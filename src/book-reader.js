// 每日读书：从 Kindle 书库增量抽取文本，累加进语料统计。
// 由插件在用户会话里拉起（launchd 读不到 Downloads 下的 venv）。
import { existsSync, statSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const MANIFEST = join(homedir(), '.dsh', 'dfy-books-read.json')
const BOOKS_DIR = '/Volumes/DISK1/书库/kindle，正版的，自己购买'

export function createBookReader({ logger = console, idleSeconds = () => -1 } = {}) {
  const IDLE_NEEDED = 300        // 5 分钟没人操作就算"没事干"
  const MIN_GAP_MINUTES = 20     // 两次读书至少间隔 20 分钟，避免连着读
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

  // 没人用就慢慢长：空闲时跑一小步 idle_worker（对话短句 / 补齐书库），5 分钟最多一次
  let lastWorker = 0
  const KEY_GAP_MINUTES = 5
  const runWorker = () => {
    if (Date.now() - lastWorker < KEY_GAP_MINUTES * 60000) return
    const idle = idleSeconds()
    if (idle < 300) return
    lastWorker = Date.now()
    import('node:child_process').then(({ spawn }) => {
      const py = join(homedir(), 'Downloads/dfy/llm-venv/bin/python')
      const script = join(homedir(), 'Downloads/dfy/local-llm-memory/idle_worker.py')
      if (!existsSync(py) || !existsSync(script)) return
      spawn(py, [script, 'step'], { detached: true, stdio: 'ignore' }).unref()
      logger.info?.('dsh-dafeiyu: 闲着，跑一小步语料增长')
    }).catch(() => {})
  }

  // 没事干就读一本：闲置 ≥5 分钟、且距上次读书 ≥20 分钟
  const maybeRead = () => {
    try { runWorker() } catch {}
    const idle = idleSeconds()
    const gapMinutes = lastRunAgeHours() * 60
    if (idle >= IDLE_NEEDED && gapMinutes >= MIN_GAP_MINUTES) {
      run({ limit: 1 }).catch(() => {})
    }
  }
  const timer = setInterval(maybeRead, 10 * 60 * 1000)
  if (typeof timer.unref === 'function') timer.unref()
  setTimeout(maybeRead, 90000)

  // 读书进度：和后台 longread / 进度卡同一份清单（read 为已完成，failed 为读不了，不计入分母）
  const progress = () => {
    try {
      const man = JSON.parse(readFileSync(MANIFEST, 'utf8'))
      const read = Object.keys(man.read ?? {})
      const failed = Object.keys(man.failed ?? {})
      let files = 0
      try {                                   // 只数文件：目录不算书
        files = readdirSync(BOOKS_DIR).filter((n) => {
          try { return statSync(join(BOOKS_DIR, n)).isFile() } catch { return false }
        }).length
      } catch {}
      const total = Math.max(0, files - failed.length)
      return { done: read.length, total, percent: total ? Number((read.length / total * 100).toFixed(1)) : 0,
               failed: failed.length, files }
    } catch { return { done: 0, total: 0, percent: 0, failed: 0, files: 0 } }
  }

  const status = () => ({ lastRunHoursAgo: Number(lastRunAgeHours().toFixed(1)), manifest: MANIFEST, ...progress() })

  // 语料库：分来源家底 / 片段检索（corpus_store.py）
  const corpus = async (argv) => {
    const { spawn } = await import('node:child_process')
    const python = join(homedir(), 'Downloads/dfy/llm-venv/bin/python')
    const script = join(homedir(), 'Downloads/dfy/local-llm-memory/corpus_store.py')
    if (!existsSync(python) || !existsSync(script)) return '缺少 python 或 corpus_store.py'
    return await new Promise((resolve) => {
      const child = spawn(python, [script, ...argv], { stdio: ['ignore', 'pipe', 'pipe'] })
      let buf = ''
      child.stdout.on('data', (c) => { buf += c })
      child.on('error', () => resolve('语料库读取失败'))
      child.on('exit', () => resolve(buf.trim().split('\n').slice(0, 30).join('\n')))
    })
  }
  return { run, status, corpus }
}

const text = (value) => [{ type: 'text', text: value }]

export function registerBookReaderTool(ctx, { books, logger = console } = {}) {
  const tool = {
    name: 'dfy-read',
    description: '每日读书：从 Kindle 书库增量抽取文本累加进语料统计（也可手动触发）。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'run', 'sources', 'query'] },
        limit: { type: 'number' },
        text: { type: 'string', description: 'query 时检索什么' },
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
      if (args.action === 'sources' || args.action === 'query') {
        const out = await books.corpus(args.action === 'query' ? ['query', String(args.text ?? '').trim()] : ['status'])
        return { ok: true, summary: out || '（语料库还没有输出）' }
      }
      const status = books.status()
      return { ok: true, ...status,
               summary: `读书 ${status.done}/${status.total}（${status.percent}%）｜读不了 ${status.failed} 本｜上次 ${status.lastRunHoursAgo} 小时前` }
    },
  }
  const register = (target) => {
    try { target.tools?.register(tool); logger.info?.('dsh-dafeiyu: dfy-read 工具已注册') } catch (error) { logger.error?.(`注册读书工具失败: ${error?.message ?? error}`) }
  }
  if (typeof ctx.inject === 'function') ctx.inject(['tools'], register)
  else register(ctx)
}
