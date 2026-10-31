import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Schema from '@deepseek-ai/schemastery'
import { CompanionReducer } from './companion-reducer.js'
import { HelperProcess } from './helper-process.js'
import { createSettingsScope } from './settings-scope.js'
import { createChatHandlers, createChatService } from './chat.js'
import { createGreeter } from './greeter.js'
import { createSpeaker } from './speech-v2.js'
import { createWakeService } from './voice.js'
import { createCloneVoice } from './voice-tts.js'
import { apply as registerDenoiseTool, createDenoiseTool, findPython, findFfmpeg } from './denoise.js'
import { createDenoiseJobs } from './denoise-jobs.js'
import { createPowerKeeper } from './power.js'
import { createMemoryStore, registerMemoryTool } from './memory.js'
import { createMoodStore } from './mood.js'
import { rememberFacts, extractFacts } from './memory-auto.js'
import { registerTeslaTool, listSkills, TESLA_CLI, VOICE_CLI, VOICES_DIR } from './tesla.js'
import { registerBilibiliTool } from './bilibili.js'
import { createRoutineStore, registerRoutineTool } from './routine.js'
import { createEnglishStore, registerEnglishTool } from './english.js'
import { createEvolutionStore, registerEvolutionTool } from './evolution.js'
import { createNotifier, registerNotifyTool } from './notify.js'
import { createPolicy, registerRlTool } from './rl.js'
import { createDirector, registerDirectorTool, ORDERS } from './director.js'
import { createSelfTool, registerSelfTool } from './selftool.js'
import { createPermMemory, registerPermMemoryTool } from './perm-memory.js'
import { createSkillStore, registerSkillTool } from './skills.js'
import { createGoldbachMemory, registerGoldbachTool } from './goldbach-memory.js'
import { createMus, registerMusTool } from './mus.js'
import { createMeta, registerMetaTool } from './meta.js'
import { createCrtMemory, registerCrtTool } from './crt-memory.js'
import { createTheory, registerTheoryTool } from './theory.js'
import { createChainStore, registerChainTool } from './chains.js'
import { createDrive, registerDriveTool } from './drive.js'
import { createPerception, registerPerceptionTool } from './perception.js'
import { createDistributed, registerDistTool } from './distributed.js'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { existsSync as fileExists, readFileSync as readFileSyncImpl, readdirSync as readdirSyncImpl } from 'node:fs'
import { join as joinPath } from 'node:path'
import { DEFAULT_NOVEL_ROOT, createNovelService, registerNovelTool } from './novel.js'
import { resolveClientTarget } from './client-target.js'
import { isLocalRequest, jsonResponse } from './local-http.js'
import { BALANCE_ENDPOINT, createBalanceQuery, createBalanceMonitor, createBalanceHandler, balanceProviderNamespace } from './balance.js'
import {
  CompanionMessageKind,
  CompanionState,
  createMessage,
} from './protocol.js'

const require = createRequire(import.meta.url)
const pkg = require('../package.json')

export const name = 'dsh-dafeiyu'
// The plugin's feature is built on session events, and mounting requires the
// settings service (used to read live config). Keep the declared inject in
// sync with those real hard dependencies instead of listing a service that
// is never consumed directly.
export const inject = ['sessions', 'settings']
export const CONFIG_ENDPOINT = '/plugins/dsh-dafeiyu/config'
export const EVENTS_ENDPOINT = '/plugins/dsh-dafeiyu/events'
export const MANIFEST_ENDPOINT = '/plugins/dsh-dafeiyu/manifest'
export const FRAME_ENDPOINT = '/plugins/dsh-dafeiyu/frame'
export const CHAT_STATE_ENDPOINT = '/plugins/dsh-dafeiyu/chat/state'
export const CHAT_SEND_ENDPOINT = '/plugins/dsh-dafeiyu/chat/send'
export const CHAT_TARGET_ENDPOINT = '/plugins/dsh-dafeiyu/chat/target'
export { BALANCE_ENDPOINT }

const here = dirname(fileURLToPath(import.meta.url))
const assetsRoot = resolve(here, '..', 'assets')
// DSH 0.2 把配置字段作为实时引用传进来；字符串字段要先解包再比较。
function asString(value, fallback = '') {
  let raw = value
  if (raw && typeof raw === 'object' && typeof raw.get === 'function') raw = raw.get()
  if (raw && typeof raw === 'object' && 'value' in raw) raw = raw.value
  return typeof raw === 'string' && raw.trim() ? raw.trim() : fallback
}

export const Config = Schema.object({
  enabled: Schema.boolean().default(true).description('启用桌面大肥鱼'),
  scale: Schema.number().min(0.55).max(1.4).step(0.05).default(1).role('slider').description('角色大小'),
  bubbleScale: Schema.number().min(0.8).max(1.2).step(0.05).default(1).role('slider').description('气泡大小'),
  activityLevel: Schema.union([
    Schema.const('quiet').description('安静'),
    Schema.const('normal').description('标准'),
    Schema.const('lively').description('活泼'),
  ]).default('normal').description('空闲微动作频率'),
  reducedMotion: Schema.boolean().default(false).description('减少走动、循环帧和程序化晃动'),
  soundEnabled: Schema.boolean().default(true).description('任务完成或出错时播放提示音'),
  bubbleMode: Schema.union([
    Schema.const('always').description('常驻显示'),
    Schema.const('hidden').description('完全隐藏'),
    Schema.const('custom').description('自定义显示状态'),
  ]).default('always').description('气泡显示模式'),
  bubbleStates: Schema.array(Schema.string()).default(['SUCCESS', 'ERROR', 'WAITING']).description('自定义模式下显示气泡的状态'),
  includeSubagents: Schema.boolean().default(false).description('允许子 Agent 抢占宠物状态'),
  webOverlay: Schema.boolean().default(false).description('在 DSH 页面右下角显示轻量桌宠（可与桌面窗口同时开启）'),
  clientTarget: Schema.union(['auto', 'web', 'desktop']).default('auto').description('打开 DSH 的目标客户端（自动识别 WebUI／桌面端）'),
  balanceEnabled: Schema.boolean().default(true).description('在状态气泡和设置页显示 DeepSeek 余额'),
  balanceSource: Schema.union(['auto', 'api-key', 'account']).default('auto').description('余额来源：自动优先 API Key，也可选择已登录账户'),
  voiceEnabled: Schema.boolean().default(true).description('任务播报和打招呼时用系统语音说话（本机 TTS，不走网络）'),
  voiceAnnouncements: Schema.boolean().default(true).description('任务完成或出错时用语音播报一句'),
  voiceName: Schema.string().default('Tingting').description('语音音色（macOS 系统语音名，如 Tingting、Eddy、Flo）'),
  chatIdleSeconds: Schema.number().min(5).max(600).step(5).default(15).description('对话面板多久没操作自动收起（秒）'),
  explorationRate: Schema.number().min(0.05).max(0.9).step(0.05).default(0.35).description('RL 随机探索比例（越高越爱试新选择，保底 0.15）'),
  voiceShaping: Schema.boolean().default(false).description('是否用音色包络给 TTS 染色（关闭=自然发音，更顺）'),
  voicePreset: Schema.string().default('').description('学来的自定义音色（留空 = 原声）。在「声音复刻」里学会后填音色名'),
  voiceRate: Schema.number().min(100).max(320).step(10).default(170).description('语速（每分钟词数）'),
  voiceVolume: Schema.number().min(0.05).max(1).step(0.05).default(0.9).description('语音音量'),
  wakeEnabled: Schema.boolean().default(false).description('语音唤醒：常驻听麦克风，喊唤醒词就叫醒她（本机识别，不上传录音）'),
  wakeKeyword: Schema.string().default('大肥鱼').description('唤醒词（默认「大肥鱼」，多个用逗号分隔）'),
  wakeReply: Schema.string().default('在呢，我在听').description('被叫醒时说的第一句话'),
  ttsEngine: Schema.union([
    Schema.const('say').description('系统语音（快，音色一般）'),
    Schema.const('clone').description('克隆音色（本机 GPT-SoVITS，慢一点但像原声）'),
  ]).default('clone').description('用哪种方式说话'),
  ttsRefAudio: Schema.string().default('').description('克隆音色的参考音频（留空 = ~/Documents/大肥鱼声音/ref/teacher.wav）'),
  ttsPromptText: Schema.string().default('').description('参考音频对应的文本（留空 = 同目录的 teacher.txt）'),
  greetingEnabled: Schema.boolean().default(true).description('长时间没人理时主动打招呼'),
  greetingAfterMinutes: Schema.number().min(1).max(240).step(1).default(12).description('空闲多少分钟后打招呼'),
  greetingRepeatMinutes: Schema.number().min(5).max(240).step(5).default(25).description('两次打招呼的最小间隔'),
  preventSleep: Schema.boolean().default(true).description('DSH 有任务在跑时阻止电脑空闲休眠（macOS caffeinate）'),
  preventSleepDisplay: Schema.boolean().default(false).description('连屏幕也保持常亮（默认只防系统休眠）'),
  novelRoot: Schema.string().default('').description('小说项目根目录（留空 = ~/Documents/大肥鱼小说）'),
  directorEnabled: Schema.boolean().default(true).description('开启三层调度：上层定时挑一条指令交给 DSH 执行并评估'),
  directorIntervalMinutes: Schema.number().min(5).max(720).step(5).default(45).description('两次自动调度之间的间隔（分钟）'),
  notifyWebhooks: Schema.array(Schema.object({
    name: Schema.string().default('wecom'),
    kind: Schema.union([
      Schema.const('wecom'), Schema.const('feishu'), Schema.const('dingtalk'), Schema.const('slack'),
      Schema.const('serverchan'), Schema.const('pushplus'), Schema.const('bark'), Schema.const('custom'),
    ]).default('wecom'),
    url: Schema.string().default('').description('webhook 或推送地址'),
    token: Schema.string().default('').description('PushPlus 的 token（其他类型可留空）'),
  })).default([]).description('消息推送 webhook：企业微信/飞书/钉钉/Slack 群机器人地址'),
  perceptionEnabled: Schema.boolean().default(true).description('主动感知：前台应用/剪贴板状态（只读元信息）'),
  perceptionIntervalSec: Schema.number().min(5).max(600).step(5).default(30).description('感知采样间隔（秒）'),
  denoiseWatchEnabled: Schema.boolean().default(true).description('盯着 NAS 降噪批处理，把进度显示到状态卡上'),
  denoiseWatchDir: Schema.string().default('/Volumes/15226550291/课程').description('降噪批处理所在目录'),
  musicOnDone: Schema.boolean().default(true).description('降噪批处理全部完成后自动放一首音乐'),
  musicPlaylist: Schema.string().default('~/Music/大肥鱼歌单').description('完成任务后播放的音乐目录'),
  memoryEnabled: Schema.boolean().default(true).description('跨会话长期记忆（偏好、常用路径等）'),
  contextInjection: Schema.boolean().default(true).description('聊天时自动附带工作会话摘要和长期记忆作为上下文'),
  chatMode: Schema.union([
    Schema.const('dedicated').description('宠物专属会话（累积上下文）'),
    Schema.const('current').description('跟随当前会话'),
  ]).default('dedicated').description('页内聊天发到哪里：专属会话会一直记住之前的对话'),
}).description('由 DeepSeek Harness 状态驱动的桌面大肥鱼伴侣')

