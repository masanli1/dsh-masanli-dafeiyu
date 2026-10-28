"""特斯拉阀 · 复刻 CLI

把 tesla_valve_v2 的阀阵/水塔网络搬过来，并加一层「复刻」：
看到想要的结果后，从当前阀态出发，一点点试「哪条边该开、哪条边该关」，
把能复现该结果的阀态存成一项「学会的功能」。

子命令：
  simulate  --sample N [--state NPZ]        跑一遍，看出口向量和最近邻判定
  replicate --target K --name X [--rounds R] 朝目标数字复刻，逐轮试阀，存成技能
  use       --skill DIR --sample N           用某项学到的功能跑一遍

输出一律是 JSON（每行一条），方便 Host 解析。
"""
import argparse
import json
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import towers  # noqa: E402
from encoding import encode, load_mnist  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data", "mnist")
MODEL = os.path.join(DATA, "model.npz")
HID = 64
OUT = 24
BATCH = 128
STATES = (-1, 0, 1)


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def load_data():
    X, y = load_mnist(os.path.join(DATA, "test-images.gz"), os.path.join(DATA, "test-labels.gz"))
    return encode(X), y


def load_baseline(hidden=None, out=None):
    d = np.load(MODEL)
    st, N_IN = d["state"], int(d["N_IN"] if "N_IN" in d.files else 49)
    H = int(hidden or HID)
    O = int(out or OUT)
    if H == HID and O == OUT:
        S0 = st[:N_IN * HID].reshape(N_IN, HID).astype(np.int8)
        S1 = st[N_IN * HID:].reshape(HID, OUT).astype(np.int8)
        return S0, S1
    # 规模不同：按目标尺寸随机初始化（更大的网络装更大的程序）
    rng = np.random.default_rng(0)
    return (rng.choice(STATES, size=(N_IN, H)).astype(np.int8),
            rng.choice(STATES, size=(H, O)).astype(np.int8))


def build_state(source, hidden=None, out=None):
    if source and source not in ("baseline", "random", "zero"):
        path = os.path.join(source, "state.npz") if os.path.isdir(source) else os.path.join(PROGRAMS, source, "state.npz")
        d = np.load(path)
        return d["S0"].astype(np.int8), d["S1"].astype(np.int8)
    S0, S1 = load_baseline(hidden, out)
    if source == "random":
        rng = np.random.default_rng(0)
        return rng.choice(STATES, size=S0.shape).astype(np.int8), rng.choice(STATES, size=S1.shape).astype(np.int8)
    if source == "zero":
        return np.zeros_like(S0), np.zeros_like(S1)
    return S0, S1


def run_state(X, S0, S1):
    # towers.run 的第二层出口数由 S1.shape[1] 决定，所以放大规模时这里自然适配
    return np.vstack([towers.run(X[i:i + BATCH], S0, S1)[1] for i in range(0, len(X), BATCH)]).astype(np.float32)


def knn_predict(Lref, yref, Lq):
    d2 = ((Lq[:, None, :] - Lref[None]) ** 2).sum(2)
    return yref[np.argmin(d2, axis=1)]


def cmd_simulate(args):
    X, y = load_data()
    state_path = args.state or MODEL
    if state_path == MODEL:
        S0, S1 = load_baseline()
    else:
        d = np.load(state_path)
        S0, S1 = d["S0"].astype(np.int8), d["S1"].astype(np.int8)
    ref_idx = np.arange(0, min(600, len(X)))
    query = int(args.sample)
    ref_idx = ref_idx[ref_idx != query]
    Lref = run_state(X[ref_idx], S0, S1)
    Lq = run_state(X[[query]], S0, S1)
    pred = int(knn_predict(Lref, y[ref_idx], Lq)[0])
    emit({
        "ok": True,
        "sample": query,
        "true": int(y[query]),
        "predicted": pred,
        "output": [round(float(v), 4) for v in Lq[0]],
        "hint": "出口塔 24 维水位向量，就是这张图的“指针”",
    })


