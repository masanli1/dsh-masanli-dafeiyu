"""编码：把传入数据变成“水塔的注水量”。这一层只管数据形式。"""
import gzip

import numpy as np


def load_mnist(images_gz, labels_gz):
    with gzip.open(images_gz, "rb") as f:
        f.read(4)
        n = int.from_bytes(f.read(4), "big")
        r = int.from_bytes(f.read(4), "big")
        c = int.from_bytes(f.read(4), "big")
        X = np.frombuffer(f.read(), dtype=np.uint8).reshape(n, r, c).astype(np.float32) / 255.0
    with gzip.open(labels_gz, "rb") as f:
        f.read(8)
        y = np.frombuffer(f.read(), dtype=np.uint8).astype(np.int64)
    return X, y


def encode(images):
    """28×28 原样铺开成 784 个输入塔，总注水量归一成 1。

    不做池化——原始数据就是 28×28，784 个塔一一对应 784 个像素。
    """
    z = images.reshape(len(images), -1).astype(np.float32)
    return z / (z.sum(axis=1, keepdims=True) + 1e-6)
