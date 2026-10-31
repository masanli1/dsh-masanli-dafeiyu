#!/usr/bin/env python3
"""把一组 PNG 序列（比如 render-turntable 输出的转台帧）变成宠物动作。

用法：frames-to-clip.py <framesDir> <clipName> [--frame-ms 40] [--size 412x344] [--loop]
"""
import argparse, json, os
from PIL import Image

ASSETS = os.path.join(os.path.dirname(__file__), '..', 'assets')
PET = os.path.join(ASSETS, 'pet')
MANIFEST = os.path.join(ASSETS, 'pet-manifest.json')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('dir')
    parser.add_argument('name')
    parser.add_argument('--frame-ms', type=int, default=40)
    parser.add_argument('--width', type=int, default=412)
    parser.add_argument('--height', type=int, default=344)
    parser.add_argument('--loop', action='store_true')
    parser.add_argument('--micro', action='store_true')
    args = parser.parse_args()

    files = sorted(f for f in os.listdir(args.dir) if f.lower().endswith(('.png', '.webp')))
    if not files:
        raise SystemExit('目录里没有图片')
    out_dir = os.path.join(PET, args.name)
    os.makedirs(out_dir, exist_ok=True)
    for index, name in enumerate(files, 1):
        image = Image.open(os.path.join(args.dir, name)).convert('RGBA')
        # 等比缩放并底部对齐到宠物画布
        scale = min(args.width / image.width, args.height / image.height)
        resized = image.resize((max(1, int(image.width * scale)), max(1, int(image.height * scale))), Image.LANCZOS)
        canvas = Image.new('RGBA', (args.width, args.height), (0, 0, 0, 0))
        canvas.alpha_composite(resized, ((args.width - resized.width) // 2, args.height - resized.height))
        canvas.save(os.path.join(out_dir, f'{args.name}_{index:03d}.webp'), 'WEBP', quality=92, method=6)

    manifest = json.load(open(MANIFEST))
    manifest['clips'][args.name] = {
        'frames': [f'{args.name}/{args.name}_{i:03d}.webp' for i in range(1, len(files) + 1)],
        'frameMs': args.frame_ms,
        'loop': args.loop,
        'source': 'render:3d',
    }
    if args.micro:
        micros = manifest.get('idleMicroClips') or []
        if args.name not in micros:
            micros.append(args.name)
        manifest['idleMicroClips'] = micros
    json.dump(manifest, open(MANIFEST, 'w'), ensure_ascii=False, indent=2)
    print(json.dumps({'ok': True, 'clip': args.name, 'frames': len(files)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
