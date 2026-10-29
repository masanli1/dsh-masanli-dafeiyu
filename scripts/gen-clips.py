#!/usr/bin/env python3
"""从现有角色帧派生出新动作（不新增素材，只做变换/叠加），写入 assets/pet 并更新 manifest。"""
import json, math, os, random
from PIL import Image, ImageDraw, ImageFont

ASSETS = 'assets'
PET = os.path.join(ASSETS, 'pet')
MANIFEST = os.path.join(ASSETS, 'pet-manifest.json')
W, H = 412, 344
FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'

def load_clip(name):
    d = os.path.join(PET, name)
    files = sorted(f for f in os.listdir(d) if f.endswith('.webp'))
    return [Image.open(os.path.join(d, f)).convert('RGBA') for f in files]

def save_clip(name, frames, frame_ms=42, note=''):
    d = os.path.join(PET, name)
    os.makedirs(d, exist_ok=True)
    for i, im in enumerate(frames, 1):
        im.save(os.path.join(d, f'{name}_{i:03d}.webp'), 'WEBP', quality=92, method=6)
    return {
        'frames': [f'{name}/{name}_{i:03d}.webp' for i in range(1, len(frames) + 1)],
        'frameMs': frame_ms,
        'loop': True,
        'source': note or f'derived:{name}',
    }

def blank():
    return Image.new('RGBA', (W, H), (0, 0, 0, 0))

