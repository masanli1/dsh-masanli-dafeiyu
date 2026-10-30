"""给 TTS 做个客观体检：合成 → 回听（ASR）→ 和对的原句比字错率 → 比音高。

    python eval_tts.py --url http://127.0.0.1:9880 --ref ref/teacher.wav --prompt-file ref/teacher.txt

不依赖主观听力：用 faster-whisper 把合成结果转回文字，和原文对比（WER），
再用自相关估基频，比较「像不像同一个人」（中位 F0 差得越小越像）。
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import common  # noqa: E402

SENTENCES = [
    "This word is abnormal. It means something is not normal.",
    "Please read the sentence aloud one more time.",
    "He was embarrassed by the question, but he answered it.",
]


def synth(url, text, ref, prompt, out):
    query = urllib.parse.urlencode({
        "text": text,
        "text_lang": "en",
        "ref_audio_path": ref,
        "prompt_text": prompt,
        "prompt_lang": "en",
        "text_split_method": "cut5",
        "batch_size": 1,
        "media_type": "wav",
    })
    with urllib.request.urlopen(f"{url}/tts?{query}", timeout=300) as response:
        data = response.read()
    with open(out, "wb") as handle:
        handle.write(data)
    return out


def normalize(text):
    return re.sub(r"[^a-z0-9' ]+", " ", text.lower()).split()


def wer(reference, hypothesis):
    ref, hyp = normalize(reference), normalize(hypothesis)
    if not ref:
        return 1.0
    previous = list(range(len(hyp) + 1))
    for i, word in enumerate(ref, 1):
        current = [i]
        for j, other in enumerate(hyp, 1):
            cost = 0 if word == other else 1
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost))
        previous = current
    return previous[-1] / len(ref)


def median_f0(path, sr_target=16000):
    import numpy as np
    import soundfile as sf

    data, sr = sf.read(path, dtype="float32", always_2d=False)
    if data.ndim > 1:
        data = data.mean(axis=1)
    if sr != sr_target:
        # 线性插值重采样，够用了
        target_len = int(len(data) * sr_target / sr)
        data = np.interp(np.linspace(0, len(data), target_len), np.arange(len(data)), data)
        sr = sr_target
    frame, hop = int(sr * 0.04), int(sr * 0.02)
    values = []
    for i in range(0, max(1, len(data) - frame), hop):
        piece = data[i:i + frame]
        if float(np.sqrt((piece ** 2).mean())) < 0.02:
            continue
        piece = piece - piece.mean()
        corr = np.correlate(piece, piece, "full")[frame - 1:]
        low, high = int(sr / 350), int(sr / 70)
        if high >= len(corr):
            continue
        lag = low + int(np.argmax(corr[low:high]))
        if corr[lag] > 0.3 * corr[0]:
            values.append(sr / lag)
    return float(np.median(values)) if values else 0.0


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:9880")
    parser.add_argument("--ref", default=os.path.join(common.VOICES, "ref", "teacher.wav"))
    parser.add_argument("--prompt-file", default=os.path.join(common.VOICES, "ref", "teacher.txt"))
    parser.add_argument("--model", default="small")
    parser.add_argument("--whisper-root", default=os.path.join(common.VOICES, "_build", "models"))
    parser.add_argument("--out", default="")
    args = parser.parse_args(argv)

    prompt = open(args.prompt_file, encoding="utf-8").read().strip()
    from faster_whisper import WhisperModel

    model = WhisperModel(args.model, device="cpu", compute_type="int8", download_root=args.whisper_root)
    ref_f0 = median_f0(args.ref)
    out_dir = args.out or tempfile.mkdtemp(prefix="dfy-eval-")
    os.makedirs(out_dir, exist_ok=True)

    rows = []
    for index, text in enumerate(SENTENCES, 1):
        path = os.path.join(out_dir, f"eval{index}.wav")
        try:
            synth(args.url, text, args.ref, prompt, path)
        except Exception as error:
            rows.append({"text": text, "error": str(error)})
            continue
        import numpy as np
        import soundfile as sf

        info = sf.info(path)
        audio, sr_in = sf.read(path, dtype="float32", always_2d=False)
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        segments, _ = model.transcribe(np.ascontiguousarray(audio), language="en", beam_size=1)
        heard = " ".join(seg.text.strip() for seg in segments)
        rows.append({
            "text": text,
            "heard": heard,
            "wer": round(wer(text, heard), 3),
            "seconds": round(info.frames / info.samplerate, 2),
            "f0": round(median_f0(path)),
            "f0Delta": round(median_f0(path) - ref_f0),
        })
        print(json.dumps(rows[-1], ensure_ascii=False), flush=True)

    ok = [row for row in rows if "wer" in row]
    summary = {
        "ok": True,
        "refF0": round(ref_f0),
        "meanWer": round(sum(row["wer"] for row in ok) / len(ok), 3) if ok else None,
        "meanF0Delta": round(sum(abs(row["f0Delta"]) for row in ok) / len(ok)) if ok else None,
        "outDir": out_dir,
        "rows": rows,
    }
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
