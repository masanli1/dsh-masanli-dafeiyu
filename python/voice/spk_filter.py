"""按「像不像同一个人」筛数据集。

这套单词课里混了电影原声，整库音高从 100 Hz 铺到 300 Hz 就是多说话人的证据。
微调单个音色时，混进来的别人会把音色平均掉。这里用 speechbrain 的 ECAPA 说话人
向量给每条片段打分，只留下和参考音频最像的那一批。

    python spk_filter.py analyze   # 打分 + 看分布（写 spk.npz / spk.json）
    python spk_filter.py keep --percentile 70   # 生成过滤后的 list
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import common  # noqa: E402

SR = 16000
MODEL_DIR = os.path.join(common.VOICES, "_build", "models", "spkrec-ecapa")


def load_classifier():
    import torch
    from speechbrain.inference.speaker import EncoderClassifier

    return EncoderClassifier.from_hparams(
        source="speechbrain/spkrec-ecapa-voxceleb", savedir=MODEL_DIR, run_opts={"device": "cpu"},
    )


def embed(clf, path):
    import numpy as np
    import soundfile as sf
    import torch

    data, sr = sf.read(path, dtype="float32", always_2d=False)
    if data.ndim > 1:
        data = data.mean(axis=1)
    if sr != SR:
        target = int(len(data) * SR / sr)
        data = np.interp(np.linspace(0, len(data), target), np.arange(len(data)), data)
    tensor = torch.from_numpy(np.ascontiguousarray(data)).unsqueeze(0)
    with torch.no_grad():
        vector = clf.encode_batch(tensor)
    return vector.squeeze().numpy()


def cmd_analyze(args):
    import numpy as np

    clf = load_classifier()
    manifest = os.path.join(os.path.expanduser(args.dataset), "manifest.jsonl")
    rows = []
    with open(manifest, encoding="utf-8") as handle:
        for line in handle:
            try:
                rows.append(json.loads(line))
            except Exception:
                continue
    print(json.dumps({"clips": len(rows)}, ensure_ascii=False), flush=True)

    names, vectors = [], []
    for index, row in enumerate(rows, 1):
        path = os.path.join(os.path.expanduser(args.dataset), row["audio"])
        if not os.path.isfile(path):
            continue
        try:
            vector = embed(clf, path)
        except Exception:
            continue
        names.append(os.path.basename(path))
        vectors.append(vector)
        if index % 200 == 0:
            print(json.dumps({"done": index}, ensure_ascii=False), flush=True)

    matrix = np.vstack(vectors).astype("float32")
    reference = embed(clf, os.path.expanduser(args.ref))
    sims = matrix @ reference / (np.linalg.norm(matrix, axis=1) * np.linalg.norm(reference) + 1e-9)
    np.savez_compressed(os.path.join(os.path.expanduser(args.dataset), "spk.npz"),
                        names=np.array(names), vectors=matrix, sims=sims)
    order = np.argsort(-sims)
    report = {
        "clips": len(names),
        "similarity": {
            "p10": round(float(np.percentile(sims, 10)), 3),
            "p25": round(float(np.percentile(sims, 25)), 3),
            "median": round(float(np.percentile(sims, 50)), 3),
            "p75": round(float(np.percentile(sims, 75)), 3),
            "p90": round(float(np.percentile(sims, 90)), 3),
        },
        "topClips": [names[i] for i in order[:5]],
    }
    print(json.dumps(report, ensure_ascii=False))
    return 0


def cmd_keep(args):
    import numpy as np

    dataset = os.path.expanduser(args.dataset)
    data = np.load(os.path.join(dataset, "spk.npz"), allow_pickle=True)
    names, sims = data["names"], data["sims"]
    threshold = float(np.percentile(sims, args.percentile))
    keep = {name for name, sim in zip(names, sims) if sim >= threshold}

    rows = []
    with open(os.path.join(dataset, "manifest.jsonl"), encoding="utf-8") as handle:
        for line in handle:
            try:
                row = json.loads(line)
            except Exception:
                continue
            if os.path.basename(row["audio"]) in keep:
                rows.append(row)

    out_list = os.path.expanduser(args.out)
    os.makedirs(os.path.dirname(out_list) or ".", exist_ok=True)
    import re

    lines = []
    for row in rows:
        text = re.sub(r"^[-–—\s]+", "", str(row.get("text", "")).strip())
        text = re.sub(r"\s+", " ", text).strip()
        if len(text) < 12 or text[-1] not in ".!?":
            continue
        lines.append(f"{os.path.join(dataset, row['audio'])}|teacher|en|{text}")
    with open(out_list, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
    seconds = sum(float(row.get("duration") or 0) for row in rows)
    print(json.dumps({"ok": True, "list": out_list, "clips": len(lines),
                      "hours": round(seconds / 3600, 2), "threshold": round(threshold, 3)},
                     ensure_ascii=False))
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("analyze")
    p.add_argument("--dataset", default=os.path.join(common.VOICES, "dataset-ocr2"))
    p.add_argument("--ref", default=os.path.join(common.VOICES, "ref", "teacher.wav"))
    p.set_defaults(func=cmd_analyze)
    p = sub.add_parser("keep")
    p.add_argument("--dataset", default=os.path.join(common.VOICES, "dataset-ocr2"))
    p.add_argument("--percentile", type=float, default=70)
    p.add_argument("--out", default=os.path.join(common.VOICES, "dataset-ocr2", "teacher_pure.list"))
    p.set_defaults(func=cmd_keep)
    args = parser.parse_args(argv)
    return args.func(args) or 0


if __name__ == "__main__":
    sys.exit(main())
