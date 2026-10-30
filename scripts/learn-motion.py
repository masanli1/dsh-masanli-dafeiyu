#!/usr/bin/env python3
"""从一段视频里学习"小动作"，映射成宠物的动作帧。

做法：低分辨率逐帧差分 → 运动质心/能量/展宽 → 归一化成动作曲线 →
把这些曲线施加到宠物待机帧上（位移/旋转/缩放），生成新动作。
"""
import json, math, os, subprocess, sys, tempfile
from PIL import Image

ASSETS = os.path.join(os.path.dirname(__file__), '..', 'assets')
PET = os.path.join(ASSETS, 'pet')
MANIFEST = os.path.join(ASSETS, 'pet-manifest.json')
W, H = 412, 344
FFMPEG = os.environ.get('DFY_FFMPEG') or os.path.expanduser('~/Applications/大肥鱼播放器.app/Contents/Resources/bin/ffmpeg')


def extract(video, fps=10, width=96):
    tmp = tempfile.mkdtemp(prefix='dfy-motion-')
    subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', '-i', video,
                    '-vf', f'fps={fps},scale={width}:-1,format=gray', os.path.join(tmp, 'f_%04d.png')], check=True)
    files = sorted(f for f in os.listdir(tmp) if f.endswith('.png'))
    return tmp, [Image.open(os.path.join(tmp, f)).convert('L') for f in files]


def motion_series(frames):
    series = []
    previous = None
    for frame in frames:
        if previous is None:
            previous = frame
            series.append({'energy': 0.0, 'cx': 0.5, 'cy': 0.5, 'spread': 0.0})
            continue
        px, qx = previous.load(), frame.load()
        w, h = frame.size
        total = 0.0
        sx = sy = 0.0
        count = 0
        for y in range(0, h, 2):
            for x in range(0, w, 2):
                diff = abs(px[x, y] - qx[x, y])
                if diff > 18:
                    total += diff
                    sx += x
                    sy += y
                    count += 1
        energy = total / (w * h * 255.0)
        series.append({
            'energy': energy,
            'cx': (sx / count) / w if count else 0.5,
            'cy': (sy / count) / h if count else 0.5,
            'spread': count / (w * h / 4) if count else 0.0,
        })
        previous = frame
    return series


def normalize(values):
    lo, hi = min(values), max(values)
    if hi - lo < 1e-6:
        return [0.5] * len(values)
    return [(v - lo) / (hi - lo) for v in values]


def build_clip(series, name='learned', frames=48, frame_ms=80):
    base_dir = os.path.join(PET, 'idle')
    base = [Image.open(os.path.join(base_dir, f)).convert('RGBA') for f in sorted(os.listdir(base_dir)) if f.endswith('.webp')]
    energy = normalize([s['energy'] for s in series])
    cx = normalize([s['cx'] for s in series])
    cy = normalize([s['cy'] for s in series])
    n = len(series)
    out = []
    for i in range(frames):
        k = int(i / frames * (n - 1))
        dx = (cx[k] - 0.5) * 34
        dy = (cy[k] - 0.5) * 20
        angle = (cx[k] - 0.5) * 6.0
        scale = 1.0 + energy[k] * 0.04
        img = base[i % len(base)].rotate(angle, resample=Image.BICUBIC, center=(W / 2, H * 0.9))
        if scale != 1.0:
            w, h = int(W * scale), int(H * scale)
            img = img.resize((w, h), Image.LANCZOS)
            canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
            canvas.alpha_composite(img, ((W - w) // 2, H - h))
        else:
            canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
            canvas.alpha_composite(img, (0, 0))
        shifted = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        shifted.alpha_composite(canvas, (int(dx), int(dy)))
        out.append(shifted)

    out_dir = os.path.join(PET, name)
    os.makedirs(out_dir, exist_ok=True)
    for index, image in enumerate(out, 1):
        image.save(os.path.join(out_dir, f'{name}_{index:03d}.webp'), 'WEBP', quality=92, method=6)

    manifest = json.load(open(MANIFEST))
    manifest['clips'][name] = {
        'frames': [f'{name}/{name}_{i:03d}.webp' for i in range(1, len(out) + 1)],
        'frameMs': frame_ms,
        'loop': True,
        'source': 'learned:motion',
    }
    micros = manifest.get('idleMicroClips') or []
    if name not in micros:
        micros.append(name)
    manifest['idleMicroClips'] = micros
    json.dump(manifest, open(MANIFEST, 'w'), ensure_ascii=False, indent=2)
    return len(out)


def main():
    video = sys.argv[1]
    name = sys.argv[2] if len(sys.argv) > 2 else 'learned'
    tmp, frames = extract(video)
    series = motion_series(frames)
    count = build_clip(series, name)
    print(json.dumps({'ok': True, 'clip': name, 'frames': count, 'samples': len(series)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
