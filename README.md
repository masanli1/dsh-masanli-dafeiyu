<div align="center">

# DSH 大肥鱼 🐋

**在桌面上陪你工作的 DeepSeek Harness 伴侣。**

[English](README_EN.md) · [npm](https://www.npmjs.com/package/dsh-dafeiyu) · [下载最新版](https://github.com/QCYTSN/dsh-dafeiyu/releases/latest) · [更新日志](CHANGELOG.md)

[![npm](https://img.shields.io/npm/v/dsh-dafeiyu?label=npm)](https://www.npmjs.com/package/dsh-dafeiyu) [![Release](https://img.shields.io/github/v/release/QCYTSN/dsh-dafeiyu)](https://github.com/QCYTSN/dsh-dafeiyu/releases/latest)

</div>

大肥鱼由 DSH 插件启动，随 DSH 一起退出。透明、无边框、始终置顶的原生窗口，让你在编辑器、浏览器或其他应用中也能看到 Agent 的工作状态。

> **当前稳定版：0.1.19。** 修复 Helper 冷启动超时后角色静默消失（首次等待放宽到 180 秒并写入诊断日志）、失败启动遗留约 100 MB 临时目录，以及 Linux arm64 误用 x86-64 Helper 后静默退出。安装时填写 `dsh-dafeiyu@0.1.19`，离线安装请从[最新版下载页](https://github.com/QCYTSN/dsh-dafeiyu/releases/latest)选择 **`dsh-dafeiyu-0.1.19.tgz`**；Windows、Linux 与 macOS 共用这一个包。GitHub 自动生成的 **Source code (zip / tar.gz)** 是源码，不是安装包。

<img src="docs/images/balance-preview.png" width="460" alt="大肥鱼在任务状态卡底部显示 API 余额">

*原生 Windows 窗口实拍；余额为演示数据。当前角色素材来自 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)。*

## 能做什么

- 显示真实任务状态：思考、查找、修改、执行、验证、等待确认、完成和错误。
- 展示项目、步骤、多任务和 DSH 提供的待办进度；没有真实进度时显示阶段。
- 在状态气泡和设置页显示 DeepSeek 余额，区分 API Key 与已登录账户。
- 兼容 WebUI 与官方桌面端的共享客户端；两个客户端使用各自的插件配置。
- 支持拖动、摸头、戳身体、碰尾巴，以及大小、气泡、声音和减少动态设置。
- 可选在 DSH 页面右下角显示轻量角色，默认关闭。

状态来自 DSH 会话事件。大肥鱼不会读取屏幕；推理强度与进度只显示上游实际提供的信息。

## 先选你的 DSH 客户端

| 使用方式 | 安装位置 | 设置入口（DSH 0.2） | 角色右键菜单的打开目标 |
| --- | --- | --- | --- |
| 浏览器 WebUI | `web` profile | 左侧插件 → dsh-dafeiyu | WebUI，默认 `http://127.0.0.1:3080/` |
| 官方桌面端 | `desktop` profile | 左侧插件 → dsh-dafeiyu | 通过 `dsh://open` 唤起桌面应用 |

**WebUI 中安装的插件不会自动出现在桌面端。** 两边都启用会各自启动原生角色，可以在其中一个 profile 关闭“大肥鱼”。第三方桌面包装器可能仍使用 `web` profile，请以它的实际启动方式为准。

客户端包中的 `platform: web` 也适用于官方桌面端：官方 Electron 应用使用同一套 Web 客户端。原生角色由对应 Host 启动。

## 安装

使用命令行安装、升级或移除前，先**完全退出对应 DSH Host**；操作后重新启动。通过桌面应用内的插件管理操作时，按应用提示重启。

### 浏览器 WebUI

已全局安装 DSH：

```powershell
dsh plugin --profile web add dsh-dafeiyu@0.1.19
dsh web
```

使用 `npx`，无需全局安装 DSH：

```powershell
npx -y @deepseek-ai/dsh plugin --profile web add dsh-dafeiyu@0.1.19
npx -y @deepseek-ai/dsh web
```

从 DeepSeek Harness 源码运行的用户，在 Harness 仓库中执行：

```powershell
pnpm dsh plugin --profile web add dsh-dafeiyu@0.1.19
pnpm dsh web
```

### 官方桌面端

推荐直接在应用内安装：

1. 打开官方 DeepSeek Harness 桌面应用，点击左侧 **插件**。
2. 点击 **添加插件**，输入 `dsh-dafeiyu@0.1.19`，点击 **安装**。
3. 安装成功后点击 **立即启用**，大肥鱼会出现在桌面上。
4. 在插件列表打开 **dsh-dafeiyu**，调整角色、气泡和余额设置，修改实时生效。

这套流程使用桌面应用自带的安装环境，用户无需安装 Node.js 或执行 npm 命令。若应用提示刷新或重启，按提示操作；失败时展开 **查看安装详情** 并保留日志。

也可以只填 `dsh-dafeiyu` 获取安装源中的最新版。新版本刚发布时，默认安装源可能仍返回旧版；指定版本可以避免装错。安装后核对详情页中的版本号。

使用命令安装时：

1. 先启动一次官方桌面应用，让它初始化 `desktop` profile，然后完全退出。
2. 使用桌面应用**自带的 `dsh` 命令**。支持命令注册的版本可从应用菜单的 **Manage dsh command… / 管理 dsh 命令**入口配置；也可直接调用安装目录的 `resources/runtime/cli/bin/dsh`（Windows 为 `dsh.cmd`）。
3. 执行：

   ```powershell
   dsh plugin --profile desktop add dsh-dafeiyu@0.1.19
   ```

4. 重新打开桌面应用，在左侧插件 → dsh-dafeiyu 调整角色。

**这里的 `dsh` 必须来自桌面应用。** 独立安装的 npm / `npx @deepseek-ai/dsh` CLI 不能修改官方桌面端的 profile。请参考 [DSH 官方桌面端说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.zh.md#bundled-command-runtime)。

### 使用 Release 安装包

打开[最新版下载页](https://github.com/QCYTSN/dsh-dafeiyu/releases/latest)，在 **Assets** 中下载 **`dsh-dafeiyu-0.1.19.tgz`**，用对应客户端的命令安装；**无需解压**。不要选择历史版本，也不要下载 **Source code** 作为安装包：

```powershell
# WebUI；文件路径替换为实际下载路径
npx -y @deepseek-ai/dsh plugin --profile web add "C:\Downloads\dsh-dafeiyu-0.1.19.tgz"

# 官方桌面端；必须使用应用自带的 dsh
dsh plugin --profile desktop add "C:\Downloads\dsh-dafeiyu-0.1.19.tgz"
```

桌面端也可在 **添加插件** 的输入框填写 `.tgz` 的完整路径。

## 余额显示

余额默认出现在**大肥鱼状态气泡底部和设置页**，查询逻辑由两个客户端共用。设置页可查看总余额、赠送和充值，并手动刷新。

| 来源 | 凭据来自哪里 | 查询内容 |
| --- | --- | --- |
| 自动（默认） | 优先使用 DSH 模型设置中的 DeepSeek API Key；未配置时尝试已登录账户 | 对应来源的余额 |
| API Key | DSH 的凭据服务；旧 Host 无该服务时读取启动环境 | DeepSeek `/user/balance` |
| 已登录账户 | DSH 的 DeepSeek 账户服务 | 账户充值与赠送钱包 |

- 在 **DSH 模型／账户设置**中配置凭据；大肥鱼设置页不需要再填写 API Key。
- API 余额与账户余额分别标明来源；CNY / USD 分别显示。
- 每分钟自动刷新，同一 Host 内共享缓存；手动刷新最快每 5 秒一次。
- 服务失败时保留上次成功结果，并标明“上次查询”；未配置、授权失败和网络失败分别提示。
- 自定义网关需要实现相同的 `/user/balance` 接口；不支持时显示查询失败。
- API Key、登录凭据和上游原始错误不会进入余额页面、角色消息或事件流。
- 没有余额凭据也能正常显示任务状态；可关闭“显示 DeepSeek 余额”。

账户余额和 API 余额的查询方式参考了 [keshing/balance-display](https://github.com/keshing/balance-display) 与 DSH 的公开账户服务。插件不会发起模型调用。

## 常用设置

| 设置 | 作用 |
| --- | --- |
| 启用大肥鱼 | 开关当前 profile 的原生角色 |
| 角色大小 / 气泡大小 | 独立调整；小气泡保留基本字号 |
| 安静 / 标准 / 活泼 | 每次待机动作结束后，分别休息 45～90 / 25～45 / 12～22 秒 |
| 减少动态 | 固定角色姿势，停止待机与点击动画；状态和提示仍实时更新 |
| 提示音 | 完成／出错时播放声音 |
| 气泡显示 | 常驻、隐藏，或仅在指定状态显示 |
| 子 Agent | 允许子 Agent 状态参与显示 |
| 页面内角色 | 在 DSH 页面右下角显示轻量角色 |
| 打开目标 | 自动、WebUI 或官方桌面端 |
| 显示余额 / 余额来源 | 开关与选择余额查询来源 |

设置页修改实时生效。右键菜单可调整大小、减少动态、打开对应 DSH 客户端，或仅在本次运行隐藏／关闭角色。

点击动作会完整播完，再回到当前任务状态；新任务可立即打断装饰动作。拖拽期间只播放悬空姿势，松手后完整落地。具体触发、频率和衔接规则见 [动作说明](docs/animation-behavior.md)。

若 WebUI 使用自定义地址，可在启动 Host 时设置 `DSH_DAFEIYU_WEBUI_URL`；它优先于自动推断的默认地址。

## 平台与运行环境

| 平台 | 原生角色 |
| --- | --- |
| Windows 10 / 11 x64 | 随包提供 Helper；WSL2 可通过 Windows 互操作启动 |
| Linux x64 | 随包提供 Qt Helper，需要图形桌面；glibc 2.35+，Ubuntu 24.04 有验收记录 |
| Linux arm64 | 包里**没有**随架构 Helper，会自动回退到 Python Helper，需要 `python3` 与 `PySide6>=6.7,<7`；缺失时会写明确日志 |
| macOS 12+ | 原生 Swift / AppKit Helper，Universal 构建；实验性支持 |

标准安装包已包含 Helper，**不需要自己安装 Python 或运行 Helper**。从源码使用时需自行构建。macOS 小字号与拖动边缘已修复并通过 CI，仍需真实机器验证视觉效果与多屏操作。

原生角色显示在 **Host 所在的桌面**：远程服务器、无图形环境和浏览器客户端不在同一台机器时，请先确认 Host 的运行位置。页面内角色可在浏览器中显示。

## 更新与排错

WebUI 用户完全退出 DSH 后执行：

```powershell
npx -y @deepseek-ai/dsh plugin --profile web update dsh-dafeiyu
```

官方桌面端 **0.2.0-rc.2 暂不支持应用内自动更新**。在插件页面卸载大肥鱼，再添加 `dsh-dafeiyu@0.1.19` 并立即启用；也可以完全退出应用后使用自带的命令：

```powershell
dsh plugin --profile desktop update dsh-dafeiyu
```

然后重新启动对应客户端。回退、移除、DSH 迁移后恢复大小，以及 Windows `EPERM` 的处理见 [更新与回退](docs/UPDATING.md)。

- DSH 0.2 设置页变化：安装当前稳定版，通过左侧插件 → dsh-dafeiyu 打开设置；较旧 Host 保留原设置入口。
- 桌面端安装只显示 `[exit 1]`：该信息不足以确定原因，请附上插件安装详细日志（如 `hub.log`）、DSH 版本、系统和安装方式。
- 余额查询失败：检查 DSH 中的凭据及所用网关是否支持余额接口。
- 角色不出现：检查 profile、插件是否启用，以及 Host 是否有可用图形桌面。Helper 的启动原因现在会写入日志：
  - Windows：`%LOCALAPPDATA%\dsh-dafeiyu\logs\helper.log`
  - macOS：`~/Library/Logs/dsh-dafeiyu/helper.log`
  - Linux：`${XDG_STATE_HOME:-~/.local/state}/dsh-dafeiyu/helper.log`

  首次启动需要把约 100 MB 的 Qt 运行库解压到临时目录，杀毒软件实时扫描可能让冷启动明显变慢；首次就绪等待上限已放宽到 180 秒（之后 60 秒）。解压临时目录在 Windows 位于 `%LOCALAPPDATA%\dsh-dafeiyu\tmp`、Linux 位于 `~/.cache/dsh-dafeiyu/tmp`，其中超过一天的陈旧 `_MEI*` 目录会在下次启动时清理。需要更详细输出时可用 `DSH_DAFEIYU_LOG_FILE=<路径>` 改日志位置，或设为 `off` 关闭；报告问题时可以附上该日志（只含本地路径与启动错误，不含凭据）。

[GitHub issue / PR 处理清单](https://github.com/QCYTSN/dsh-dafeiyu/blob/main/docs/GITHUB_TRIAGE.md)记录已处理和仍需补充证据的问题；[验收记录](https://github.com/QCYTSN/dsh-dafeiyu/blob/main/docs/ACCEPTANCE.md)保留实际测试结果。这些记录中的旧版本号用于追溯，不是安装建议。

## 源码开发

```powershell
pnpm install --frozen-lockfile
npm test
npm run test:python
npm run build:helper
npm run test:helper:packaged
```

开发 Python Helper 需要 `requirements.txt` 中的依赖；macOS Helper 需要 Xcode Command Line Tools。纯 Swift 核心测试运行 `swift test`。修改原生代码后应重新构建 Helper，再安装本地打包产物。

CI 还会隔离安装 DSH 0.2.0-rc.2 并运行 `scripts/test-dsh-settings.mjs`，验证新设置接口。该检查不读取用户 profile 或凭据，文件写入使用测试适配器。

项目通过 GitHub Actions 构建三个平台的 Helper 并发布；维护者操作见 [发布说明](https://github.com/QCYTSN/dsh-dafeiyu/blob/main/docs/RELEASING.md)。

## 素材与授权

当前动态素材来自 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)，以来源的 **24 fps** 转成透明 WebP 帧。当前清单含 16 组动作、3,444 帧，帧画布为 412 × 344；清单记录了上游版本、视频校验值和取帧范围。

软件代码与角色素材适用不同授权，请完整阅读 [ASSET_LICENSE.md](ASSET_LICENSE.md)、[素材来源许可证](assets/dsh-pet-LICENSE.txt)和 [LICENSE](LICENSE)。旧版素材及社区拖拽图片保留于 `legacy/`，不随当前 npm 包分发。

感谢社区在动画、macOS、WSL 和兼容性方面的贡献。想接收更新通知，请订阅仓库 **Watch → Custom → Releases**；Star 只收藏项目。

## 本地分支：页内聊天面板（chat.1）

本目录是本地 fork（基于 dsh-dafeiyu 0.1.19，MIT 代码 + 原素材授权）。新增：

- 页面右下角 💬 按钮，点开是和朋友聊天的小面板；
- 消息通过 Host 的 `sessionController.prompt` 进入当前 Harness 会话（和网页里输入等价，模型/工具/权限都沿用会话本身）；
- 历史通过 `sessionQuery.observeSession` 读取，默认跟随你最近使用的会话，也可在面板顶部切换；
- 轮询 2.5s 刷新，发送后乐观追加，助手回复自动出现；
- 端点：`/plugins/dsh-dafeiyu/chat/state|send|target`，只接受本机回环请求。

测试：`node test/chat.test.mjs`（消息提取、状态机、HTTP 端点）。

## 本地分支：语音 + 主动打招呼（chat.6）

- **本机语音**：用 macOS 自带 `say` 播报，不联网、不消耗 token、不需要 API Key。默认音色 `Tingting`，语速 180，可在设置里改。
- **任务播报**：任务完成 / 出错时各说一句（30 秒内最多一次，避免连续任务时吵）。
- **无聊打招呼**：空闲满 12 分钟后主动冒泡（气泡 + 动作 + 语音），之后每 25 分钟最多一次，**连续 3 次后会安静**，直到你重新操作。
- **时段感知**：早上 / 下午 / 晚上 / 深夜各有不同台词（23:00–05:00 会催你睡觉）。
- 台词表在 `src/greeter.js`，想改直接换文案；开关和参数在 **设置 → 大肥鱼**。
- 新的打招呼动作复用现有素材（成功动作 + 气泡）；要真正的“挥手/转圈”需要新的动作帧，当前素材包里没有对应 clip。

测试：`node test/greeter.test.mjs`（阈值 / 忙碌 / 间隔 / 连续上限 / 语音开关 / 播报节流 / 时段）。

## 本地分支：新增待机动作（chat.8）

用 `scripts/gen-clips.py` 从现有帧派生出 5 组新动作（不新增素材，纯变换/叠加）：

| 动作 | 做法 | 帧数 |
|---|---|---|
| `bounce` | 待机帧 + 弹跳/轻微挤压 | 96 |
| `sway` | 待机帧 + 左右摇摆 + 轻微倾斜 | 120 |
| `heart` | 摸头帧 + 上浮爱心粒子 | 144 |
| `sparkle` | 成功帧 + 星光粒子 | 144 |
| `sleepy` | 待机帧减速 + 上升 Zzz | 120 |

它们被追加进 `idleMicroClips`（现在共 8 个待机小动作），空闲时按 `activityLevel` 的节奏轮播。
Host 通过 `DSH_DAFEIYU_ASSET_ROOT` 把原生 Helper 的资源根指向安装包内的 `assets/`，所以改完帧不用重新编译 Swift 助手。

想再生成一批：`python3 scripts/gen-clips.py`（会重写 manifest，注意先备份）。

## 内置降噪（chat.9）

装这一个插件，同时得到桌宠和降噪工具 `denoise_audio`（NPSS-Enhancer 核心，纯 CPU、无模型下载）：

- 音频/视频均可：wav 直接处理，其它容器与视频用 ffmpeg 抽轨、处理后再混回（画面流拷贝）；
- 参数：`mode`（music/voice）、`targetDb`（定果寻因）、`fast`、`workers`；
- 依赖：Python 3 + numpy（Host 会自动找 DSH 自带运行时；可用 `DSH_NPSS_PYTHON` 覆盖），视频/非 WAV 需要 ffmpeg；
- 核心代码在 `python/`，许可沿用 NPSS-Enhancer：学术/非商业免费，商用需授权（见 `python/NPSS-*.md` 说明与上游 LICENSE）。

典型用法（对 Agent 说）：

> 把这个视频的声音降噪到 15 dB：/Users/me/clip.mp4

安装（二选一）：

```sh
dsh plugin --profile desktop add github:masanli1/dsh-masanli-dafeiyu#v0.1.19-chat.9
# 或下载 Release 里的 dsh-dafeiyu-*.tgz 后：
dsh plugin --profile desktop add /path/to/dsh-dafeiyu-0.1.19-chat.9.tgz
```

## 设置页降噪入口（chat.12）

设置 → 大肥鱼 → 底部「降噪（NPSS）」：

- **选择文件**：内置目录浏览（限制在用户目录内，只看音视频），点目录进入、点文件选中；
- **模式**：音乐（全频带）/ 人声（16k 带限）；
- **目标 dB**：可选，填了就是定果寻因；
- **快速模式**：勾选后约 2 倍速；
- 运行中显示进度，完成后展示输出路径、时长、RTF、目标/实测 dB，并在 `~/.dsh/dsh-dafeiyu-denoise.json` 保留最近 8 条记录。

端点：`/plugins/dsh-dafeiyu/denoise/{state,run,browse}`，仅本机回环可访问。

## 任务期间防止电脑休眠（chat.14）

- DSH 有任务在跑（任一会话的 turn 进行中），或设置页里有降噪任务在处理时，Host 会启动
  `/usr/bin/caffeinate -i -m` 顶住**系统空闲休眠**；全部结束后自动退出。
- 默认**不**阻止屏幕休眠（屏幕可以正常变暗），需要连屏幕常亮时在设置里勾「屏幕也常亮」，
  会改用 `-i -m -d`。
- 用引用计数：多个来源（会话轮次、降噪任务）叠加时不会提前放行。
- 设置项：`preventSleep`（默认开）、`preventSleepDisplay`（默认关）。
- 诊断：`GET /plugins/dsh-dafeiyu/denoise/state` 里带 `power: {held, holders, active, turns, denoiseBusy}`。

## 小说工坊（chat.15/16）

设置页新增「小说工坊」：新建书名、查看每本书的章节与字数、展开看书目、打开目录、导出全书。

目录结构（默认 `~/Documents/大肥鱼小说/`，可用 `novelRoot` 改）：

```
<书名>/
├── meta.json
├── outline.md          大纲
├── characters.md       人物卡
├── chapters/
│   └── 第01章-雨夜.md
└── <书名>-全书.md      导出产物
```

Agent 侧还注册了 `novel` 工具（action：`create / write / append / read / outline / characters / status / list / export`），
可以直接说：

> 给我写《长夜灯火》第 2 章，1500 字，接上一章的雨夜
> 把《长夜灯火》的人物卡补一下
> 统计一下这本书写了多少字

接口：`/plugins/dsh-dafeiyu/novel/{books,book,create,export,open}`，仅本机回环可访问。

## 聊天上下文 + 小说续写上下文（chat.17/18）

### 宠物专属会话

`chatMode` 默认 `dedicated`：第一次点开聊天面板时，Host 自动新建一个会话并改名为
「和大肥鱼聊天」，之后一直复用同一个会话——**聊过的内容就是上下文**，重启 DSH 也不会丢
（会话 id 存在 `~/.dsh/dsh-dafeiyu-chat.json`）。

设置里可切回 `current`（跟随当前会话），或在面板顶部手动选一个会话（临时覆盖）。

### 小说续写上下文

`novel` 工具新增 `action=context`：返回**大纲 + 人物卡 + 最近两章**（各截断到 4000 字），
工具描述里已提示模型“写新章节前先取上下文”。所以可以直接说：

> 接着写《长夜灯火》第 2 章，1500 字

它会先拉上下文再动笔，避免人物名、设定跑偏。

### 宠物会话单独成组（chat.19）

宠物专属会话创建在 `~/Documents/大肥鱼聊天/`，因此侧边栏会和「dfy」「降噪」等工作区并列，
单独出现一条 **大肥鱼聊天** 分组；会话标题固定为「和大肥鱼聊天」。

DSH 0.2 目前没有给插件暴露“会话置顶”接口，所以做不到真正钉在列表顶部；
分组独立 + 最近活动排序是最接近的效果。

### 宠物会话的模型选择（chat.20）

新建的专属会话如果落到 `deepseek-official`（需要 API Key 的路由），每轮都会报
`MISSING_CREDENTIAL`，桌宠会显示「任务好像遇到一点问题呢」。

现在 `adoptModel()` 会在创建/复用宠物会话时：优先沿用当前活跃会话的模型选择；
读不到时退回 catalog 里**确实存在且有凭据的分组**（优先 `deepseek-account`），
并在日志里打印最终选择。排查用：`GET /plugins/dsh-dafeiyu/debug/models`。

## 跨会话上下文 + 长期记忆（chat.21/22）

### 工作摘要注入

宠物专属会话发消息前，Host 会取**最近活跃的非宠物会话**的最近 6 条消息 + 项目名，和长期记忆一起
压成 `<dfy-context>…</dfy-context>` 块，贴在用户消息前面发给模型：

- 模型能看到上下文，因此「我刚才在做什么」能答上来；
- 面板渲染时会把这段 `<dfy-context>` 剥离，**界面上不显示**；
- DSH 主界面的会话记录里仍能看到这段（这是消息的一部分），介意的话可以在设置里关掉
  `contextInjection`。

### 长期记忆

- 文件：`~/Documents/大肥鱼记忆.json`（可直接编辑）；
- 设置页「长期记忆」区块：查看、添加、删除单条、清空，并显示文件路径；
- 工具 `memory`（add / list / remove / clear）：对她说「记住我喜欢蓝色」就会落盘；
- 每次聊天自动把记忆摘要注入上下文，跨会话共享。

### 排查端点（仅本机）

- `GET /plugins/dsh-dafeiyu/memory` 记忆列表
- `GET /plugins/dsh-dafeiyu/debug/chat` 本次会注入的上下文（含跟踪到的会话）
- `GET /plugins/dsh-dafeiyu/debug/models` 模型 catalog 与会话当前选择

## 特斯拉阀 · 复刻（chat.23）

把 `tesla_valve_v2`（三元阀阵 + 水塔网络）搬进插件，并加了一层「复刻」能力。

- 代码：`python/tesla/`（ternary / valve / towers / encoding / impact + MNIST 测试集与已训练阀态）
- 技能目录：`~/Documents/大肥鱼技能/<名字>/{state.npz, meta.json}`

### 工具 `tesla`

| action | 作用 |
|---|---|
| `simulate` | 跑一个样本，返回 24 维出口水位向量与判定 |
| `replicate` | **复刻**：给定目标数字，逐轮试阀——每条边试「开 / 关 / 换向」，只保留让目标 margin 变好的改动，记录每轮试开/试关多少条边，最后把阀态存成一项学会的功能 |
| `use` | 用某项学会的功能跑样本 |
| `skills` | 列出已学会的功能 |

复刻的思想：不重训整个网络，而是**从当前阀态出发做局部搜索**，像人一样
"这里该开、那里该关"一点点往前推，把能复现目标结果的那套阀态固化下来。

```text
GET /plugins/dsh-dafeiyu/tesla/skills   # 列出技能
```

## 程序复刻：只靠阀的位置参数装下多个程序（chat.24）

把「复刻」从"目标数字"推广成**任意程序**：

```text
一段程序 = 一组 (输入, 输出) 记录
复刻     = 调整阀的位置/方向，让网络对同样的输入产生同样的输出
产物     = 一份阀态参数（state.npz），就是一个"装进来的程序"
```

| 动作 | 说明 |
|---|---|
| `tesla action=program-record name=S samples=[0,1,2,3] [source=baseline]` | 记录输入和结果（source 可以是 baseline / 某个技能 / random / zero） |
| `tesla action=program-fit name=S rounds=10 [source=random]` | 从 source 出发逐轮试阀，最小化与记录输出的 MSE，记录每轮试开/试关条数 |
| `tesla action=program-run name=S sample=2` | 跑样本，报告输出与记录值的 MSE |
| `tesla action=programs` | 列出复刻过的程序 |

存放：`~/Documents/大肥鱼技能/programs/<名字>/{examples.json, state.npz, meta.json}`。
每个程序只是一份 `int8` 阀态 + 样例，互不干扰——**同一张网络可以装很多个程序**，
切换程序就是切换阀态。

实测：从 `random` 阀态起步复刻 baseline 的 4 个样例，10 轮内
试开 256 条边、试关 243 条边，MSE 从 ~1e-3 降到 **1e-8**。

## 传入程序 + 数据 → 编译成阀态（chat.25）

`tesla action=program-compile` 可以接受一段**程序表达式**（`expr`，输入是 784 维向量 x、可用 x0 和批量 n），
自动生成数据、记录、拟合阀态，并在没见过的输入上测保真度：

```json
{"name":"整图均值扩散","output_dim":24,"expr":"np.repeat(x.mean(axis=1)[:,None],24,axis=1)*1e4"}
```

流程与 `program-record` + `program-fit` 相同，区别是**数据由程序自己生成**，不是从现有阀态录下来的。

实测与限制：

| 路线 | 结果 |
|---|---|
| 从现有阀态**录制** I/O 再拟合（程序已在网络输出分布内） | MSE ~1e-8，几乎完全复现 |
| 用表达式**新造**一个映射再拟合（12 轮随机试阀） | MSE 从 1.1e-3 降到 8.9e-4，**保真度仍然很低** |

原因很直接：5 万条边里随机挑 130 条试，信号太弱。要收敛需要更强搜索——
按流量/灵敏度挑边（`impact.py` 已经能算每条边的累计流量），而不是随机挑。

## 规模可调：更大的程序用更大的网络（chat.26）

阀网规模不再写死 64×24，`replicate` / `program-compile` 都可以带规模参数：

```text
tesla action=replicate target=5 name=big5 hidden=256 out=48 rounds=5
```

| 规模 | 阀数（边） | 适用 |
|---|---|---|
| 64 隐藏 / 24 出口 | 51,712 | 数字分类、小映射 |
| 128 / 32 | ~104,000 | 中等映射 |
| 256 / 48 | ~213,000 | 更大的程序 |
| 512 / 64 | ~430,000 | 计算代价明显上升，建议后台跑 |

增长关系：`784×H + H×OUT`（H 是隐藏塔数）。计算量随 `H` 线性增长在输入侧、
`H×OUT` 在输出侧，25 步推进的总量大致和阀数同阶，所以规模翻倍、时间也大致翻倍。

规模存进 `state.npz` 的 `H/OUT`，`use` / `program-run` 会按文件里的尺寸还原。

## 两个独立能力（chat.27）

### 1) 失败自动重试（降噪批处理）

每个文件最多试 3 次，间隔 20 秒，并在两次之间确认挂载还在；
成功会清掉 `state.failed` 里对应的旧记录。脚本在 `~/Downloads/dfy/dfy-factory/scripts/denoise-batch.mjs`。

### 2) 按流量挑边（复刻搜索）

`--no-guided` 可以关掉；默认开启时，用 `impact.measure` 统计的累计流量给每条边算权重，
再按权重挑要试的边（每 4 轮刷新一次权重）。

**实测结论（如实说）**：在这两个任务上，按流量挑边**没有明显优于随机**——

| 任务 | 加权 | 随机 |
|---|---|---|
| compile（整图均值扩散，12 轮） | MSE 1.03e-3 | MSE 0.89e-3 |
| replicate（目标 5，6 轮） | margin -1.448 | margin -1.427 |

流量大的边改一下影响面太大，反而更噪声；真正该动的是"水流小但决定分支"的边，
这需要按梯度的思路，不是按流量。

## 声音复刻：给大肥鱼换音色（chat.28）

把水塔网络当**储层**用：阀态决定 24 个频段的能量分布，一个阀态 = 一个音色。

| 动作 | 说明 |
|---|---|
| `tesla action=voice-learn wav=/path/clip.wav name=某某` | 从一段声音里学 24 段频谱包络，存成音色（阀态 + 包络） |
| `tesla action=voice-speak skill=某某 text="..."` | 用该音色说话（TTS + 频响整形） |
| `tesla action=voices` | 列出学过的音色 |

存放：`~/Documents/大肥鱼声音/<名字>/{meta.json, state.npz}`
（`python/tesla/voice_cli.py`，依赖 ffmpeg 与 `/usr/bin/say`）

现状与下一步：

- v1 用**实测包络**做整形，音色已经是真的（可播放）；
- 阀态拟合 MSE 约 1.5，还没好到能"用阀态自己算出包络"，所以阀态目前只是记录；
- 下一步：把拟合做稳，让出口塔水位直接驱动合成，再接到大肥鱼的语音上。

## 大肥鱼用自己的音色说话（chat.29）

学来的音色可以直接接进她的语音链路：

1. `tesla action=voice-learn wav=/path/clip.wav name=lecture` 学音色；
2. 设置 → 大肥鱼 → **自定义音色** 填 `lecture`（留空 = 原声）；
3. 她再说任何话，链路变成 `say → 24 段包络整形 → afplay`；
4. 整形失败（缺 ffmpeg/python）自动回退原声，不会没声音。

已内置学会的音色：`tingting`（TTS 女声）、`lecture`（课程录音）。
设置里的「自定义音色」提示会列出当前已学会的音色名。

## 用某段人声的音色说话（chat.30）

`voice-learn` 从任意音频里取 24 段频谱包络（按 1 秒切片取中位数，抗伴奏/爆音），
学会后用匹配滤波把 TTS 的频谱拉向该包络：`增益 = 目标包络 − 源包络`，限幅 ±12 dB。

实测（黄龄《免我蹉跎苦》40–90 秒片段 → `huangling`）：

| 项 | 值 |
|---|---|
| 学习 | 成功，包络 24 段 |
| 输出与原包络相关性 | 0.37（有伴奏混入，包络被音乐拉平） |

**说明**：这是「音色包络」不是声音克隆——只调频谱，不复制发音习惯，
个人本机自用；要更像，需要**干净的人声素材**（无伴奏/清唱），相关性会明显提高。

## 语音链路修复（chat.31）

「设置里选了音色但没声音/还是原声」的三处原因，都已修：

1. `plugin.js` 里 `applyEnvelope` 用了 `findPython/findFfmpeg` 却没 import → 抛错后走回退，音色从未生效；
2. `findFfmpeg()` 在这台机器上找不到 ffmpeg → 现在按优先级找：环境变量 → App 自带 → imageio 自带；
3. `speech.js` 被 Node ESM 缓存，改名 `speech-v2.js` 强制重新加载。

排查端点（仅本机）：

- `GET /plugins/dsh-dafeiyu/debug/voice` — 当前 preset 原值与解析结果
- `GET /plugins/dsh-dafeiyu/debug/envelope` — 跑一次包络整形，返回 ok/错误
- `GET /plugins/dsh-dafeiyu/debug/speak` — 用当前音色说一句

## 音色下拉 + 试听（chat.32）

设置 → 大肥鱼 → 语音说话 → **自定义音色**：

- 下拉列出全部已学会音色（带 MSE），第一项是「原声（默认）」；
- 右侧 **试听** 按钮用当前选中的音色说一句示例（不改变已保存设置）；
- 接口：`POST /plugins/dsh-dafeiyu/voice/preview {voice}`。

## 人声占优挑帧（chat.33）

歌曲混音里伴奏会拉平包络，`voice-learn --vocal-focus` 会先按帧算
「300–3500 Hz 能量 ÷ 250 Hz 以下能量」，只保留人声占优的 60% 帧再取中位数。

实测（三段素材做人声聚焦后学音色，用同一句话合成后比较包络相关性）：

| 音色 | 素材 | 相关性 |
|---|---|---|
| lecture | 课程录音（纯人声） | **0.52** |
| huangling | 歌曲混音 | 0.06 |
| wuyi | 潮汕话翻唱（混音） | -0.22 |

结论：**纯人声素材效果明显好**；歌曲混音即使做帧筛选，也只够"染色"，谈不上音色还原。

## 四个"像宠物"的能力（chat.34–38）

### 1) 持续状态 `mood.json`

`~/.dsh/dsh-dafeiyu-mood.json`：饿 / 困 / 开心 / 想你，随时间自然漂移。

- 每 5 分钟 tick 一次；聊天、被夸、喂食、陪玩都会改变它；
- 三天没聊，心情变成「想你」，开心值也会回落；
- 面板里「她的状态」一行显示数值，并带 **夸夸她 / 喂点吃的 / 陪她玩** 三个按钮。

### 2) 自动记忆

聊天时用规则从你的话里抽事实（不调模型、不花 token），写进长期记忆：

| 你说 | 记住 |
|---|---|
| 我讨厌下雨，也喜欢蓝色 | 讨厌=下雨、喜欢=蓝色 |
| 我叫马三立 | 名字=马三立 |
| 我住在杭州 / 每天 11 点睡 | 住在=杭州 / 作息=11点睡 |

调试：`GET /plugins/dsh-dafeiyu/debug/memory-extract?text=…`

### 3) 主动行为

每 10 分钟检查一次：只有在「两天没聊 / 饿了 / 困了」时才冒泡，且两次之间至少隔 3 小时，
有任务在跑时不打扰——不再固定一天三问。

### 4) 一个身体

桌宠身体本来就在（待机动作、走动、心跳、打瞌睡…），这次没动它；
mood 已经能驱动它的状态气泡。

## 说话同时出气泡（chat.40）

新增 `pulse(text)`：**同一句话既进气泡、也进语音**。

- 心情按钮（夸夸她 / 喂点吃的 / 陪她玩）→ 气泡 + 语音；
- 主动行为（想你 / 饿了 / 困了）→ 气泡 + 语音，按状态挑不同的句子；
- 任务完成/出错的播报本来就有气泡。

气泡沿用 `PULSE` 消息（ttl 6 秒），如果同一时刻有任务状态气泡，会以最新一条为准。

## 独立说话气泡（chat.42）

新增消息类型 `say`（走 `/plugins/dsh-dafeiyu/events` 这条 SSE 通道），由插件自己的前端组件渲染，
**和任务状态气泡互不覆盖**：

- 位置：右下角、聊天按钮上方；
- ttl 9 秒，自动消失；
- 触发：心情按钮（夸/喂/玩）、主动行为（想你/饿/困）、以及任何走 `pulse()` 的句子；
- 同一句话同时进语音，所以"看到的"和"听到的"一致。

## 聊天面板升级（chat.43/44）

| # | 需求 | 实现 |
|---|---|---|
| 1 | 流式/推送 | `/chat/stream` SSE，Host 每 700ms 推一次状态（只在变化时推），面板用 EventSource，去掉 2.5s 轮询（保留 5s 兜底） |
| 2 | 发送即反馈 | 点发送立刻显示「她在想…」，气泡里先落用户消息；回来后自动消失 |
| 3 | 快捷 chips | 每条助手回复下三个按钮：展开说说 / 换个说法 / 接着说 |
| 4 | 忙碌可中断 | 发送键变红色「停止」，调用 `/chat/stop` → `sessionController.cancel` |
| 5 | 语音输入 + 朗读 | 🎤 用 Web Speech API（zh-CN）填进输入框；每条回复旁 🔊 用她的音色朗读（`/chat/speak`） |
| 6 | 可拖可拉可收 | 拖标题栏移动、右下角 ◢ 缩放、位置尺寸存 localStorage、— 收起 |
| 7 | 打开不空白 | 空会话时请求 `/chat/welcome`，用工作摘要/长期记忆主动开场 |

**关于"流式"的实话**：插件的会话事件里没有逐 token 的增量（只有 `assistant/message`），
所以做不到逐字吐；这里做的是**状态级推送**——助手消息一落库就立刻出现，
配上「她在想…」的即时反馈，观感接近流式。

## 生物反馈（chat.45）

除了心情，还多了一层"身体信号"：**心跳 / 呼吸 / 压力**，随互动实时变化，并且会反过来影响状态。

| 事件 | 心跳 | 压力 |
|---|---|---|
| 聊天 | +6 | −0.08 |
| 被夸 | +4 | −0.20 |
| 陪玩 | +10 | — |
| 任务出错 | +14 | +0.35 |
| 任务成功 | −8 | −0.15 |

- 每 5 分钟按"当下该有的水平"收敛（压力越高心跳越快、呼吸越急）；
- 压力随时间自然衰减（每小时 −0.05），不会一直紧绷；
- 设置页「她的状态」里显示 `心跳 78 · 呼吸 17 · 压力 24%`，旁边一颗**随心率跳动的小红点**
  （动画时长 = 60/心率 秒，心跳越快跳得越急）。

实测：聊天后 72→78，任务出错 92、压力 0.47，三小时后回落到 80 / 0.32。

## 面板配色修复（chat.46）

之前面板用 `var(--surface-color, #141824)` 做背景、文字 `inherit`——在浅色主题下会变成
深底 + 深字，看起来就是"黑屏"。

现在统一改用系统色：`Canvas` / `CanvasText`（跟随浅色/深色自动反色），
气泡、输入框、按钮、chips 的边框也换成 `rgba(127,127,127,.35)` 这种两边都清楚的中性色。

## 聊天面板改成"头顶气泡"（chat.47）

- 尺寸读取时做范围校正（320×320 起），异常值（比如被拖成一条）自动回默认；
- **双击标题栏**恢复默认位置和大小；
- 样式改成贴在宠物头顶的气泡：圆角 18、右下角一个尖角指向她，默认位置 `right:26 / bottom:182`。

## 接管宠物本体点击（chat.48）

在右下角她的活动区域盖了一层**透明热区**（`right:6 / bottom:0 / 340×330`）：

- 点她 = 打开/关闭头顶的对话气泡（`window.dispatchEvent('dfy-chat-toggle')`）；
- 热区层级低于聊天按钮和面板本身，所以 💬 按钮和面板内的点击不受影响；
- 不需要时可以把这个热区去掉（或改成只在面板关闭时生效）。

## 对话框贴到状态气泡下面（chat.49）

不再固定右下角：打开面板时用 TreeWalker 在 DOM 里找那块**含「余额」的状态气泡**
（按面积挑最小的匹配元素），读它的 `getBoundingClientRect()`，然后把对话面板
贴到它正下方、右边缘对齐：

- 每 1.5 秒重新测量一次，窗口缩放也会跟着动；
- 找不到状态气泡时，回退到之前保存的位置（`right:26 / bottom:182`）；
- 面板高度按剩余空间收敛，不会顶出屏幕。

## 聊天 + 播放器合成一个 dock（chat.50）

原来右下角漂着两个独立按钮（💬 聊天、▶ 播放器）。现在：

- 合成一个圆角 dock：`💬 | ▶`，贴在宠物旁边；
- 点 ▶ 派发 `window.dispatchEvent('dfy-open-player')`，由 `dsh-player` 插件接收并打开全屏播放器；
- `dsh-player` 自己的浮动按钮已移除，它只保留接收事件后的播放器页面；
- 面板打开时 dock 收起，关闭面板后 dock 回来。

## 合成一张"贴纸卡"（chat.51）

宠物区域外面包了一层圆角卡片（322×344，半透明灰底 + 细边框 + 阴影），
聊天按钮和播放器按钮就嵌在卡片的**底边内侧**；打开对话时面板从卡片**上方**长出来。

- 卡片本身 `pointer-events: none`，只有按钮可点，不影响宠物本体和 DSH 界面；
- 视觉上：宠物 + 按钮 + 对话 = 一块卡片，而不是三个漂着的零件；
- 宠物本体仍是 DSH 内建图层，我们只能给它"垫底 + 挂控件"，无法真正塞进它的渲染树。

## 原生本体（chat.52/53）

`runtime/bin/darwin/dsh-dafeiyu-helper.app` 原来是一个编译好的原生二进制，无法直接改。
现在换成了我们自己写的 Swift 版本：`native/DFYPet.swift`。

一个进程里同时包含：

- 宠物帧动画（读 `assets/pet-manifest.json`，21 个 clip，WebP 直接加载）；
- 气泡（`pulse` 消息里的文字，右上角圆角气泡，ttl 到期消失）；
- 对话面板（点她弹出/收起，贴在宠物上方，含输入框、发送、停止、▶ 播放器）；
- 拖拽移动（拖动<4px 视为点击，切换对话面板）。

协议沿用原来的 stdin JSON（每行一条）：`state` / `pulse` / `config` / `ping` / `shutdown`，
启动时回 `{"kind":"ready"}`。

回滚：原版二进制备份在 `/tmp/original-helper.bin`，复制回
`runtime/bin/darwin/dsh-dafeiyu-helper.app/Contents/MacOS/dsh-dafeiyu-helper` 即可。

## 原生面板：状态 / 余额 / 任务（chat.54）

对话面板重做：

- 深色半透明卡片（`NSVisualEffectView` + `darkAqua`），圆角 18、细边框；
- 顶部一行标题 + **状态**（干活中/思考中…）；
- 右上两行：**余额 ¥xx** 与 **任务 n**（来自 host 的 `balance` / `tasks` 消息）；
- 消息按角色着色（我=蓝、大肥鱼=绿），带段间距，自动滚到底；
- 底部：输入框 + 发送 / 停止 / ▶ 播放器。

## 修复：只启动一只 + 面板深色（chat.55）

- **单实例**：启动时按 bundle id 检查 `NSRunningApplication`，已有实例就直接退出——
  不会再出现两只宠物；
- **面板底色**：不再依赖 `NSVisualEffectView`（它会跟随系统变成浅色，白字看不见），
  改成纯色深底 `rgba(26,28,33,0.97)`，白字对比稳定；
- 面板定位限制在屏幕可见区域内，上方放不下就自动落到宠物下方。

## 面板：可输入 / 小窗 / 历史（chat.57）

- **能打字**：`ChatWindow` 重写了 `canBecomeKey`，弹出时会 `makeKey()` 并让输入框成为第一响应者；
- **不用时是小窗**：默认收起成 220×46 的小条，只显示「余额 ¥x · 任务 n」；
  点一下小条 → 展开成 360×400 的对话窗口（消息 + 输入框），再点标题区可收起；
- **历史**：展开时从 `/chat/state` 拉最近 80 条消息，随会话持续累积（跨会话上下文本来就在 host 侧）；
- 面板配色白底黑字（chat.56）。

## 复刻状态卡 + 双击开大窗（chat.61）

原生本体现在会像原来那样，在宠物上方画一张状态卡：

```
大肥鱼陪你待命            任务 2
DSH · 等待下一次任务   账户 余额 ¥8.96
```

- 标题随状态变化（干活中 / 思考中 / 等你呢 / 完成啦 / 出问题了）；
- 右侧两行来自 host 推送的 `tasks` 与 `balance`（余额保留两位小数）；
- **双击宠物** → 打开 360×400 的大对话框（输入框自动聚焦）；
- 单击拖动移动宠物；对话窗可点标题收起。

## B 站能力（chat.64）

新增工具 `bilibili`：

| action | 作用 |
|---|---|
| `info` | 查一条视频：标题、UP、时长、播放、点赞（链接或 BV 号） |
| `hot` | 音乐区热门 TOP10（走公开排行接口，带首页 cookie 防 -352） |
| `download` | 下载一条视频到 `~/Downloads/大肥鱼视频`（封装 `dfy-factory/scripts/bili-dl.mjs` + yt-dlp，可 `audioOnly`） |

边界：只用于下载你有权保存的内容（自己的投稿、已授权素材），不做事站级批量抓取、不绕过风控。
