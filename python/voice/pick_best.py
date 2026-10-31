"""从训练过程中自动评测的结果里挑最好的一版，设为默认音色。

评测由 _build/watch_train.sh 每轮写入 ~/Documents/大肥鱼声音/eval/watch.log：
每行一条 JSON，含 meanWer / meanF0Delta / outDir（outDir 名字就是权重文件名）。

挑法：先看字错率（低者优），再看似不像同一个人（基频偏差，小者优）。
选中的权重会：
  1. 复制到 ~/Documents/大肥鱼声音/models/tts/teacher_best.pth；
  2. 写进 GPT-SoVITS 的 tts_infer.yaml（custom 档），下次起服务直接用。

用法：python pick_best.py [--dry-run]
"""
import argparse
import json
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import common  # noqa: E402

GSV_ROOT = os.environ.get("GSV_ROOT", os.path.expanduser("~/Downloads/dfy/gpt-sovits"))
WEIGHTS_DIR = os.path.join(GSV_ROOT, "logs", "teacher_weights")
YAML = os.path.join(GSV_ROOT, "GPT_SoVITS", "configs", "tts_infer.yaml")
BEST_DIR = os.path.join(common.MODELS, "tts")


def parse_watch(path):
    entries = []
    pending = None
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line.startswith("=="):
                match = re.search(r"(teacher_e\d+_s\d+\.pth)$", line)
                pending = match.group(1) if match else None
                continue
            if line.startswith("{") and pending:
                try:
                    data = json.loads(line)
                except Exception:
                    continue
                if "meanWer" in data and data["meanWer"] is not None:
                    data["weights"] = pending
                    entries.append(data)
                pending = None
    return entries


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--watch-log", default=os.path.join(common.VOICES, "eval", "watch.log"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    compare_path = os.path.join(os.path.dirname(args.watch_log), "compare", "compare.json")
    entries = []
    if os.path.isfile(compare_path):
        try:
            data = json.load(open(compare_path, encoding="utf-8"))
            entries = [{"weights": item["weights"] + ".pth", "meanWer": item["meanWer"],
                        "meanF0Delta": item.get("meanF0Delta")} for item in data.get("rows", [])]
        except Exception:
            entries = []
    if not entries:
        if not os.path.isfile(args.watch_log):
            raise SystemExit(f"还没有评测记录：{args.watch_log}")
        entries = parse_watch(args.watch_log)
    if not entries:
        raise SystemExit("评测记录里没有可用的结果")

    entries.sort(key=lambda item: (item["meanWer"], abs(item.get("meanF0Delta") or 0)))
    best = entries[0]
    source = os.path.join(WEIGHTS_DIR, best["weights"])
    if not os.path.isfile(source):
        raise SystemExit(f"找不到权重文件：{source}")

    print(json.dumps({
        "best": best["weights"], "meanWer": best["meanWer"],
        "meanF0Delta": best.get("meanF0Delta"), "candidates": len(entries),
    }, ensure_ascii=False))

    if args.dry_run:
        return 0

    os.makedirs(BEST_DIR, exist_ok=True)
    target = os.path.join(BEST_DIR, "teacher_best.pth")
    shutil.copyfile(source, target)

    with open(YAML, encoding="utf-8") as handle:
        text = handle.read()
    # custom 档：替换 vits_weights_path（绝对路径）
    block = re.search(r"(custom:\n(?:  .*\n)+)", text)
    if not block:
        raise SystemExit("tts_infer.yaml 里没有 custom 段")
    updated = re.sub(r"(custom:\n(?:  .*\n)*?  vits_weights_path: ).*",
                     lambda m: m.group(1) + target, text, count=1)
    with open(YAML, "w", encoding="utf-8") as handle:
        handle.write(updated)
    print(json.dumps({"installed": target, "yaml": YAML}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
