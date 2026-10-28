// Chat bridge: lets the in-page companion panel talk to a real DSH session.
// Everything stays local: the browser calls these exact-path endpoints through
// the Host's loopback web server, and the Host forwards the message to the
// session controller (the same service the WebUI itself uses).
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { isLocalRequest, jsonResponse } from './local-http.js'

const MAX_MESSAGES = 60
const MAX_SESSIONS = 12
const MAX_TEXT = 4000
const MAX_BODY = 16 * 1024

function textOfContent(content) {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  const pieces = []
  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    if (typeof part.text === 'string' && (part.type === undefined || part.type === 'text')) pieces.push(part.text)
    else if (part.type === 'image') pieces.push('[图片]')
  }
  return pieces.join('').trim()
}

function baseName(path) {
  const parts = String(path ?? '').split(/[\\/]/u).filter(Boolean)
  return parts.at(-1) ?? ''
}

async function readJsonBody(req) {
  const chunks = []
  let bytes = 0
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > MAX_BODY) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求体必须是 JSON 对象')
  return value
}

export function messagesFromEvents(events) {
  const messages = []
  for (const event of events ?? []) {
    if (!event || typeof event.type !== 'string') continue
    if (event.type === 'user/message') {
      const source = event.data?.source
      // Skip system/subagent-authored user messages; only the human's own turn
      // belongs in the chat transcript.
      if (source && typeof source.kind === 'string' && source.kind !== 'user') continue
      const text = textOfContent(event.data?.content)
      if (text) messages.push({ role: 'user', text, at: Number(event.at ?? event.seq ?? 0) })
    } else if (event.type === 'assistant/message') {
      const text = textOfContent(event.data?.message?.content)
      if (text) messages.push({ role: 'assistant', text, at: Number(event.at ?? event.seq ?? 0) })
    }
  }
  return messages.slice(-MAX_MESSAGES)
}

const CHAT_STORE = join(homedir(), '.dsh', 'dsh-dafeiyu-chat.json')
// 宠物聊天单独放一个工作区目录：侧边栏会因此多出一条「大肥鱼聊天」分组，
// 和工作会话彻底分开，不会互相挤位置。
export const PET_WORKSPACE = join(homedir(), 'Documents', '大肥鱼聊天')

import { rememberFacts } from './memory-auto.js'

