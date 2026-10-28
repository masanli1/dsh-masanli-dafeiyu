"""声音复刻：把一段声音的「频谱包络」学下来，再用它给大肥鱼换音色。

水塔网络在这里当「储层」用：输入是固定的驱动序列，出口 24 塔的水位
就是 24 个频段的能量。调阀 = 调这个包络，所以阀态本身就是"一个音色"。

  learn --wav 样本.wav --name 名字 --rounds 12   学一个音色（存阀态 + 频段）
  speak --voice 名字 --text "..." [--out out.wav]  用这个音色说话
  list                                           列出学过的音色
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import towers  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
VOICES = os.path.expanduser(os.path.join("~", "Documents", "大肥鱼声音"))
SR = 16000
BANDS = 24
STATES = (-1, 0, 1)
FFMPEG = os.environ.get("DF_FACTORY_FFMPEG", "ffmpeg")
SAY = "/usr/bin/say"
AFPLAY = "/usr/bin/afplay"


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def decode(path):
    with tempfile.NamedTemporaryFile(suffix=".raw", delete=False) as handle:
        raw = handle.name
    try:
        subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", path,
                        "-ac", "1", "-ar", str(SR), "-f", "s16le", raw], check=True)
        data = np.fromfile(raw, dtype="<i2").astype(np.float32) / 32768.0
    finally:
        try: os.unlink(raw)
        except OSError: pass
    if data.size < SR // 4:
        raise SystemExit("音频太短")
    return data


def band_edges(n=BANDS, lo=80.0, hi=7500.0):
    return np.geomspace(lo, hi, n + 1)


def band_energies(x, n=BANDS):
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2
    freqs = np.fft.rfftfreq(len(x), 1 / SR)
    edges = band_edges(n)
    out = np.zeros(n, dtype=np.float64)
    for index in range(n):
        mask = (freqs >= edges[index]) & (freqs < edges[index + 1])
        out[index] = spec[mask].sum()
    return np.log10(out + 1e-12)


def envelope_from_bands(bands_log, length, n=BANDS):
    """把 24 个频段增益展开成整条频响曲线（对数频率插值）。"""
    edges = band_edges(n)
    centers = np.sqrt(edges[:-1] * edges[1:])
    freqs = np.fft.rfftfreq(length, 1 / SR)
    return np.interp(np.log10(np.maximum(freqs, 1.0)), np.log10(centers), bands_log)


def apply_voice(x, bands_log):
    curve = envelope_from_bands(bands_log, len(x))
    return np.fft.irfft(np.fft.rfft(x) * curve, len(x))


def run_state(drive, S0, S1, steps=25):
    h1 = np.zeros((1, S0.shape[1]), np.float32)
    h2 = np.zeros((1, S1.shape[1]), np.float32)
    valve = None
    for _ in range(steps):
        _, h1, h2 = towers.run(drive, S0, S1, steps=1)[0], h1, h2
        break
    return h2


def fit_bands(drive, S0, S1, target, rounds, seed=0):
    """用阀态去拟合目标频段能量（驱动固定，出口塔水位即包络）。"""
    rng = np.random.default_rng(seed)
    H = S0.shape[1]
    O = S1.shape[1]
    # 输入驱动：固定伪随机的水位向量（相当于"激励"）
    X = drive

    def predict(a, b):
        L = towers.run(X, a, b)[1][0]
        v = np.log10(np.abs(L) + 1e-9)
        return (v - v.mean()) / (v.std() + 1e-9)

    target_n = (target - target.mean()) / (target.std() + 1e-9)
    def mse(a, b):
        return float(np.mean((predict(a, b) - target_n) ** 2))

    best = mse(S0, S1)
    best_state = (S0.copy(), S1.copy())
    trace = []
    n_edges = S0.size + S1.size
    per_round = max(16, n_edges // 400)
    for round_index in range(1, rounds + 1):
        improved = False
        for _ in range(4):
            a, b = best_state[0].copy(), best_state[1].copy()
            flat = np.concatenate([a.ravel(), b.ravel()])
            pick = rng.choice(flat.size, per_round, replace=False)
            flat[pick] = rng.choice(STATES, per_round)
            candidate = mse(flat[:a.size].reshape(a.shape), flat[a.size:].reshape(b.shape))
            if candidate < best - 1e-9:
                best = candidate
                best_state = (flat[: a.size].reshape(a.shape), flat[a.size:].reshape(b.shape))
                improved = True
                trace.append({"round": round_index, "mse": round(best, 6), "accepted": True})
                emit(trace[-1])
                break
        if not improved:
            trace.append({"round": round_index, "mse": round(best, 6), "accepted": False})
            emit(trace[-1])
    return best_state, best, trace


def cmd_learn(args):
    x = decode(args.wav)
    target = band_energies(x)
    os.makedirs(os.path.join(VOICES, args.name), exist_ok=True)
    rng = np.random.default_rng(0)
    S0 = rng.choice(STATES, size=(784, 64)).astype(np.int8)
    S1 = rng.choice(STATES, size=(64, BANDS)).astype(np.int8)
    drive = rng.random((1, 784)).astype(np.float32) * 0.5 + 0.5
    state, mse, trace = fit_bands(drive, S0, S1, target, args.rounds)
    out = os.path.join(VOICES, args.name)
    np.savez_compressed(os.path.join(out, "state.npz"), S0=state[0], S1=state[1], drive=drive)
    meta = {"name": args.name, "kind": "voice", "bands": [round(float(v), 4) for v in target],
            "mse": round(mse, 6), "seconds": 0, "trace": trace,
            "source": args.wav, "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S")}
    with open(os.path.join(out, "meta.json"), "w", encoding="utf-8") as handle:
        json.dump(meta, handle, ensure_ascii=False, indent=2)
    emit({"ok": True, "event": "learned", "name": args.name, "mse": round(mse, 6), "dir": out})


def load_voice(name):
    path = os.path.join(VOICES, name, "meta.json")
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def cmd_speak(args):
    meta = load_voice(args.voice)
    bands = np.asarray(meta["bands"], dtype=np.float64)
    with tempfile.TemporaryDirectory() as tmp:
        aiff = os.path.join(tmp, "say.aiff")
        subprocess.run([SAY, "-v", args.say_voice, "-o", aiff, args.text], check=True)
        x = decode(aiff)
        y = apply_voice(x, bands)
        out = args.out or os.path.join(tmp, "out.wav")
        y = np.clip(y / (np.abs(y).max() + 1e-9) * 0.9, -1, 1)
        pcm = (y * 32767).astype("<i2")
        subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-f", "s16le",
                        "-ar", str(SR), "-ac", "1", "-i", "-", out], input=pcm.tobytes(), check=True)
        if not args.no_play:
            subprocess.run([AFPLAY, out])
    emit({"ok": True, "event": "spoken", "voice": args.voice, "text": args.text, "out": args.out or ""})


def cmd_apply(args):
    meta = load_voice(args.voice)
    bands = np.asarray(meta["bands"], dtype=np.float64)
    x = decode(args.inp)
    y = apply_voice(x, bands)
    y = np.clip(y / (np.abs(y).max() + 1e-9) * 0.9, -1, 1)
    pcm = (y * 32767).astype("<i2")
    subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-f", "s16le",
                    "-ar", str(SR), "-ac", "1", "-i", "-", args.out], input=pcm.tobytes(), check=True)
    emit({"ok": True, "event": "applied", "voice": args.voice, "out": args.out})


def cmd_list(args):
    if not os.path.isdir(VOICES):
        emit({"ok": True, "voices": []})
        return
    voices = []
    for name in sorted(os.listdir(VOICES)):
        try:
            voices.append(load_voice(name))
        except OSError:
            voices.append({"name": name})
    emit({"ok": True, "voices": voices})


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("learn")
    p.add_argument("--wav", required=True)
    p.add_argument("--name", required=True)
    p.add_argument("--rounds", type=int, default=12)
    p.set_defaults(func=cmd_learn)

    p = sub.add_parser("speak")
    p.add_argument("--voice", required=True)
    p.add_argument("--text", required=True)
    p.add_argument("--out", default=None)
    p.add_argument("--say-voice", default="Tingting")
    p.add_argument("--no-play", action="store_true")
    p.set_defaults(func=cmd_speak)

    p = sub.add_parser("apply")
    p.add_argument("--voice", required=True)
    p.add_argument("--in", dest="inp", required=True)
    p.add_argument("--out", required=True)
    p.set_defaults(func=cmd_apply)

    p = sub.add_parser("list")
    p.set_defaults(func=cmd_list)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
