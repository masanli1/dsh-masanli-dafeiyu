"""一条命令换掉宠物的音色：音频 →（可选转写/裁切）→ 写进插件设置。

    python pick_voice.py --wav 候选5.wav
    python pick_voice.py --wav 我的录音.m4a --name my --text "参考音频里那句话"

它会：
  1. 需要时先用 ref_from_wav 把音频裁成 6–8 秒、配好文本；
  2. 找到当前 DSH 页面的地址（插件把最新 Host 写在 ~/.dsh/dsh-dafeiyu-webui.txt）；
  3. PATCH 插件配置：ttsEngine=clone、ttsRefAudio、ttsPromptText。
"""
import argparse
import json
import os
import subprocess
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import common  # noqa: E402

WEBUI_HINT = os.path.join(os.path.expanduser("~"), ".dsh", "dsh-dafeiyu-webui.txt")


def base_url():
    try:
        url = open(WEBUI_HINT, encoding="utf-8").read().strip()
        if url:
            return url.rstrip("/")
    except OSError:
        pass
    return ""


def patch_config(base, patch):
    body = json.dumps(patch, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(f"{base}/plugins/dsh-dafeiyu/config", data=body, method="PATCH",
                                 headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def ensure_reference(wav, name, text, seconds):
    """没有同名 .txt 就先做一遍参考（裁切 + 转写）。"""
    wav = os.path.expanduser(wav)
    stem = os.path.splitext(wav)[0]
    text_path = stem + ".txt"
    if os.path.isfile(text_path) and not text:
        return wav, open(text_path, encoding="utf-8").read().strip()
    if text:
        with open(text_path, "w", encoding="utf-8") as handle:
            handle.write(text.strip() + "\n")
        return wav, text.strip()

    python = sys.executable
    script = os.path.join(HERE, "ref_from_wav.py")
    env = dict(os.environ, HF_ENDPOINT=os.environ.get("HF_ENDPOINT", "https://hf-mirror.com"))
    proc = subprocess.run([python, script, "--wav", wav, "--name", name or "ref", "--seconds", str(seconds)],
                          capture_output=True, text=True, env=env)
    payload = None
    for line in proc.stdout.splitlines():
        if line.strip().startswith("{"):
            try:
                payload = json.loads(line)
            except Exception:
                pass
    if not payload or not payload.get("ok"):
        raise SystemExit((proc.stderr or proc.stdout or "生成参考失败").strip()[-400:])
    return payload["wav"], payload["text"]


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--wav", required=True)
    parser.add_argument("--name", default="")
    parser.add_argument("--text", default="", help="参考音频对应文本；不填会尝试读同名 .txt，再不行就转写")
    parser.add_argument("--seconds", type=float, default=8.0)
    parser.add_argument("--url", default="")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    wav, text = ensure_reference(args.wav, args.name, args.text, args.seconds)
    patch = {"ttsEngine": "clone", "ttsRefAudio": wav, "ttsPromptText": text}
    base = args.url or base_url()
    result = {"ok": True, "wav": wav, "text": text, "base": base, "patch": patch}

    if args.dry_run or not base:
        result["applied"] = False
        result["hint"] = ("dry-run：没有写配置" if args.dry_run
                          else "没找到页面地址（先打开一次 DSH 页面），或手动把 wav/text 填进设置")
        print(json.dumps(result, ensure_ascii=False))
        return 0

    try:
        config = patch_config(base, patch)
    except Exception as error:
        result["ok"] = False
        result["error"] = str(error)
        print(json.dumps(result, ensure_ascii=False))
        return 1
    result["applied"] = True
    result["engine"] = config.get("ttsEngine")
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