export function createChatService({ ctx, logger = console, config = () => ({}), storePath = CHAT_STORE, memory, mood } = {}) {
  const sessions = new Map()
  let targetId
  let manualTarget = ''
  let dedicatedId = ''

  const readStore = () => {
    try { return JSON.parse(readFileSync(storePath, 'utf8')) } catch { return {} }
  }
  const writeStore = (patch) => {
    try {
      mkdirSync(dirname(storePath), { recursive: true })
      writeFileSync(storePath, `${JSON.stringify({ ...readStore(), ...patch }, null, 2)}\n`)
    } catch {
      // 持久化失败不影响使用
    }
  }

  // 宠物会话必须沿用当前会话的模型选择：新建会话如果落到 "deepseek-official"
  // 这类需要 API Key 的路由，会直接报 MISSING_CREDENTIAL。
  const adoptModel = async (sessionId) => {
    try {
      const controller = ctx.get?.('sessionController')
      const query = ctx.get?.('sessionQuery')
      if (!controller?.selectModel) return
      let selection
      const candidates = [targetId, ...sessions.keys()].filter(Boolean)
      for (const id of candidates) {
        try {
          const observation = await query?.observeSession(id)
          selection = observation?.projections?.values?.modelSelection?.next
          try { observation?.[Symbol.dispose]?.() } catch {}
          if (selection?.provider && selection?.model) break
        } catch {
          // 忽略单个会话的读取失败
        }
      }
      const catalog = await controller.modelCatalog?.()
      const groups = catalog?.groups ?? []
      const providers = new Set(groups.map((group) => group.id))
      // catalog.default 可能指向需要 API Key 的 “official” 路由；这种情况下退回到
      // 有凭据的分组（通常是 deepseek-account / 已登录账户）。
      if (!selection?.provider || !providers.has(selection.provider)) {
        const preferred = groups.find((group) => /account/i.test(group.id)) ?? groups[0]
        const model = preferred?.models?.find((item) => item.id === selection?.model)?.id
          ?? preferred?.models?.[0]?.id
        if (preferred && model) selection = { provider: preferred.id, model }
      }
      if (!selection?.provider || !selection?.model) return
      await controller.selectModel({ sessionId, provider: selection.provider, model: selection.model })
      logger.info?.(`dsh-dafeiyu chat: 宠物会话模型 = ${selection.provider}/${selection.model}`)
    } catch (error) {
      logger.warn?.(`dsh-dafeiyu chat: 同步模型选择失败: ${error?.message ?? error}`)
    }
  }

  // 宠物专属会话：第一次聊天时新建，之后一直复用，上下文自然累积。
  const resolveDedicated = async () => {
    if (dedicatedId) return dedicatedId
    const query = ctx.get?.('sessionQuery')
    const controller = ctx.get?.('sessionController')
    const stored = String(readStore().dedicatedSessionId ?? '')
    if (stored && query?.observeSession) {
      try {
        const observation = await query.observeSession(stored)
        try { observation?.[Symbol.dispose]?.() } catch {}
        dedicatedId = stored
        try { await ctx.get?.('sessionController')?.rename?.({ sessionId: stored, title: '和大肥鱼聊天' }) } catch {}
        await adoptModel(dedicatedId)
        return dedicatedId
      } catch {
        // 旧会话被删了就重建
      }
    }
    if (!controller?.create) return ''
    try { mkdirSync(PET_WORKSPACE, { recursive: true }) } catch {}
    const created = await controller.create({ cwd: PET_WORKSPACE })
    dedicatedId = String(created?.sessionId ?? '')
    if (dedicatedId) {
      try { await controller.rename?.({ sessionId: dedicatedId, title: '和大肥鱼聊天' }) } catch {}
      await adoptModel(dedicatedId)
      writeStore({ dedicatedSessionId: dedicatedId })
    }
    return dedicatedId
  }

  const mode = () => {
    try { return String(config()?.chatMode ?? 'current') } catch { return 'current' }
  }

  const targetForUse = async () => {
    if (manualTarget) return manualTarget
    if (mode() === 'dedicated') return resolveDedicated()
    return targetId
  }

  const titleOf = (session) => {
    const header = session?.header ?? {}
    const title = String(header.title ?? header.name ?? '').trim()
    if (title) return title
    const cwd = baseName(header.cwd)
    return cwd || ''
  }

  const prune = () => {
    if (sessions.size <= 50) return
    const ordered = [...sessions.values()].sort((left, right) => left.at - right.at)
    for (const record of ordered.slice(0, sessions.size - 50)) sessions.delete(record.id)
  }

  const note = (session, event) => {
    try {
      const id = String(session?.header?.id ?? session?.id ?? '')
      if (!id) return
      const previous = sessions.get(id) ?? { id, title: '', at: 0, busy: false }
      const next = { ...previous, at: Date.now() }
      const title = titleOf(session)
      if (title) next.title = title
      if (event?.type === 'turn/start') {
        next.busy = true
        // The session the human is typing into becomes the chat target.
        targetId = id
      }
      if (event?.type === 'turn/end') next.busy = false
      if (event?.type === 'session/title' && event.data?.title) next.title = String(event.data.title)
      sessions.set(id, next)
      if (!targetId) targetId = id
      prune()
    } catch (error) {
      logger.warn?.(`dsh-dafeiyu chat: 记录会话事件失败: ${error?.message ?? error}`)
    }
  }

  // A plugin reload forgets which session was active, so the panel offers the
  // recent sessions instead of guessing: a wrong guess would post the message
  // into somebody else's conversation.
  // When exactly one session is live (the one open on screen), use it. With
  // several live sessions the panel asks instead of guessing.
  const soleLiveSession = async () => {
    const query = ctx.get?.('sessionQuery')
    if (!query?.listSessions) return undefined
    try {
      const records = await query.listSessions()
      const live = (records ?? []).filter((record) => record?.live === true && record?.header?.origin !== 'subagent')
      return live.length === 1 ? String(live[0].header.id) : undefined
    } catch {
      return undefined
    }
  }

  const recentSessions = async () => {
    const merged = new Map()
    for (const record of sessions.values()) {
      merged.set(record.id, { id: record.id, title: record.title || record.id.slice(0, 8), busy: record.busy === true, at: record.at })
    }
    const query = ctx.get?.('sessionQuery')
    if (query?.listSessions) {
      try {
        const records = await query.listSessions()
        for (const record of records ?? []) {
          const header = record?.header
          if (!header?.id || header.origin === 'subagent' || merged.has(String(header.id))) continue
          merged.set(String(header.id), {
            id: String(header.id),
            title: String(header.title ?? header.name ?? '').trim() || baseName(header.cwd) || String(header.id).slice(0, 8),
            busy: false,
            at: 0,
          })
        }
      } catch (error) {
        logger.warn?.(`dsh-dafeiyu chat: 列出会话失败: ${error?.message ?? error}`)
      }
    }
    return [...merged.values()]
      .sort((left, right) => right.at - left.at)
      .slice(0, MAX_SESSIONS)
      .map(({ id, title, busy }) => ({ id, title, busy }))
  }

  const state = async () => {
    const id = await targetForUse()
    const list = await recentSessions()
    if (!id) {
      return { sessionId: null, title: '', busy: false, sessions: list, messages: [] }
    }
    const record = sessions.get(id)
    const fallbackTitle = record?.title || id.slice(0, 8)
    const query = ctx.get?.('sessionQuery')
    if (!query?.observeSession) {
      return { sessionId: id, title: fallbackTitle, busy: record?.busy === true, sessions: list, messages: [], error: '当前 Host 没有提供会话读取服务' }
    }
    let observation
    try {
      observation = await query.observeSession(id)
      const title = String(observation?.header?.title ?? observation?.header?.name ?? '').trim() || fallbackTitle
      return {
        sessionId: id,
        title,
        busy: record?.busy === true,
        sessions: list,
        messages: messagesFromEvents(observation?.events),
      }
    } catch (error) {
      return { sessionId: id, title: fallbackTitle, busy: record?.busy === true, sessions: list, messages: [], error: error?.message ?? String(error) }
    } finally {
      try {
        observation?.[Symbol.dispose]?.()
      } catch {
        // lease already released
      }
    }
  }

  // 当前工作会话的最近几条消息：只取非宠物会话，压缩成一段背景。
  const workSummary = async (excludeIds) => {
    const query = ctx.get?.('sessionQuery')
    if (!query?.observeSession) return ''
    const candidates = [...sessions.values()]
      .filter((record) => !excludeIds.includes(record.id))
      .sort((a, b) => b.at - a.at)
      .slice(0, 3)
    for (const record of candidates) {
      try {
        const observation = await query.observeSession(record.id)
        const messages = messagesFromEvents(observation?.events).slice(-6)
        const header = observation?.header ?? {}
        const title = String(header.title ?? header.name ?? '').trim() || baseName(header.cwd) || record.id.slice(0, 8)
        try { observation?.[Symbol.dispose]?.() } catch {}
        if (messages.length === 0) continue
        const body = messages.map((message) => `${message.role === 'user' ? '用户' : '助手'}：${message.text.replace(/\s+/g, ' ').slice(0, 140)}`).join('\n')
        return `当前工作会话「${title}」最近：\n${body}`.slice(0, 1200)
      } catch {
        // 换下一个会话
      }
    }
    return ''
  }

  const buildContext = async () => {
    try {
      if (config()?.contextInjection === false) return ''
      const parts = []
      const remembered = memory?.summary?.()
      if (remembered) parts.push(`长期记忆：\n${remembered}`)
      // 只排除宠物会话本身；targetId 可能是某个工作会话（turn/start 时更新），不能一起排除。
      const petId = manualTarget || dedicatedId
      const work = await workSummary([petId].filter(Boolean))
      if (work) parts.push(work)
      if (parts.length === 0) return ''
      return `<dfy-context>\n${parts.join('\n\n').slice(0, 1800)}\n</dfy-context>\n`
    } catch (error) {
      logger.warn?.(`dsh-dafeiyu chat: 生成上下文失败: ${error?.message ?? error}`)
      return ''
    }
  }

  const send = async (text) => {
    const value = typeof text === 'string' ? text.trim() : ''
    if (!value) throw new Error('消息不能为空')
    const id = await targetForUse()
    if (!id) throw new Error('先在面板顶部选一个会话，再发送')
    // 面板发出的消息直接在这里落状态：这样不依赖 session/event 总线是否转发 user/message。
    try {
      mood?.poke?.('chat')
      if (/(可爱|好乖|真棒|厉害|喜欢你|好看|漂亮|聪明)/.test(value)) mood?.poke?.('praise')
      else if (/(吃饭|喂你|给你吃|零食)/.test(value)) mood?.poke?.('feed')
    } catch {}
    try {
      if (memory) {
        const result = rememberFacts(memory, value)
        if (result.added.length) logger.info?.(`dsh-dafeiyu 自动记忆: ${result.added.map((f) => f.key + '=' + f.value).join('、')}`)
      }
    } catch {}
    const context = await buildContext()
    const controller = ctx.get?.('sessionController')
    if (!controller?.prompt) throw new Error('当前 Host 没有提供会话写入服务')
    // The controller starts with `signal.throwIfAborted()`, so the cancellation
    // argument is not optional. One controller per message, never aborted:
    // admission is fast and the durable queue takes over immediately after.
    const admission = new AbortController()
    const receipt = await controller.prompt({
      sessionId: id,
      requestId: randomUUID(),
      mode: 'queue',
      content: [{ type: 'text', text: (context + value).slice(0, MAX_TEXT + 2000) }],
      clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }, admission.signal)
    if (receipt?.accepted !== true) throw new Error('会话没有接受这条消息')
    return { accepted: true, sessionId: id }
  }

  const select = async (sessionId) => {
    const id = String(sessionId ?? '').trim()
    if (!id) throw new Error('缺少 sessionId')
    const query = ctx.get?.('sessionQuery')
    if (!query?.observeSession) throw new Error('当前 Host 没有提供会话读取服务')
    const observation = await query.observeSession(id)
    try {
      if (String(observation?.header?.id ?? '') !== id) throw new Error('找不到该会话')
      if (observation?.header?.origin === 'subagent') throw new Error('不能直接和子 Agent 会话聊天')
    } finally {
      try {
        observation?.[Symbol.dispose]?.()
      } catch {
        // ignored
      }
    }
    const previous = sessions.get(id) ?? { id, title: '', at: 0, busy: false }
    sessions.set(id, { ...previous, at: Date.now() })
    manualTarget = id
    targetId = id
    return { sessionId: id }
  }

  const debug = () => ({
    targetId, dedicatedId, manualTarget,
    sessions: [...sessions.values()].map((record) => ({ id: record.id, title: record.title, at: record.at })),
  })

  return { note, state, send, select, buildContext, debug }
}