// Mark fields, rather than the root object: current DSH passes each volatile
// field as a live reference, while the config object remains an object.
for (const [key, field] of Object.entries(Config.dict)) Config.dict[key] = field.volatile()

const defaults = Object.freeze({
  directorEnabled: true,
  directorIntervalMinutes: 45,
  perceptionEnabled: true,
  perceptionIntervalSec: 30,
  enabled: true,
  scale: 1,
  bubbleScale: 1,
  activityLevel: 'normal',
  reducedMotion: false,
  soundEnabled: true,
  bubbleMode: 'always',
  bubbleStates: ['SUCCESS', 'ERROR', 'WAITING'],
  includeSubagents: false,
  webOverlay: false,
  clientTarget: 'auto',
  balanceEnabled: true,
  balanceSource: 'auto',
  voiceEnabled: true,
  voiceAnnouncements: true,
  voiceName: 'Tingting',
  chatIdleSeconds: 15,
  explorationRate: 0.35,
  voiceShaping: false,
  voicePreset: '',
  voiceRate: 170,
  voiceVolume: 0.9,
  wakeEnabled: false,
  wakeKeyword: '大肥鱼',
  wakeReply: '在呢，我在听',
  ttsEngine: 'clone',
  ttsRefAudio: '',
  ttsPromptText: '',
  greetingEnabled: true,
  greetingAfterMinutes: 12,
  greetingRepeatMinutes: 25,
  preventSleep: true,
  preventSleepDisplay: false,
  novelRoot: '',
  chatMode: 'dedicated',
  memoryEnabled: true,
  denoiseWatchEnabled: true,
  denoiseWatchDir: '/Volumes/15226550291/课程',
  musicOnDone: true,
  musicPlaylist: '~/Music/大肥鱼歌单',
  contextInjection: true,
})

function publicConfig(config = {}) {
  return {
    enabled: config.enabled ?? defaults.enabled,
    scale: config.scale ?? defaults.scale,
    bubbleScale: config.bubbleScale ?? defaults.bubbleScale,
    activityLevel: config.activityLevel ?? defaults.activityLevel,
    reducedMotion: config.reducedMotion ?? defaults.reducedMotion,
    soundEnabled: config.soundEnabled ?? defaults.soundEnabled,
    bubbleMode: config.bubbleMode ?? defaults.bubbleMode,
    bubbleStates: Array.isArray(config.bubbleStates) ? config.bubbleStates : defaults.bubbleStates,
    includeSubagents: config.includeSubagents ?? defaults.includeSubagents,
    webOverlay: config.webOverlay === true,
    clientTarget: config.clientTarget ?? defaults.clientTarget,
    balanceEnabled: config.balanceEnabled !== false,
    balanceSource: config.balanceSource ?? defaults.balanceSource,
    voiceEnabled: config.voiceEnabled !== false,
    voiceAnnouncements: config.voiceAnnouncements !== false,
    voiceName: config.voiceName ?? defaults.voiceName,
    chatIdleSeconds: Number.isFinite(config.chatIdleSeconds) ? config.chatIdleSeconds : defaults.chatIdleSeconds,
    explorationRate: Number.isFinite(config.explorationRate) ? config.explorationRate : defaults.explorationRate,
    voiceShaping: config.voiceShaping === true,
    voicePreset: asString(config.voicePreset, ''),
    voiceRate: Number.isFinite(config.voiceRate) ? config.voiceRate : defaults.voiceRate,
    voiceVolume: Number.isFinite(config.voiceVolume) ? config.voiceVolume : defaults.voiceVolume,
    wakeEnabled: config.wakeEnabled === true,
    wakeKeyword: asString(config.wakeKeyword, defaults.wakeKeyword),
    wakeReply: asString(config.wakeReply, defaults.wakeReply),
    ttsEngine: config.ttsEngine === 'say' ? 'say' : 'clone',
    ttsRefAudio: asString(config.ttsRefAudio, ''),
    ttsPromptText: asString(config.ttsPromptText, ''),
    greetingEnabled: config.greetingEnabled !== false,
    greetingAfterMinutes: Number.isFinite(config.greetingAfterMinutes) ? config.greetingAfterMinutes : defaults.greetingAfterMinutes,
    greetingRepeatMinutes: Number.isFinite(config.greetingRepeatMinutes) ? config.greetingRepeatMinutes : defaults.greetingRepeatMinutes,
    preventSleep: config.preventSleep !== false,
    preventSleepDisplay: config.preventSleepDisplay === true,
    novelRoot: asString(config.novelRoot, ''),
    chatMode: config.chatMode === 'current' ? 'current' : 'dedicated',
    memoryEnabled: config.memoryEnabled !== false,
    directorEnabled: config.directorEnabled !== false,
    directorIntervalMinutes: Number.isFinite(config.directorIntervalMinutes) ? config.directorIntervalMinutes : defaults.directorIntervalMinutes,
    denoiseWatchEnabled: config.denoiseWatchEnabled !== false,
    denoiseWatchDir: asString(config.denoiseWatchDir, defaults.denoiseWatchDir),
    musicOnDone: config.musicOnDone !== false,
    musicPlaylist: asString(config.musicPlaylist, defaults.musicPlaylist),
    contextInjection: config.contextInjection !== false,
  }
}

async function readPatch(req) {
  const chunks = []
  let bytes = 0
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > 8192) throw new Error('request body is too large')
    chunks.push(chunk)
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('patch must be an object')
  const allowed = new Set(Object.keys(defaults))
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error('patch contains an unknown setting')
  return value
}

export function createConfigHandler(settings) {
  return async (req, res) => {
    if (!isLocalRequest(req)) {
      jsonResponse(res, 403, { error: 'local access only' })
      return
    }
    if (req.method === 'GET') {
      jsonResponse(res, 200, settings.get())
      return
    }
    if (req.method !== 'PATCH') {
      jsonResponse(res, 405, { error: 'method not allowed' })
      return
    }
    if (typeof settings.update !== 'function') {
      jsonResponse(res, 503, { error: 'settings are read-only; restart DSH or use a supported host version' })
      return
    }
    try {
      await settings.update(await readPatch(req))
      jsonResponse(res, 200, settings.get())
    } catch (error) {
      jsonResponse(res, 400, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}

// Server-sent events channel mirroring the companion protocol for in-page
// consumers (the future web overlay). Snapshot kinds are remembered so a client
// that connects late still renders the current state immediately.
export function createEventStream() {
  const clients = new Set()
  const snapshot = new Map()
  return {
    get clientCount() {
      return clients.size
    },
    broadcast(message) {
      if (message?.kind === 'hello' || message?.kind === 'state' || message?.kind === 'task'
        || message?.kind === 'tasks' || message?.kind === 'config' || message?.kind === 'balance') {
        snapshot.set(message.kind, message)
      }
      const payload = `data: ${JSON.stringify(message)}\n\n`
      for (const res of clients) {
        try {
          res.write(payload)
        } catch {
          clients.delete(res)
        }
      }
    },
    add(res) {
      clients.add(res)
      for (const message of snapshot.values()) {
        res.write(`data: ${JSON.stringify(message)}\n\n`)
      }
      return () => clients.delete(res)
    },
  }
}

export function createEventsHandler(stream) {
  return (req, res) => {
    if (!isLocalRequest(req)) {
      jsonResponse(res, 403, { error: 'local access only' })
      return
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    })
    res.write('retry: 2000\n\n')
    const remove = stream.add(res)
    req.on('close', remove)
  }
}

// Frame bytes are served only for paths the manifest declares, so the query
// parameter can never steer the reader outside assets/pet. Returns null when
// the manifest cannot be read; the overlay routes then stay unregistered.
export function createAssetRoutes() {
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(assetsRoot, 'pet-manifest.json'), 'utf8'))
  } catch {
    return null
  }
  const frames = new Set()
  for (const clip of Object.values(manifest.clips ?? {})) {
    for (const frame of clip.frames ?? []) frames.add(frame)
  }
  return {
    manifestHandler(req, res) {
      if (!isLocalRequest(req)) {
        jsonResponse(res, 403, { error: 'local access only' })
        return
      }
      jsonResponse(res, 200, manifest)
    },
    frameHandler(req, res) {
      if (!isLocalRequest(req)) {
        jsonResponse(res, 403, { error: 'local access only' })
        return
      }
      let frame
      try {
        frame = new URL(req.url ?? '', 'http://dsh.local').searchParams.get('frame')
      } catch {
        frame = null
      }
      if (!frame || !frames.has(frame)) {
        jsonResponse(res, 404, { error: 'unknown frame' })
        return
      }
      let bytes
      try {
        bytes = readFileSync(join(assetsRoot, 'pet', frame))
      } catch {
        jsonResponse(res, 404, { error: 'frame unavailable' })
        return
      }
      res.writeHead(200, {
        'content-type': 'image/webp',
        'cache-control': 'public, max-age=86400',
        'content-length': bytes.length,
      })
      res.end(bytes)
    },
  }
}

