"""常驻语音唤醒：一直听麦克风，说到唤醒词就吐一行 JSON。

父进程（DSH 插件）负责显示和反应，这里只管「听见」：

    python wakeword.py --keyword 大肥鱼 --model-dir ~/Documents/大肥鱼声音/models/kws

输出（逐行 JSON，便于 Node 侧按行解析）：
    {"ok": true, "event": "ready", "keyword": "大肥鱼", "device": ":0"}
    {"ok": true, "event": "wake", "keyword": "大肥鱼"}
    {"ok": false, "event": "error", "error": "..."}

麦克风用 ffmpeg 的 avfoundation 采集（macOS 自带，无需额外依赖），
直接以 16k 单声道 s16le 流式喂给 sherpa-onnx 的关键词检测器。
"""
import argparse
import json
import os
import signal
import subprocess
import sys
import time
import urllib.request

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import common  # noqa: E402
import keywords as kw  # noqa: E402

SAMPLE_RATE = 16000
BYTES_PER_SAMPLE = 2
# 0.1 秒一个块：延迟够低，又不会把 CPU 打满
CHUNK_SAMPLES = SAMPLE_RATE // 10
CHUNK_BYTES = CHUNK_SAMPLES * BYTES_PER_SAMPLE


def log(payload):
    common.emit(payload)


def build_spotter(model_dir, keywords_file, threshold, score, threads):
    import sherpa_onnx

    def path(name):
        return os.path.join(model_dir, name)

    return sherpa_onnx.KeywordSpotter(
        tokens=path("tokens.txt"),
        encoder=path("encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx"),
        decoder=path("decoder-epoch-12-avg-2-chunk-16-left-64.onnx"),
        joiner=path("joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx"),
        keywords_file=keywords_file,
        num_threads=threads,
        keywords_threshold=threshold,
        keywords_score=score,
        provider="cpu",
    )


