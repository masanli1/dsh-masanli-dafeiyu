"""把训练过程中保存的每一版权重都用同一套句子再评一遍，挑出最好的。

    python compare_ckpts.py [--weights ~/Downloads/dfy/gpt-sovits/logs/teacher_weights]
                            [--out ~/Documents/大肥鱼声音/eval/compare]

流程：逐个 /set_sovits_weights 热换 → eval_tts.py 合成 8 句 → 回听算 WER。
结果按 meanWer 排序打印，并写 compare.json。
"""
import argparse
import glob
import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import common  # noqa: E402

EVAL = os.path.join(HERE, "eval_tts.py")


def set_weights(url, path):
    query = urllib.parse.urlencode({"weights_path": path})
    with urllib.request.urlopen(f"{url}/set_sovits_weights?{query}", timeout=180) as response:
        return response.status


def eval_one(python, url, out_dir):
    proc = subprocess.run([python, EVAL, "--url", url, "--out", out_dir],
                          capture_output=True, text=True)
    lines = [line for line in proc.stdout.splitlines() if line.strip().startswith("{")]
    for line in reversed(lines):
        try:
            data = json.loads(line)
        except Exception:
            continue
        if data.get("meanWer") is not None:
            return data
    return None


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--weights", default=os.path.join(
        os.environ.get("GSV_ROOT", os.path.expanduser("~/Downloads/dfy/gpt-sovits")),
        "logs", "teacher_weights"))
    parser.add_argument("--url", default="http://127.0.0.1:9880")
    parser.add_argument("--out", default=os.path.join(common.VOICES, "eval", "compare"))
    parser.add_argument("--python", default=os.path.join(common.RUNTIME, "tts", "bin", "python"))
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args(argv)

    files = sorted(glob.glob(os.path.join(args.weights, "teacher_e*_s*.pth")),
                   key=lambda path: int(os.path.basename(path).split("_")[1][1:]))
    if args.limit:
        files = files[-args.limit:]
    if not files:
        raise SystemExit(f"{args.weights} 里没有权重文件")

    os.makedirs(args.out, exist_ok=True)
    rows = []
    for path in files:
        name = os.path.basename(path)[:-4]
        try:
            set_weights(args.url, path)
        except Exception as error:
            print(json.dumps({"weights": name, "error": str(error)}, ensure_ascii=False))
            continue
        result = eval_one(args.python, args.url, os.path.join(args.out, name))
        if not result:
            print(json.dumps({"weights": name, "error": "评测没有输出"}, ensure_ascii=False))
            continue
        rows.append({"weights": name, "path": path, "meanWer": result["meanWer"],
                     "meanF0Delta": result.get("meanF0Delta")})
        print(json.dumps(rows[-1], ensure_ascii=False), flush=True)

    rows.sort(key=lambda item: (item["meanWer"], abs(item.get("meanF0Delta") or 0)))
    summary = {"ok": True, "best": rows[0] if rows else None, "rows": rows}
    with open(os.path.join(args.out, "compare.json"), "w", encoding="utf-8") as handle:
        json.dump(summary, handle, ensure_ascii=False, indent=2)
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
