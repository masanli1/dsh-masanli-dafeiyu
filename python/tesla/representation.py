"""三值表示：0 无阀、+1 正装、-1 反装。

这三个值是**设计量**——这条边上放不放阀、朝哪边装。它们不是流体状态，
也不参与流量计算；流量那一侧由 valve.py 根据方向码给出。

真阀没有关断态，所以 0 不是"阀关死"，是"这里没有元件"。
"""
import numpy as np

STATES = (-1, 0, 1)


class TernaryValves:
    """一块 {-1,0,+1} 的阀阵，形状 = (上游塔数, 下游塔数)。"""

    def __init__(self, shape, rng=None, init="random"):
        rng = rng or np.random.default_rng(0)
        if init == "random":
            self.state = rng.choice(STATES, size=shape).astype(np.int8)
        else:
            self.state = np.zeros(shape, dtype=np.int8)

    # ---- 语义 ----
    @property
    def open_mask(self):
        return self.state != 0

    def sparsity(self):
        return float((self.state == 0).mean())

    def counts(self):
        return {s: int((self.state == s).sum()) for s in STATES}

    # ---- 复制 / 变换 ----
    def copy(self):
        v = TernaryValves(self.state.shape)
        v.state = self.state.copy()
        return v

    def assign(self, idx, values):
        self.state.ravel()[idx] = values

    def crossover(self, other, rng):
        v = TernaryValves(self.state.shape)
        v.state = np.where(rng.random(self.state.shape) < 0.5, self.state, other.state)
        return v

    def mutate(self, frac, rng, allow_zero=True):
        v = self.copy()
        mask = rng.random(self.state.shape) < frac
        vals = rng.choice(STATES if allow_zero else (-1, 1), size=int(mask.sum()))
        v.state[mask] = vals
        return v
