#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""纸偶骨骼 v2：
   - 按角色 alpha 包围盒做相对切分（每张图自适应，可单独覆盖）
   - 新增"头发"骨：跟随头但带相位滞后（弹性感）
"""
import math, os, json
import numpy as np
from PIL import Image, ImageFilter

DEFAULT = {
    # 切分线（相对角色包围盒）
    'head_y': 0.42, 'torso_bottom': 0.76,
    'arm_side': 0.20, 'arm_top': 0.38, 'arm_bottom': 0.76,
    'elbow_y': 0.58, 'leg_y': 0.76,
    # 脸的椭圆（用于把头拆成脸/头发）
    'face_cx': 0.50, 'face_cy': 0.26, 'face_rx': 0.17, 'face_ry': 0.15,
    # 头发滞后系数
    'hair_lag': 0.55,
}

def load_overrides(path):
    try: return json.load(open(path))
    except Exception: return {}

def masks_for(arr, cfg):
    alpha = arr[..., 3] > 8
    ys, xs = np.where(alpha)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    W, H = x1-x0+1, y1-y0+1
    yy, xx = np.mgrid[0:arr.shape[0], 0:arr.shape[1]].astype(np.float32)
    nx = (xx - x0) / W
    ny = (yy - y0) / H
    m = {}
    head = ny < cfg['head_y']
    face = (((nx - cfg['face_cx']) / cfg['face_rx'])**2 +
            ((ny - cfg['face_cy']) / cfg['face_ry'])**2) < 1.0
    m['hair'] = head & ~face
    m['head'] = head & face
    m['torso'] = (ny >= cfg['head_y']) & (ny < cfg['torso_bottom']) & (np.abs(nx-0.5) < 0.30)
    m['armR_u'] = (ny >= cfg['arm_top']) & (ny < cfg['elbow_y']) & (nx >= 0.5 + cfg['arm_side'])
    m['armR_l'] = (ny >= cfg['elbow_y']) & (ny < cfg['arm_bottom']) & (nx >= 0.5 + cfg['arm_side']*0.7)
    m['armL_u'] = (ny >= cfg['arm_top']) & (ny < cfg['elbow_y']) & (nx <= 0.5 - cfg['arm_side'])
    m['armL_l'] = (ny >= cfg['elbow_y']) & (ny < cfg['arm_bottom']) & (nx <= 0.5 - cfg['arm_side']*0.7)
    m['legR'] = (ny >= cfg['leg_y']) & (nx >= 0.5)
    m['legL'] = (ny >= cfg['leg_y']) & (nx < 0.5)
    # 没被任何部件覆盖的像素归到躯干，避免丢失
    covered = np.zeros_like(m['torso'])
    for v in m.values(): covered |= v
    m['torso'] |= alpha & ~covered
    return {k: v & alpha for k, v in m.items()}, (x0, y0, W, H)

PIV = {
    'root': (0.50, 0.76), 'torso': (0.50, 0.76),
    'head': (0.50, 0.40), 'hair': (0.50, 0.30),
    'armR_u': (0.60, 0.42), 'armR_l': (0.64, 0.58),
    'armL_u': (0.40, 0.42), 'armL_l': (0.36, 0.58),
    'legR': (0.53, 0.76), 'legL': (0.47, 0.76),
}
ORDER = ['legL', 'legR', 'armL_l', 'armR_l', 'armL_u', 'armR_u', 'torso', 'hair', 'head']

def split(img, cfg):
    arr = np.array(img.convert('RGBA')).astype(np.uint8)
    ms, meta = masks_for(arr, cfg)
    parts = {}
    for name, m in ms.items():
        p = arr.copy(); p[..., 3] = np.where(m, p[..., 3], 0)
        im = Image.fromarray(p)
        im.putalpha(im.getchannel('A').filter(ImageFilter.GaussianBlur(1.0)))
        parts[name] = im
    return parts, meta

def pose_frame(parts, meta, pose):
    x0, y0, W, H = meta
    w, h = parts['torso'].size
    canvas = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    for name in ORDER:
        angle, off = pose.get(name, (0.0, (0, 0)))
        px, py = PIV[name]
        pivot = (x0 + px * W, y0 + py * H)
        layer = parts[name].rotate(angle, center=pivot, resample=Image.BICUBIC,
                                   translate=(int(off[0]), int(off[1])))
        canvas.alpha_composite(layer)
    return canvas

def actions(cfg):
    lag = cfg.get('hair_lag', 0.55)
    return {
        'alive': lambda t: {
            'torso': (math.sin(t*2*math.pi)*1.2, (0, int(math.sin(t*2*math.pi)*2))),
            'head':  (math.sin(t*2*math.pi+0.6)*2.0, (0, 0)),
            'hair':  (math.sin(t*2*math.pi+0.6-lag)*4.0, (0, 0)),
            'armL_u': (math.sin(t*2*math.pi+1.1)*5, (0, 0)),
            'armR_u': (-math.sin(t*2*math.pi+1.1)*5, (0, 0)),
            'armL_l': (math.sin(t*2*math.pi+1.5)*6, (0, 0)),
            'armR_l': (-math.sin(t*2*math.pi+1.5)*6, (0, 0)),
        },
        'wave': lambda t: {
            'armR_u': (-45 + math.sin(t*2*math.pi*2)*12, (2, -6)),
            'armR_l': (-25 + math.sin(t*2*math.pi*2+0.5)*20, (4, -4)),
            'head':   (4*math.sin(t*2*math.pi), (0, 0)),
            'hair':   (4*math.sin(t*2*math.pi-lag)*1.6, (0, 0)),
            'torso':  (2, (0, 0)),
        },
        'nod': lambda t: {
            'head': (10*math.sin(t*2*math.pi*2), (0, int(2*math.sin(t*2*math.pi*2)))),
            'hair': (10*math.sin(t*2*math.pi*2-lag)*0.9, (0, 0)),
            'torso': (1.5*math.sin(t*2*math.pi*2), (0, 0)),
        },
        'walk': lambda t: {
            'legR': (18*math.sin(t*2*math.pi), (0, int(-2*abs(math.sin(t*2*math.pi))))),
            'legL': (-18*math.sin(t*2*math.pi), (0, int(-2*abs(math.sin(t*2*math.pi))))),
            'torso': (2*math.sin(t*2*math.pi*2), (0, int(-2*abs(math.sin(t*2*math.pi))))),
            'hair': (3*math.sin(t*2*math.pi*2-lag), (0, 0)),
        },
    }

def make_clip(src_path, action, out_dir, overrides=None, frames=24, size=(412, 344)):
    cfg = dict(DEFAULT); cfg.update(overrides or {})
    img = Image.open(src_path).convert('RGBA')
    scale = (size[1]*0.78) / img.height
    img = img.resize((max(1, int(img.width*scale)), max(1, int(img.height*scale))), Image.LANCZOS)
    canvas = Image.new('RGBA', size, (0, 0, 0, 0))
    canvas.alpha_composite(img, ((size[0]-img.width)//2, size[1]-img.height-6))
    parts, meta = split(canvas, cfg)
    os.makedirs(out_dir, exist_ok=True)
    for old in os.listdir(out_dir): os.remove(os.path.join(out_dir, old))
    act = actions(cfg)[action]
    for f in range(frames):
        t = f / frames
        pose_frame(parts, meta, act(t)).save(os.path.join(out_dir, f'{action}_{f+1:03d}.webp'), 'WEBP', quality=88, method=4)

if __name__ == '__main__':
    import sys
    src, action, out = sys.argv[1], sys.argv[2], sys.argv[3]
    ov = json.load(open(sys.argv[4])) if len(sys.argv) > 4 else {}
    make_clip(src, action, out, ov.get(os.path.basename(src)))
    print('done', action)
