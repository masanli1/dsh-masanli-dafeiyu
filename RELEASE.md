# 大肥鱼 0.2.1 发布说明

## 这版多了什么

| 能力 | 说明 | 怎么用 |
|---|---|---|
| **记忆层** | 17 阶排列地址（3.56e14）、CRT 校验、哥德巴赫联想、压缩矩阵存储 | `/memory`、`matrix-memory` 工具 |
| **SAN 熵** | 无重复段切分 + SAD 分布熵，替代字频熵 | `layer entropy`、状态卡 |
| **三条链 + 驱动链** | 推理（熵）、联想（时序）、思考（坐标），驱动链按熵梯度选方向 | `chain`、`drive` 工具 |
| **舞台库** | 多文档投位 + bge 语义检索，检索结果注入对话 | `dfy-stages` 工具 |
| **每日读书** | 闲置 5 分钟后自动读 1 本 Kindle 书 | 全自动 |
| **单词降噪** | 每天 2:00 批量降噪 300 个 | `dfy-denoise` 工具 |
| **抠图做动作** | U-Net 抠图（Dice 0.915）+ 纸偶骨骼 | `dfy-seg action=clip` |
| **状态卡** | 读书/降噪进度条 + SAN 熵 | 点一下她 |

## 安装

```bash
dsh plugin --profile desktop add file:/path/to/dsh-dafeiyu-chat
```

或安装 tgz：

```bash
dsh plugin --profile desktop add file:/path/to/dsh-dafeiyu-0.2.0.tgz
```

安装后 **⌘Q 重启** 一次，让原生端加载新的动作清单。

## 抠图模型已内置

```
python/seg/unet_def.py          模型定义
python/seg/train_seg.py         训练脚本（BCE+Dice，MPS）
python/seg/seg_pet.py           推理：matte / clip
python/seg/puppet2.py           纸偶骨骼
python/seg/weights/unet_pet.pt  权重 1.9 MB（验证 Dice 0.915）
python/seg/README.md            训练方式说明
```

换机器后 `dfy-seg` 依然可用（需要能跑 torch 的 Python）。

## 已知限制

- 新生成的动作（`dfy-seg`）需要重启才能播放；
- 语义桥（bge）首次启动要建索引，约 1–2 分钟；
- 读书/降噪依赖本机路径：`/Volumes/DISK1/...` 与 `~/Downloads/dfy/...`。
