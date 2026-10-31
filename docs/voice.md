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

> 克隆音色只会说英文：训练语料是英文单词课，中文句子会自动回落到系统语音，
> 避免把「在呢，我在听」当成英文单词念成乱码。

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

## 四、训练结果（2026-10-31）

数据：532 条 OCR 字幕片段，0.66 小时英文；8 轮 SoVITS 微调，每轮约 10 分钟（batch 6）。

用同一套 8 句话做客观评测（合成 → Whisper 回听 → 算字错率 WER）：

| 版本 | 平均 WER | 基频偏差 |
| --- | --- | --- |
| 预训练模型（零样本） | 0.191 | 11 Hz |
| 微调第 1 轮 | 0.112 | 17 Hz |
| 微调第 5 轮 | 0.159 | 11 Hz |
| **微调第 8 轮（已装为默认）** | **0.047** | 16 Hz |

第 8 轮的字错率是零样本的 **1/4**：`abnormal`、`embarrassed`、`consistent` 这些原本念错的词都读对了。

选中的权重已复制到 `~/Documents/大肥鱼声音/models/tts/teacher_best.pth`，并写进
`GPT_SoVITS/configs/tts_infer.yaml` 的 `custom` 档——服务下次启动直接用它。

### 换一版模型

```bash
# 对比所有轮次，挑最好的并安装
python python/voice/pick_best.py

# 或手动热换（注意路径要 URL 编码，否则中文路径会被 uvicorn 判为非法请求）
curl --get "http://127.0.0.1:9880/set_sovits_weights" \
     --data-urlencode "weights_path=/绝对路径/teacher_e8_s688.pth"
```

### 实测延迟（M4 CPU 16GB，8 轮之后）

| 场景 | 耗时 |
| --- | --- |
| 冷启动（拉起服务 + 加载模型 + 合成第一句） | 16.9 秒 |
| 之后每句（4 秒左右的话） | 1.9–2.4 秒 |

## 五、语料真相：这是影视例句库，不是「一位老师」

训练前后做的说话人检查结论很重要，写在这里避免以后重走弯路。

**证据**

1. 同一个单词（abnormal）的 7 句例句，基频从 110 Hz 到 201 Hz——跨越男声/女声区间；
2. 文本里能直接看到对白痕迹：`Boy: Well, I think 970 AM is pretty bad.`、`- Hey! No alcohol. -`；
3. 用 ECAPA 说话人向量给 2646 条片段两两打分（阈值 0.5，同一人通常 >0.5-0.6）：

   | 指标 | 数值 |
   | --- | --- |
   | 每条片段平均「同人近邻」 | 2.9 条 |
   | 中位数 | 1 条 |
   | 单条最多 | 32 条 |

也就是说，每个说话人在这套语料里只出现几次；2600 多条片段背后是几百个不同的人。

**含义**

- 在这套语料上微调，学到的是「很多人的平均音色」，不存在"那位老师的音色"；
- 想要某一个具体声音，只能用**零样本克隆**（给 3–10 秒参考），或者从别的语料找同一人的多段素材再微调。

**选声音**

`~/Documents/大肥鱼声音/demo/voice-candidates/` 里是我按说话人聚类挑出的 6 个候选（基频 109–333 Hz，各不相同），
挑中哪个就把那段 wav + 对应 txt 填进设置里的「参考音频 / 参考文本」，说话方式选克隆音色。

**统计脚本**

```bash
python python/voice/spk_filter.py analyze   # 说话人向量 + 与参考的相似度分布
python python/voice/spk_filter.py keep --percentile 90   # 只留最像参考的一批（可用于"单人多素材"场景）
```

### 一条命令换音色

```bash
# 挑中某个候选（或自己的录音），直接写进插件设置
python python/voice/pick_voice.py --wav ~/Documents/大肥鱼声音/demo/voice-candidates/候选5_0-10_Philippine_0008900.wav
```

它会先把音频裁到 6–8 秒、配好文本（没有同名 `.txt` 就用 large-v3 转写），
再 PATCH `/plugins/dsh-dafeiyu/config`，把 `ttsEngine`、`ttsRefAudio`、`ttsPromptText` 一次写好。
`--dry-run` 只打印不落盘。

### 两版模型对比（2026-10-31 完成）

| 版本 | 数据 | 轮数 | 累计步数 | 平均 WER（8 句） | 基频偏差 |
| --- | --- | --- | --- | --- | --- |
| v1（teacher） | 0.66 h | 8 | 688 | 0.047–0.089 | 14–16 Hz |
| v2（teacher2） | 2.45 h | 5 | 1390 | 0.056–0.151 | 7–10 Hz |

- v2 在第 3–4 轮追到 v1 的水平（WER 0.056/0.059），第 5 轮回退到 0.087（过拟合）；
- 重复评测的方差很大（同一模型两次能差 0.03–0.06），8 句样本量不够，结论只看趋势；
- 最终保留 **v1 第 8 轮** 作为默认（可懂度更稳），v2 第 4 轮音高更贴参考，权重留在
  `~/Downloads/dfy/gpt-sovits/logs/teacher2_weights/teacher2_e4_s1112.pth`，需要时一条命令可换。
