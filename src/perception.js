// 主动感知：知道你在用什么应用、剪贴板有没有东西、多久没动。
// 只取"元信息"（应用名、剪贴板长度/哈希），不读内容；内容需要显式开启。
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promisify } from 'node:util'

const run = promisify(execFile)

async function frontmostApp() {
  try {
    const { stdout } = await run('/usr/bin/osascript', ['-e', 'tell application "System Events" to get name of first application process whose frontmost is true'], { timeout: 3000 })
    return stdout.trim()
  } catch { return '' }
}

async function clipboardInfo(includeContent = false) {
  try {
    const { stdout } = await run('/usr/bin/pbpaste', [], { timeout: 3000, maxBuffer: 1024 * 1024 })
    const text = String(stdout ?? '')
    return {
      length: text.length,
      hash: text ? createHash('sha1').update(text).digest('hex').slice(0, 12) : '',
      preview: includeContent ? text.slice(0, 120) : '',
    }
  } catch { return { length: 0, hash: '', preview: '' } }
}

async function idleSeconds() {
  try {
    const { stdout } = await run('/usr/bin/ioreg', ['-c', 'IOHIDSystem'], { timeout: 3000 })
    const match = /"HIDIdleTime"\s*=\s*(\d+)/.exec(stdout)
    return match ? Math.round(Number(match[1]) / 1e9) : -1
  } catch { return -1 }
}

export function createPerception({ logger = console, intervalMs = 30000, historyLimit = 120 } = {}) {
  let history = []
  let timer = null
  let last = null

  const sample = async (options = {}) => {
    const [app, clipboard, idle] = await Promise.all([
      frontmostApp(),
      clipboardInfo(options.includeClipboard === true),
      idleSeconds(),
    ])
    const entry = { at: Date.now(), app, clipboard, idleSeconds: idle }
    last = entry
    history = [...history, entry].slice(-historyLimit)
    return entry
  }

  const start = (options = {}) => {
    if (timer) return
    sample(options).catch(() => {})
    timer = setInterval(() => sample(options).catch(() => {}), intervalMs)
    if (typeof timer.unref === 'function') timer.unref()
  }

  const stop = () => { clearInterval(timer); timer = null }

  const recent = (limit = 8) => history.slice(-limit)

  // 给聊天用的上下文摘要：最近在用什么应用、多久没动
  const summary = () => {
    if (!last) return ''
    const apps = [...new Set(history.slice(-10).map((entry) => entry.app).filter(Boolean))]
    const idle = last.idleSeconds >= 0 ? `${Math.round(last.idleSeconds / 60)} 分钟没动` : ''
    const clip = last.clipboard.length ? `剪贴板有 ${last.clipboard.length} 字` : '剪贴板空'
    return [`前台应用：${last.app || '未知'}`, apps.length > 1 ? `最近用过：${apps.join('、')}` : '', clip, idle].filter(Boolean).join('；')
  }

  const stats = () => ({ samples: history.length, last, topApps: [...new Set(history.map((entry) => entry.app).filter(Boolean))].slice(0, 6) })

  return { sample, start, stop, recent, summary, stats }
}

const text = (value) => [{ type: 'text', text: value }]

export function registerPerceptionTool(ctx, { perception, logger = console } = {}) {
  const tool = {
    name: 'perception',
    description: '主动感知：当前前台应用、剪贴板状态、多久没操作（只读元信息）。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['now', 'recent', 'stats', 'start', 'stop'] },
        includeClipboard: { type: 'boolean', description: '是否包含剪贴板内容（默认只给长度/哈希）' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' } }, additionalProperties: true }, render: (_a, v) => text(v.summary ?? '') },
    async execute(args) {
      if (args.action === 'start') { perception.start({ includeClipboard: args.includeClipboard }); return { ok: true, summary: '已开始感知' } }
      if (args.action === 'stop') { perception.stop(); return { ok: true, summary: '已停止感知' } }
      if (args.action === 'recent') {
        const items = perception.recent()
        return { ok: true, items, summary: items.map((item) => `${new Date(item.at).toLocaleTimeString('zh-CN')} ${item.app}`).join('\n') || '还没有采样' }
      }
      if (args.action === 'stats') {
        const stats = perception.stats()
        return { ok: true, ...stats, summary: `采样 ${stats.samples} 次；最近应用：${stats.topApps.join('、') || '无'}` }
      }
      const entry = await perception.sample({ includeClipboard: args.includeClipboard })
      return { ok: true, entry, summary: perception.summary() }
    },
  }
  const register = (target) => {
    try { target.tools?.register(tool); logger.info?.('dsh-dafeiyu: perception 工具已注册') } catch (error) { logger.error?.(`注册 perception 失败: ${error?.message ?? error}`) }
  }
  if (typeof ctx.inject === 'function') ctx.inject(['tools'], register)
  else register(ctx)
}
