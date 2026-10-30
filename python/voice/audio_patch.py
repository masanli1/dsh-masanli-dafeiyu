"""把 torchaudio 的读写换成 soundfile。

torchaudio 2.11 起把解码交给 torchcodec，而 torchcodec 要加载系统 ffmpeg 的
动态库（libavutil.*.dylib）；这台机器只有静态 ffmpeg，没有 /opt/homebrew/opt/ffmpeg，
于是 `torchaudio.load()` 会抛 "Could not load libtorchcodec"。

我们用 soundfile（自带 libsndfile）顶上这两个函数就够了：
  torchaudio.load(path) -> (Tensor[channels, time], sample_rate)
  torchaudio.save(path, tensor, sample_rate)
"""
import numpy as np
import soundfile as sf
import torch


def patch():
    import torchaudio

    if getattr(torchaudio, "_dfy_patched", False):
        return

    def load(path, **kwargs):
        data, sample_rate = sf.read(str(path), dtype="float32", always_2d=True)
        return torch.from_numpy(np.ascontiguousarray(data.T)), int(sample_rate)

    def save(path, src, sample_rate, **kwargs):
        array = src.detach().cpu().numpy() if hasattr(src, "detach") else np.asarray(src)
        if array.ndim == 2:
            array = array.T
        sf.write(str(path), array, int(sample_rate), subtype="PCM_16")

    def info(path, **kwargs):
        meta = sf.info(str(path))
        return _Info(meta)


    class _Info:
        def __init__(self, meta):
            self.sample_rate = int(meta.samplerate)
            self.num_frames = int(meta.frames)
            self.num_channels = int(meta.channels)
            self.bits_per_sample = int(meta.subtype.split("_")[-1]) if "PCM" in meta.subtype else 16

    torchaudio.load = load
    torchaudio.save = save
    torchaudio.info = info
    torchaudio._dfy_patched = True