class Mic:
    """把 ffmpeg 的麦克风采集包装成「一次读一块」的迭代器。"""

    def __init__(self, ffmpeg, device, level):
        self.ffmpeg = ffmpeg
        self.device = device
        self.level = level
        self.proc = None

    def start(self):
        self.proc = subprocess.Popen(
            [
                self.ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin",
                "-f", "avfoundation", "-i", self.device,
                "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "s16le", "-",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0,
        )

    def read(self, size=CHUNK_BYTES):
        if self.proc is None or self.proc.stdout is None:
            return b""
        return self.proc.stdout.read(size)

    def close(self):
        if self.proc is None:
            return
        proc, self.proc = self.proc, None
        try:
            proc.terminate()
            proc.wait(timeout=3)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass


class WavFeed:
    """自测用：把一段 wav 当麦克风喂进来（和 Mic 同样的 read/close 接口）。"""

    def __init__(self, path):
        import wave

        self.path = path
        self.handle = None
        self.buffer = b""

    def start(self):
        import wave

        self.handle = wave.open(self.path, "rb")
        if self.handle.getframerate() != SAMPLE_RATE or self.handle.getnchannels() != 1:
            raise SystemExit(f"{self.path} 需要 16k 单声道 wav")
        self.buffer = self.handle.readframes(self.handle.getnframes())

    def read(self, size=CHUNK_BYTES):
        block, self.buffer = self.buffer[:size], self.buffer[size:]
        return block

    def close(self):
        if self.handle is not None:
            try:
                self.handle.close()
            except Exception:
                pass
            self.handle = None

    def alive(self):
        return bool(self.buffer)


def post(url, payload, timeout=2.0):
    try:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers={"content-type": "application/json"})
        urllib.request.urlopen(req, timeout=timeout).read()
        return True
    except Exception as error:  # 网络不是致命问题，事件已经在 stdout 里了
        log({"ok": False, "event": "post-failed", "error": str(error)})
        return False


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--keyword", default="大肥鱼", help="唤醒词，多个用逗号分隔")
    parser.add_argument("--model-dir", default=common.KWS_MODEL)
    parser.add_argument("--device", default=":0", help="avfoundation 输入，默认 :0（第一个麦克风）")
    parser.add_argument("--ffmpeg", default=None)
    parser.add_argument("--threshold", type=float, default=0.25)
    parser.add_argument("--score", type=float, default=1.5)
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--cooldown", type=float, default=2.0, help="触发后的冷却秒数")
    parser.add_argument("--http", default="", help="触发时额外 POST 到这个地址")
    parser.add_argument("--once", action="store_true", help="触发一次就退出（自测用）")
    parser.add_argument("--wav", default="", help="自测：从 wav 文件喂音频，不开麦克风")
    parser.add_argument("--keywords-file", default="", help="直接用现成的关键词文件")
    parser.add_argument("--dump-dir", default="", help="触发时把最近 3 秒存成 wav（自测用）")
    args = parser.parse_args(argv)

    ffmpeg = args.ffmpeg or common.find_ffmpeg()
    if not args.wav and not common.probe_ffmpeg(ffmpeg):
        log({"ok": False, "event": "error", "error": f"找不到可用的 ffmpeg：{ffmpeg}"})
        return 2

    if not common.kws_ready(args.model_dir):
        log({"ok": False, "event": "error", "error": f"唤醒模型不完整：{args.model_dir}（先跑 setup.py）"})
        return 3

    phrases = [p.strip() for p in args.keyword.replace("，", ",").split(",") if p.strip()]
    if args.keywords_file:
        keywords_file = args.keywords_file
    else:
        keywords_file = os.path.join(common.RUNTIME, "keywords.txt")
        try:
            lines = kw.write_keywords(phrases, keywords_file)
        except SystemExit as error:
            log({"ok": False, "event": "error", "error": str(error)})
            return 4
        log({"ok": True, "event": "keywords", "lines": lines})

    try:
        spotter = build_spotter(args.model_dir, keywords_file, args.threshold, args.score, args.threads)
    except Exception as error:
        log({"ok": False, "event": "error", "error": f"唤醒模型加载失败：{error}"})
        return 5

    stop = {"flag": False}

    def handle_signal(signum, _frame):
        stop["flag"] = True

    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            signal.signal(sig, handle_signal)
        except Exception:
            pass

    if args.wav:
        feed = WavFeed(args.wav)
    else:
        feed = Mic(ffmpeg, args.device, None)
    log({"ok": True, "event": "ready", "keyword": ",".join(phrases), "device": args.device,
         "model": args.model_dir, "ffmpeg": ffmpeg})

    recent = []  # 最近几秒的原始音频，触发时方便回放排查
    keep_chunks = int(3 / 0.1)
    last_hit = 0.0
    restarts = 0

    while not stop["flag"]:
        try:
            feed.start()
        except Exception as error:
            log({"ok": False, "event": "error", "error": f"麦克风启动失败：{error}"})
            time.sleep(2)
            continue

        stream = spotter.create_stream()
        silent_since = time.time()
        try:
            while not stop["flag"]:
                block = feed.read()
                if not block:
                    break
                silent_since = time.time()
                if len(block) % BYTES_PER_SAMPLE:
                    block = block[: len(block) - (len(block) % BYTES_PER_SAMPLE)]
                if not block:
                    continue
                samples = np.frombuffer(block, dtype="<i2").astype(np.float32) / 32768.0
                stream.accept_waveform(SAMPLE_RATE, samples)
                recent.append(block)
                if len(recent) > keep_chunks:
                    recent.pop(0)

                hit = ""
                while spotter.is_ready(stream):
                    spotter.decode_stream(stream)
                    result = spotter.get_result(stream)
                    if result:
                        hit = result
                        spotter.reset_stream(stream)
                        break
                if hit:
                    now = time.time()
                    if now - last_hit < args.cooldown:
                        continue
                    last_hit = now
                    event = {"ok": True, "event": "wake", "keyword": hit, "at": int(now * 1000)}
                    log(event)
                    if args.http:
                        post(args.http, event)
                    if args.dump_dir:
                        try:
                            os.makedirs(args.dump_dir, exist_ok=True)
                            path = os.path.join(args.dump_dir, time.strftime("wake-%H%M%S.wav"))
                            raw = b"".join(recent)
                            import wave

                            with wave.open(path, "wb") as handle:
                                handle.setnchannels(1)
                                handle.setsampwidth(2)
                                handle.setframerate(SAMPLE_RATE)
                                handle.writeframes(raw)
                            log({"ok": True, "event": "dump", "path": path})
                        except Exception as error:
                            log({"ok": False, "event": "error", "error": f"存样失败：{error}"})
                    if args.once:
                        return 0
                # 麦克风没了（拔掉、被系统抢占）时等一会儿再说
                if (not args.wav) and time.time() - silent_since > 1.0 and feed.proc and feed.proc.poll() is not None:
                    break
                if args.wav and not feed.alive():
                    # 文件放完了：补静音、收尾再走一遍解码，然后直接结束
                    pad = np.zeros(int(SAMPLE_RATE * 0.66), dtype=np.float32)
                    stream.accept_waveform(SAMPLE_RATE, pad)
                    stream.input_finished()
                    while spotter.is_ready(stream):
                        spotter.decode_stream(stream)
                        result = spotter.get_result(stream)
                        if result:
                            log({"ok": True, "event": "wake", "keyword": result, "at": int(time.time() * 1000)})
                            spotter.reset_stream(stream)
                    stop["flag"] = True
                    break
        except Exception as error:
            log({"ok": False, "event": "error", "error": f"监听中断：{error}"})
        finally:
            feed.close()

        if stop["flag"]:
            break
        restarts += 1
        backoff = min(0.5 * restarts, 5.0)
        log({"ok": False, "event": "restart", "attempt": restarts, "afterSeconds": backoff})
        time.sleep(backoff)

    log({"ok": True, "event": "stopped"})
    return 0


if __name__ == "__main__":
    sys.exit(main())
