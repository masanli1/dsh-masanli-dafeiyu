"""U-Net 定义（训练与推理共用）"""
import torch
import torch.nn as nn
import torch.nn.functional as F

def conv(i, o): return nn.Sequential(nn.Conv2d(i,o,3,padding=1), nn.BatchNorm2d(o), nn.ReLU(inplace=True),
                                     nn.Conv2d(o,o,3,padding=1), nn.BatchNorm2d(o), nn.ReLU(inplace=True))

class UNet(nn.Module):
    def __init__(self, base=16):
        super().__init__()
        self.d1 = conv(3, base); self.d2 = conv(base, base*2); self.d3 = conv(base*2, base*4)
        self.bott = conv(base*4, base*8)
        self.u3 = nn.ConvTranspose2d(base*8, base*4, 2, 2); self.c3 = conv(base*8, base*4)
        self.u2 = nn.ConvTranspose2d(base*4, base*2, 2, 2); self.c2 = conv(base*4, base*2)
        self.u1 = nn.ConvTranspose2d(base*2, base, 2, 2); self.c1 = conv(base*2, base)
        self.out = nn.Conv2d(base, 1, 1)
    def forward(self, x):
        d1 = self.d1(x); d2 = self.d2(F.max_pool2d(d1,2)); d3 = self.d3(F.max_pool2d(d2,2))
        b = self.bott(F.max_pool2d(d3,2))
        u3 = self.c3(torch.cat([self.u3(b), d3], 1))
        u2 = self.c2(torch.cat([self.u2(u3), d2], 1))
        u1 = self.c1(torch.cat([self.u1(u2), d1], 1))
        return self.out(u1)

