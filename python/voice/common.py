"""语音模块的公共路径与小工具（唤醒 / TTS 共用）。

约定：模型和学习成果都放在用户目录，插件的代码目录只放逻辑。
  ~/Documents/大肥鱼声音/models/kws     唤醒词模型
  ~/Documents/大肥鱼声音/models/tts     TTS 模型
  ~/Documents/大肥鱼声音/<名字>/        学出来的音色
"""
import json
import os
import shutil
import subprocess
import sys

HOME = os.path.expanduser("~")
VOICES = os.path.join(HOME, "Documents", "大肥鱼声音")
MODELS = os.path.join(VOICES, "models")
KWS_MODEL = os.path.join(MODELS, "kws")
TTS_MODEL = os.path.join(MODELS, "tts")
RUNTIME = os.path.join(HOME, ".dsh", "dsh-dafeiyu", "voice")

# sherpa-onnx KWS 官方中文模型（zipformer，3.3M，约 36MB）
KWS_URL = (
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/"
    "sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01.tar.bz2"
)

# 这些文件齐了才算模型可用
KWS_FILES = (
    "tokens.txt",
    "encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
    "decoder-epoch-12-avg-2-chunk-16-left-64.onnx",
    "joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
)


def emit(payload):
    """给父进程（Node 插件）读的一行 JSON。"""
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def find_ffmpeg():
    """找一个能录/转音频的 ffmpeg。"""
    candidates = [
        os.environ.get("DF_FACTORY_FFMPEG"),
        os.path.join(VOICES, "bin", "ffmpeg"),
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        shutil.which("ffmpeg"),
    ]
    # 装了 NPSS 降噪 App 的话，它自带一份 imageio-ffmpeg
    for app in ("NPSS-Enhancer v3.3.1.app", "NPSS-Enhancer.app"):
        base = os.path.join("/Applications", app, "Contents", "Resources", "imageio_ffmpeg", "binaries")
        if os.path.isdir(base):
            for name in sorted(os.listdir(base)):
                if name.startswith("ffmpeg"):
                    candidates.append(os.path.join(base, name))
    # DSH 运行时里也可能装了一份
    runtime_site = os.path.join(
        HOME, ".dsh", "dsh-runtimes", "dsh-primary-runtime",
        "dependencies", "python", "lib", "python3.12", "site-packages",
        "imageio_ffmpeg", "binaries", "ffmpeg-macos-aarch64-v7.1",
    )
    candidates.append(runtime_site)
    for path in candidates:
        if path and os.path.isfile(path) and os.access(path, os.X_OK):
            return path
    return "ffmpeg"


def probe_ffmpeg(path):
    try:
        out = subprocess.run([path, "-version"], capture_output=True, timeout=10)
        return out.returncode == 0
    except OSError:
        return False


def kws_ready(model_dir=KWS_MODEL):
    return all(os.path.isfile(os.path.join(model_dir, name)) for name in KWS_FILES)


def fail(message, code=2):
    emit({"ok": False, "error": message})
    sys.exit(code)