function mount(ctx, config = {}, eventCtx = ctx) {
  const logger = ctx.logger ?? console
  try {
    mountCompanion(ctx, config, eventCtx, logger)
  } catch (error) {
    // DSH treats a failing plugin activation as fatal for the whole boot
    // (dsh-app-boot rethrows init rejections). A host-side API change must
    // cost the pet its session, never the host its startup.
    logger.error?.(`dsh-dafeiyu failed to activate and stays disabled for this session: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function mountCompanion(ctx, config = {}, eventCtx = ctx, logger) {
  const eventStream = createEventStream()
  // 只把"纯配置"交给 settings 作用域：运行时服务对象里有 .get 之类的方法，
  // 会被 plainConfig 误当成 settings 解包（曾导致整个 App 启动失败）。
  const SERVICE_KEYS = [
    'memoryStore', 'policy', 'orderPolicy', 'director', 'meta', 'selfTool', 'permMemory', 'skills',
    'goldbach', 'mus', 'crt', 'perception', 'dist', 'routine', 'english', 'evolution', 'emote', 'onUserMessage',
  ]
  const plainInput = { ...config }
  for (const key of SERVICE_KEYS) delete plainInput[key]
  const settings = createSettingsScope(ctx, Config, plainInput, publicConfig)
  const mood = createMoodStore({ logger })
  const initialMood = mood.snapshot()
  if (!initialMood.met) { try { mood.poke('seen') } catch {} }
  mood.tick()
  const moodTimer = setInterval(() => { try { mood.tick() } catch {} }, 5 * 60 * 1000)
  if (typeof moodTimer.unref === 'function') moodTimer.unref()
  const PRAISE = /(可爱|好乖|真棒|厉害|喜欢你|好看|漂亮|聪明|谢谢大肥鱼|辛苦了)/
  const FEED = /(吃饭|喂你|给你吃|零食|喝点)/
  const chat = createChatService({ ctx, logger, config: () => settings.get(), memory: config.memoryStore, mood, emote: config.emote, policy: config.policy, perception: config.perception, onUserMessage: config.onUserMessage,
    onPlan: (plan) => { try { config.chains?.add?.('think', { text: `打算回答「${plan.user}」：风格 ${plan.styleHint}`, relation: 'hypothesis' }) } catch {} },
    reasonHistory: (message) => {
      try {
        if (!/任务|进度|调度|降噪|检查|状态/.test(message)) return ''
        const last = (config.chains?.list?.('reason', 3) ?? [])
        if (!last.length) return ''
        const lines = config.chains?.replay?.(last[0].id)?.slice(0, 6) ?? []
        return lines.join('\n')
      } catch { return '' }
    } })
  const chatHandlers = createChatHandlers(chat, logger)
  const ffmpegCandidates = () => [
    process.env.DF_FACTORY_FFMPEG,
    joinPath(homedir(), 'Applications/大肥鱼播放器.app/Contents/Resources/bin/ffmpeg'),
    joinPath(homedir(), '.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/lib/python3.12/site-packages/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1'),
  ].filter(Boolean)

  const applyEnvelope = async (preset, input, output) => {
    const python = (await findPython({ logger })).bin
    let ffmpeg = ffmpegCandidates().find((path) => fileExists(path))
    if (!ffmpeg) {
      try { ffmpeg = await findFfmpeg(python, {}) } catch { ffmpeg = 'ffmpeg' }
    }
    await new Promise((resolve, reject) => {
      const child = spawn(python, [VOICE_CLI, 'apply', '--voice', preset, '--in', input, '--out', output], {
        stdio: ['ignore', 'ignore', 'pipe'],
        env: { ...process.env, DF_FACTORY_FFMPEG: ffmpeg },
      })
      let stderr = ''
      child.stderr?.on('data', (chunk) => { stderr = (stderr + chunk).slice(-600) })
      child.once('error', reject)
      child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(stderr || `退出码 ${code}`))))
    })
  }

  const speaker = createSpeaker({ logger, applyEnvelope })

  // 克隆音色：参考音频 + 对应文本，默认用整理好的那位老师的一段 6 秒。
  const refDir = joinPath(homedir(), 'Documents', '大肥鱼声音', 'ref')
  const readTextFile = (path) => { try { return readFileSyncImpl(path, 'utf8').trim() } catch { return '' } }
  const cloneVoice = createCloneVoice({
    logger,
    refAudio: asString(settings.get()?.ttsRefAudio, '') || joinPath(refDir, 'teacher.wav'),
    promptText: asString(settings.get()?.ttsPromptText, '') || readTextFile(joinPath(refDir, 'teacher.txt')),
  })
  // 统一出口：按设置决定用系统语音还是克隆音色，克隆失败自动回落。
  // 克隆音色目前只会说英文（训练语料只有英文人声），中文句子直接走系统语音，
  // 免得被当成英文单词念成乱码。
  const CJK_TEXT = /[\u4e00-\u9fff]/
  const speakText = (text, options = {}) => {
    const live = settings.get()
    if (live.voiceEnabled === false) return false
    if (live.ttsEngine === 'clone' && !CJK_TEXT.test(String(text ?? ''))) {
      cloneVoice.speak(text, { speed: Number(live.voiceRate ?? 170) / 170 })
        .then((ok) => { if (!ok) speaker.speak(text, options) })
        .catch(() => { try { speaker.speak(text, options) } catch {} })
      return true
    }
    return speaker.speak(text, options)
  }
  // 用克隆音色时提前把服务拉起来，第一句话就不必等模型加载
  if (settings.get()?.ttsEngine !== 'say' && settings.get()?.voiceEnabled !== false) {
    setTimeout(() => { cloneVoice.start().catch(() => {}) }, 3000).unref?.()
  }
  const syncCloneVoice = () => {
    const live = settings.get()
    cloneVoice.configure?.({
      refAudio: asString(live.ttsRefAudio, '') || joinPath(refDir, 'teacher.wav'),
      promptText: asString(live.ttsPromptText, '') || readTextFile(joinPath(refDir, 'teacher.txt')),
    })
  }
  let powerHeld = false
  const power = createPowerKeeper({
    logger,
    extraArgs: () => (settings.get().preventSleepDisplay === true ? ['-i', '-m', '-d'] : ['-i', '-m']),
  })
  let denoiseBusy = 0
  const syncPower = () => {
    let want = false
    try {
      want = (activeTurns > 0 || denoiseBusy > 0) && settings.get().preventSleep !== false
    } catch {
      want = false
    }
    if (want && !powerHeld) {
      power.acquire()
      powerHeld = true
    } else if (!want && powerHeld) {
      power.release()
      powerHeld = false
    }
  }
  const novel = createNovelService({ root: config.novelRootResolved ?? DEFAULT_NOVEL_ROOT, logger })
  const denoiseJobs = createDenoiseJobs({
    tool: createDenoiseTool({ logger }),
    logger,
    onJobStart: () => { denoiseBusy += 1; syncPower() },
    onJobEnd: () => { denoiseBusy = Math.max(0, denoiseBusy - 1); syncPower() },
  })
  // 盯着 NAS 上的降噪批处理：进度进状态卡，全部完成时放一首歌。
  let watchTimer
  function startDenoiseWatch() {
    const current = () => settings.get()
    if (current().denoiseWatchEnabled === false) return
    let lastRemaining = null
    let lastDone = 0
    let sawWork = false
    const poll = () => {
      try {
        const cfg = current()
        if (cfg.denoiseWatchEnabled === false) return
        const dir = String(cfg.denoiseWatchDir ?? '').replace(/^~(?=$\/)/, homedir())
        if (!dir || !fileExists(dir)) return
        let state = { done: {}, skipped: {} }
        try { state = JSON.parse(readFileSyncImpl(joinPath(dir, '_denoise-state.json'), 'utf8')) } catch { return }
        const done = state.done ?? {}
        const skipped = state.skipped ?? {}
        let remaining = 0
        for (const name of readdirSyncImpl(dir)) {
          if (name.startsWith('.') || '.denoise-tmp' in name) continue
          if (!/\.(mp4|mkv|mov|avi|wmv|flv|ts|webm)$/i.test(name)) continue
          if (done[name] || skipped[name]) continue
          remaining += 1
        }
        const total = Object.keys(done).length + Object.keys(skipped).length + remaining
        if (remaining !== lastRemaining || !watchTimer._sent) {
          lastRemaining = remaining
          lastDone = Object.keys(done).length
          watchTimer._sent = true
          try {
            bridge?.send(createMessage(CompanionMessageKind.TASKS, {
              tasks: remaining > 0 ? [{ title: '降噪批处理', state: 'WORKING' }] : [],
            }))
            bridge?.send(createMessage(CompanionMessageKind.TASK, {
              state: remaining > 0 ? 'WORKING' : 'IDLE',
              activity: remaining > 0 ? `降噪 ${total - remaining}/${total}` : '',
            }))
          } catch {}
        }
        if (remaining > 0) sawWork = true
        if (remaining === 0 && sawWork && !watchTimer._celebrated) {
          watchTimer._celebrated = true
          celebrate()
        }
      } catch {}
    }
    watchTimer = setInterval(poll, 60 * 1000)
    watchTimer.unref?.()
    watchTimer._celebrated = false
    poll()
  }

  function celebrate() {
    try {
      const cfg = settings.get()
      if (cfg.musicOnDone === false) return
      const dir = String(cfg.musicPlaylist ?? '').replace(/^~(?=$\/)/, homedir())
      if (!dir || !fileExists(dir)) return
      const tracks = readdirSyncImpl(dir).filter((name) => /\.(mp4|m4a|mp3|wav|aac|flac)$/i.test(name))
      if (tracks.length === 0) return
      const track = joinPath(dir, tracks[Math.floor(Math.random() * tracks.length)])
      const child = spawn('/usr/bin/afplay', ['-v', '0.5', track], { stdio: 'ignore', detached: true })
      child.unref()
      logger.info?.(`dsh-dafeiyu: 降噪全部完成，播放 ${track}`)
      pulse('降噪全部完成啦，放首歌庆祝一下～')
      noteLife('降噪', '把一整批视频的降噪跑完了')
    } catch (error) {
      logger.warn?.(`dsh-dafeiyu 庆祝失败: ${error?.message ?? error}`)
    }
  }

  try { if (!initialMood.met) noteLife('见面', '第一次和主人见面') } catch {}
  try { config.routine?.record?.('start') } catch {}
  try { startDenoiseWatch() } catch (error) { logger.warn?.(`dsh-dafeiyu 降噪监视器启动失败: ${error?.message ?? error}`) }

  let activeTurns = 0
  let lastUserText = ''
  let blockedTurns = 0
  let lastSentTurns = -1
  const turnTimer = setInterval(() => {
    try {
      if (activeTurns === lastSentTurns) return
      lastSentTurns = activeTurns
      bridge?.send(createMessage(CompanionMessageKind.TASKS, {
        tasks: Array.from({ length: activeTurns }, (_, index) => ({ title: `任务 ${index + 1}`, state: 'WORKING' })),
      }))
    } catch {}
  }, 5000)
  if (typeof turnTimer.unref === 'function') turnTimer.unref()

  // 上层定时出令：有空且到点时，让 RL 挑一条指令交给 DSH
  let lastMetaAt = 0
  const metaTimer = setInterval(() => {
    try {
      if (Date.now() - lastMetaAt < 20 * 60000) return
      lastMetaAt = Date.now()
      for (const [name, target] of [['chat', config.policy], ['director', config.orderPolicy]]) {
        if ((target?.exportHistory?.() ?? []).length >= 8) config.meta?.optimize?.(target, { name })
      }
    } catch {}
  }, 60000)
  if (typeof metaTimer.unref === 'function') metaTimer.unref()

  let lastDirectorAt = 0
  const directorTimer = setInterval(() => {
    try {
      const live = settings.get()
      if (live?.directorEnabled === false) return
      if (activeTurns > 0) return
      const interval = (Number(live?.directorIntervalMinutes) || 45) * 60000
      if (Date.now() - lastDirectorAt < interval) return
      lastDirectorAt = Date.now()
      Promise.resolve(config.runDirectorWithChain?.({ reason: 'auto' })).catch(() => {})
    } catch {}
  }, 60000)
  if (typeof directorTimer.unref === 'function') directorTimer.unref()
  const greeter = createGreeter({
    config: () => settings.get(),
    speak: (text, options) => {
      const live = settings.get()
      const shaping = live?.voiceShaping === true
      return speaker.speak(text, { ...options, preset: shaping ? asString(live?.voicePreset, '') : '' })
    },
    send: (message) => bridge?.send(message),
    isBusy: () => activeTurns > 0,
    logger,
  })

  const pickOne = (list) => list[Math.floor(Math.random() * list.length)]
  const MOOD_TEXT = {
    praise: ['嘿嘿，被你夸到了', '谢谢～我尾巴都翘起来了', '真的吗？那我今天要多蹦两下'],
    feed: ['谢谢，我吃饱了', '这个好吃，还有吗'],
    play: ['好耶，再来一次！', '我喜欢跟你玩'],
    missing: ['好久没见你了，我一直在等你', '你是不是把我忘了…'],
    hungry: ['肚子在叫了…有吃的吗', '有点饿了'],
    sleepy: ['夜深了，眼皮开始打架', '我有点困了…'],
    happy: ['今天心情不错！', '今天感觉挺好的'],
  }

  // 说话 + 气泡：她要说的每一句都能在气泡里看到。
  const pulse = (text, state = 'SUCCESS') => {
    // 独立气泡通道：不跟任务状态气泡抢位置
    try {
      eventStream.broadcast(createMessage(CompanionMessageKind.SAY, { message: text, ttlMs: 9000 }))
    } catch {}
    try {
      bridge?.send(createMessage(CompanionMessageKind.PULSE, {
        state, message: text, detail: '大肥鱼', ttlMs: 6000, resumeState: 'IDLE',
      }))
    } catch {}
    try {
      const live = settings.get()
      speakText(text, {
        voice: asString(live?.voiceName, 'Tingting'),
        rate: Number(live?.voiceRate ?? 180),
        volume: Number(live?.voiceVolume ?? 0.9),
        preset: live?.voiceShaping === true ? asString(live?.voicePreset, '') : '',
      })
    } catch {}
  }

  // 语音唤醒：常驻听麦克风，喊一句唤醒词就叫醒她。
  // 识别全在本机（sherpa-onnx 关键词检测），录音不出门。
  const wakeReact = (keyword) => {
    const live = settings.get()
    if (live.wakeEnabled !== true) return
    pulse(asString(live.wakeReply, '在呢，我在听'))
    try { eventStream.broadcast({ kind: 'wake', keyword, at: Date.now() }) } catch {}
    try { config.evolution?.addXp?.(2) } catch {}
    try { noteLife('被唤醒', `听见「${keyword}」把我叫醒了`) } catch {}
    try { config.routine?.record?.('wake') } catch {}
  }
  const wake = createWakeService({
    logger,
    keyword: asString(settings.get()?.wakeKeyword, '大肥鱼'),
    onWake: wakeReact,
    onStatus: (status) => {
      try { eventStream.broadcast({ kind: 'wake-status', status }) } catch {}
    },
  })
  const syncWake = () => {
    const live = settings.get()
    if (live.wakeEnabled !== true || live.enabled === false) {
      if (wake.status.enabled) wake.stop()
      return
    }
    const changed = wake.configure({ keyword: asString(live.wakeKeyword, '大肥鱼') })
    if (changed || !wake.status.running) wake.restart()
  }
  syncWake()

  // 生活记忆：把"发生过的事"写进长期记忆，按天去重，同类一天只记一条。
  const lifeLogged = new Map()
  const noteLife = (kind, text) => {
    try {
      const store = config.memoryStore
      if (!store) return
      const day = new Date().toISOString().slice(0, 10)
      const stamp = `${day} ${kind}`
      if (lifeLogged.get(kind) === day) return
      lifeLogged.set(kind, day)
      store.add(stamp, text)
      try { config.permMemory?.remember?.(stamp, text) } catch {}
      try { config.goldbach?.register?.(stamp, text) } catch {}
      logger.info?.(`dsh-dafeiyu 生活记忆: ${stamp} = ${text}`)
    } catch {}
  }

  // 主动行为：不再固定"一天三问"，而是按"多久没聊 + 当前状态"决定要不要冒泡。
  let lastProactive = 0
  const proactiveTimer = setInterval(() => {
    try {
      const snap = mood.tick()
      if (activeTurns > 0) return
      const current = settings.get()
      if (current.enabled === false || current.greetingEnabled === false) return
      if (Date.now() - lastProactive < 3 * 3600 * 1000) return
      const key = (snap.daysSinceChat ?? 0) >= 2 ? 'missing'
        : snap.hunger >= 0.8 ? 'hungry'
          : snap.sleepiness >= 0.85 ? 'sleepy' : ''
      if (!key) return
      lastProactive = Date.now()
      pulse(pickOne(MOOD_TEXT[key]))
    } catch {}
  }, 10 * 60 * 1000)
  if (typeof proactiveTimer.unref === 'function') proactiveTimer.unref()

  let bridge
  let reducer
  let restartTimer
  const balance = createBalanceMonitor({
    query: createBalanceQuery(ctx),
    onChange(snapshot) {
      const message = createMessage(CompanionMessageKind.BALANCE, snapshot)
      if (bridge) bridge.send(message)
      else eventStream.broadcast(message)
    },
  })

  const stopRuntime = (reason = 'settings-change') => {
    bridge?.stop(reason)
    bridge = undefined
    reducer = undefined
  }

  const restartRuntime = (next) => {
    stopRuntime('settings-change')
    startRuntime(next)
  }

  const applyLiveSettings = (next) => {
    for (const message of reducer.setIncludeSubagents(next.includeSubagents === true)) bridge.send(message)
    bridge.send(createMessage(CompanionMessageKind.CONFIG, {
      scale: next.scale ?? defaults.scale,
      bubbleScale: next.bubbleScale ?? defaults.bubbleScale,
      activityLevel: next.activityLevel ?? defaults.activityLevel,
      reducedMotion: next.reducedMotion === true,
      soundEnabled: next.soundEnabled !== false,
      bubbleMode: next.bubbleMode ?? defaults.bubbleMode,
      bubbleStates: Array.isArray(next.bubbleStates) ? next.bubbleStates : defaults.bubbleStates,
      openUrl: resolveClientTarget({ ...config, ...next }).url,
      openLabel: resolveClientTarget({ ...config, ...next }).label,
    }))
  }

  const scheduleRestart = (next) => {
    if (restartTimer) clearTimeout(restartTimer)
    restartTimer = setTimeout(() => {
      restartTimer = undefined
      restartRuntime(next)
    }, 400)
    restartTimer.unref?.()
  }

  const startRuntime = (resolved) => {
    if (resolved.enabled === false) {
      logger.info?.('dsh-dafeiyu is disabled')
      return
    }
    // 把当前 WebUI 地址写到一个固定文件：GUI 端口每次启动都会变，
  // 原生助手靠它拿到最新的接口地址。
  const helperConfig = config.helper ?? {}
    bridge = new HelperProcess({
      ...helperConfig,
      env: {
        ...helperConfig.env,
        DSH_DAFEIYU_SCALE: String(resolved.scale ?? defaults.scale),
        DSH_DAFEIYU_BUBBLE_SCALE: String(resolved.bubbleScale ?? defaults.bubbleScale),
        DSH_DAFEIYU_ACTIVITY_LEVEL: String(resolved.activityLevel ?? defaults.activityLevel),
        DSH_DAFEIYU_REDUCED_MOTION: resolved.reducedMotion === true ? '1' : '0',
        DSH_DAFEIYU_SOUND_ENABLED: resolved.soundEnabled !== false ? '1' : '0',
        DSH_DAFEIYU_BUBBLE_MODE: String(resolved.bubbleMode ?? defaults.bubbleMode),
        DSH_DAFEIYU_BUBBLE_STATES: (Array.isArray(resolved.bubbleStates) ? resolved.bubbleStates : defaults.bubbleStates).join(','),
        DSH_DAFEIYU_WEBUI_URL: resolveClientTarget({ ...config, ...resolved }).url,
        DSH_DAFEIYU_VOICE: asString(resolved.voiceName, defaults.voiceName),
        DSH_DAFEIYU_VOICE_RATE: String(resolved.voiceRate ?? defaults.voiceRate),
        DSH_DAFEIYU_CHAT_IDLE_SEC: String(resolved.chatIdleSeconds ?? defaults.chatIdleSeconds),
        DSH_DAFEIYU_DENOISE_DIR: String(resolved.denoiseWatchDir ?? defaults.denoiseWatchDir).replace(/^~(?=$\/)/, homedir()),
        DSH_DAFEIYU_MUSIC_DIR: String(resolved.musicPlaylist ?? defaults.musicPlaylist).replace(/^~(?=$\/)/, homedir()),
        DSH_DAFEIYU_OPEN_LABEL: resolveClientTarget({ ...config, ...resolved }).label,
        // Serve animations from the installed package instead of the helper's
        // baked-in bundle so derived clips (scripts/gen-clips.py) take effect
        // without rebuilding the native app.
        DSH_DAFEIYU_ASSET_ROOT: assetsRoot,
      },
      onSettingsChange: (report) => {
        if (typeof settings.update !== 'function') return
        const patch = {}
        if (Number.isFinite(report.scale)) patch.scale = Math.min(1.4, Math.max(0.55, report.scale))
        if (Number.isFinite(report.bubbleScale)) patch.bubbleScale = Math.min(1.2, Math.max(0.8, report.bubbleScale))
        if (typeof report.reducedMotion === 'boolean') patch.reducedMotion = report.reducedMotion
        if (Object.keys(patch).length === 0) return
        void Promise.resolve(settings.update(patch)).catch((error) => {
          logger.warn?.(`dsh-dafeiyu failed to persist helper settings: ${error instanceof Error ? error.message : String(error)}`)
        })
      },
    }, logger)
    // Mirror every companion message to in-page subscribers without changing
    // what the helper receives; the wrap is per-runtime and dies with it.
    const deliver = bridge.send.bind(bridge)
    bridge.send = (message) => {
      deliver(message)
      eventStream.broadcast(message)
    }
    reducer = new CompanionReducer({ includeSubagents: resolved.includeSubagents === true })
    bridge.start()
    bridge.send(createMessage(CompanionMessageKind.HELLO, {
      state: CompanionState.IDLE,
      host: 'deepseek-harness',
      pluginVersion: pkg.version,
      message: 'BigFish connected to DSH',
    }))
    bridge.send(createMessage(CompanionMessageKind.STATE, {
      state: CompanionState.IDLE,
      phase: 'plugin-start',
      stage: '等待任务',
      message: '我在这儿等新任务哦',
      detail: 'DSH · 等待下一次任务',
    }))
    if (balance.get().status !== 'disabled') bridge.send(createMessage(CompanionMessageKind.BALANCE, balance.get()))
    logger.info?.('dsh-dafeiyu companion bridge started')
  }

  startRuntime(settings.get())
  balance.configure(settings.get().enabled !== false && settings.get().balanceEnabled, settings.get().balanceSource)

  // The companion intentionally observes every DSH session. Loader entries may
  // live inside a scoped composition, so use the unscoped root bus and dispose
  // the registrations explicitly with this plugin's lifecycle.
  // Never let an exception from this optional companion escape into the shared
  // session bus: a throw here could stop every other subscriber from seeing
  // the event, which would look exactly like "installing the pet broke other
  // plugins".
  const eventStats = { total: 0, userMessage: 0, turns: 0, lastType: '', lastError: '' }
  const offEvent = eventCtx.on('session/event', (session, event) => {
    eventStats.total += 1
    if (event?.type === 'user/message') eventStats.userMessage += 1
    chat.note(session, event)
    if (event?.type === 'user/message') {
      let text = ''
      try {
        const raw = event.data?.content
        text = Array.isArray(raw) ? raw.map((part) => (typeof part === 'string' ? part : part?.text ?? '')).join(' ') : String(raw ?? '')
      } catch { text = '' }
      try {
        mood.poke('chat')
        try { config.routine?.record?.('chat') } catch {}
        try { config.evolution?.addXp?.(1) } catch {}
        if (PRAISE.test(text)) mood.poke('praise')
        else if (FEED.test(text)) mood.poke('feed')
        if (config.memoryStore && text) {
          const result = rememberFacts(config.memoryStore, text)
          if (result.added.length) logger.info?.(`dsh-dafeiyu 自动记忆: ${result.added.map((f) => f.key + '=' + f.value).join('、')}`)
        }
      } catch {}
    }
    eventStats.lastType = event?.type ?? ''
    try {
      if (event?.type === 'assistant/message' && lastUserText) {
        const text = event?.data?.message?.content?.filter?.((part) => part.type === 'text')?.map((part) => part.text).join('') ?? ''
        const cleanQuestion = !/^(Time sampled|Current runtime context|<dfy-context>)/.test(lastUserText)
        if (cleanQuestion && text.length > 8 && text.length < 800) config.selfTool?.learn?.(lastUserText, text)
        lastUserText = ''
      }
    } catch {}
    if (event?.type === 'turn/start') { activeTurns += 1; eventStats.turns += 1; syncPower() }
    if (event?.type === 'turn/end') {
      activeTurns = Math.max(0, activeTurns - 1)
      syncPower()
      // 连续被阻塞说明会话坏了，重置一次
      try {
        const kind = event?.data?.reason?.kind ?? ''
        if (kind === 'blocked') {
          blockedTurns += 1
          if (blockedTurns >= 2) {
            blockedTurns = 0
            chat.reset?.()
          }
        } else {
          blockedTurns = 0
        }
      } catch {}
    }
    if (event?.type !== 'turn/end') greeter.noteActivity()
    if (!bridge || !reducer) return
    try {
      for (const message of reducer.handle(session, event)) {
        bridge.send(message)
        if (message.kind === 'state' && message.state === 'SUCCESS') { greeter.announce('success'); try { mood.poke('calm') } catch {} }
        if (message.kind === 'state' && message.state === 'ERROR') { greeter.announce('error'); try { mood.poke('stress') } catch {} }
      }
    } catch (error) {
      logger.error?.('dsh-dafeiyu failed to handle session event', error)
    }
  }, { global: true })
  const offDisposed = eventCtx.on('session/disposed', (session) => {
    if (!bridge || !reducer) return
    try {
      for (const message of reducer.disposeSession(session)) bridge.send(message)
    } catch (error) {
      logger.error?.('dsh-dafeiyu failed to dispose session', error)
    }
  }, { global: true })

  const unwatch = settings.watch((next) => {
    // Disabling is the only path that tears the helper down.  Every other
    // setting is applied live through a CONFIG message, so sliders never
    // restart the pet.  Starting a previously-disabled runtime is debounced
    // to avoid spawning repeatedly while settings settle.
    try {
      balance.configure(next.enabled !== false && next.balanceEnabled, next.balanceSource)
      syncPower()
      syncWake()
      syncCloneVoice()
      if (next.enabled === false) {
        if (restartTimer) {
          clearTimeout(restartTimer)
          restartTimer = undefined
        }
        stopRuntime('settings-change')
        return
      }
      if (!bridge) {
        scheduleRestart(next)
        return
      }
      if (restartTimer) {
        clearTimeout(restartTimer)
        restartTimer = undefined
      }
      applyLiveSettings(next)
    } catch (error) {
      // This callback runs inside the host's settings dispatch; a throw here
      // would take the host's settings service down with the pet.
      logger.error?.(`dsh-dafeiyu failed to apply settings: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
  // A credential or account change invalidates the old display immediately.
  const refreshBalance = () => {
    const next = settings.get()
    balance.configure(next.enabled !== false && next.balanceEnabled, next.balanceSource, true)
  }
  const offCredential = eventCtx.on('credentials/reference-updated', refreshBalance, { global: true })
  const offAccount = eventCtx.on('deepseek-account/signed-out', refreshBalance, { global: true })
  const offAccountCredential = eventCtx.on('credentials/record-updated', refreshBalance, { global: true })
  const offProvider = eventCtx.on('settings/document-updated', (ns) => {
    if (['llm-deepseek', 'llm-deepseek-api-key', balanceProviderNamespace(ctx)].includes(ns)) refreshBalance()
  }, { global: true })
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (httpCtx) => {
      httpCtx.effect(
        () => httpCtx.webServer.register({ kind: 'exact', path: CONFIG_ENDPOINT, handler: createConfigHandler(settings) }),
        'dsh-dafeiyu: local settings endpoint',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({ kind: 'exact', path: EVENTS_ENDPOINT, handler: createEventsHandler(eventStream) }),
        'dsh-dafeiyu: local event stream',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({ kind: 'exact', path: BALANCE_ENDPOINT, handler: createBalanceHandler(balance) }),
        'dsh-dafeiyu: local balance endpoint',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({ kind: 'exact', path: CHAT_STATE_ENDPOINT, handler: chatHandlers.state }),
        'dsh-dafeiyu: local chat state endpoint',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({ kind: 'exact', path: CHAT_SEND_ENDPOINT, handler: chatHandlers.send }),
        'dsh-dafeiyu: local chat send endpoint',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({ kind: 'exact', path: CHAT_TARGET_ENDPOINT, handler: chatHandlers.target }),
        'dsh-dafeiyu: local chat target endpoint',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/debug/crt',
          handler: (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            try { jsonResponse(res, 200, config.crt?.stats?.() ?? {}) } catch (error) { jsonResponse(res, 500, { error: String(error?.message ?? error) }) }
          },
        }),
        'dsh-dafeiyu: crt debug',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/debug/meta',
          handler: (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            try { jsonResponse(res, 200, config.meta?.status?.() ?? {}) } catch (error) { jsonResponse(res, 500, { error: String(error?.message ?? error) }) }
          },
        }),
        'dsh-dafeiyu: meta debug',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/debug/mus',
          handler: (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            try { jsonResponse(res, 200, config.mus?.stats?.() ?? {}) } catch (error) { jsonResponse(res, 500, { error: String(error?.message ?? error) }) }
          },
        }),
        'dsh-dafeiyu: mus debug',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/debug/goldbach',
          handler: (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            try { jsonResponse(res, 200, config.goldbach?.stats?.() ?? {}) } catch (error) { jsonResponse(res, 500, { error: String(error?.message ?? error) }) }
          },
        }),
        'dsh-dafeiyu: goldbach debug',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/debug/skills',
          handler: (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            try { jsonResponse(res, 200, config.skills?.stats?.() ?? {}) } catch (error) { jsonResponse(res, 500, { error: String(error?.message ?? error) }) }
          },
        }),
        'dsh-dafeiyu: skills debug',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/debug/matrix-memory',
          handler: (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            try { jsonResponse(res, 200, config.permMemory?.stats?.() ?? {}) } catch (error) { jsonResponse(res, 500, { error: String(error?.message ?? error) }) }
          },
        }),
        'dsh-dafeiyu: matrix memory debug',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/debug/selftool',
          handler: (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            try { jsonResponse(res, 200, config.selfTool?.stats?.() ?? {}) } catch (error) { jsonResponse(res, 500, { error: String(error?.message ?? error) }) }
          },
        }),
        'dsh-dafeiyu: selftool debug',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/debug/director',
          handler: (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            try { jsonResponse(res, 200, config.director?.status?.() ?? {}) } catch (error) { jsonResponse(res, 500, { error: String(error?.message ?? error) }) }
          },
        }),
        'dsh-dafeiyu: director debug',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/emote',
          handler: (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            const clip = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('clip') ?? ''
            if (!clip) return jsonResponse(res, 400, { error: '缺少 clip' })
            try {
              bridge?.send(createMessage(CompanionMessageKind.EMOTE, { clip }))
              jsonResponse(res, 200, { ok: true, clip })
            } catch (error) { jsonResponse(res, 500, { error: String(error?.message ?? error) }) }
          },
        }),
        'dsh-dafeiyu: emote',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/preview',
          handler: (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            const seconds = Number(new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('seconds')) || 1.6
            try {
              bridge?.send(createMessage(CompanionMessageKind.PREVIEW, { seconds }))
              jsonResponse(res, 200, { ok: true, seconds })
            } catch (error) { jsonResponse(res, 500, { error: String(error?.message ?? error) }) }
          },
        }),
        'dsh-dafeiyu: preview',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/director/run',
          handler: (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            const order = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('order') ?? ''
            Promise.resolve(config.runDirectorWithChain?.({ reason: 'http', forceOrder: order }))
              .then((result) => jsonResponse(res, 200, result ?? {}))
              .catch((error) => jsonResponse(res, 500, { error: String(error?.message ?? error) }))
          },
        }),
        'dsh-dafeiyu: director run',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/debug/rl',
          handler: (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            try { jsonResponse(res, 200, config.policy?.status?.() ?? {}) } catch (error) { jsonResponse(res, 500, { error: String(error?.message ?? error) }) }
          },
        }),
        'dsh-dafeiyu: rl debug',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/debug/tasks',
          handler: (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            jsonResponse(res, 200, { activeTurns, lastSentTurns, ...eventStats })
          },
        }),
        'dsh-dafeiyu: debug tasks',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/debug/events',
          handler: (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            jsonResponse(res, 200, { ...eventStats, mood: mood.snapshot() })
          },
        }),
        'dsh-dafeiyu: debug events',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/debug/memory-extract',
          handler: (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            const url = new URL(req.url ?? '/', 'http://127.0.0.1')
            jsonResponse(res, 200, { facts: extractFacts(url.searchParams.get('text') ?? '') })
          },
        }),
        'dsh-dafeiyu: memory extract',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/chat/stream',
          handler: (req, res) => {
            if (!isLocalRequest(req)) { jsonResponse(res, 403, { error: 'local access only' }); return }
            res.writeHead(200, {
              'content-type': 'text/event-stream; charset=utf-8',
              'cache-control': 'no-store',
              connection: 'keep-alive',
            })
            let last = ''
            let closed = false
            const push = async () => {
              if (closed) return
              try {
                const snapshot = await chat.state()
                const payload = JSON.stringify({
                  sessionId: snapshot.sessionId, title: snapshot.title, busy: snapshot.busy,
                  messages: snapshot.messages, sessions: snapshot.sessions, error: snapshot.error ?? '',
                })
                if (payload !== last) { last = payload; res.write(`data: ${payload}\n\n`) }
              } catch {}
            }
            push()
            const timer = setInterval(push, 700)
            req.on('close', () => { closed = true; clearInterval(timer); try { res.end() } catch {} })
            req.on('error', () => { closed = true; clearInterval(timer) })
          },
        }),
        'dsh-dafeiyu: chat stream',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/chat/stop',
          handler: async (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'method not allowed' })
            try { jsonResponse(res, 200, await chat.stop()) } catch (error) { jsonResponse(res, 500, { error: String(error?.message ?? error) }) }
          },
        }),
        'dsh-dafeiyu: chat stop',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/chat/speak',
          handler: async (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'method not allowed' })
            try {
              const chunks = []
              for await (const chunk of req) chunks.push(chunk)
              const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
              const text = String(body.text ?? '').slice(0, 500)
              const live = settings.get()
              const started = speakText(text, {
                voice: asString(live?.voiceName, 'Tingting'),
                rate: Number(live?.voiceRate ?? 180),
                volume: Number(live?.voiceVolume ?? 0.9),
                preset: live?.voiceShaping === true ? asString(live?.voicePreset, '') : '',
              })
              jsonResponse(res, 200, { started })
            } catch (error) {
              jsonResponse(res, 500, { error: String(error?.message ?? error) })
            }
          },
        }),
        'dsh-dafeiyu: chat speak',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/chat/welcome',
          handler: async (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            try { jsonResponse(res, 200, await chat.welcome()) } catch (error) { jsonResponse(res, 500, { error: String(error?.message ?? error) }) }
          },
        }),
        'dsh-dafeiyu: chat welcome',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/evolution',
          handler: (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            try { jsonResponse(res, 200, config.evolution?.snapshot?.() ?? {}) } catch (error) { jsonResponse(res, 500, { error: String(error?.message ?? error) }) }
          },
        }),
        'dsh-dafeiyu: evolution',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/mood',
          handler: async (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            try {
              if (req.method === 'GET') {
                jsonResponse(res, 200, mood.tick())
                return
              }
              if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'method not allowed' })
              const chunks = []
              for await (const chunk of req) chunks.push(chunk)
              const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
              const action = String(body.action ?? '')
              const kind = action === 'feed' ? 'feed' : action === 'play' ? 'play' : action === 'praise' ? 'praise' : 'seen'
              const next = mood.poke(kind)
              try { config.routine?.record?.('mood') } catch {}
              try { config.evolution?.addXp?.(kind === 'praise' ? 3 : kind === 'feed' ? 2 : 1) } catch {}
              if (kind === 'praise') noteLife('被夸', '今天被夸了，心情很好')
              if (kind === 'feed') noteLife('吃饭', '吃了一碗白饭')
              if (MOOD_TEXT[kind]) pulse(pickOne(MOOD_TEXT[kind]))
              else if (action === 'tick' && MOOD_TEXT[next.mood === '想你' ? 'missing' : next.mood === '饿' ? 'hungry' : next.mood === '困' ? 'sleepy' : 'happy']) {
                pulse(pickOne(MOOD_TEXT[next.mood === '想你' ? 'missing' : next.mood === '饿' ? 'hungry' : next.mood === '困' ? 'sleepy' : 'happy']))
              }
              jsonResponse(res, 200, next)
            } catch (error) {
              jsonResponse(res, 500, { error: String(error?.message ?? error) })
            }
          },
        }),
        'dsh-dafeiyu: mood',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/wake/status',
          handler: async (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            if (req.method === 'POST') {
              try {
                const chunks = []
                for await (const chunk of req) chunks.push(chunk)
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
                if (body.test === true) {
                  wakeReact(String(body.keyword ?? '测试'))
                  return jsonResponse(res, 200, { ok: true, tested: true, status: wake.status })
                }
                if (body.enabled === true || body.enabled === false) {
                  if (typeof settings.update === 'function') await settings.update({ wakeEnabled: body.enabled === true })
                  const live = settings.get()
                  if (body.enabled === true) { wake.configure({ keyword: asString(live.wakeKeyword, '大肥鱼') }); wake.restart() } else { wake.stop() }
                  return jsonResponse(res, 200, { ok: true, status: wake.status })
                }
              } catch (error) {
                return jsonResponse(res, 500, { ok: false, error: String(error?.message ?? error) })
              }
            }
            jsonResponse(res, 200, { ok: true, status: wake.status })
          },
        }),
        'dsh-dafeiyu: wake status',
      ),
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/voice/preview',
          handler: async (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'method not allowed' })
            try {
              const chunks = []
              for await (const chunk of req) chunks.push(chunk)
              const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
              const preset = String(body.voice ?? '')
              const live = settings.get()
              const started = speakText(String(body.text ?? '大肥鱼现在用的是这个音色，你听听看。'), {
                voice: asString(live?.voiceName, 'Tingting'),
                rate: Number(live?.voiceRate ?? 180),
                volume: Number(live?.voiceVolume ?? 0.9),
                preset,
              })
              jsonResponse(res, 200, { started, preset })
            } catch (error) {
              jsonResponse(res, 500, { error: String(error?.message ?? error) })
            }
          },
        }),
        'dsh-dafeiyu: voice preview',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/debug/envelope',
          handler: async (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            try {
              const preset = asString(settings.get()?.voicePreset, '')
              await applyEnvelope(preset, '/tmp/t2.aiff', '/tmp/envelope-out.wav')
              jsonResponse(res, 200, { ok: true, preset })
            } catch (error) {
              jsonResponse(res, 500, { ok: false, preset: asString(settings.get()?.voicePreset, ''), error: String(error?.message ?? error) })
            }
          },
        }),
        'dsh-dafeiyu: debug envelope',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/debug/speak',
          handler: (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            const preset = asString(settings.get()?.voicePreset, '')
            const started = speaker.speak('这是音色测试', { voice: 'Tingting', rate: 180, volume: 0.9, preset })
            jsonResponse(res, 200, { preset, started })
          },
        }),
        'dsh-dafeiyu: debug speak',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/debug/voice',
          handler: (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            const raw = settings.get()?.voicePreset
            jsonResponse(res, 200, {
              raw, type: typeof raw,
              keys: raw && typeof raw === 'object' ? Object.keys(raw) : [],
              resolved: asString(raw, ''),
            })
          },
        }),
        'dsh-dafeiyu: debug voice',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/voices',
          handler: (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            try {
              const voices = fileExists(VOICES_DIR)
                ? readdirSyncImpl(VOICES_DIR, { withFileTypes: true })
                    .filter((entry) => entry.isDirectory())
                    .map((entry) => {
                      try { return JSON.parse(readFileSyncImpl(joinPath(VOICES_DIR, entry.name, 'meta.json'), 'utf8')) } catch { return { name: entry.name } }
                    })
                : []
              jsonResponse(res, 200, { voices })
            } catch (error) {
              jsonResponse(res, 500, { error: String(error?.message ?? error) })
            }
          },
        }),
        'dsh-dafeiyu: voices',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/tesla/skills',
          handler: (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            try {
              jsonResponse(res, 200, { skills: listSkills(), cli: TESLA_CLI })
            } catch (error) {
              jsonResponse(res, 500, { error: String(error?.message ?? error) })
            }
          },
        }),
        'dsh-dafeiyu: tesla skills',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/debug/chat',
          handler: async (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            try {
              const context = await chat.buildContext()
              jsonResponse(res, 200, { context, length: context.length, debug: chat.debug() })
            } catch (error) {
              jsonResponse(res, 500, { error: String(error?.message ?? error) })
            }
          },
        }),
        'dsh-dafeiyu: debug chat',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/memory',
          handler: async (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            const memory = config.memoryStore
            try {
              if (req.method === 'GET') {
                jsonResponse(res, 200, { items: memory.list(), path: memory.path })
                return
              }
              if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'method not allowed' })
              const chunks = []
              for await (const chunk of req) chunks.push(chunk)
              const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
              const action = String(body.action ?? '')
              if (action === 'add') memory.add(body.key, body.value)
              else if (action === 'remove') memory.remove(body.target)
              else if (action === 'clear') memory.clear()
              else return jsonResponse(res, 400, { error: 'action 必须是 add / remove / clear' })
              jsonResponse(res, 200, { items: memory.list(), path: memory.path })
            } catch (error) {
              jsonResponse(res, 400, { error: String(error?.message ?? error) })
            }
          },
        }),
        'dsh-dafeiyu: memory endpoint',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/debug/models',
          handler: async (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            try {
              const controller = ctx.get?.('sessionController')
              const catalog = await controller?.modelCatalog?.()
              const state = await chat.state()
              let selection
              const query = ctx.get?.('sessionQuery')
              if (state.sessionId && query?.observeSession) {
                const observation = await query.observeSession(state.sessionId)
                selection = observation?.projections?.values?.modelSelection?.next
                try { observation?.[Symbol.dispose]?.() } catch {}
              }
              jsonResponse(res, 200, {
                default: catalog?.default ?? null,
                groups: (catalog?.groups ?? []).map((group) => ({ id: group.id, models: (group.models ?? []).map((m) => m.id) })),
                session: { id: state.sessionId, selection: selection ?? null },
              })
            } catch (error) {
              jsonResponse(res, 500, { error: String(error?.message ?? error) })
            }
          },
        }),
        'dsh-dafeiyu: debug models',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/novel/books',
          handler: (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            if (req.method !== 'GET') return jsonResponse(res, 405, { error: 'method not allowed' })
            jsonResponse(res, 200, { root: novel.root, books: novel.listBooks() })
          },
        }),
        'dsh-dafeiyu: novel list endpoint',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/novel/book',
          handler: (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            if (req.method !== 'GET') return jsonResponse(res, 405, { error: 'method not allowed' })
            try {
              const book = new URL(req.url ?? '/', 'http://dsh.local').searchParams.get('book')
              jsonResponse(res, 200, novel.bookDetail(String(book ?? '')))
            } catch (error) {
              jsonResponse(res, 400, { error: error?.message ?? String(error) })
            }
          },
        }),
        'dsh-dafeiyu: novel detail endpoint',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/novel/create',
          handler: async (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'method not allowed' })
            try {
              const chunks = []
              for await (const chunk of req) chunks.push(chunk)
              const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
              jsonResponse(res, 200, novel.createBook(String(body.book ?? '')))
            } catch (error) {
              jsonResponse(res, 400, { error: error?.message ?? String(error) })
            }
          },
        }),
        'dsh-dafeiyu: novel create endpoint',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/novel/export',
          handler: async (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'method not allowed' })
            try {
              const chunks = []
              for await (const chunk of req) chunks.push(chunk)
              const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
              jsonResponse(res, 200, novel.exportBook(String(body.book ?? '')))
            } catch (error) {
              jsonResponse(res, 400, { error: error?.message ?? String(error) })
            }
          },
        }),
        'dsh-dafeiyu: novel export endpoint',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/novel/open',
          handler: async (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'method not allowed' })
            try {
              const chunks = []
              for await (const chunk of req) chunks.push(chunk)
              const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
              const dir = novel.bookPath(String(body.book ?? ''))
              const open = await import('node:child_process')
              open.spawn('/usr/bin/open', [dir], { stdio: 'ignore', detached: true }).unref()
              jsonResponse(res, 200, { opened: dir })
            } catch (error) {
              jsonResponse(res, 400, { error: error?.message ?? String(error) })
            }
          },
        }),
        'dsh-dafeiyu: novel open endpoint',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/denoise/state',
          handler: (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            if (req.method !== 'GET') return jsonResponse(res, 405, { error: 'method not allowed' })
            jsonResponse(res, 200, {
              ...denoiseJobs.state(),
              power: { held: powerHeld, holders: power.holders, active: power.active, turns: activeTurns, denoiseBusy },
            })
          },
        }),
        'dsh-dafeiyu: denoise state endpoint',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/denoise/run',
          handler: async (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'method not allowed' })
            try {
              const chunks = []
              let bytes = 0
              for await (const chunk of req) {
                bytes += chunk.length
                if (bytes > 8192) throw new Error('请求体过大')
                chunks.push(chunk)
              }
              const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
              jsonResponse(res, 200, await denoiseJobs.start(body))
            } catch (error) {
              jsonResponse(res, 400, { error: error?.message ?? String(error) })
            }
          },
        }),
        'dsh-dafeiyu: denoise run endpoint',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/denoise/browse',
          handler: (req, res) => {
            if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
            if (req.method !== 'GET') return jsonResponse(res, 405, { error: 'method not allowed' })
            try {
              const dir = new URL(req.url ?? '/', 'http://dsh.local').searchParams.get('dir')
              jsonResponse(res, 200, denoiseJobs.browse(dir))
            } catch (error) {
              jsonResponse(res, 400, { error: error?.message ?? String(error) })
            }
          },
        }),
        'dsh-dafeiyu: denoise browse endpoint',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: '/plugins/dsh-dafeiyu/greet',
          handler: async (req, res) => {
            if (!isLocalRequest(req)) {
              jsonResponse(res, 403, { error: 'local access only' })
              return
            }
            if (req.method !== 'POST') {
              jsonResponse(res, 405, { error: 'method not allowed' })
              return
            }
            try {
              jsonResponse(res, 200, { text: greeter.greet() })
            } catch (error) {
              jsonResponse(res, 500, { error: error?.message ?? String(error) })
            }
          },
        }),
        'dsh-dafeiyu: local greeting test endpoint',
      )
      const assetRoutes = createAssetRoutes()
      if (assetRoutes) {
        httpCtx.effect(
          () => httpCtx.webServer.register({ kind: 'exact', path: MANIFEST_ENDPOINT, handler: assetRoutes.manifestHandler }),
          'dsh-dafeiyu: local manifest endpoint',
        )
        httpCtx.effect(
          () => httpCtx.webServer.register({ kind: 'exact', path: FRAME_ENDPOINT, handler: assetRoutes.frameHandler }),
          'dsh-dafeiyu: local frame endpoint',
        )
      }
    })
  }
  ctx.effect(() => () => {
    if (restartTimer) clearTimeout(restartTimer)
    restartTimer = undefined
    offEvent?.()
    offDisposed?.()
    offCredential?.()
    offAccount?.()
    offAccountCredential?.()
    offProvider?.()
    unwatch()
    settings.dispose?.()
    balance.stop()
    wake.stop()
    cloneVoice.stop()
    greeter.stop()
    power.stop()
    speaker.stop()
    stopRuntime('dsh-host-stop')
  })
}

