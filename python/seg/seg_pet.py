#!/usr/bin/env python3
"""给大肥鱼用的抠图 + 动画流水线：
   seg_pet.py matte <in> <out.png>              只抠图
   seg_pet.py clip  <in> <clip名> [action]      抠图→骨骼动画→写进插件 assets
"""
import os, sys, json, shutil, subprocess
import numpy as np
from PIL import Image
import torch

HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN = os.path.abspath(os.path.join(HERE, '..', '..'))
WEIGHTS = os.path.join(HERE, 'weights', 'unet_pet.pt')
ASSETS = os.path.join(PLUGIN, 'assets', 'pet')
MANIFEST = os.path.join(PLUGIN, 'assets', 'pet-manifest.json')
RIG = os.environ.get('DFY_RIG_SCRIPT') or os.path.join(HERE, 'puppet2.py')
SZ = 256
_device = 'mps' if torch.backends.mps.is_available() else 'cpu'
_model = None

def model():
    global _model
    if _model is not None: return _model
    sys.path.insert(0, HERE)
    from unet_def import UNet
    m = UNet().eval()
    m.load_state_dict(torch.load(WEIGHTS, map_location='cpu'))
    _model = m.to(_device)
    return _model

def matte(path, out):
    im = Image.open(path).convert('RGB')
    w, h = im.size
    x = np.array(im.resize((SZ, SZ), Image.BILINEAR), dtype=np.float32)/255.0
    t = torch.tensor(x.transpose(2, 0, 1)[None]).to(_device)
    with torch.no_grad():
        p = torch.sigmoid(model()(t))[0, 0].cpu().numpy()
    mask = np.array(Image.fromarray((p*255).astype(np.uint8)).resize((w, h), Image.BILINEAR)) > 120
    rgba = np.array(im.convert('RGBA'))
    rgba[..., 3] = np.where(mask, 255, 0).astype(np.uint8)
    img = Image.fromarray(rgba)
    bbox = img.getbbox()
    if bbox: img = img.crop(bbox)
    img.save(out)
    return img

def make_clip(src, name, action='alive'):
    tmp = f'/tmp/seg_pet_{name}.png'
    matte(src, tmp)
    clip = f'{name}_{action}'
    out_dir = os.path.join(ASSETS, clip)
    if os.path.isdir(out_dir): shutil.rmtree(out_dir)
    subprocess.run([sys.executable, RIG, tmp, action, out_dir], check=True, capture_output=True)
    frames = sorted(os.listdir(out_dir))
    m = json.load(open(MANIFEST))
    m['clips'][clip] = {'frames': [f'{clip}/{f}' for f in frames], 'frameMs': 60, 'loop': True, 'source': 'user-image+unet'}
    json.dump(m, open(MANIFEST, 'w'), ensure_ascii=False, indent=1)
    return clip, len(frames)

if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'matte':
        matte(sys.argv[2], sys.argv[3]); print('ok')
    elif cmd == 'clip':
        clip, n = make_clip(sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else 'alive')
        print(f'{clip} {n} 帧')
