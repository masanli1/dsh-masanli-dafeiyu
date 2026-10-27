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
import { createSpeaker } from './speech.js'
import { apply as registerDenoiseTool, createDenoiseTool } from './denoise.js'
import { createDenoiseJobs } from './denoise-jobs.js'
import { createPowerKeeper } from './power.js'
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
  voiceRate: Schema.number().min(100).max(320).step(10).default(180).description('语速（每分钟词数）'),
  voiceVolume: Schema.number().min(0.05).max(1).step(0.05).default(0.9).description('语音音量'),
  greetingEnabled: Schema.boolean().default(true).description('长时间没人理时主动打招呼'),
  greetingAfterMinutes: Schema.number().min(1).max(240).step(1).default(12).description('空闲多少分钟后打招呼'),
  greetingRepeatMinutes: Schema.number().min(5).max(240).step(5).default(25).description('两次打招呼的最小间隔'),
  preventSleep: Schema.boolean().default(true).description('DSH 有任务在跑时阻止电脑空闲休眠（macOS caffeinate）'),
  preventSleepDisplay: Schema.boolean().default(false).description('连屏幕也保持常亮（默认只防系统休眠）'),
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
  voiceRate: 180,
  voiceVolume: 0.9,
  greetingEnabled: true,
  greetingAfterMinutes: 12,
  greetingRepeatMinutes: 25,
  preventSleep: true,
  preventSleepDisplay: false,
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
    voiceRate: Number.isFinite(config.voiceRate) ? config.voiceRate : defaults.voiceRate,
    voiceVolume: Number.isFinite(config.voiceVolume) ? config.voiceVolume : defaults.voiceVolume,
    greetingEnabled: config.greetingEnabled !== false,
    greetingAfterMinutes: Number.isFinite(config.greetingAfterMinutes) ? config.greetingAfterMinutes : defaults.greetingAfterMinutes,
    greetingRepeatMinutes: Number.isFinite(config.greetingRepeatMinutes) ? config.greetingRepeatMinutes : defaults.greetingRepeatMinutes,
    preventSleep: config.preventSleep !== false,
    preventSleepDisplay: config.preventSleepDisplay === true,
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
  const chat = createChatService({ ctx, logger })
  const chatHandlers = createChatHandlers(chat, logger)
  const speaker = createSpeaker({ logger })
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
  const denoiseJobs = createDenoiseJobs({
    tool: createDenoiseTool({ logger }),
    logger,
    onJobStart: () => { denoiseBusy += 1; syncPower() },
    onJobEnd: () => { denoiseBusy = Math.max(0, denoiseBusy - 1); syncPower() },
  })
  let activeTurns = 0
  const greeter = createGreeter({
    config: () => settings.get(),
    speak: (text, options) => speaker.speak(text, options),
    send: (message) => bridge?.send(message),
    isBusy: () => activeTurns > 0,
    logger,
  })

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
  const offEvent = eventCtx.on('session/event', (session, event) => {
    chat.note(session, event)
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
  // Settings is already a declared dependency. Keep observers on this fiber
  // so Loader's fiber-scoped volatile updates reach them.
  mount(ctx, config)
  // 降噪能力随伴侣一起安装：denoise_audio 工具（NPSS 核心，本地 CPU）。
  try {
    registerDenoiseTool(ctx, ctx.logger ?? console)
  } catch (error) {
    (ctx.logger ?? console).error?.(`dsh-dafeiyu 降噪工具挂载失败: ${error?.message ?? error}`)
  }
}

export {
  CompanionMessageKind,
  CompanionReducer,
  CompanionState,
  HelperProcess,
}
