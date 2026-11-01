# 抠图模型（U-Net）

大肥鱼用这个模型把截图里的角色抠成透明 PNG，再交给纸偶骨骼生成动作。

## 结构

```
python/seg/
  unet_def.py            模型定义（3 层下采样 U-Net，base 16）
  train_seg.py           训练脚本（BCE + Dice，MPS/CPU）
  seg_pet.py             推理/流水线：matte（只抠图） / clip（抠图 + 生成动作）
  puppet2.py             纸偶骨骼（头/头发/躯干/四肢 + 肘膝），生成 24 帧动作
  weights/unet_pet.pt    训练好的权重（1.9 MB，验证 Dice 0.915）
```

## 训练方式

1. **伪标注**：用 macOS Vision 的前景分割（`VNGenerateForegroundInstanceMaskRequest`）给视频帧打掩码，
   再用“前景占比 / 宽高比 / 最小尺寸”过滤掉把 UI 面板当主体的坏样本（本机保留了 137 张）；
2. **输入**：192×192，随机水平翻转、±12° 旋转、亮度对比度抖动；
3. **损失**：`BCEWithLogits + (1 - Dice)`（与原始医学分割工程同一思路，Dice 直接优化重叠率）；
4. **训练**：AdamW，lr 2e-3，batch 8，400 步，MPS 上约 5 分钟；
5. **验证**：留出 15%，Dice 0.915。

## 重新训练

```bash
export DFY_SEG_IMG=/path/to/images     # 原图
export DFY_SEG_MSK=/path/to/masks      # 掩码（RGBA，alpha>128 视为前景）
python train_seg.py                    # 权重写回 weights/unet_pet.pt
```

## 直接调用

```bash
python seg_pet.py matte in.png out.png          # 只抠图
python seg_pet.py clip  in.png myname wave      # 抠图 + 生成动作（写入插件 assets）
```

## 已知限制

- 只在“角色占画面较大、背景不太杂乱”的图上稳定；
- 角色过小或被大面板压住时会失效（训练样本里没有这种情形）。
