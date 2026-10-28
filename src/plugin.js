import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Schema from '@deepseek-ai/schemastery'
import { CompanionReducer } from './companion-reducer.js'
import { HelperProcess } from './helper-process.js'
import { createSettingsScope } from './settings-scope.js'
import { createChatHandlers, createChatService } from './chat.js'
import { createGreeter } from './greeter.js'
import { createSpeaker } from './speech-v2.js'
import { apply as registerDenoiseTool, createDenoiseTool, findPython, findFfmpeg } from './denoise.js'
import { createDenoiseJobs } from './denoise-jobs.js'
import { createPowerKeeper } from './power.js'
import { createMemoryStore, registerMemoryTool } from './memory.js'
import { createMoodStore } from './mood.js'
import { rememberFacts, extractFacts } from './memory-auto.js'
import { registerTeslaTool, listSkills, TESLA_CLI, VOICE_CLI, VOICES_DIR } from './tesla.js'
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
  voicePreset: Schema.string().default('').description('学来的自定义音色（留空 = 原声）。在「声音复刻」里学会后填音色名'),
  voiceRate: Schema.number().min(100).max(320).step(10).default(180).description('语速（每分钟词数）'),
  voiceVolume: Schema.number().min(0.05).max(1).step(0.05).default(0.9).description('语音音量'),
  greetingEnabled: Schema.boolean().default(true).description('长时间没人理时主动打招呼'),
  greetingAfterMinutes: Schema.number().min(1).max(240).step(1).default(12).description('空闲多少分钟后打招呼'),
  greetingRepeatMinutes: Schema.number().min(5).max(240).step(5).default(25).description('两次打招呼的最小间隔'),
  preventSleep: Schema.boolean().default(true).description('DSH 有任务在跑时阻止电脑空闲休眠（macOS caffeinate）'),
  preventSleepDisplay: Schema.boolean().default(false).description('连屏幕也保持常亮（默认只防系统休眠）'),
  novelRoot: Schema.string().default('').description('小说项目根目录（留空 = ~/Documents/大肥鱼小说）'),
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
  voicePreset: '',
  voiceRate: 180,
  voiceVolume: 0.9,
  greetingEnabled: true,
  greetingAfterMinutes: 12,
  greetingRepeatMinutes: 25,
  preventSleep: true,
  preventSleepDisplay: false,
  novelRoot: '',
  chatMode: 'dedicated',
  memoryEnabled: true,
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
    voicePreset: asString(config.voicePreset, ''),
    voiceRate: Number.isFinite(config.voiceRate) ? config.voiceRate : defaults.voiceRate,
    voiceVolume: Number.isFinite(config.voiceVolume) ? config.voiceVolume : defaults.voiceVolume,
    greetingEnabled: config.greetingEnabled !== false,
    greetingAfterMinutes: Number.isFinite(config.greetingAfterMinutes) ? config.greetingAfterMinutes : defaults.greetingAfterMinutes,
    greetingRepeatMinutes: Number.isFinite(config.greetingRepeatMinutes) ? config.greetingRepeatMinutes : defaults.greetingRepeatMinutes,
    preventSleep: config.preventSleep !== false,
    preventSleepDisplay: config.preventSleepDisplay === true,
    novelRoot: asString(config.novelRoot, ''),
    chatMode: config.chatMode === 'current' ? 'current' : 'dedicated',
    memoryEnabled: config.memoryEnabled !== false,
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
  const settings = createSettingsScope(ctx, Config, config, publicConfig)
  const mood = createMoodStore({ logger })
  mood.tick()
  const moodTimer = setInterval(() => { try { mood.tick() } catch {} }, 5 * 60 * 1000)
  if (typeof moodTimer.unref === 'function') moodTimer.unref()
  const PRAISE = /(可爱|好乖|真棒|厉害|喜欢你|好看|漂亮|聪明|谢谢大肥鱼|辛苦了)/
  const FEED = /(吃饭|喂你|给你吃|零食|喝点)/
  const chat = createChatService({ ctx, logger, config: () => settings.get(), memory: config.memoryStore, mood })
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
  let activeTurns = 0
  const greeter = createGreeter({
    config: () => settings.get(),
    speak: (text, options) => speaker.speak(text, { ...options, preset: asString(settings.get()?.voicePreset, '') }),
    send: (message) => bridge?.send(message),
    isBusy: () => activeTurns > 0,
    logger,
  })

  // 主动行为：不再固定"一天三问"，而是按"多久没聊 + 当前状态"决定要不要冒泡。
  let lastProactive = 0
  const proactiveTimer = setInterval(() => {
    try {
      const snap = mood.tick()
      if (activeTurns > 0) return
      const current = settings.get()
      if (current.enabled === false || current.greetingEnabled === false) return
      if (Date.now() - lastProactive < 3 * 3600 * 1000) return
      const due = (snap.daysSinceChat ?? 0) >= 2 || snap.hunger >= 0.8 || snap.sleepiness >= 0.85
      if (!due) return
      lastProactive = Date.now()
      greeter.greet()
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
  const eventStats = { total: 0, userMessage: 0, lastType: '', lastError: '' }
  const offEvent = eventCtx.on('session/event', (session, event) => {
    eventStats.total += 1
    eventStats.lastType = event?.type ?? ''
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
        if (PRAISE.test(text)) mood.poke('praise')
        else if (FEED.test(text)) mood.poke('feed')
        if (config.memoryStore && text) {
          const result = rememberFacts(config.memoryStore, text)
          if (result.added.length) logger.info?.(`dsh-dafeiyu 自动记忆: ${result.added.map((f) => f.key + '=' + f.value).join('、')}`)
        }
      } catch {}
    }
    if (event?.type === 'turn/start') { activeTurns += 1; syncPower() }
    if (event?.type === 'turn/end') { activeTurns = Math.max(0, activeTurns - 1); syncPower() }
    if (event?.type !== 'turn/end') greeter.noteActivity()
    if (!bridge || !reducer) return
    try {
      for (const message of reducer.handle(session, event)) {
        bridge.send(message)
        if (message.kind === 'state' && message.state === 'SUCCESS') greeter.announce('success')
        if (message.kind === 'state' && message.state === 'ERROR') greeter.announce('error')
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
              jsonResponse(res, 200, mood.poke(action === 'feed' ? 'feed' : action === 'play' ? 'play' : action === 'praise' ? 'praise' : 'seen'))
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
              const started = speaker.speak(String(body.text ?? '大肥鱼现在用的是这个音色，你听听看。'), {
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
  mount(ctx, { ...config, novelRootResolved: novelRoot, memoryStore: memory })
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
