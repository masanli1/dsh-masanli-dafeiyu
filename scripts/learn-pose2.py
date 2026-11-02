#!/usr/bin/env python3
"""从视频学动作 · 改良版（learn-pose2）。

和旧的 learn-pose.py 比：
  1. **真实单位**：所有位移都换算成"躯干长度"的倍数，动作大就是大，动作小就是小（旧版强行
     normalize 到 0–1，静止的人也被拉成满幅度）；
  2. **不再逐帧换底图**：单一待机帧当身体，避免 241 帧乱跳造成的抖动；
  3. **循环闭口**：尾部动作线性融回开头，播放时不再跳一下；
  4. **多自由度**：躯干倾角、左右摆、上下颠、头部偏、手臂抬落，各自独立系数；
  5. **平滑 + 缓入缓出**：特征先做中值/滑动平均，再按 smoothstep 重采样；
  6. 默认输出 60 帧 @60ms（≈3.6s），强度系数按像素给足（旧版 ±8px 几乎看不见）。

用法：
  ~/Downloads/dfy/pose-venv/bin/python learn-pose2.py <视频> <动作名> [--intensity 1.0]
      [--window auto|<秒起>-<秒止>] [--frames 60] [--frame-ms 60] [--assets <assets 目录>]
"""
import argparse, json, math, os, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ASSETS = os.path.join(HERE, '..', 'assets')
MODEL = os.path.expanduser('~/Downloads/dfy/models/pose_landmarker_lite.task')
W, H = 412, 344

L_SHOULDER, R_SHOULDER = 11, 12
L_ELBOW, R_ELBOW = 13, 14
L_WRIST, R_WRIST = 15, 16
L_HIP, R_HIP = 23, 24
NOSE = 0


def smooth(x, k=7):
    """滑动平均 + 两端镜像，避免边界塌陷。"""
    x = np.asarray(x, dtype=np.float32)
    if len(x) < 3:
        return x
    pad = k // 2
    xp = np.pad(x, pad, mode='edge')
    ker = np.ones(k) / k
    return np.convolve(xp, ker, mode='valid')[:len(x)]


def loop_close(x, blend=0.18):
    """把尾部融回开头，保证首尾相接（播放时无缝）。"""
    n = len(x)
    m = max(2, int(n * blend))
    out = x.copy()
    for i in range(m):
        t = i / m
        out[n - m + i] = x[n - m + i] * (1 - t) + x[i] * t
    return out


def detrend(x):
    """减掉窗口均值：只保留"动"的部分，不让静止姿势把整体拽偏。"""
    x = np.asarray(x, dtype=np.float32)
    return x - x.mean()


