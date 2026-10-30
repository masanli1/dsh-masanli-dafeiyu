"""用「画面字幕」做 TTS 数据集：比纯 ASR 准，因为字幕就是原文。

这套视频的排版是固定的：一句英文 + 一句中文译文，换句时整块刷新。
所以做法是：

  1. ffmpeg 的 scene 检测找出「画面变了」的时刻（也就是换句的时刻）；
  2. 对每个时刻截一帧，用 macOS Vision OCR 两遍（en-US / zh-Hans），
     en 保英文空格，zh 保中文断句，按 y 坐标合并；
  3. 相邻两帧文字相同就并成一张「字幕卡」，卡的存活时间 = 这句话的时间窗；
  4. 按时间窗切音频、去掉首尾静音、响度归一到 -20 dBFS；
  5. 过滤时长/文本不合格的片段，写 manifest.jsonl。

用法：
    python dataset_ocr.py build --src /Volumes/DISK1/单词听力 --limit 60
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import common  # noqa: E402

SR = 16000
VIDEO_EXT = {".mov", ".mp4", ".mkv"}

CJK = re.compile(r"[\u4e00-\u9fff]")
LATIN = re.compile(r"[A-Za-z]")
SCENE_THRESHOLD = 0.02


def slug(text):
    return re.sub(r"[^0-9A-Za-z_\u4e00-\u9fff-]+", "_", text)[:80]


def ensure_ocr():
    """Vision OCR 工具：有二进制直接用，没有就用 swiftc 现编一个。"""
    binary = os.path.join(common.VOICES, "bin", "ocr")
    source = os.path.join(HERE, "ocr.swift")
    if os.path.isfile(binary) and os.access(binary, os.X_OK):
        return binary
    if not os.path.isfile(source):
        return ""
    os.makedirs(os.path.dirname(binary), exist_ok=True)
    subprocess.run(["swiftc", "-O", source, "-o", binary], check=True)
    return binary


def scene_times(video, ffmpeg):
    """返回画面突变的时刻（秒），已按 0.4 秒去重。"""
    proc = subprocess.run(
        [ffmpeg, "-hide_banner", "-nostdin", "-i", video,
         "-vf", f"select='gt(scene,{SCENE_THRESHOLD})',showinfo", "-vsync", "vfr", "-f", "null", "-"],
        capture_output=True, text=True, errors="ignore",
    )
    times = []
    for match in re.finditer(r"pts_time:([0-9.]+)", proc.stderr):
        value = float(match.group(1))
        if not times or value - times[-1] > 0.4:
            times.append(value)
    return times


def frame_at(video, ffmpeg, when, path):
    subprocess.run(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
         "-ss", f"{max(when, 0):.3f}", "-i", video, "-frames:v", "1",
         "-vf", "scale=iw*1.5:ih*1.5:flags=lanczos", path],
        check=True,
    )
    return os.path.isfile(path)


def run_ocr_batch(ocr, images, langs):
    """一次进程 OCR 一批图，返回 {图片路径: [行...]}。"""
    if not images:
        return {}
    proc = subprocess.run([ocr, "--langs", langs, *images], capture_output=True, text=True, errors="ignore")
    rows = {}
    for line in proc.stdout.splitlines():
        parts = line.split("\t", 3)
        if len(parts) != 4:
            continue
        path, y, confidence, text = parts
        try:
            row = {"y": float(y), "confidence": float(confidence), "text": text.strip()}
        except ValueError:
            continue
        rows.setdefault(path, []).append(row)
    return rows


def pick_text(rows):
    """一行英文 + 一行中文；英文取最像整句的那条。"""
    english = [r for r in rows if LATIN.search(r["text"]) and not CJK.search(r["text"])]
    chinese = [r for r in rows if CJK.search(r["text"])]
    english.sort(key=lambda r: r["y"])
    chinese.sort(key=lambda r: r["y"])
    text = english[0]["text"] if english else ""
    return text, (chinese[0]["text"] if chinese else ""), (english[0]["confidence"] if english else 0.0)


def text_score(text):
    if not text:
        return -1.0
    score = len(text)
    if text[-1] in ".!?":
        score += 20
    if text[:1].islower():
        score -= 15  # 多半是从中间截断的
    return score


def build_cards(frames):
    """相邻帧文字一样就并成一张卡，卡的时间窗 = [start, next_start)。"""
    cards = []
    for frame in frames:
        if not frame or not frame["text"]:
            continue
        if cards and cards[-1]["text"] == frame["text"]:
            continue
        cards.append({"start": frame["at"], "text": frame["text"],
                      "textZh": frame.get("textZh", ""), "confidence": frame.get("confidence", 0)})
    return cards


def read_cards(ocr, ffmpeg, video, times, workdir, key):
    """每张字幕卡取两帧（切换后 0.45s 和卡片中点），挑文本最完整的那帧。"""
    import hashlib

    probes = []  # (card_index, time, path)
    stamp = hashlib.md5(key.encode("utf-8")).hexdigest()[:10]
    for index, when in enumerate(times):
        end = times[index + 1] if index + 1 < len(times) else None
        candidates = [when + 0.45]
        if end and end - when > 2.0:
            candidates.append((when + end) / 2)
        for n, at in enumerate(candidates):
            path = os.path.join(workdir, f"{stamp}_{index:03d}_{n}.png")
            if frame_at(video, ffmpeg, at, path):
                probes.append((index, at, path))
    if not probes:
        return []
    images = [item[2] for item in probes]
    en_rows = run_ocr_batch(ocr, images, "en-US,zh-Hans")
    zh_rows = run_ocr_batch(ocr, images, "zh-Hans,en-US")
    best = {}
    for index, at, path in probes:
        text, _zh, confidence = pick_text(en_rows.get(path, []))
        if not text:
            continue
        _, text_zh, _ = pick_text(zh_rows.get(path, []))
        score = text_score(text)
        if index not in best or score > best[index]["score"]:
            best[index] = {"start": times[index], "text": text, "textZh": text_zh,
                           "confidence": confidence, "score": score}
    return [best[index] for index in sorted(best)]


def speech_ratio(audio, frame=320):
    """粗算有声比例，用来丢掉纯静音/只剩尾音的片段。"""
    import numpy as np

    if audio.size < frame:
        return 0.0
    usable = audio[: len(audio) - len(audio) % frame].reshape(-1, frame)
    energy = np.sqrt((usable ** 2).mean(axis=1))
    threshold = max(0.01, float(np.median(energy)) * 0.6)
    return float((energy > threshold).mean())


def trim_silence(audio, sr=SR, pad=0.06):
    import numpy as np

    frame = int(sr * 0.02)
    if audio.size < frame * 4:
        return audio
    usable = audio[: len(audio) - len(audio) % frame].reshape(-1, frame)
    energy = np.sqrt((usable ** 2).mean(axis=1))
    threshold = max(float(energy.max()) * 0.05, 1e-4)
    voiced = np.where(energy > threshold)[0]
    if voiced.size == 0:
        return audio
    begin = max(0, int(voiced[0] * frame - pad * sr))
    end = min(len(audio), int((voiced[-1] + 1) * frame + pad * sr))
    return audio[begin:end]


def cmd_build(args):
    import numpy as np
    import soundfile as sf

    ffmpeg = args.ffmpeg or common.find_ffmpeg()
    if not common.probe_ffmpeg(ffmpeg):
        common.fail(f"找不到 ffmpeg：{ffmpeg}")
    ocr = ensure_ocr()
    if not ocr:
        common.fail("找不到 Vision OCR 工具（python/voice/ocr.swift，需要 swiftc 编译）")

    src = os.path.expanduser(args.src)
    out = os.path.expanduser(args.out)
    clips_dir = os.path.join(out, "clips")
    work = os.path.join(out, "work")
    os.makedirs(clips_dir, exist_ok=True)
    os.makedirs(work, exist_ok=True)

    videos = []
    for dirpath, _dirs, names in os.walk(src):
        for name in names:
            if os.path.splitext(name)[1].lower() in VIDEO_EXT:
                videos.append(os.path.join(dirpath, name))
    videos.sort()
    if args.limit:
        videos = videos[: args.limit]

    manifest_path = os.path.join(out, "manifest.jsonl")
    done = set()
    if os.path.isfile(manifest_path):
        with open(manifest_path, encoding="utf-8") as handle:
            for line in handle:
                try:
                    done.add(json.loads(line)["video"])
                except Exception:
                    pass

    kept = 0
    seconds = 0.0
    with open(manifest_path, "a", encoding="utf-8") as manifest:
        for index, video in enumerate(videos, 1):
            key = os.path.relpath(video, src)
            if key in done:
                continue
            started = time.time()
            try:
                wav_path = os.path.join(work, slug(key) + ".wav")
                subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
                                "-i", video, "-vn", "-ac", "1", "-ar", str(SR),
                                "-c:a", "pcm_s16le", wav_path], check=True)
                audio, _sr = sf.read(wav_path, dtype="float32", always_2d=False)
                times = scene_times(video, ffmpeg)
                cards = read_cards(ocr, ffmpeg, video, times, work, key)
            except Exception as error:
                common.emit({"ok": False, "event": "skip", "video": key, "error": str(error)})
                continue

            duration = len(audio) / SR
            made = 0
            for i, card in enumerate(cards):
                start = card["start"]
                end = cards[i + 1]["start"] if i + 1 < len(cards) else duration
                span = end - start
                if span < args.min_dur - 0.4 or span > args.max_dur + 3:
                    continue
                text = card["text"]
                if len(text) < args.min_chars or not LATIN.search(text):
                    continue
                piece = audio[int(max(0, start - 0.08) * SR): int(min(duration, end - 0.08) * SR)]
                if piece.size == 0:
                    continue
                ratio = speech_ratio(piece)
                if ratio < 0.25:
                    continue
                piece = trim_silence(piece)
                clip_dur = len(piece) / SR
                if clip_dur < args.min_dur or clip_dur > args.max_dur:
                    continue
                peak = float(np.max(np.abs(piece)))
                if peak < 1e-3:
                    continue
                piece = piece / peak * 0.9
                name = f"{slug(os.path.splitext(key)[0])}_{int(start * 1000):07d}.wav"
                sf.write(os.path.join(clips_dir, name), piece, SR, subtype="PCM_16")
                manifest.write(json.dumps({
                    "audio": os.path.join("clips", name),
                    "text": text,
                    "textZh": card["textZh"],
                    "duration": round(clip_dur, 3),
                    "video": key,
                    "start": round(start, 2),
                    "ocrConfidence": round(card["confidence"], 3),
                }, ensure_ascii=False) + "\n")
                kept += 1
                made += 1
                seconds += clip_dur
            manifest.flush()
            common.emit({"ok": True, "event": "video", "index": index, "total": len(videos),
                         "video": key, "cards": len(cards), "kept": made, "total_kept": kept,
                         "hours": round(seconds / 3600, 3), "seconds": round(time.time() - started, 1)})
    common.emit({"ok": True, "event": "done", "clips": kept, "hours": round(seconds / 3600, 3)})
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("build")
    p.add_argument("--src", default="/Volumes/DISK1/单词听力")
    p.add_argument("--out", default=os.path.join(common.VOICES, "dataset-ocr"))
    p.add_argument("--limit", type=int, default=60)
    p.add_argument("--min-dur", type=float, default=1.5)
    p.add_argument("--max-dur", type=float, default=12.0)
    p.add_argument("--min-chars", type=int, default=12)
    p.add_argument("--ffmpeg", default=None)
    p.set_defaults(func=cmd_build)
    args = parser.parse_args(argv)
    return args.func(args) or 0


if __name__ == "__main__":
    sys.exit(main())