def score_batch(L, y, target):
    """目标类的相对 margin（按出口量级归一，越大越好）+ 这些样本的准确率。"""
    other = np.max(np.where(np.arange(L.shape[1])[None, :] == target, -1e9, L), axis=1)
    scale = float(np.mean(np.abs(L))) + 1e-12
    margin = float(np.mean((L[:, target] - other) / scale))
    acc = float(np.mean(np.argmax(L, axis=1) == y))
    return margin, acc




# ---------------------------------------------------------------- 灵敏度挑边
# 随机挑边在 5 万条边上信号太弱；这里用 impact.measure 统计的累计流量，
# 按"这条边实际过了多少水"加权挑边——水走得多的边，改它才真的改变结果。

def guided_weights(S0, S1, X, batch=8):
    import impact
    stats = impact.measure(X[:batch], S0, S1)
    w_in = np.asarray(stats["flow_in"]) + 0.5 * np.asarray(stats["flow_in2"])
    w_out = np.asarray(stats["flow_out"]) + 0.5 * np.asarray(stats["flow_out2"])
    w = np.concatenate([w_in.ravel(), w_out.ravel()]).astype(np.float64)
    w = np.maximum(w, 1e-9)
    return w / w.sum()


def pick_edges(rng, weights, count, size):
    if weights is None or weights.size != size:
        return rng.choice(size, count, replace=False)
    return rng.choice(size, count, replace=False, p=weights)

