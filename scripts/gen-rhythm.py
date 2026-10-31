#!/usr/bin/env python3
"""把一条联想链的节奏（间距序列）变成宠物动作。

每个间距 = 一次"点"：间距越大，起伏越高；整体形成一串带重音的动作。
用法：gen-rhythm.py <name> <gap,gap,...> [--intensity 1.0]
"""
import json, math, os, sys, argparse
from PIL import Image, ImageDraw

ASSETS = os.path.join(os.path.dirname(__file__), '..', 'assets')
PET = os.path.join(ASSETS, 'pet')
MANIFEST = os.path.join(ASSETS, 'pet-manifest.json')
W, H = 412, 344


def load(name):
    d = os.path.join(PET, name)
    files = sorted(f for f in os.listdir(d) if f.endswith('.webp'))
    return [Image.open(os.path.join(d, f)).convert('RGBA') for f in files]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('name')
    parser.add_argument('gaps')
    parser.add_argument('--intensity', type=float, default=1.0)
    args = parser.parse_args()

    gaps = [int(float(value)) for value in args.gaps.split(',') if value.strip()][:16]
    if not gaps:
        gaps = [1, 2, 3]
    base = load('idle')
    frames = []
    per_gap = 8                      # 每个"点"8 帧
    for index, gap in enumerate(gaps):
        amplitude = min(1.0, gap / max(gaps)) * args.intensity
        for k in range(per_gap):
            t = k / per_gap
            # 一次弹跳：起→顶→落
            hop = math.sin(math.pi * t)
            dy = int(-26 * amplitude * hop)
            squash = 1.0 - 0.05 * amplitude * hop
            w, h = int(W * (1 + (1 - squash) * 0.4)), int(H * squash)
            img = base[(index * per_gap + k) % len(base)].resize((w, h), Image.LANCZOS)
            canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
            canvas.alpha_composite(img, ((W - w) // 2, H - h + dy))
            frames.append(canvas)

    out_dir = os.path.join(PET, args.name)
    os.makedirs(out_dir, exist_ok=True)
    for index, image in enumerate(frames, 1):
        image.save(os.path.join(out_dir, f'{args.name}_{index:03d}.webp'), 'WEBP', quality=90, method=4)

    manifest = json.load(open(MANIFEST))
    manifest['clips'][args.name] = {
        'frames': [f'{args.name}/{args.name}_{i:03d}.webp' for i in range(1, len(frames) + 1)],
        'frameMs': 45,
        'loop': True,
        'source': 'learned:rhythm',
    }
    micros = manifest.get('idleMicroClips') or []
    if args.name not in micros:
        micros.append(args.name)
    manifest['idleMicroClips'] = micros
    json.dump(manifest, open(MANIFEST, 'w'), ensure_ascii=False, indent=2)
    print(json.dumps({'ok': True, 'clip': args.name, 'frames': len(frames), 'gaps': gaps}, ensure_ascii=False))


if __name__ == '__main__':
    main()
