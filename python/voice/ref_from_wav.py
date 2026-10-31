"""把一段人声变成「克隆音色的参考」：自动转写 + 裁成 3–10 秒 + 存成 wav/txt。

这是新的「声音复刻」：不再学 EQ 包络，而是给 GPT-SoVITS 准备参考音频和
它对应的文本（参考文本必须一字不差，写错会直接把音素带偏）。

    python ref_from_wav.py --wav 我的声音.m4a --name teacher
    # → ~/Documents/大肥鱼声音/ref/teacher.wav + teacher.txt

参数：
  --start/--end   只取其中一段（秒），不填就自动挑最像「连续说话」的一段
  --text          直接给文本，跳过 ASR
"""
import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import common  # noqa: E402

SR = 32000
WHISPER_ROOT = os.path.join(common.VOICES, "_build", "models")


def load_audio(path, ffmpeg):
    """统一解成 32k 单声道 float32（非 wav 先过 ffmpeg）。"""
    import numpy as np
    import soundfile as sf

    ext = os.path.splitext(path)[1].lower()
    if ext == ".wav":
        data, sr = sf.read(path, dtype="float32", always_2d=False)
        if data.ndim > 1:
            data = data.mean(axis=1)
        if sr != SR:
            target = int(len(data) * SR / sr)
            data = np.interp(np.linspace(0, len(data), target), np.arange(len(data)), data)
        return data
    tmp = os.path.join(common.RUNTIME, "ref-decode.wav")
    os.makedirs(os.path.dirname(tmp), exist_ok=True)
    import subprocess

    subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", path,
                    "-ac", "1", "-ar", str(SR), "-c:a", "pcm_s16le", tmp], check=True)
    data, _ = sf.read(tmp, dtype="float32", always_2d=False)
    if data.ndim > 1:
        data = data.mean(axis=1)
    return data


def voice_activity(data, sr=SR, frame=0.02):
    """简单的能量 VAD，返回 (起始秒, 结束秒)。"""
    import numpy as np

    size = int(sr * frame)
    usable = data[: len(data) - len(data) % size].reshape(-1, size)
    energy = np.sqrt((usable ** 2).mean(axis=1))
    threshold = max(float(energy.max()) * 0.06, 1e-4)
    voiced = np.where(energy > threshold)[0]
    if voiced.size == 0:
        return 0.0, len(data) / sr
    return voiced[0] * frame, (voiced[-1] + 1) * frame


def pick_window(data, sr=SR, target=8.0):
    """挑一段 target 秒左右、尽量都在说话的片段。"""
    import numpy as np

    total = len(data) / sr
    if total <= target + 1:
        return 0.0, total
    start, end = voice_activity(data, sr)
    best_start, best_score = start, -1.0
    step = 0.5
    while start + target <= end + 0.5:
        piece = data[int(start * sr): int((start + target) * sr)]
        score = float(np.sqrt((piece ** 2).mean()))
        if score > best_score:
            best_score, best_start = score, start
        start += step
    return best_start, min(best_start + target, total)


def transcribe(data, model_name="large-v3"):
    import numpy as np
    from faster_whisper import WhisperModel

    model = WhisperModel(model_name, device="cpu", compute_type="int8", download_root=WHISPER_ROOT)
    segments, info = model.transcribe(np.ascontiguousarray(data), language="en", beam_size=5, vad_filter=False)
    text = " ".join(seg.text.strip() for seg in segments).strip()
    return text, info.language


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--wav", required=True)
    parser.add_argument("--name", default="")
    parser.add_argument("--out-dir", default=os.path.join(common.VOICES, "ref"))
    parser.add_argument("--start", type=float, default=None)
    parser.add_argument("--end", type=float, default=None)
    parser.add_argument("--text", default="")
    parser.add_argument("--seconds", type=float, default=8.0)
    parser.add_argument("--whisper", default="large-v3")
    args = parser.parse_args(argv)

    import numpy as np
    import soundfile as sf

    ffmpeg = common.find_ffmpeg()
    if not common.probe_ffmpeg(ffmpeg):
        common.fail(f"找不到 ffmpeg：{ffmpeg}")

    source = os.path.expanduser(args.wav)
    if not os.path.isfile(source):
        common.fail(f"找不到音频：{source}")

    data = load_audio(source, ffmpeg)
    sr = SR
    if args.start is not None or args.end is not None:
        start = max(0.0, args.start or 0.0)
        end = min(args.end if args.end else (start + args.seconds), len(data) / sr)
    else:
        start, end = pick_window(data, sr, args.seconds)
    piece = data[int(start * sr): int(end * sr)]
    peak = float(np.max(np.abs(piece))) if piece.size else 0.0
    if peak < 1e-3:
        common.fail("这段音频几乎没有声音")
    # 统一响度，避免参考太小声导致合成也小
    piece = piece / peak * 0.9

    text = args.text.strip()
    if not text:
        text, language = transcribe(piece, args.whisper)
        if not text:
            common.fail("没转写出文本，可以用 --text 手动给")
    else:
        language = "en"
    text = re.sub(r"\s+", " ", text).strip()

    name = args.name.strip() or os.path.splitext(os.path.basename(source))[0]
    name = re.sub(r"[^\w\-]+", "_", name)[:40]
    out_dir = os.path.expanduser(args.out_dir)
    os.makedirs(out_dir, exist_ok=True)
    wav_path = os.path.join(out_dir, f"{name}.wav")
    text_path = os.path.join(out_dir, f"{name}.txt")
    sf.write(wav_path, piece, sr, subtype="PCM_16")
    with open(text_path, "w", encoding="utf-8") as handle:
        handle.write(text + "\n")

    common.emit({
        "ok": True,
        "event": "reference",
        "wav": wav_path,
        "text": text,
        "textPath": text_path,
        "seconds": round(len(piece) / sr, 2),
        "start": round(start, 2),
        "language": language,
    })
    return 0


if __name__ == "__main__":
    sys.exit(main())
