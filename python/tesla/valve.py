"""连续层：容量差驱动的水流，阀只决定"顺"还是"逆"。

物理
----
层流下，两个塔之间的流动服从 Δp = R·q，也就是

    q = (V_i − V_j) / R_dir ,        V = 容量 = 截面积 × 水位

阀不做通断，它只让**回流绕远路**：顺阀口是主通道（路短，R 小），
逆阀口要过环回支路（路长，R 大）。所以两向都通，只是逆流慢。

    R_rev / R_fwd = K_rev / K_fwd = Di        （Di 由几何给出）

    K_fwd = N·(f·L/D + ζ_分汇流 + ζ_弯头)
    K_rev = K_fwd + N·k_block·λ²·sin²θ        （环回支路带来的额外路程）

两层的关系
----------
    ternary.direction(state, Δh) → {-1,0,+1}   只给方向，整数
    本模块把这个方向码翻译成 g_fwd / g_rev / 0，再乘 Δh 得到流量

一个约定常数
------------
g_fwd = 1/R_fwd 是管路的电导，单位是"每步、每单位水位差推进的容量"。
它由机器本身决定（管径、管长、黏度、步长），不是拟合出来的。
默认 2.1 —— 对应"单位水位差在一步内推过约两个单位的容量"。
这是这套量纲里唯一需要外部指定的数；Di 那边全部由几何算。

用法
----
    from valve import TeslaValve
    v = TeslaValve()
    q = v.flux(delta_h, state)      # 与网络同符号约定
    v.describe()
"""
from dataclasses import dataclass

import numpy as np

import ternary


@dataclass(frozen=True)
class TeslaGeometry:
    """一只 N 级特斯拉阀的几何（默认 = 一个可加工的毫米级阀）。"""
    D: float = 2.0e-3            # 主通道水力直径 m
    L: float = 8.0e-3            # 单级主通道长 m
    n_stages: int = 3            # 串联级数
    loop_ratio: float = 0.45     # 环回支路直径 / 主通道直径 λ
    theta_deg: float = 40.0      # 环回支路汇入角 θ
    k_block_gain: float = 4.0    # 环回带来的额外路程系数
    zeta_junction: float = 0.15  # 分/汇流局部损失
    zeta_bend: float = 0.25      # 环回弯头损失
    f_straight: float = 0.02     # 直管沿程系数

    @property
    def LD(self) -> float:
        return self.L / self.D

    def k_form(self):
        """返回 (K_顺流, K_逆流)，无量纲阻力系数。"""
        per_stage = self.f_straight * self.LD + self.zeta_junction + self.zeta_bend
        k_fwd = self.n_stages * per_stage
        theta = np.deg2rad(self.theta_deg)
        k_block = self.n_stages * self.k_block_gain * self.loop_ratio ** 2 * np.sin(theta) ** 2
        return float(k_fwd), float(k_fwd + k_block)


DEFAULT_GEOMETRY = TeslaGeometry()


class TeslaValve:
    """(水位差, 阀态) → 流量。方向归三元层，快慢归这里。"""

    def __init__(self, geom: TeslaGeometry = DEFAULT_GEOMETRY, g_fwd: float = 2.1):
        self.geom = geom
        self.k_fwd, self.k_rev = geom.k_form()
        self.di = self.k_rev / self.k_fwd           # 回流绕远路的倍率
        self.g_fwd = float(g_fwd)                   # 顺阀电导（机器常数）
        self.g_rev = self.g_fwd / self.di           # 逆阀电导：慢 Di 倍

    def flux(self, delta, state):
        """delta: 水位差 h_i − h_j；state: 阀态 {-1,0,+1}。

        返回"沿阀导通方向流入 j 的量"，直接加进 j 的水量。
        """
        delta = np.asarray(delta)
        code = ternary.direction(state, delta)                    # 纯三元
        g = np.where(code > 0, self.g_fwd,
                     np.where(code < 0, self.g_rev, 0.0)).astype(delta.dtype)  # 连续层
        return np.asarray(state) * g * delta

    def describe(self, verbose=True):
        lines = [
            f"几何  N={self.geom.n_stages}级  D={self.geom.D*1e3:.2f}mm  L={self.geom.L*1e3:.2f}mm"
            f"  λ={self.geom.loop_ratio:.2f}  θ={self.geom.theta_deg:.0f}°",
            f"阻力  K_fwd={self.k_fwd:.3f}  K_rev={self.k_rev:.3f}  →  Di={self.di:.2f}",
            f"电导  g_fwd={self.g_fwd:.3f}  g_rev={self.g_rev:.3f}   （顺快、逆慢 {self.di:.2f} 倍）",
            "",
            f"{'Δh':>7} {'顺流 q':>9} {'逆流 q':>9}",
        ]
        for d in (0.001, 0.005, 0.01, 0.05, 0.1, 0.3):
            lines.append(f"{d:7.3f} {float(self.flux(d, 1)):9.5f} {float(self.flux(d, -1)):9.5f}")
        out = "\n".join(lines)
        if verbose:
            print(out)
        return out


DEFAULT_VALVE = TeslaValve()


if __name__ == "__main__":
    DEFAULT_VALVE.describe()
