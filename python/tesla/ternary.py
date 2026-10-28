"""三元层：只认 {-1, 0, +1}。这里没有一个浮点运算。

它不读水位、不算流量、不做比较以外的事。它只回答一个问题：
这条边上的流动，是**顺着阀**、**逆着阀**、还是**没有路**。

三元语义（设计量，不是流体状态）：

    +1   阀正装 —— 顺阀口朝 i→j
    -1   阀反装 —— 顺阀口朝 j→i
     0   无阀   —— 这条边上没有元件，不通行

注意：0 不是"阀关死"。真阀没有关断态，关断是数字电路的概念。

唯一的运算是三元乘法：

    direction = state × sign(Δh)

    state=+1, Δh>0 → +1   顺着阀，快
    state=+1, Δh<0 → -1   逆着阀，慢
    state=-1, Δh>0 → -1   逆着阀，慢
    state=-1, Δh<0 → +1   顺着阀，快
    state= 0, 任意 →  0   没有路

乘出来还是 {-1,0,+1}——三元对三元封闭，不产生浮点。
"多快"不归这一层管，归连续层（valve.py）。
"""
import numpy as np

STATES = (-1, 0, 1)


def direction(state, delta):
    """state: {-1,0,+1} 阀态；delta: 水位差（只取符号用）。

    返回 int8 的 {-1,0,+1}：+1 顺阀（快），-1 逆阀（慢），0 无边。
    """
    state = np.asarray(state, dtype=np.int8)
    sgn = np.sign(delta).astype(np.int8)
    return (state * sgn).astype(np.int8)


def is_open(code):
    return code != 0


def counts(code):
    return {s: int((code == s).sum()) for s in STATES}