def cmd_replicate(args):
    X, y = load_data()
    rng = np.random.default_rng(args.seed)
    S0, S1 = build_state(args.source, getattr(args, "hidden", None), getattr(args, "out", None))
    target = int(args.target)

    idx_t = np.flatnonzero(y == target)[: args.samples // 2]
    idx_o = rng.choice(np.flatnonzero(y != target), args.samples - len(idx_t), replace=False)
    idx = np.concatenate([idx_t, idx_o])
    Xb, yb = X[idx], y[idx]

    def evaluate(a, b):
        return score_batch(run_state(Xb, a, b), yb, target)

    best_score, best_acc = evaluate(S0, S1)
    best = (S0.copy(), S1.copy())
    emit({"round": 0, "score": round(best_score, 5), "acc": round(best_acc, 4), "event": "start",
          "target": target, "samples": int(len(idx)), "shape": [int(S0.shape[0]), int(S0.shape[1]), int(S1.shape[1])],
          "edges": int(S0.size + S1.size)})

    trace = []
    n_edges = int(S0.size + S1.size)
    per_round = max(8, n_edges // 500)
    weights = guided_weights(S0, S1, Xb) if args.guided else None
    started = time.time()
    for round_index in range(1, args.rounds + 1):
        if args.guided and round_index % 4 == 0:
            weights = guided_weights(best[0], best[1], Xb)
        improved = False
        for _ in range(args.candidates):
            a, b = best[0].copy(), best[1].copy()
            n0 = a.size
            flat = np.concatenate([a.ravel(), b.ravel()])
            pick = pick_edges(rng, weights, per_round, flat.size)
            flat[pick] = rng.choice(STATES, per_round)
            a2, b2 = flat[:n0].reshape(a.shape), flat[n0:].reshape(b.shape)
            score, acc = evaluate(a2, b2)
            if score > best_score + 1e-7:
                opened = int(((flat[pick] != 0) & (np.concatenate([best[0].ravel(), best[1].ravel()])[pick] == 0)).sum())
                closed = int(((flat[pick] == 0) & (np.concatenate([best[0].ravel(), best[1].ravel()])[pick] != 0)).sum())
                flipped = int(per_round - opened - closed)
                best_score, best_acc = score, acc
                best = (a2, b2)
                improved = True
                entry = {"round": round_index, "accepted": True, "score": round(score, 5),
                         "acc": round(acc, 4), "opened": opened, "closed": closed, "flipped": flipped}
                trace.append(entry)
                emit(entry)
                break
        if not improved:
            entry = {"round": round_index, "accepted": False, "score": round(best_score, 5), "acc": round(best_acc, 4)}
            trace.append(entry)
            emit(entry)

    out_dir = getattr(args, "out_dir_arg", None) or os.path.expanduser(os.path.join("~", "Documents", "大肥鱼技能", args.name))
    out_dir = os.path.abspath(out_dir)
    os.makedirs(out_dir, exist_ok=True)
    np.savez_compressed(os.path.join(out_dir, "state.npz"), S0=best[0], S1=best[1],
                        target=target, score=best_score, acc=best_acc, H=int(S1.shape[0]), OUT=int(S1.shape[1]))
    meta = {
        "name": args.name, "kind": "tesla-replicate", "target": target,
        "score": round(best_score, 5), "accuracy": round(best_acc, 4),
        "rounds": args.rounds, "samples": int(len(idx)),
        "seconds": round(time.time() - started, 1),
        "edges": n_edges, "trace": trace,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "stateFile": os.path.join(out_dir, "state.npz"),
    }
    with open(os.path.join(out_dir, "meta.json"), "w", encoding="utf-8") as handle:
        json.dump(meta, handle, ensure_ascii=False, indent=2)
    emit({"ok": True, "event": "done", "dir": out_dir, **{k: meta[k] for k in ("name", "target", "score", "accuracy", "seconds")}})


def cmd_use(args):
    X, y = load_data()
    d = np.load(os.path.join(args.skill, "state.npz"))
    S0, S1 = d["S0"].astype(np.int8), d["S1"].astype(np.int8)
    ref_idx = np.arange(0, min(400, len(X)))
    query = int(args.sample)
    ref_idx = ref_idx[ref_idx != query]
    Lref = run_state(X[ref_idx], S0, S1)
    Lq = run_state(X[[query]], S0, S1)
    pred = int(knn_predict(Lref, y[ref_idx], Lq)[0])
    emit({"ok": True, "skill": os.path.basename(args.skill.rstrip("/")), "sample": query,
          "true": int(y[query]), "predicted": pred})




# ---------------------------------------------------------------- 程序复刻
# 一段"程序" = 一组 (输入, 输出) 记录。把当前阀态跑出来的结果记下来，
# 再用另一个阀态去逼近这组记录；学到的只是阀的位置/方向参数，
# 所以同一个网络能装下很多个不同的"程序"。

PROGRAMS = os.path.expanduser(os.path.join("~", "Documents", "大肥鱼技能", "programs"))


def program_dir(name):
    return os.path.join(PROGRAMS, name)


def load_examples(name):
    path = os.path.join(program_dir(name), "examples.json")
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def save_examples(name, payload):
    os.makedirs(program_dir(name), exist_ok=True)
    with open(os.path.join(program_dir(name), "examples.json"), "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)


def resolve_state(source):
    if not source or source == "baseline":
        return build_state(None)
    if source in ("random", "zero"):
        return build_state(source)
    path = os.path.join(source, "state.npz") if os.path.isdir(source) else os.path.join(PROGRAMS, source, "state.npz")
    d = np.load(path)
    return d["S0"].astype(np.int8), d["S1"].astype(np.int8)


def cmd_program(args):
    if args.list:
        names = sorted(os.listdir(PROGRAMS)) if os.path.isdir(PROGRAMS) else []
        items = []
        for name in names:
            meta_path = os.path.join(PROGRAMS, name, "meta.json")
            try:
                with open(meta_path, encoding="utf-8") as handle:
                    items.append(json.load(handle))
            except OSError:
                items.append({"name": name})
        emit({"ok": True, "programs": items})
        return

    name = args.name
    if not name:
        raise SystemExit("需要 --name")
    os.makedirs(program_dir(name), exist_ok=True)

    if args.record:
        X, y = load_data()
        S0, S1 = resolve_state(args.source)
        idx = [int(v) for v in args.record]
        L = run_state(X[idx], S0, S1)
        payload = load_examples(name) if os.path.exists(os.path.join(program_dir(name), "examples.json")) else {"name": name, "examples": []}
        existing = {example["sample"]: example for example in payload["examples"]}
        for row, sample_index in enumerate(idx):
            existing[sample_index] = {
                "sample": sample_index,
                "label": int(y[sample_index]),
                "input": [round(float(v), 6) for v in X[sample_index]],
                "output": [round(float(v), 6) for v in L[row]],
                "source": args.source or "baseline",
            }
        payload["examples"] = list(existing.values())
        save_examples(name, payload)
        emit({"ok": True, "event": "recorded", "name": name, "count": len(payload["examples"])})
        return

    if args.fit:
        payload = load_examples(name)
        examples = payload["examples"]
        if not examples:
            raise SystemExit("这个程序还没有记录任何样例")
        X = np.asarray([example["input"] for example in examples], dtype=np.float32)
        target = np.asarray([example["output"] for example in examples], dtype=np.float32)
        S0, S1 = resolve_state(args.source)
        rng = np.random.default_rng(args.seed)

        def mse(a, b):
            return float(np.mean((run_state(X, a, b) - target) ** 2))

        best = mse(S0, S1)
        best_state = (S0.copy(), S1.copy())
        emit({"event": "start", "mse": round(best, 8), "examples": len(examples)})
        trace = []
        flat0 = np.concatenate([S0.ravel(), S1.ravel()])
        n_edges = flat0.size
        per_round = max(16, n_edges // 400)
        weights = guided_weights(S0, S1, X)
        for round_index in range(1, args.rounds + 1):
            accepted = None
            for _ in range(args.candidates):
                a, b = best_state[0].copy(), best_state[1].copy()
                flat = np.concatenate([a.ravel(), b.ravel()])
                pick = pick_edges(rng, weights, per_round, flat.size)
                before = flat[pick].copy()
                flat[pick] = rng.choice(STATES, per_round)
                candidate = mse(flat[:a.size].reshape(a.shape), flat[a.size:].reshape(b.shape))
                if candidate < best - 1e-10:
                    opened = int(((flat[pick] != 0) & (before == 0)).sum())
                    closed = int(((flat[pick] == 0) & (before != 0)).sum())
                    accepted = {"round": round_index, "mse": round(candidate, 8),
                                "opened": opened, "closed": closed,
                                "flipped": int(per_round - opened - closed)}
                    best = candidate
                    best_state = (flat[: a.size].reshape(a.shape), flat[a.size:].reshape(b.shape))
                    break
            entry = accepted or {"round": round_index, "mse": round(best, 8), "accepted": False}
            trace.append(entry)
            emit(entry)

        out_dir = program_dir(name)
        np.savez_compressed(os.path.join(out_dir, "state.npz"), S0=best_state[0], S1=best_state[1], H=HID, OUT=OUT)
        meta_path = os.path.join(out_dir, "meta.json")
        try:
            with open(meta_path, encoding="utf-8") as handle:
                meta = json.load(handle)
        except OSError:
            meta = {"name": name}
        meta.update({"kind": "tesla-program", "mse": round(best, 8), "examples": len(examples),
                     "rounds": args.rounds, "trace": trace,
                     "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%S")})
        with open(meta_path, "w", encoding="utf-8") as handle:
            json.dump(meta, handle, ensure_ascii=False, indent=2)
        emit({"ok": True, "event": "fitted", "name": name, "mse": round(best, 8), "dir": out_dir})
        return

    if args.run:
        payload = load_examples(name)
        X, y = load_data()
        sample = int(args.run)
        S0, S1 = resolve_state(program_dir(name))
        L = run_state(X[[sample]], S0, S1)[0]
        recorded = next((example for example in payload["examples"] if example["sample"] == sample), None)
        diff = None
        if recorded:
            diff = float(np.mean((L - np.asarray(recorded["output"], dtype=np.float32)) ** 2))
        emit({"ok": True, "program": name, "sample": sample, "true": int(y[sample]),
              "output": [round(float(v), 6) for v in L],
              "mse_vs_recorded": round(diff, 8) if diff is not None else None})
        return

    raise SystemExit("program 需要 --record / --fit / --run / --list 之一")



# ---------------------------------------------------------------- 程序编译
# 传入「一个程序 + 数据」：程序用表达式描述（输入 784 维向量 x，输出 24 维），
# 自动生成数据、记录，再学出阀态，最后在没见过的输入上测保真度。
# 相当于把这段程序“编译”成一份阀的位置参数。

def compile_spec(spec, count, seed):
    rng = np.random.default_rng(seed)
    expr = spec["expr"]
    out_dim = int(spec.get("output_dim", 24))
    x = rng.random((count, 784)).astype(np.float32)
    env = {"np": np, "x": x, "x0": x[0], "n": count}
    try:
        # 本地可信输入：只放开 __import__，numpy 内部偶尔会用到它
        value = eval(expr, {"__builtins__": {"__import__": __import__}}, env)  # noqa: S307
    except Exception as error:  # noqa: BLE001
        raise SystemExit(f"程序表达式执行失败：{error}")
    value = np.asarray(value, dtype=np.float32)
    if value.ndim == 1 and value.shape[0] == count:
        value = np.repeat(value[:, None], out_dim, axis=1)
    elif value.ndim == 1:
        value = np.repeat(value[None, :out_dim], count, axis=0)
    return x, value[:, :out_dim]


def cmd_compile(args):
    with open(args.spec, encoding="utf-8") as handle:
        spec = json.load(handle)
    name = args.name or spec.get("name") or "program"
    train_count = int(args.samples)
    holdout = int(args.holdout)
    Xtr, Ytr = compile_spec(spec, train_count, args.seed)
    Xte, Yte = compile_spec(spec, holdout, args.seed + 1)
    # 目标输出的量级要和阀网实际出口的量级对齐：先空跑一遍起始阀态，
    # 取它输出的均值和标准差做仿射映射，归一化参数存进 meta。
    _S0, _S1 = build_state(args.source, getattr(args, "hidden", None), getattr(args, "out", None))
    L0 = run_state(Xtr, _S0, _S1)
    Y_mean = float(Ytr.mean())
    Y_std = float(Ytr.std()) or 1.0
    L_mean = float(L0.mean())
    L_std = float(L0.std()) or 5e-5
    def normalize(Y):
        return ((Y - Y_mean) / Y_std * L_std + L_mean).astype(np.float32)
    Ytr_n, Yte_n = normalize(Ytr), normalize(Yte)

    os.makedirs(program_dir(name), exist_ok=True)
    examples = [
        {"sample": index, "label": -1,
         "input": [round(float(v), 6) for v in Xtr[index]],
         "output": [round(float(v), 6) for v in Ytr_n[index]],
         "source": "compiled:" + (spec.get("name") or name)}
        for index in range(train_count)
    ]
    save_examples(name, {"name": name, "spec": spec, "examples": examples})

    S0, S1 = build_state(args.source, getattr(args, "hidden", None), getattr(args, "out", None))
    rng = np.random.default_rng(args.seed)

    def mse(a, b, X, Y):
        return float(np.mean((run_state(X, a, b) - Y) ** 2))

    best = mse(S0, S1, Xtr, Ytr_n)
    best_state = (S0.copy(), S1.copy())
    emit({"event": "start", "mse": round(best, 8), "examples": train_count})
    flat0 = np.concatenate([S0.ravel(), S1.ravel()])
    per_round = max(16, flat0.size // 400)
    weights = guided_weights(S0, S1, Xtr) if args.guided else None
    trace = []
    for round_index in range(1, args.rounds + 1):
        if args.guided and round_index % 4 == 0:
            weights = guided_weights(best_state[0], best_state[1], Xtr)
        accepted = None
        for _ in range(args.candidates):
            a, b = best_state[0].copy(), best_state[1].copy()
            flat = np.concatenate([a.ravel(), b.ravel()])
            pick = pick_edges(rng, weights, per_round, flat.size)
            before = flat[pick].copy()
            flat[pick] = rng.choice(STATES, per_round)
            candidate = mse(flat[: a.size].reshape(a.shape), flat[a.size:].reshape(b.shape), Xtr, Ytr_n)
            if candidate < best - 1e-10:
                opened = int(((flat[pick] != 0) & (before == 0)).sum())
                closed = int(((flat[pick] == 0) & (before != 0)).sum())
                accepted = {"round": round_index, "mse": round(candidate, 8), "opened": opened,
                            "closed": closed, "flipped": int(per_round - opened - closed)}
                best = candidate
                best_state = (flat[: a.size].reshape(a.shape), flat[a.size:].reshape(b.shape))
                break
        entry = accepted or {"round": round_index, "mse": round(best, 8), "accepted": False}
        trace.append(entry)
        emit(entry)

    held = mse(best_state[0], best_state[1], Xte, Yte_n)
    baseline_held = mse(S0, S1, Xte, Yte_n)
    variance = float(np.mean((Yte_n - Yte_n.mean()) ** 2)) or 1e-12
    np.savez_compressed(os.path.join(program_dir(name), "state.npz"),
                        S0=best_state[0], S1=best_state[1], H=int(S1.shape[0]), OUT=int(S1.shape[1]))
    meta = {
        "name": name, "kind": "tesla-compiled-program",
        "program": spec.get("name") or name, "expr": spec.get("expr"),
        "mse": round(best, 8), "holdout_mse": round(held, 8),
        "holdout_baseline_mse": round(baseline_held, 8),
        "fidelity": round(max(0.0, 1 - held / variance), 4),
        "baseline_fidelity": round(max(0.0, 1 - baseline_held / variance), 4),
        "readout": {"mean": Y_mean, "std": Y_std, "scale": L_std, "offset": L_mean},
        "examples": train_count, "holdout": holdout, "rounds": args.rounds,
        "trace": trace, "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    with open(os.path.join(program_dir(name), "meta.json"), "w", encoding="utf-8") as handle:
        json.dump(meta, handle, ensure_ascii=False, indent=2)
    emit({"ok": True, "event": "compiled", "name": name, "mse": round(best, 8),
          "holdout_mse": round(held, 8), "fidelity": meta["fidelity"]})

def main():
    parser = argparse.ArgumentParser(description="特斯拉阀 · 复刻")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("simulate")
    p.add_argument("--sample", type=int, default=0)
    p.add_argument("--state", default=None)
    p.set_defaults(func=cmd_simulate)

    p = sub.add_parser("replicate")
    p.add_argument("--target", type=int, required=True)
    p.add_argument("--name", required=True)
    p.add_argument("--rounds", type=int, default=12)
    p.add_argument("--candidates", type=int, default=4)
    p.add_argument("--samples", type=int, default=48)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--source", default=None, help="起始阀态：baseline / random / zero / 技能名")
    p.add_argument("--hidden", type=int, default=None, help="隐藏塔数量（默认 64）")
    p.add_argument("--no-guided", dest="guided", action="store_false", help="关闭按流量加权挑边")
    p.add_argument("--out", type=int, default=None, help="出口塔数量（默认 24）")
    p.add_argument("--out-dir", dest="out_dir_arg", default=None)
    p.set_defaults(func=cmd_replicate)

    p = sub.add_parser("program")
    p.add_argument("--name", default=None)
    p.add_argument("--list", action="store_true")
    p.add_argument("--record", nargs="+", default=None)
    p.add_argument("--fit", action="store_true")
    p.add_argument("--run", type=int, default=None)
    p.add_argument("--source", default=None)
    p.add_argument("--rounds", type=int, default=20)
    p.add_argument("--candidates", type=int, default=6)
    p.add_argument("--seed", type=int, default=0)
    p.set_defaults(func=cmd_program)

    p = sub.add_parser("compile")
    p.add_argument("--spec", required=True, help="程序描述 JSON：{name, expr, output_dim}")
    p.add_argument("--name", default=None)
    p.add_argument("--samples", type=int, default=48)
    p.add_argument("--holdout", type=int, default=24)
    p.add_argument("--rounds", type=int, default=10)
    p.add_argument("--candidates", type=int, default=6)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--source", default=None)
    p.add_argument("--hidden", type=int, default=None)
    p.add_argument("--out", type=int, default=None)
    p.add_argument("--no-guided", dest="guided", action="store_false")
    p.set_defaults(func=cmd_compile)

    p = sub.add_parser("use")
    p.add_argument("--skill", required=True)
    p.add_argument("--sample", type=int, default=0)
    p.set_defaults(func=cmd_use)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
