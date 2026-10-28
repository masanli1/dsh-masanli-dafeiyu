"""流量冲击统计：看哪里在动，决定哪里该细分、哪里该合并。

为什么需要
----------
抉择层要把 64 个隐藏塔分成若干块并行推进。等分（6 个塔一块）是无信息的：
有的塔一秒过几十个单位的水，有的塔几乎不动；把它们放在一块里，
一块里 90% 的阀态改了也等于没改，白白花掉一次适应度。

冲击 = 这条边实际过了多少水、经历了多大压差
--------------------------------------------
跑一遍网络（`towers.run(record=True)`），对每条边累计：

    flow  累计 |q|      —— 过了多少水
    dp    累计 |Δh|     —— 挨了多大压差

对隐藏塔 j，它的冲击是"进水侧 + 出水侧"的吞吐：

    impact[j] = Σ_i flow_in[i, j] + Σ_k flow_out[j, k]

分组：按冲击等量分，不按个数等分
--------------------------------
把塔按冲击从大到小排，累加，每 `总冲击/G` 切一刀。
结果自然就是：冲击大的塔自己一块（它一票就顶满一格），
冲击小的塔合并成一块（几十个塔才顶一格）。

也就是说，**分块的分辨率跟着流量走**：哪里在动，哪里就切细。

用法
----
    from impact import measure, partition, describe
    _, _, stats = measure(X, S0, S1)
    describe(stats)
    blocks = partition(stats, groups=8)      # 直接喂给 BlockSelector
"""
import numpy as np

import towers


def measure(X, S0, S1, steps=towers.STEPS, valve=None, batch=128):
    """跑一遍网络，收集流量冲击统计。"""
    acc = None
    for i in range(0, len(X), batch):
        _, _, s = towers.run(X[i:i + batch], S0, S1, steps=steps, valve=valve, record=True)
        if acc is None:
            acc = {k: v.copy() for k, v in s.items() if k != "steps"}
        else:
            for k in acc:
                acc[k] += s[k]
    acc["steps"] = steps
    acc["n_samples"] = len(X)
    return acc


def tower_impact(stats):
    """每个隐藏塔的吞吐（进 + 出）。"""
    return stats["flow_in"].sum(0) + stats["flow_out"].sum(1)


def tower_variability(stats):
    """跨样本的波动：同一座塔在不同数字下过水量差多少。

    吞吐高但波动小的塔，对分类没用——它每一步都走同样的水。
    """
    n = stats["n_samples"] * stats["steps"]
    m_in = stats["flow_in"] / n
    v_in = np.maximum(stats["flow_in2"] / n - m_in ** 2, 0)
    m_out = stats["flow_out"] / n
    v_out = np.maximum(stats["flow_out2"] / n - m_out ** 2, 0)
    return v_in.sum(0) + v_out.sum(1)


def tower_dp(stats):
    """每个隐藏塔两侧的平均压差。"""
    return stats["dp_in"].mean(0) + stats["dp_out"].mean(1)


def partition(stats, groups, n_in, H, OUT, metric="flow"):
    """按冲击等量切块，返回扁平状态的下标数组（同 BlockSelector.blocks 的格式）。"""
    imp = tower_impact(stats) if metric == "flow" else tower_variability(stats)
    order = np.argsort(-imp, kind="stable")
    csum = np.cumsum(imp[order])
    total = csum[-1] if csum[-1] > 0 else 1.0

    bins, start = [], 0
    for g in range(1, groups):
        target = total * g / groups
        cut = int(np.searchsorted(csum, target))
        cut = min(max(cut + 1, start + 1), H - (groups - g))
        bins.append(order[start:cut])
        start = cut
    bins.append(order[start:])

    n0 = n_in * H
    out = []
    for cols in bins:
        c = np.concatenate([np.arange(j, n0, H) for j in cols]) if len(cols) else np.array([], int)
        r = np.concatenate([np.arange(n0 + j * OUT, n0 + (j + 1) * OUT) for j in cols]) if len(cols) else np.array([], int)
        out.append(np.concatenate([c, r]))
    return out, bins


def describe(stats, top=5, verbose=True):
    imp = tower_impact(stats)
    var = tower_variability(stats)
    dp = tower_dp(stats)
    order = np.argsort(-imp)
    tot = imp.sum()
    lines = [
        f"隐藏塔冲击  total={tot:.3g}  max={imp.max():.3g}  min={imp.min():.3g}  "
        f"max/min={imp.max()/max(imp.min(),1e-30):.1f}x",
        f"集中度      前 8 个塔占 {imp[order[:8]].sum()/tot*100:.1f}%   前 16 占 {imp[order[:16]].sum()/tot*100:.1f}%",
        "",
        f"{'塔':>4} {'冲击':>10} {'占比':>6} {'波动':>10} {'压差':>9}",
    ]
    for j in order[:top]:
        lines.append(f"{j:4d} {imp[j]:10.3g} {imp[j]/tot*100:5.1f}% {var[j]:10.3g} {dp[j]:9.3g}")
    lines.append("...")
    for j in order[-top:]:
        lines.append(f"{j:4d} {imp[j]:10.3g} {imp[j]/tot*100:5.1f}% {var[j]:10.3g} {dp[j]:9.3g}")
    lines.append(f"\n波动 max/min = {var.max()/max(var.min(),1e-30):.1f}x")
    out = "\n".join(lines)
    if verbose:
        print(out)
    return out