def bounce(base, n=96):
    out = []
    for i in range(n):
        phase = math.sin(math.pi * (i % 32) / 32)
        dy = -14 * abs(phase)
        squash = 1.0 + 0.035 * phase
        w, h = int(W * (1.0 + (1 - squash) * 0.35)), int(H * squash)
        img = base[i % len(base)].resize((w, h), Image.LANCZOS)
        canvas = blank()
        canvas.alpha_composite(img, ((W - w) // 2, H - h + int(dy)))
        out.append(canvas)
    return out

def sway(base, n=120):
    out = []
    for i in range(n):
        phase = 2 * math.pi * i / 60
        angle = 2.6 * math.sin(phase)
        dx = int(10 * math.sin(phase + 0.6))
        img = base[i % len(base)].rotate(angle, resample=Image.BICUBIC, center=(W / 2, H * 0.82))
        canvas = blank()
        canvas.alpha_composite(img, (dx, 0))
        out.append(canvas)
    return out

def heart_shape(size, color):
    im = blank_sized(size)
    d = ImageDraw.Draw(im)
    pts = []
    for a in range(0, 360, 4):
        r = math.radians(a)
        x = 16 * math.sin(r) ** 3
        y = -(13 * math.cos(r) - 5 * math.cos(2 * r) - 2 * math.cos(3 * r) - math.cos(4 * r))
        pts.append((size / 2 + x * size / 36, size / 2 + y * size / 36))
    d.polygon(pts, fill=color)
    return im

def blank_sized(size):
    return Image.new('RGBA', (size, size), (0, 0, 0, 0))

def with_hearts(base, n=144):
    out = []
    random.seed(7)
    active = []
    for i in range(n):
        frame = base[i % len(base)].copy()
        if i % 22 == 0:
            active.append({'born': i, 'x': random.randint(120, 300), 'size': random.randint(16, 26), 'sway': random.uniform(-0.4, 0.4)})
        layer = blank()
        keep = []
        for h in active:
            age = i - h['born']
            life = 66
            if age > life:
                continue
            keep.append(h)
            progress = age / life
            y = H * 0.62 - progress * 150
            x = h['x'] + math.sin(progress * 6 + h['sway'] * 6) * 10
            alpha = int(230 * (1 - progress) ** 1.2)
            im = heart_shape(h['size'], (255, 120, 160, max(0, alpha)))
            layer.alpha_composite(im, (int(x - h['size'] / 2), int(y)))
        active = keep
        frame.alpha_composite(layer)
        out.append(frame)
    return out

def star(size, color):
    im = blank_sized(size)
    d = ImageDraw.Draw(im)
    c = size / 2
    d.polygon([(c, 0), (c + size * 0.12, c - size * 0.12), (size, c), (c + size * 0.12, c + size * 0.12),
               (c, size), (c - size * 0.12, c + size * 0.12), (0, c), (c - size * 0.12, c - size * 0.12)], fill=color)
    return im

def with_sparkles(base, n=144):
    out = []
    random.seed(11)
    for i in range(n):
        frame = base[i % len(base)].copy()
        layer = blank()
        for k in range(7):
            phase = (i / 24 + k * 0.37) % 1.0
            size = int(8 + 10 * abs(math.sin(phase * math.pi)))
            if size < 4:
                continue
            x = 90 + (k * 47) % 240 + math.sin(i / 9 + k) * 8
            y = 70 + (k * 31) % 150 + math.cos(i / 11 + k) * 6
            alpha = int(200 * (1 - abs(phase - 0.5) * 2) ** 1.5) if phase != 0 else 0
            layer.alpha_composite(star(size, (255, 236, 170, max(0, alpha))), (int(x), int(y)))
        frame.alpha_composite(layer)
        out.append(frame)
    return out

def sleepy(base, n=120):
    font = ImageFont.truetype(FONT, 26)
    small = ImageFont.truetype(FONT, 18)
    out = []
    slowed = []
    for im in base[:60]:
        slowed.extend([im, im])
    for i in range(n):
        frame = slowed[i % len(slowed)].copy()
        layer = blank()
        text = Image.new('RGBA', (140, 60), (0, 0, 0, 0))
        d = ImageDraw.Draw(text)
        d.text((6, 26), 'Z', font=small, fill=(235, 240, 255, 190))
        d.text((30, 8), 'Z', font=font, fill=(245, 250, 255, 220))
        lift = int((i % 120) * 0.45)
        layer.alpha_composite(text, (250, 90 - lift))
        frame.alpha_composite(layer)
        out.append(frame)
    return out


def jump(base, n=96):
    """跳一下：起跳压缩 → 腾空 → 落地缓冲。"""
    out = []
    for i in range(n):
        t = (i % 48) / 48.0
        if t < 0.15:
            scale = 1.0 - 0.06 * (t / 0.15)
            dy = 0
        elif t < 0.75:
            u = (t - 0.15) / 0.6
            dy = -46 * math.sin(math.pi * u)
            scale = 1.0 + 0.05 * math.sin(math.pi * u)
        else:
            u = (t - 0.75) / 0.25
            scale = 1.0 - 0.05 * math.sin(math.pi * u)
            dy = 0
        w, h = int(W * (1.0 + (1 - scale) * 0.3)), int(H * scale)
        img = base[i % len(base)].resize((w, h), Image.LANCZOS)
        canvas = blank()
        canvas.alpha_composite(img, ((W - w) // 2, H - h + int(dy)))
        out.append(canvas)
    return out


def nod(base, n=72):
    """点头：轻微上下 + 一点点前倾。"""
    out = []
    for i in range(n):
        phase = 2 * math.pi * i / 24
        dy = int(5 * math.sin(phase))
        angle = 1.6 * math.sin(phase)
        img = base[i % len(base)].rotate(angle, resample=Image.BICUBIC, center=(W / 2, H * 0.9))
        canvas = blank()
        canvas.alpha_composite(img, (0, dy))
        out.append(canvas)
    return out


def shake(base, n=60):
    """摇头：左右快速小幅摆动。"""
    out = []
    for i in range(n):
        dx = int(7 * math.sin(2 * math.pi * i / 10))
        img = base[i % len(base)].rotate(2.2 * math.sin(2 * math.pi * i / 10), resample=Image.BICUBIC, center=(W / 2, H * 0.85))
        canvas = blank()
        canvas.alpha_composite(img, (dx, 0))
        out.append(canvas)
    return out


def lean(base, n=90):
    """歪头看你：缓慢倾斜再回正。"""
    out = []
    for i in range(n):
        u = (i % 45) / 45.0
        angle = 4.2 * math.sin(math.pi * u)
        img = base[i % len(base)].rotate(angle, resample=Image.BICUBIC, center=(W / 2, H * 0.92))
        canvas = blank()
        canvas.alpha_composite(img, (0, 0))
        out.append(canvas)
    return out

def main():
    idle = load_clip('idle')
    head = load_clip('head_pat')
    success = load_clip('success')
    new = {
        'bounce': (bounce(idle), 'derived:idle+bounce'),
        'sway': (sway(idle), 'derived:idle+sway'),
        'heart': (with_hearts(head), 'derived:head_pat+hearts'),
        'sparkle': (with_sparkles(success), 'derived:success+sparkles'),
        'sleepy': (sleepy(idle), 'derived:idle+zzz'),
        'jump': (jump(idle), 'derived:idle+jump'),
        'nod': (nod(idle), 'derived:idle+nod'),
        'shake': (shake(idle), 'derived:idle+shake'),
        'lean': (lean(idle), 'derived:idle+lean'),
    }
    manifest = json.load(open(MANIFEST))
    for name, (frames, note) in new.items():
        manifest['clips'][name] = save_clip(name, frames, note=note)
        print(f'{name}: {len(frames)} frames')
    micros = manifest.get('idleMicroClips') or []
    for name in new:
        if name not in micros:
            micros.append(name)
    manifest['idleMicroClips'] = micros
    json.dump(manifest, open(MANIFEST, 'w'), ensure_ascii=False, indent=2)
    print('idleMicroClips:', micros)

if __name__ == '__main__':
    main()
