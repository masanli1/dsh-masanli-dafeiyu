"""水塔网络：容量守恒、满则溢流、时间推进。

一个塔 = 一个容量有限的容器。水位 h∈[0,HMAX]，注入由数据层给，
流动由 valve.py 算，满了溢流改道（容量守恒，不丢液体），
出口塔有恒定出流：灌进去的多就涨，涨到背压把进水顶回去，最后稳在一个高度。
这是负反馈——出流是个常量，水位自己找到平衡点。

网络是两层的：

    输入塔 784 ──阀网 S0──▶  隐藏塔 64  ──阀网 S1──▶  出口塔 24  ──▶ 排水

S0、S1 是三元态矩阵（{-1,0,+1} 的整数），它们只定方向；
水位和流量是浮点，只在连续层里出现。
"""
import numpy as np

import valve as valve_mod

AREA = 10.0       # 塔的截面积
OUTFLOW = 2.0e-4  # 出口塔的恒定出流（每步、每塔）——这是反馈的参照量
DRAIN = 0.04      # 旧的"比例漏"系数，只在 drain="prop" 时用
HMAX = 1.0      # 单塔容量上限
STEPS = 25      # 一步 = 一次流动推进；25 步是这套网络的观测时刻


def overflow(v):
    """满了就溢到还有空位的塔；总量不变。"""
    over = np.maximum(0, v - HMAX)
    v = np.minimum(v, HMAX)
    tot = over.sum(1, keepdims=True)
    room = HMAX - v
    rs = room.sum(1, keepdims=True)
    return v + np.minimum(tot, rs) * room / np.maximum(rs, 1e-9)


def run(X, S0, S1, steps=STEPS, valve=None, record=False,
        drain="const", outflow=OUTFLOW):
    """X: (N, n_in) 输入塔注水量；S0: (n_in,H)；S1: (H,OUT) 三元阀态。

    record=True 时额外返回一份流量冲击统计（见 impact.py）：
    每条边累计通过的 |q| 和累计经历的 |Δh|。

    返回 (h1, h2) 或 (h1, h2, stats)。
    """
    valve = valve_mod.DEFAULT_VALVE if valve is None else valve
    N, n_in = X.shape
    H, OUT = S0.shape[1], S1.shape[1]
    h0 = np.asarray(X, dtype=np.float32)
    h1 = np.zeros((N, H), np.float32)
    h2 = np.zeros((N, OUT), np.float32)
    if record:
        f_in = np.zeros((n_in, H), np.float64)
        f_in2 = np.zeros((n_in, H), np.float64)
        d_in = np.zeros((n_in, H), np.float64)
        f_out = np.zeros((H, OUT), np.float64)
        f_out2 = np.zeros((H, OUT), np.float64)
        d_out = np.zeros((H, OUT), np.float64)
    for _ in range(steps):
        d0 = h0[:, :, None] - h1[:, None, :]
        q0 = valve.flux(d0, S0[None])                 # 沿阀流入隐藏塔
        d1 = h1[:, :, None] - h2[:, None, :]
        q1 = valve.flux(d1, S1[None])                 # 沿阀流入出口塔

        # 限流：塔里没有的水抽不出来。没有压力就没有流量，水位因此不会穿过 0。
        into = np.maximum(q0, 0).sum(1) / n_in + np.maximum(-q1, 0).sum(2) / H
        out = np.maximum(-q0, 0).sum(1) / n_in + np.maximum(q1, 0).sum(2) / H
        s1 = _limit(h1 * AREA, into, out)
        q0 = np.where(q0 < 0, q0 * s1[:, None, :], q0)
        q1 = np.where(q1 > 0, q1 * s1[:, :, None], q1)

        if record:
            f_in += np.abs(q0).mean(0)
            f_in2 += (q0 * q0).mean(0)
            d_in += np.abs(d0).mean(0)
        h1 = overflow(h1 + (q0.sum(1) / n_in - q1.sum(2) / H) / AREA)

        # 出口塔同理：倒空了就没有回流可给
        into2 = np.maximum(q1, 0).sum(1) / H
        out2 = np.maximum(-q1, 0).sum(1) / H + (outflow if drain == "const" else DRAIN * h2)
        s2 = _limit(h2 * AREA, into2, out2)
        if record:
            f_out += np.abs(q1).mean(0)
            f_out2 += (q1 * q1).mean(0)
            d_out += np.abs(d1).mean(0)
        q1 = np.where(q1 < 0, q1 * s2[:, None, :], q1)
        load = outflow if drain == "const" else DRAIN * h2
        h2 = np.clip(h2 + (q1.sum(1) / H - load) / AREA, 0, HMAX).astype(np.float32)
    if record:
        return h1, h2, dict(flow_in=f_in, flow_in2=f_in2, dp_in=d_in,
                            flow_out=f_out, flow_out2=f_out2, dp_out=d_out, steps=steps)
    return h1, h2


def _limit(volume, inflow, outflow):
    """出流不能超过"存量 + 本步流入"；超了就等比缩小。

    这是"没有压力就没有流量"的数值形式：塔见底时，出流自动收到 0，
    而不是先抽成负数再截断。
    """
    avail = np.maximum(volume + inflow, 0.0)
    return np.where(outflow > avail, avail / np.maximum(outflow, 1e-12), 1.0)
