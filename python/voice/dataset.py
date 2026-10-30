"""从「单词听力」视频里做 TTS 数据集：视频 → 干净语音片段 + 文本。

流程（每一步都能单独跑，产物落在 --out）：

    extract   .mov ──ffmpeg──► 16k 单声道 wav
    asr       wav ──faster-whisper──► 句级时间轴 + 文本
    slice     按句切出 2–10 秒片段，写成 clips/*.wav + manifest.jsonl

用法：
    python dataset.py build --src /Volumes/DISK1/单词听力 --out ~/Documents/大肥鱼声音/dataset --limit 120

注意：这批视频是「一个单词一整段讲解」，文件名是单词，但音频里是整句朗读，
所以文本必须靠 ASR/OCR，不能用文件名。
"""
import argparse
import json
import os
import random
import re
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import common  # noqa: E402

SR = 16000
AUDIO_EXT = {".mov", ".mp4", ".m4a", ".wav", ".mkv"}


def slug(text):
    return re.sub(r"[^0-9A-Za-z_\u4e00-\u9fff-]+", "_", text)[:80]


def walk_videos(root):
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            if os.path.splitext(name)[1].lower() in AUDIO_EXT:
                yield os.path.join(dirpath, name)


def pick_videos(root, limit, seed=7, max_bytes=120 * 1024 * 1024):
    """挑一批「不太大」的视频：小文件 I/O 快，句子密度也高。"""
    items = []
    for path in walk_videos(root):
        try:
            size = os.path.getsize(path)
        except OSError:
            continue
        if size > max_bytes:
            continue
        items.append((size, path))
    items.sort()
    random.seed(seed)
    # 在中小文件里随机挑，避免全是 a 开头的单词
    pool = items[: max(limit * 6, 600)]
    random.shuffle(pool)
    return [path for _size, path in pool[:limit]]


def extract(wav_path, src_path, ffmpeg):
    if os.path.isfile(wav_path) and os.path.getsize(wav_path) > 4096:
        return wav_path
    os.makedirs(os.path.dirname(wav_path), exist_ok=True)
    subprocess.run(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-nostdin", "-i", src_path,
         "-vn", "-ac", "1", "-ar", str(SR), "-c:a", "pcm_s16le", wav_path],
        check=True,
    )
    return wav_path


def load_asr(model_name, root):
    from faster_whisper import WhisperModel

    return WhisperModel(model_name, device="cpu", compute_type="int8", download_root=root)


def transcribe(model, wav_path):
    """返回 [{start, end, text}]，已经用 VAD 去掉静音。"""
    import soundfile as sf

    audio, _sr = sf.read(wav_path, dtype="float32", always_2d=False)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    segments, info = model.transcribe(
        audio,
        language="en",
        beam_size=5,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 350},
        condition_on_previous_text=False,
    )
    rows = []
    for seg in segments:
        text = seg.text.strip()
        if text:
            rows.append({"start": round(seg.start, 3), "end": round(seg.end, 3), "text": text})
    return rows, info.duration


def split_long(start, end, text, max_sec=10.0):
    """把过长的段按句子切到 max_sec 以内（时间按字数近似分配）。"""
    if end - start <= max_sec:
        return [(start, end, text)]
    parts = re.split(r"(?<=[.!?])\s+", text)
    parts = [p for p in parts if p.strip()]
    if len(parts) < 2:
        return [(start, end, text)]
    total_chars = sum(len(p) for p in parts)
    out, cursor = [], start
    for part in parts:
        share = (end - start) * len(part) / max(total_chars, 1)
        out.append((cursor, min(cursor + share, end), part))
        cursor += share
    return out


def cmd_build(args):
    import numpy as np
    import soundfile as sf

    ffmpeg = args.ffmpeg or common.find_ffmpeg()
    if not common.probe_ffmpeg(ffmpeg):
        common.fail(f"找不到 ffmpeg：{ffmpeg}")

    out = os.path.expanduser(args.out)
    audio_dir = os.path.join(out, "audio")
    clip_dir = os.path.join(out, "clips")
    os.makedirs(audio_dir, exist_ok=True)
    os.makedirs(clip_dir, exist_ok=True)

    videos = pick_videos(os.path.expanduser(args.src), args.limit)
    common.emit({"ok": True, "event": "plan", "videos": len(videos), "out": out})

    model = load_asr(args.model, os.path.join(out, "models"))
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
    total_sec = 0.0
    with open(manifest_path, "a", encoding="utf-8") as manifest:
        for index, video in enumerate(videos, 1):
            video_key = os.path.relpath(video, os.path.expanduser(args.src))
            if video_key in done:
                continue
            started = time.time()
            wav = os.path.join(audio_dir, slug(os.path.splitext(video_key)[0]) + ".wav")
            try:
                extract(wav, video, ffmpeg)
                rows, duration = transcribe(model, wav)
            except Exception as error:
                common.emit({"ok": False, "event": "skip", "video": video_key, "error": str(error)})
                continue
            audio, _sr = sf.read(wav, dtype="float32", always_2d=False)
            if audio.ndim > 1:
                audio = audio.mean(axis=1)
            for row in rows:
                for start, end, text in split_long(row["start"], row["end"], row["text"]):
                    dur = end - start
                    if dur < args.min_dur or dur > args.max_dur:
                        continue
                    # 太短的句子读不出几帧，直接丢
                    if len(text) < 8:
                        continue
                    clip_name = f"{slug(os.path.splitext(video_key)[0])}_{int(start*1000):07d}.wav"
                    clip_path = os.path.join(clip_dir, clip_name)
                    begin = int(start * SR)
                    finish = min(len(audio), int(end * SR) + int(0.05 * SR))
                    piece = audio[max(0, begin - int(0.05 * SR)):finish]
                    peak = float(np.max(np.abs(piece))) if piece.size else 0.0
                    if peak < 0.02:
                        continue
                    piece = np.clip(piece / peak * 0.9, -1, 1)
                    sf.write(clip_path, piece, SR, subtype="PCM_16")
                    manifest.write(json.dumps({
                        "audio": os.path.relpath(clip_path, out),
                        "text": text,
                        "duration": round(len(piece) / SR, 3),
                        "video": video_key,
                        "start": start,
                    }, ensure_ascii=False) + "\n")
                    kept += 1
                    total_sec += len(piece) / SR
            manifest.flush()
            common.emit({
                "ok": True, "event": "video", "index": index, "total": len(videos),
                "video": video_key, "sentences": len(rows), "kept": kept,
                "hours": round(total_sec / 3600, 3), "seconds": round(time.time() - started, 1),
            })
    common.emit({"ok": True, "event": "done", "clips": kept, "hours": round(total_sec / 3600, 3)})
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("build")
    p.add_argument("--src", default="/Volumes/DISK1/单词听力")
    p.add_argument("--out", default=os.path.join(common.VOICES, "dataset"))
    p.add_argument("--limit", type=int, default=120)
    p.add_argument("--model", default="large-v3")
    p.add_argument("--min-dur", type=float, default=1.2)
    p.add_argument("--max-dur", type=float, default=12.0)
    p.add_argument("--ffmpeg", default=None)
    p.set_defaults(func=cmd_build)
    args = parser.parse_args(argv)
    return args.func(args) or 0


if __name__ == "__main__":
    sys.exit(main())