def pingpong(curve, frames):
    """取前一半 + 后半镜像 → 首尾同一个姿势，循环无缝。"""
    n = len(curve)
    half = curve[: max(1, n // 2)]
    out = np.concatenate([half, half[::-1]])
    return sample_curve(out, frames)


def sample_curve(curve, frames):
    """把任意长度的曲线重采样成 frames 帧，带 smoothstep 缓动。"""
    n = len(curve)
    if n == 1:
        return np.repeat(curve, frames)
    pos = np.linspace(0, n - 1, frames)
    lo = np.floor(pos).astype(int)
    hi = np.minimum(lo + 1, n - 1)
    t = pos - lo
    t = t * t * (3 - 2 * t)          # smoothstep
    return curve[lo] * (1 - t) + curve[hi] * t


def load_timeline(video, fps):
    import cv2
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    capture = cv2.VideoCapture(video)
    if not capture.isOpened():
        sys.exit(f'打不开视频：{video}')
    src_fps = capture.get(cv2.CAP_PROP_FPS) or 30
    step = max(1, int(round(src_fps / fps)))
    frames, grey, index = [], [], 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        if index % step == 0:
            frames.append(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            g = cv2.cvtColor(cv2.resize(frame, (96, 54)), cv2.COLOR_BGR2GRAY).astype(np.float32)
            grey.append(g)
        index += 1
    capture.release()
    energy = [0.0]
    for a, b in zip(grey, grey[1:]):
        energy.append(float(np.abs(a - b).mean()))

    landmarker = vision.PoseLandmarker.create_from_options(
        vision.PoseLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=MODEL),
            running_mode=vision.RunningMode.VIDEO,
            num_poses=1))
    timeline = []
    for i, rgb in enumerate(frames):
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = landmarker.detect_for_video(image, int(i * 1000 / fps))
        if result.pose_landmarks:
            timeline.append({k: (p.x, p.y) for k, p in enumerate(result.pose_landmarks[0])})
        else:
            timeline.append(None)
    landmarker.close()
    return timeline, src_fps, energy


def features(t):
    """单帧骨骼 → 真实单位特征（像素级，相对躯干长度）。"""
    if not t or not all(k in t for k in (L_SHOULDER, R_SHOULDER, L_HIP, R_HIP)):
        return None
    sm = ((t[L_SHOULDER][0] + t[R_SHOULDER][0]) / 2, (t[L_SHOULDER][1] + t[R_SHOULDER][1]) / 2)
    hm = ((t[L_HIP][0] + t[R_HIP][0]) / 2, (t[L_HIP][1] + t[R_HIP][1]) / 2)
    torso = math.hypot(sm[0] - hm[0], sm[1] - hm[1]) or 1e-6        # 近似躯干长度（归一化坐标）
    sw = math.hypot(t[L_SHOULDER][0] - t[R_SHOULDER][0],
                    t[L_SHOULDER][1] - t[R_SHOULDER][1]) or torso    # 肩宽
    # 躯干倾角（度，正=向右倾）。上下颠倒的检测很常见，折回 [-90, 90]
    lean = math.degrees(math.atan2(sm[0] - hm[0], hm[1] - sm[1] + 1e-9))
    while lean > 90:
        lean -= 180
    while lean < -90:
        lean += 180
    if not (0.05 <= torso <= 0.7) or abs(lean) > 70 or sw < 0.03:
        return None
    f = {
        'lean': lean,
        'sway': sm[0] - hm[0],                    # 上半身相对胯的横向偏移（/肩宽 后 = 真实摆幅）
        'bob': hm[1],                              # 胯的高度（越小越高）
        'head_x': (t[NOSE][0] - sm[0]) if NOSE in t else 0.0,
        'head_y': (t[NOSE][1] - sm[1]) if NOSE in t else 0.0,
        'arm_l': (t[L_WRIST][1] - t[L_SHOULDER][1]) if L_WRIST in t else 0.0,
        'arm_r': (t[R_WRIST][1] - t[R_SHOULDER][1]) if R_WRIST in t else 0.0,
        'torso': torso, 'shoulder': sw,
    }
    # 都换成"身体单位"（除以躯干长），跨视频可比
    for k in ('sway', 'head_x', 'head_y', 'arm_l', 'arm_r', 'bob'):
        f[k] = f[k] / torso
    return f


def pick_window(series, fps, energy=None, seconds=2.6):
    """挑"动得凶 + 检测连续"的一段（肩 + 双腕 + 头）。"""
    if len(series) < 5:
        return 0, len(series)
    speeds = [0.0]
    for a, b in zip(series, series[1:]):
        if a is None or b is None:
            speeds.append(0.0)
            continue
        s = 0.0
        for k in ('sway', 'head_x', 'head_y', 'arm_l', 'arm_r'):
            s += abs(b[k] - a[k])
        speeds.append(s)
    span = max(3, int(seconds * fps))
    if len(speeds) <= span:
        return 0, len(speeds)
    valid = np.array([1.0 if f else 0.0 for f in series])
    cands = []
    for i in range(len(speeds) - span):
        frac = valid[i:i + span].mean()
        if frac < 0.9:                     # 检测断续的段不用
            continue
        body = float(np.sum(speeds[i:i + span])) * frac
        kick = 0.0
        if energy is not None and len(energy) >= i + span:
            e = np.array(energy[i:i + span], dtype=np.float32)
            kick = float(e.mean()) / (float(np.percentile(energy, 95)) or 1.0) * span * 0.02
        score = body + kick
        cands.append((score, i))
    if not cands:
        return 0, min(len(series), span)
    cands.sort(reverse=True)
    for sc, i in cands[:3]:
        print(f'  候选窗口 {i/fps:.1f}s–{(i+span)/fps:.1f}s  分 {sc:.2f}')
    return cands[0][1], cands[0][1] + min(span, len(series))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('video')
    ap.add_argument('name', nargs='?', default='pose2')
    ap.add_argument('--intensity', type=float, default=1.0)
    ap.add_argument('--window', default='auto', help='auto 或 起-止（秒）')
    ap.add_argument('--fps', type=float, default=10.0)
    ap.add_argument('--frames', type=int, default=60)
    ap.add_argument('--frame-ms', type=int, default=60)
    ap.add_argument('--assets', default=DEFAULT_ASSETS)
    ap.add_argument('--dry-run', action='store_true', help='只打印特征，不写文件')
    ap.add_argument('--loop', choices=['pingpong', 'crossfade'], default='pingpong',
                    help='pingpong=摆出去再摆回来（首尾对齐不跳）；crossfade=尾部融回开头')
    ap.add_argument('--cache', default='', help='特征缓存 npz（有则读，无则写）')
    args = ap.parse_args()

    assets = os.path.abspath(args.assets)
    pet = os.path.join(assets, 'pet')
    manifest_path = os.path.join(assets, 'pet-manifest.json')

    if args.cache and os.path.exists(args.cache):
        z = np.load(args.cache)
        series = []
        for i in range(len(z['valid'])):
            series.append(None if not z['valid'][i] else {k: float(z[k][i]) for k in
                          ('lean', 'sway', 'bob', 'head_x', 'head_y', 'arm_l', 'arm_r', 'torso', 'shoulder')})
        src_fps = float(z['src_fps'])
        timeline = [None] * len(series)
        energy = list(z['energy']) if 'energy' in z else [0.0] * len(series)
    else:
        timeline, src_fps, energy = load_timeline(args.video, args.fps)
        series = [features(t) for t in timeline]
        if args.cache:
            keys = ('lean', 'sway', 'bob', 'head_x', 'head_y', 'arm_l', 'arm_r', 'torso', 'shoulder')
            np.savez(args.cache, valid=np.array([bool(f) for f in series]),
                     src_fps=src_fps, energy=np.array(energy, dtype=np.float32),
                     **{k: np.array([f[k] if f else 0.0 for f in series], dtype=np.float32) for k in keys})
    valid = [f for f in series if f]
    print(f'抽了 {len(timeline)} 帧，检测到人体 {len(valid)} 帧（源 {src_fps:.1f}fps → {args.fps}fps）')
    if len(valid) < 5:
        sys.exit('没检测到人体骨骼点')

    if args.window == 'auto':
        start, end = pick_window(series, args.fps, energy)
    else:
        a, b = args.window.split('-')
        start, end = int(float(a) * args.fps), int(float(b) * args.fps)
    win = series[start:end]
    idx = [i for i, f in enumerate(win) if f]
    if len(idx) < 5:
        sys.exit('窗口里没有骨骼点')
    first, last = idx[0], idx[-1]
    win = win[first:last + 1]
    print(f'窗口 {start/args.fps:.1f}s–{(start+last+1)/args.fps:.1f}s（{len(win)} 帧）')
    ewin = np.array(energy[start + first:start + last + 1], dtype=np.float32)
    if len(ewin) < 3:
        ewin = np.zeros(len(win), dtype=np.float32)

    def fill(key, arr):
        """线性插值补洞（骨骼点丢帧的地方别用"保持上一帧"）。"""
        good = np.array([i for i, f in enumerate(arr) if f is not None], dtype=int)
        if len(good) < 2:
            return np.zeros(len(arr), dtype=np.float32), good
        vals = np.array([arr[i] for i in good], dtype=np.float32)
        filled = np.interp(np.arange(len(arr)), good, vals).astype(np.float32)
        return filled, good

    med = lambda v, k=5: np.median(np.pad(v, k // 2, mode='edge')[:len(v) + k - 1].reshape(-1, k), axis=1) \
        if False else v

    def robust(key, k=7):
        raw = [f[key] if f else None for f in win]
        vals, good = fill(key, raw)
        if key == 'lean':
            vals = np.degrees(np.unwrap(np.radians(vals)))      # 跨 ±180 不跳
        # 中值滤波（去单帧爆点）再滑动平均（去高频抖动）
        m = 5
        padded = np.pad(vals, m // 2, mode='edge')
        vals = np.median(np.stack([padded[i:i + len(vals)] for i in range(m)]), axis=0)
        vals = smooth(vals, k)
        return detrend(vals)

    def col(key, k=7):
        return robust(key, k)

    vars_ = {k: col(k) for k in ('lean', 'sway', 'bob', 'head_x', 'head_y', 'arm_l', 'arm_r')}
    def robrange(v):
        lo, hi = np.percentile(v, [2, 98])
        return float(hi - lo)
    rng = {k: robrange(v) for k, v in vars_.items()}
    print('动作幅度（真实单位）：' + '  '.join(f'{k}={v:.3f}' for k, v in rng.items()))

    # —— 逐通道归一化后再给目标幅度 ——
    # 这段视频里人体摆幅只有几度/零点几个身位，直接按物理单位换算等于没动；
    # 所以每个通道先拉伸到 ±1（保留"形状与节拍"），再乘上 chibi 看得见的目标幅度。
    def unit(v):
        lo, hi = np.percentile(v, [3, 97])
        c = (v - (lo + hi) / 2) / max(1e-9, (hi - lo) / 2)
        return np.clip(c, -1.2, 1.2)

    E = args.intensity
    n = args.frames
    clip = lambda v, lim: np.clip(v, -lim, lim)
    wrap = pingpong if args.loop == 'pingpong' else (lambda c, _n: sample_curve(loop_close(c), _n))
    ch = {k: wrap(unit(v), n) for k, v in vars_.items()}

    # 目标幅度（像素/度），intensity 直接乘上去
    A_ANGLE, A_DX, A_DY, A_SHEAR, A_SX, A_SY = 9.0, 30.0, 24.0, 20.0, 0.055, 0.10
    angle = clip((ch['lean'] * 0.75 + ch['head_x'] * 0.45) * A_ANGLE * E, 14.0)
    sway = clip((ch['sway'] * 0.8 + ch['head_x'] * 0.5) * E, 1.3)
    dx = clip(sway * A_DX, 42.0)
    dy = clip((ch['bob'] * -0.8 + ch['head_y'] * 0.45) * A_DY * E, 34.0)
    shear = clip(sway * A_SHEAR, 24.0)
    sy = 1.0 + clip(ch['bob'] * -0.8 * A_SY * E, 0.12)
    sx = 1.0 + clip((ch['arm_l'] * 0.5 + ch['arm_r'] * 0.5) * A_SX * E, 0.07)

    # 冲击：画面帧差能量（剑光/雷击那几下）→ 缩放脉冲 + 一点旋转
    en = smooth(ewin, 5)
    hi = float(np.percentile(en, 95)) or 1.0
    impact = np.clip(en / hi, 0, 1.2)
    impact = wrap(impact - impact.mean(), n)
    sx = sx * (1.0 + clip(impact, 1.0) * 0.07 * E)
    angle = angle + impact * 2.0 * E

    print(f'输出：{n} 帧，最大横移 {np.abs(dx).max():.1f}px、竖移 {np.abs(dy).max():.1f}px、'
          f'倾角 {np.abs(angle).max():.1f}°、缩放 {np.abs(sx-1).max()*100:.1f}%')
    if args.dry_run:
        return

    base_dir = os.path.join(pet, 'idle')
    idles = sorted(f for f in os.listdir(base_dir) if f.endswith('.webp'))
    # 待机帧慢慢循环 + 相邻两帧交叉淡入：有呼吸感，又不会像旧版那样乱跳
    cycle = min(len(idles), 24)
    bases = [Image.open(os.path.join(base_dir, idles[k])).convert('RGBA') for k in range(cycle)]

    def base_at(i, n):
        pos = (i / max(1, n)) * cycle * 2 % cycle          # 一圈里走两遍
        k = int(pos) % cycle
        alpha = pos - int(pos)
        lo = bases[k]
        hi = bases[(k + 1) % cycle]
        return Image.blend(lo, hi, alpha)

    out = []
    for i in range(n):
        img = base_at(i, n).rotate(float(angle[i]), resample=Image.BICUBIC, center=(W / 2, H * 0.94))
        sw, sh = W * float(sx[i]), H * float(sy[i])
        img = img.resize((max(1, int(sw)), max(1, int(sh))), Image.LANCZOS)
        canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        canvas.alpha_composite(img, (int((W - sw) / 2 + dx[i]), int(H - sh + dy[i])))
        if abs(shear[i]) > 0.3:
            a = np.array(canvas)
            pivot = H * 0.55
            w = np.clip((np.arange(H) - pivot) / max(1.0, H - pivot), 0, 1) ** 1.7
            shifts = np.round(w * shear[i]).astype(int)
            for y in range(H):
                if shifts[y]:
                    a[y] = np.roll(a[y], shifts[y], axis=0)
            canvas = Image.fromarray(a, 'RGBA')
        out.append(canvas)

    out_dir = os.path.join(pet, args.name)
    os.makedirs(out_dir, exist_ok=True)
    for old in os.listdir(out_dir):
        if old.endswith('.webp'):
            os.remove(os.path.join(out_dir, old))
    for i, image in enumerate(out, 1):
        image.save(os.path.join(out_dir, f'{args.name}_{i:03d}.webp'), 'WEBP', quality=92, method=6)

    manifest = json.load(open(manifest_path))
    manifest.setdefault('clips', {})[args.name] = {
        'frames': [f'{args.name}/{args.name}_{i:03d}.webp' for i in range(1, n + 1)],
        'frameMs': args.frame_ms,
        'loop': True,
        'source': 'learned:pose2',
    }
    micros = manifest.get('idleMicroClips') or []
    if args.name not in micros:
        micros.append(args.name)
    manifest['idleMicroClips'] = micros
    json.dump(manifest, open(manifest_path, 'w'), ensure_ascii=False, indent=2)

    # 质量自检
    arr = [np.asarray(im.convert('L'), dtype=np.float32) for im in out]
    diffs = [float(np.abs(a - b).mean()) for a, b in zip(arr, arr[1:])]
    seam = float(np.abs(arr[-1] - arr[0]).mean())
    print(json.dumps({'ok': True, 'clip': args.name, 'frames': n,
                      'frameMs': args.frame_ms, 'source': 'learned:pose2',
                      'window': [round(start / args.fps, 1), round((start + last + 1) / args.fps, 1)],
                      'intensity': args.intensity,
                      'motion': {k: round(v, 3) for k, v in rng.items()},
                      'frame_delta': round(float(np.mean(diffs)), 2),
                      'jitter': round(float(np.std(diffs)), 2),
                      'loop_seam': round(seam, 2)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
