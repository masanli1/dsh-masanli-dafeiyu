// 每日读书：从 Kindle 书库增量抽取文本，累加进语料统计。
// 由插件在用户会话里拉起（launchd 读不到 Downloads 下的 venv）。
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const MANIFEST = join(homedir(), '.dsh', 'dfy-books-read.json')

export function createBookReader({ logger = console } = {}) {
  let child = null
  let lastRun = 0

  const lastRunAgeHours = () => {
    try { return (Date.now() - statSync(MANIFEST).mtimeMs) / 3600000 } catch { return 999 }
  }

  const run = async ({ limit = 3 } = {}) => {
    const { spawn } = await import('node:child_process')
    const python = join(homedir(), 'Downloads/dfy/llm-venv/bin/python')
    const script = join(homedir(), 'Downloads/dfy/local-llm-memory/read_books.py')
    if (!existsSync(python) || !existsSync(script)) return { ok: false, error: '缺少 python 或脚本' }
    child = spawn(python, ['-u', script, '--limit', String(limit)], { detached: true, stdio: 'ignore' })
    child.unref()
    lastRun = Date.now()
    logger.info?.(`dsh-dafeiyu: 开始读书（${limit} 本）`)
    return { ok: true, limit }
  }

  // 每 6 小时检查一次：超过 20 小时没读就自动读 3 本
  const timer = setInterval(() => {
    if (lastRunAgeHours() > 20) run({ limit: 3 }).catch(() => {})
  }, 6 * 3600 * 1000)
  if (typeof timer.unref === 'function') timer.unref()
  setTimeout(() => { if (lastRunAgeHours() > 20) run({ limit: 3 }).catch(() => {}) }, 60000)

  const status = () => ({ lastRunHoursAgo: Number(lastRunAgeHours().toFixed(1)), manifest: MANIFEST })
  return { run, status }
}

const text = (value) => [{ type: 'text', text: value }]

export function registerBookReaderTool(ctx, { books, logger = console } = {}) {
  const tool = {
    name: 'dfy-read',
    description: '每日读书：从 Kindle 书库增量抽取文本累加进语料统计（也可手动触发）。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'run'] },
        limit: { type: 'number' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' } }, additionalProperties: true }, render: (_a, v) => text(v.summary ?? '') },
    async execute(args) {
      if (args.action === 'run') {
        const result = await books.run({ limit: args.limit ?? 3 })
        return { ok: true, ...result, summary: result.ok ? `开始读 ${result.limit} 本书` : `失败：${result.error}` }
      }
      const status = books.status()
      return { ok: true, ...status, summary: `上次读书：${status.lastRunHoursAgo} 小时前` }
    },
  }
  const register = (target) => {
    try { target.tools?.register(tool); logger.info?.('dsh-dafeiyu: dfy-read 工具已注册') } catch (error) { logger.error?.(`注册读书工具失败: ${error?.message ?? error}`) }
  }
  if (typeof ctx.inject === 'function') ctx.inject(['tools'], register)
  else register(ctx)
}
