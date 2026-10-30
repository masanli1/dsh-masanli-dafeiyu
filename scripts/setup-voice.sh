#!/usr/bin/env bash
# 准备「语音唤醒 + 本地语音」运行时。
#
#   1. 单独装一个 Python（DSH 自带的 Python 开了硬运行时校验，
#      加载不了 onnxruntime 这类第三方 .so，所以语音单独用一份）；
#   2. 建 venv，装 numpy / sherpa-onnx / soundfile / pypinyin；
#   3. 下载唤醒词模型（约 36MB）到 ~/Documents/大肥鱼声音/models/kws。
#
# 全部文件都在用户目录，重装插件不会丢。可以重复执行（幂等）。
set -euo pipefail

VOICE_HOME="${VOICE_HOME:-$HOME/.dsh/dsh-dafeiyu/voice}"
MODELS="${MODELS:-$HOME/Documents/大肥鱼声音/models}"
KWS_DIR="$MODELS/kws"
PY="$VOICE_HOME/python"
VENV="$VOICE_HOME/venv"
MIRROR="${PIP_MIRROR:-https://pypi.tuna.tsinghua.edu.cn/simple}"
GH_PROXY="${GH_PROXY:-https://gh-proxy.com/}"
PY_URL="https://github.com/astral-sh/python-build-standalone/releases/download/20241016/cpython-3.12.7%2B20241016-aarch64-apple-darwin-install_only.tar.gz"
KWS_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01.tar.bz2"

say() { printf '\033[1m%s\033[0m\n' "$*"; }

mkdir -p "$VOICE_HOME" "$MODELS"

if [ ! -x "$PY/bin/python3.12" ]; then
  say "① 下载独立 Python 3.12（约 15MB）"
  tmp="$(mktemp -d)"
  curl -sSL --http1.1 -m 600 -o "$tmp/py.tar.gz" "${GH_PROXY}${PY_URL}"
  tar xzf "$tmp/py.tar.gz" -C "$tmp"
  mkdir -p "$PY"
  cp -R "$tmp"/python/* "$PY"/
  rm -rf "$tmp"
fi

if [ ! -x "$VENV/bin/python" ]; then
  say "② 建虚拟环境"
  "$PY/bin/python3.12" -m venv "$VENV"
fi

say "③ 安装依赖（numpy / sherpa-onnx / soundfile / pypinyin）"
"$VENV/bin/python" -m pip install -q -i "$MIRROR" --upgrade pip
"$VENV/bin/python" -m pip install -q -i "$MIRROR" numpy sherpa-onnx soundfile pypinyin

if [ ! -f "$KWS_DIR/tokens.txt" ]; then
  say "④ 下载唤醒词模型（约 36MB）"
  mkdir -p "$KWS_DIR"
  tmp="$(mktemp -d)"
  curl -sSL --http1.1 -m 900 -C - -o "$tmp/kws.tar.bz2" "${GH_PROXY}${KWS_URL}" || true
  tar xjf "$tmp/kws.tar.bz2" -C "$KWS_DIR" --strip-components=1
  rm -rf "$tmp"
fi

say "⑤ 自检"
"$VENV/bin/python" - <<'PY'
import os, sys
import numpy, sherpa_onnx, soundfile, pypinyin
home = os.path.expanduser("~")
kws = os.path.join(home, "Documents", "大肥鱼声音", "models", "kws")
need = ["tokens.txt",
        "encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
        "decoder-epoch-12-avg-2-chunk-16-left-64.onnx",
        "joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx"]
missing = [n for n in need if not os.path.isfile(os.path.join(kws, n))]
print("python", sys.version.split()[0], "| numpy", numpy.__version__, "| sherpa-onnx OK")
print("唤醒模型", "完整" if not missing else f"缺 {missing}")
sys.exit(1 if missing else 0)
PY

say "完成：在「大肥鱼设置 → 语音」里打开语音唤醒，喊「大肥鱼」试试。"