export function apply(ctx, config = {}) {
  const logger = ctx.logger ?? console
  const novelRoot = asString(config.novelRoot, DEFAULT_NOVEL_ROOT)
  const memory = createMemoryStore({ logger })
  // Settings is already a declared dependency. Keep observers on this fiber
  // so Loader's fiber-scoped volatile updates reach them.
  const routine = createRoutineStore({ logger })
  const english = createEnglishStore({ logger })
  const evolution = createEvolutionStore({ logger })
  const policy = createPolicy({ logger })
  try { registerRlTool(ctx, { policy, logger }) } catch (error) { logger.error?.(`RL 工具挂载失败: ${error?.message ?? error}`) }
  const mus = createMus({ logger })
  try {
    registerMusTool(ctx, { mus, logger })
    // 预置两个宇宙，开箱即用
    mus.define('降噪质量', {
      parameters: [{ name: '降噪强度', min: 0, max: 1 }, { name: '保留原声', min: 0, max: 1 }],
      objective: '降噪强度 * 6 + 保留原声 * 4',
      target: 7.5,
      constraints: ['降噪强度 > 0.3', '保留原声 > 0.2'],
    })
  } catch (error) { logger.warn?.(`MUS 预置宇宙失败: ${error?.message ?? error}`) }
  const goldbach = createGoldbachMemory({
    logger,
    onChain: (result) => {
      // 联想链自动记录：把每一跳写成 associate 节点
      try {
        chains.open('associate', `联想：${result.path[0]}`)
        result.path.forEach((key, index) => {
          chains.add('associate', { text: key, relation: index === 0 ? 'start' : 'associate' })
        })
        chains.close('associate')
      } catch {}
    },
  })
  try { registerGoldbachTool(ctx, { goldbach, logger }) } catch (error) { logger.error?.(`哥德巴赫联想挂载失败: ${error?.message ?? error}`) }
  const orderPolicy = createPolicy({
    path: join(homedir(), '.dsh', 'dsh-dafeiyu-director-policy.json'),
    actions: ORDERS.map((order) => order.id),
    logger,
  })
  const director = createDirector({ ctx, policy: orderPolicy, goldbach, logger })
  // 启动后延迟应用探索率（此时 settings 已就绪）
  setTimeout(() => {
    try {
      const rate = Number(settings.get()?.explorationRate) || 0.35
      policy.applyHyper?.({ epsilon: rate, floor: 0.15 })
      orderPolicy.applyHyper?.({ epsilon: rate, floor: 0.15 })
      logger.info?.(`dsh-dafeiyu: 探索率应用为 ${rate}`)
    } catch (error) { logger.warn?.(`应用探索率失败: ${error?.message ?? error}`) }
  }, 3000)
  const perception = createPerception({ logger, intervalMs: (Number(config.perceptionIntervalSec) || 30) * 1000 })
  try {
    registerPerceptionTool(ctx, { perception, logger })
    if (config.perceptionEnabled !== false) perception.start({})
  } catch (error) { logger.error?.(`感知挂载失败: ${error?.message ?? error}`) }

  const distNodes = [
    { name: 'local', type: 'file', path: join(homedir(), '.dsh', 'dsh-dafeiyu-nodes', 'local') },
    { name: 'nas', type: 'file', path: '/Volumes/15226550291/大肥鱼记忆' },
  ]
  const dist = createDistributed({ nodes: distNodes, shards: 4, logger })
  try { registerDistTool(ctx, { dist, logger }) } catch (error) { logger.error?.(`分布式存储挂载失败: ${error?.message ?? error}`) }

  const chains = createChainStore({ logger })
  try { registerChainTool(ctx, { chains, logger }) } catch (error) { logger.error?.(`三链挂载失败: ${error?.message ?? error}`) }

  // 调度台每跑一单，自动记一条推理链
  const runDirectorWithChain = async (options = {}) => {
    try {
      chains.open('reason', options.reason ?? '自动调度')
      chains.add('reason', { text: `触发方式：${options.reason ?? 'auto'}${options.forceOrder ? `，指定指令：${options.forceOrder}` : ''}`, relation: 'premise' })
    } catch {}
    try {
      const result = await director?.runOnce?.(options)
      try {
        chains.add('reason', { text: `执行 ${result?.order ?? '未知'}：${result?.ok ? '成功' : '失败'}（奖励 ${result?.reward ?? 0}）`, relation: 'conclusion' })
        chains.close('reason')
      } catch {}
      return result
    } catch (error) {
      try { chains.add('reason', { text: `执行异常：${error?.message ?? error}`, relation: 'conclusion' }); chains.close('reason') } catch {}
      throw error
    }
  }

  const drive = createDrive({ chains, logger })
  try { registerDriveTool(ctx, { drive, logger }) } catch (error) { logger.error?.(`驱动链挂载失败: ${error?.message ?? error}`) }
  const theory = createTheory({ logger })
  try { registerTheoryTool(ctx, { theory, logger }) } catch (error) { logger.error?.(`理论记忆挂载失败: ${error?.message ?? error}`) }
  const crt = createCrtMemory({ logger })
  try { registerCrtTool(ctx, { crt, logger }) } catch (error) { logger.error?.(`CRT 编码挂载失败: ${error?.message ?? error}`) }
  const meta = createMeta({ logger })
  try { registerMetaTool(ctx, { meta, policies: { chat: policy, director: orderPolicy }, logger }) } catch (error) { logger.error?.(`元优化挂载失败: ${error?.message ?? error}`) }
  try { registerDirectorTool(ctx, { director, logger }) } catch (error) { logger.error?.(`调度台工具挂载失败: ${error?.message ?? error}`) }
  // 动作学习：从视频里学"小动作"，生成新的动作帧（scripts/learn-motion.py）
  const motionTool = {
    name: 'motion',
    description: '从视频里学习小动作并生成宠物动作：action=learn 需要 video 路径和可选 name。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['learn', 'scene', 'pose', 'rhythm'] },
        video: { type: 'string', description: '视频文件路径' },
        name: { type: 'string', description: '动作名（默认 learned / pose）' },
        intensity: { type: 'number', description: '动作幅度倍数（默认 1.0，0.3–3.0）' },
        gaps: { type: 'string', description: 'rhythm 时的节奏序列，如 "1,2,3,4"' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' } }, additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: v.summary ?? '' }] },
    async execute(args) {
      if (!['learn', 'scene', 'pose', 'rhythm'].includes(args.action)) throw new Error('只支持 learn / scene / pose / rhythm')
      const video = String(args.video ?? '').trim()
      if (args.action !== 'rhythm' && !video) throw new Error('缺少 video 路径')
      const name = String(args.name ?? 'learned').replace(/[^\w.-]/g, '') || 'learned'
      // 姿态估计需要 OpenCV：优先用装好 mediapipe 的 venv，其次回退到内置 Python
      const poseVenv = join(homedir(), 'Downloads', 'dfy', 'pose-venv', 'bin', 'python')
      const python = args.action === 'pose' && existsSync(poseVenv)
        ? poseVenv
        : (await findPython({ logger })).bin
      const scriptName = args.action === 'scene' ? 'learn-scene.py'
        : args.action === 'pose' ? 'learn-pose.py'
          : args.action === 'rhythm' ? 'gen-rhythm.py'
            : 'learn-motion.py'
      const script = join(dirname(new URL(import.meta.url).pathname), '..', 'scripts', scriptName)
      const ffmpeg = await findFfmpeg({ logger }).catch(() => '')
      const { spawn } = await import('node:child_process')
      const output = await new Promise((resolve, reject) => {
        const scriptArgs = args.action === 'rhythm'
          ? [script, name || 'rhythm', String(args.gaps ?? '1,2,3')]
          : [script, video, name]
        if (args.action === 'pose' && Number.isFinite(Number(args.intensity))) scriptArgs.push('--intensity', String(args.intensity))
        const child = spawn(python, scriptArgs, { env: { ...process.env, DFY_FFMPEG: ffmpeg || process.env.DFY_FFMPEG || '' } })
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (chunk) => { stdout += chunk })
        child.stderr.on('data', (chunk) => { stderr += chunk })
        child.on('error', reject)
        child.on('exit', (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr.slice(-500) || `退出码 ${code}`)))
      })
      const result = JSON.parse(output.trim().split('\n').pop())
      if (args.action === 'rhythm') {
        return { ok: true, ...result, summary: `节奏动作「${result.clip}」：${result.frames} 帧，节奏 ${result.gaps.join(',')}` }
      }
      if (args.action === 'pose') {
        return { ok: true, ...result, summary: `已用骨骼点学会动作「${result.clip}」：${result.frames} 帧（最激烈窗口 ${result.window.join('–')}，强度 ${result.intensity}）` }
      }
      if (args.action === 'scene') {
        return { ok: true, ...result, summary: `已学会出场背景与视角：地平线 ${result.horizon}、主体尺度 ${result.scale}、推镜 ${result.dolly}` }
      }
      return { ok: true, ...result, summary: `已学会动作「${result.clip}」：${result.frames} 帧（采样 ${result.samples} 个运动点）` }
    },
  }
  const registerMotion = (target) => {
    try { target.tools?.register(motionTool); logger.info?.('dsh-dafeiyu: motion 工具已注册') } catch (error) { logger.error?.(`movie 工具挂载失败: ${error?.message ?? error}`) }
  }
  if (typeof ctx.inject === 'function') ctx.inject(['tools'], registerMotion)
  else registerMotion(ctx)
  const permMemory = createPermMemory({ logger })
  try { registerPermMemoryTool(ctx, { memory: permMemory, logger }) } catch (error) { logger.error?.(`矩阵记忆挂载失败: ${error?.message ?? error}`) }
  const skills = createSkillStore({ memory: permMemory, logger })
  try { registerSkillTool(ctx, { skills, logger }) } catch (error) { logger.error?.(`技能库挂载失败: ${error?.message ?? error}`) }
  const selfTool = createSelfTool({ logger })
  try { registerSelfTool(ctx, { selfTool, logger }) } catch (error) { logger.error?.(`复刻工具挂载失败: ${error?.message ?? error}`) }
  const notifier = createNotifier({ webhooks: Array.isArray(config.notifyWebhooks) ? config.notifyWebhooks : [], logger })
  try { registerNotifyTool(ctx, { notifier, logger }) } catch (error) { logger.error?.(`推送工具挂载失败: ${error?.message ?? error}`) }
  try {
    const result = evolution.addXp(10)
    if (result.evolved) logger.info?.(`dsh-dafeiyu 进化：${result.before.name} → ${result.after.name}`)
  } catch {}
  try { registerEvolutionTool(ctx, { evolution, logger }) } catch (error) { logger.error?.(`进化工具挂载失败: ${error?.message ?? error}`) }
  try { registerRoutineTool(ctx, { routine, logger }) } catch (error) { logger.error?.(`作息工具挂载失败: ${error?.message ?? error}`) }
  try { registerEnglishTool(ctx, { english, logger }) } catch (error) { logger.error?.(`英语工具挂载失败: ${error?.message ?? error}`) }
  mount(ctx, {
    ...config,
    novelRootResolved: novelRoot,
    memoryStore: memory,
    policy,
    director,
    meta,
    crt,
    theory,
    chains,
    drive,
    runDirectorWithChain,
    perception,
    dist,
    orderPolicy,
    selfTool,
    permMemory,
    skills,
    goldbach,
    mus,
    routine,
    english,
    evolution,
    emote: (clip) => {
      try { bridge?.send(createMessage(CompanionMessageKind.EMOTE, { clip })) } catch {}
    },
  })
  // 降噪能力随伴侣一起安装：denoise_audio 工具（NPSS 核心，本地 CPU）。
  try {
    registerDenoiseTool(ctx, logger)
  } catch (error) {
    logger.error?.(`dsh-dafeiyu 降噪工具挂载失败: ${error?.message ?? error}`)
  }
  try {
    registerNovelTool(ctx, { logger, root: novelRoot })
  } catch (error) {
    logger.error?.(`dsh-dafeiyu 小说工具挂载失败: ${error?.message ?? error}`)
  }
  try {
    registerBilibiliTool(ctx, { logger })
  } catch (error) {
    logger.error?.(`dsh-dafeiyu B 站工具挂载失败: ${error?.message ?? error}`)
  }
  try {
    registerTeslaTool(ctx, { logger })
  } catch (error) {
    logger.error?.(`dsh-dafeiyu 特斯拉阀工具挂载失败: ${error?.message ?? error}`)
  }
  if (config.memoryEnabled !== false) {
    try {
      registerMemoryTool(ctx, { memory, logger })
    } catch (error) {
      logger.error?.(`dsh-dafeiyu 记忆工具挂载失败: ${error?.message ?? error}`)
    }
  }
}

export {
  CompanionMessageKind,
  CompanionReducer,
  CompanionState,
  HelperProcess,
}
