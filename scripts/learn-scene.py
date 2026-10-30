#!/usr/bin/env python3
"""从视频里学"出场背景"和"出场视角"。

- 背景：挑选"亮部集中在上方 + 有环形光斑"的帧作为背景板，压暗、轻微模糊；
- 视角：估计地平线（水平梯度最强的行）、主体尺度（亮斑占画面比例）、
  推镜趋势（亮斑随时间的放大率），写成 scene.json 供原生助手使用。
"""
import json, math, os, subprocess, sys, tempfile
from PIL import Image, ImageFilter, ImageEnhance

OUT = os.path.expanduser('~/.dsh/dsh-dafeiyu/effects/scene')
W, H = 412, 344
FFMPEG = os.environ.get('DFY_FFMPEG') or os.path.expanduser('~/Applications/大肥鱼播放器.app/Contents/Resources/bin/ffmpeg')


def extract(video, fps=2, width=160):
    tmp = tempfile.mkdtemp(prefix='dfy-scene-')
    subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', '-i', video,
                    '-vf', f'fps={fps},scale={width}:-1', os.path.join(tmp, 'f_%04d.png')], check=True)
    files = sorted(f for f in os.listdir(tmp) if f.endswith('.png'))
    return [Image.open(os.path.join(tmp, f)).convert('RGB') for f in files]


def analyze(frames):
    stats = []
    for index, frame in enumerate(frames):
        small = frame.resize((80, 45))
        pixels = list(small.getdata())
        width, height = small.size
        luma = [0.2126 * r + 0.7152 * g + 0.0722 * b for r, g, b in pixels]
        # 上半部分亮度 vs 下半部分
        top = sum(luma[: width * (height // 2)]) / (width * (height // 2))
        bottom = sum(luma[width * (height // 2):]) / (width * (height - height // 2))
        # 水平梯度（找地平线）
        gradient = []
        for y in range(1, height):
            row = sum(abs(luma[y * width + x] - luma[(y - 1) * width + x]) for x in range(width)) / width
            gradient.append(row)
        horizon = (gradient.index(max(gradient)) / height) if gradient else 0.5
        # 亮斑范围（>200 的像素占比）
        bright = [i for i, v in enumerate(luma) if v > 200]
        ratio = len(bright) / len(luma)
        stats.append({'index': index, 'top': top, 'bottom': bottom, 'horizon': horizon,
                      'bright': ratio, 'mean': sum(luma) / len(luma)})
    return stats


def ring_profile(frame):
    small = frame.resize((80, 45)).convert('L')
    px = small.load()
    w, h = small.size
    cx, cy = w / 2.0, h / 2.0
    bins = [0.0] * 10
    counts = [0] * 10
    for y in range(h):
        for x in range(w):
            dx, dy = (x - cx) / (w / 2.0), (y - cy) / (h / 2.0)
            r = min(0.999, math.hypot(dx, dy) / 1.2)
            index = int(r * 10)
            bins[index] += px[x, y]
            counts[index] += 1
    profile = [bins[i] / max(1, counts[i]) for i in range(10)]
    center = sum(profile[0:2]) / 2
    ring = max(profile[2:6]) if len(profile) >= 6 else 0
    return ring - center, profile


def pick_plate(frames, stats):
    # 背景板：上半明显比下半亮（天空/光斑），且亮部不过分集中（排除人物特写）
    scored = []
    for item in stats:
        ring, profile = ring_profile(frames[item['index']])
        scored.append((ring, item, profile))
    scored.sort(key=lambda entry: entry[0], reverse=True)
    best = scored[1][1] if len(scored) > 1 else scored[0][1]
    ring_value = scored[0][0]
    best['ring'] = round(ring_value, 2)
    return frames[best['index']], best


def main():
    video = sys.argv[1]
    os.makedirs(OUT, exist_ok=True)
    frames = extract(video)
    frames = frames[:max(4, int(len(frames) * 0.6))]
    stats = analyze(frames)
    frame, best = pick_plate(frames, stats)
    plate = frame.resize((W, H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(2))
    plate = ImageEnhance.Brightness(plate).enhance(0.75)
    plate = ImageEnhance.Color(plate).enhance(1.15)
    plate.save(os.path.join(OUT, 'backdrop.jpg'), quality=90)

    ratios = [s['bright'] for s in stats]
    peak = max(ratios) if ratios else 0
    first = ratios[:max(1, len(ratios) // 3)]
    dolly = (peak + 1e-6) / (max(0.001, sum(first) / len(first) + 1e-6))
    scene = {
        'backdrop': 'backdrop.jpg',
        'horizon': round(best['horizon'], 3),
        'bright': round(best['bright'], 4),
        'dolly': round(min(2.0, max(0.8, dolly)), 3),
        'scale': round(1.0 + (1.0 - min(1.0, best['bright'] * 3)) * 0.35, 3),
        'source': os.path.basename(video),
    }
    json.dump(scene, open(os.path.join(OUT, 'scene.json'), 'w'), ensure_ascii=False, indent=2)
    print(json.dumps({'ok': True, **scene}, ensure_ascii=False))


if __name__ == '__main__':
    main()
