# 语音：唤醒 + 说话

大肥鱼的语音分两块：**听见你**（唤醒）和**说话**（TTS）。两块都在本机跑，不联网、不上传录音。

## 一、语音唤醒（已完成）

### 它是什么

一个常驻的 Python 小进程，用 `ffmpeg` 从麦克风以 16k 单声道流式取音，喂给
[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) 的中文关键词检测模型
（zipformer，3.3M 参数，模型 36MB，纯 CPU，约占 3–5% 单核）。

听到唤醒词就往上吐一行 JSON，插件收到后：

1. 让大肥鱼说一句 `wakeReply`（默认「在呢，我在听」）；
2. 广播 `{kind:'wake'}`，网页端收到后自动打开对话面板；
3. 记一笔心情/经验（被叫醒）。

### 装

```bash
bash scripts/setup-voice.sh
```

会做三件事（都可重复执行）：

| 步骤 | 产物 |
| --- | --- |
| 装独立 Python 3.12 | `~/.dsh/dsh-dafeiyu/voice/python` |
| 建 venv 装依赖 | `~/.dsh/dsh-dafeiyu/voice/venv`（numpy / sherpa-onnx / soundfile / pypinyin） |
| 下载唤醒模型 | `~/Documents/大肥鱼声音/models/kws` |

> 为什么要单独装 Python：DSH 运行时自带的 Python 开了 Hardened Runtime，
> 加载 onnxruntime 这类第三方 `.so` 会被系统按 Team ID 拒掉
> （`different Team IDs`），所以语音必须用一份没开校验的解释器。

### 开关

设置页「语音」分组新增：

- `wakeEnabled`：语音唤醒（默认关，开着才会占麦克风）
- `wakeKeyword`：唤醒词，默认 `大肥鱼`，多个用逗号分隔
- `wakeReply`：被叫醒时说的第一句话

改完即时生效：插件会重启监听进程，不用重开 DSH。

### 接口

```bash
# 看状态
curl http://127.0.0.1:<端口>/plugins/dsh-dafeiyu/wake/status

# 不开麦克风，直接演一遍"被唤醒"
curl -X POST -d '{"test":true}' http://127.0.0.1:<端口>/plugins/dsh-dafeiyu/wake/status

# 远程开关
curl -X POST -d '{"enabled":true}' http://127.0.0.1:<端口>/plugins/dsh-dafeiyu/wake/status
```

### 自测（不用真人喊）

```bash
say -v Tingting -o /tmp/wake.aiff "大肥鱼"
ffmpeg -y -i /tmp/wake.aiff -ac 1 -ar 16000 /tmp/wake.wav
~/.dsh/dsh-dafeiyu/voice/venv/bin/python python/voice/wakeword.py \
  --wav /tmp/wake.wav --keyword 大肥鱼 --once
# {"ok": true, "event": "ready", ...}
# {"ok": true, "event": "wake", "keyword": "大肥鱼", ...}
```

## 二、说话（TTS）

### 现在的问题

原来的「声音复刻」不是语音模型：它只是把 `say` 合成的声音按 24 个频段做一遍
EQ 包络匹配（`python/tesla/voice_cli.py`）。能改变"亮/闷"，改变不了音色，
所以听起来还是系统音。

### 语料结论（`/Volumes/DISK1/单词听力`）

- 7751 个 `.mov`，抽样 50 个估算总时长 **约 233 小时**，平均 108 秒/条；
- 单一英文男/女声朗读（待确认），句间有 1–2 秒干净停顿，无背景音乐；
- **画面里有中英字幕**，可以用 macOS Vision OCR 直接拿到精确文本和句子时间轴；
- 中文只出现在字幕里，**没有人读中文** —— 这批语料只能训英文声音。

### 三条路线

| 路线 | 要多久 | 效果 | 代价 |
| --- | --- | --- | --- |
| 零样本克隆（CosyVoice2 / F5-TTS） | 0.5–1 小时 | 像，但短句不稳 | 下载 1–2GB |
| 微调 GPT-SoVITS（1–5 小时高质量数据） | 6–12 小时后台 | 很像，可跨语种说中文 | 下载 3–4GB，占满 CPU |
| 从零训 VITS / StyleTTS2 | 几天 | 最好 | M4 16G 不现实 |

推荐：**先零样本跑通链路（今天就能听见），再后台微调**。

### 数据管线（`python/voice/dataset.py`，待实现）

```
.mov ──ffmpeg──► 16k wav ──VAD──► 语音段
      └─ffmpeg──► 1fps 帧 ──Vision OCR──► 字幕文本 + 时间轴
                                    └──► (wav, text) 对齐样本
```

难点与对策：

- OCR 一次只认一种语言：`en-US` 优先时英文空格正确但漏中文，`zh-Hans` 优先时中文准但英文粘连
  → 两遍 OCR 按 y 坐标合并；
- 233 小时全量 OCR 约 35–90 小时，先做 20–30 小时的精选子集；
- 文本用 OCR（精确）+ ASR（时间戳）互校。

## 三、克隆音色 TTS（本机 GPT-SoVITS）

### 链路

```
文字 ──► GPT-SoVITS api_v2.py (127.0.0.1:9880) ──► wav ──► afplay
                  ▲
     参考音频 + 参考文本（~/Documents/大肥鱼声音/ref/teacher.wav + .txt）
```

插件里 `src/voice-tts.js` 负责：按需拉起服务（首次约 30–60 秒加载模型）、
常驻复用、排队合成、播放，失败自动回落到系统语音。

### 打开

设置 → 语音 → **说话方式 → 克隆音色（老师的声音）**。

### 训练（可选，效果更好）

```bash
# 1) 从视频做数据集（OCR 字幕取原文，按字幕卡切音频，32k）
python python/voice/dataset_ocr.py build --limit 900

# 2) 转成 GPT-SoVITS 的特征
python python/voice/train_gsv.py prepare --name teacher

# 3) 训练 SoVITS（音色）
python python/voice/train_gsv.py s2 --name teacher --epochs 8 --batch 4
```

产物：`~/Downloads/dfy/gpt-sovits/logs/teacher/`（`G_latest.pth` 每轮更新）、
`logs/teacher_weights/*.pth`（每 N 轮导出）。

换模型不用重启服务：

```bash
curl "http://127.0.0.1:9880/set_sovits_weights?weights_path=/绝对路径/G_xxx.pth"
```

### 速度（M4 CPU，16GB）

| 环节 | 实测 |
| --- | --- |
| 参考音频 6 秒 + 一句 4 秒的话 | 3.5–4.6 秒 |
| 首次加载模型 | 30–60 秒 |
| SoVITS 训练 0.66 小时数据、130 步/轮 | 约 17 分钟/轮 |