export const CHAT_SERVER_VERSION = 'v5'

export function createChatHandlers(chat, logger = console) {
  const guard = (req, res, methods) => {
    if (!isLocalRequest(req)) {
      jsonResponse(res, 403, { error: 'local access only' })
      return false
    }
    if (!methods.includes(req.method)) {
      jsonResponse(res, 405, { error: 'method not allowed' })
      return false
    }
    return true
  }
  const queryOf = (req) => new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
  // The desktop renderer routes POST through its own fetch proxy, which can
  // reject plugin calls before they leave the page. A local GET with the same
  // payload is the fallback path, so both methods are accepted here.
  const payloadOf = async (req, key) => {
    if (req.method === 'GET') return queryOf(req).get(key) ?? ''
    const body = await readJsonBody(req)
    return body[key]
  }
  const fail = (res, error) => {
    logger.warn?.(`dsh-dafeiyu chat: ${error?.message ?? error}`)
    jsonResponse(res, 400, { error: error instanceof Error ? error.message : String(error) })
  }
  return {
    async state(req, res) {
      if (!guard(req, res, ['GET'])) return
      try {
        jsonResponse(res, 200, { ...(await chat.state()), serverVersion: CHAT_SERVER_VERSION })
      } catch (error) {
        fail(res, error)
      }
    },
    async send(req, res) {
      if (!guard(req, res, ['POST', 'GET'])) return
      try {
        jsonResponse(res, 200, await chat.send(await payloadOf(req, 'text')))
      } catch (error) {
        fail(res, error)
      }
    },
    async target(req, res) {
      if (!guard(req, res, ['POST', 'GET'])) return
      try {
        jsonResponse(res, 200, await chat.select(await payloadOf(req, 'sessionId')))
      } catch (error) {
        fail(res, error)
      }
    },
  }
}
