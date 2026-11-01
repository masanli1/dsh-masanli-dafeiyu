"""小 U-Net 学习"宠物前景"分割：伪标注来自 Vision，训练用 MPS。"""
import os, glob, random, math
import numpy as np
from PIL import Image
import torch, torch.nn as nn, torch.nn.functional as F

HERE = os.path.dirname(os.path.abspath(__file__))
IMG = os.environ.get('DFY_SEG_IMG', os.path.join(HERE, 'data', 'img'))
MSK = os.environ.get('DFY_SEG_MSK', os.path.join(HERE, 'data', 'mask'))
SZ = 192
files = sorted(os.path.basename(p) for p in glob.glob(IMG + '/*.png'))
random.seed(0); random.shuffle(files)
split = int(len(files)*0.85)
train_f, val_f = files[:split], files[split:]

def load(name, augment=False):
    im = Image.open(f'{IMG}/{name}').convert('RGB').resize((SZ, SZ), Image.BILINEAR)
    mk = Image.open(f'{MSK}/{name}').convert('RGBA').resize((SZ, SZ), Image.NEAREST)
    a = np.array(im, dtype=np.float32)/255.0
    m = (np.array(mk)[...,3] > 128).astype(np.float32)
    if augment:
        if random.random() < 0.5: a, m = a[:, ::-1], m[:, ::-1]
        if random.random() < 0.5:
            ang = random.uniform(-12, 12)
            pi = Image.fromarray((a*255).astype(np.uint8)); pm = Image.fromarray((m*255).astype(np.uint8))
            pi = pi.rotate(ang, resample=Image.BILINEAR); pm = pm.rotate(ang, resample=Image.NEAREST)
            a = np.array(pi, dtype=np.float32)/255.0; m = (np.array(pm) > 128).astype(np.float32)
        a = np.clip(a * random.uniform(0.85, 1.15) + random.uniform(-0.05, 0.05), 0, 1)
    return a.transpose(2,0,1).copy(), m[None].copy()

from unet_def import UNet

device = 'mps' if torch.backends.mps.is_available() else 'cpu'
print('设备', device, '｜训练', len(train_f), '验证', len(val_f))
model = UNet().to(device)
opt = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=1e-4)

def dice(logits, target, eps=1e-6):
    p = torch.sigmoid(logits)
    inter = (p*target).sum((1,2,3)); union = p.sum((1,2,3)) + target.sum((1,2,3))
    return ((2*inter+eps)/(union+eps)).mean()

steps = 400
bs = 8
model.train()
for step in range(steps):
    batch = random.sample(train_f, bs)
    xs, ys = zip(*[load(n, True) for n in batch])
    x = torch.tensor(np.stack(xs)).to(device); y = torch.tensor(np.stack(ys)).to(device)
    logits = model(x)
    loss = F.binary_cross_entropy_with_logits(logits, y) + (1 - dice(logits, y))
    opt.zero_grad(); loss.backward(); opt.step()
    if step % 50 == 0:
        with torch.no_grad():
            d = dice(logits, y).item()
        print(f'{step:4d} loss {loss.item():.3f} dice {d:.3f}', flush=True)

model.eval()
ds = []
with torch.no_grad():
    for i in range(0, len(val_f), 8):
        batch = val_f[i:i+8]
        xs, ys = zip(*[load(n, False) for n in batch])
        x = torch.tensor(np.stack(xs)).to(device); y = torch.tensor(np.stack(ys)).to(device)
        ds.append(dice(model(x), y).item())
print(f'验证 Dice {np.mean(ds):.3f}')
torch.save(model.state_dict(), os.environ.get('DFY_SEG_OUT', os.path.join(HERE, 'weights', 'unet_pet.pt')))
print('已保存 unet_pet.pt')
