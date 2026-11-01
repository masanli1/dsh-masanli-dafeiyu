// 单词听力降噪：每天凌晨自动跑一批（断点续跑），也可手动触发。
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(homedir(), 'Downloads/dfy/word-denoise/denoise_words.py')
const MANIFEST = join(homedir(), 'Downloads/dfy/word-denoise/manifest.json')
export const DENOISE_PYTHON = '/Users/ma/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3'

export function createWordDenoiser({ logger = console, limit = 300, workers = 6, hour = 2 } = {}) {
  let lastDay = ''

  const running = () => {
    try {
      const { execFileSync } = require('node:child_process')
      execFileSync('/usr/bin/pgrep', ['-f', 'denoise_words.py'], { stdio: 'pipe' })
      return true
    } catch { return false }
  }

  const run = async (options = {}) => {
    if (running()) return { ok: false, error: '上一批还在跑' }
    const { spawn } = await import('node:child_process')
    if (!existsSync(SCRIPT)) return { ok: false, error: '缺少降噪脚本' }
    const child = spawn(DENOISE_PYTHON, ['-u', SCRIPT, '--limit', String(options.limit ?? limit), '--workers', String(options.workers ?? workers)], { detached: true, stdio: 'ignore' })
    child.unref()
    logger.info?.(`dsh-dafeiyu: 开始降噪一批（${options.limit ?? limit} 个）`)
    return { ok: true, limit: options.limit ?? limit }
  }

  const status = () => {
    try {
      const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
      return {
        done: Object.keys(manifest.done ?? {}).length,
        failed: Object.keys(manifest.failed ?? {}).length,
        running: running(),
        lastDay,
      }
    } catch {
      return { done: 0, failed: 0, running: running(), lastDay }
    }
  }

  // 每天 hour 点后跑一次（10 分钟粒度检查）
  const timer = setInterval(() => {
    const now = new Date()
    const today = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
    if (now.getHours() === hour && lastDay !== today) {
      lastDay = today
      run().catch(() => {})
    }
  }, 10 * 60 * 1000)
  if (typeof timer.unref === 'function') timer.unref()

  return { run, status, isRunning: running }
}

const text = (value) => [{ type: 'text', text: value }]

export function registerWordDenoiseTool(ctx, { denoiser, logger = console } = {}) {
  const tool = {
    name: 'dfy-denoise',
    description: '单词听力降噪：查看进度，或手动跑一批（每天凌晨自动跑一次）。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'run'] },
        limit: { type: 'number' },
        workers: { type: 'number' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' } }, additionalProperties: true }, render: (_a, v) => text(v.summary ?? '') },
    async execute(args) {
      if (args.action === 'run') {
        const result = await denoiser.run({ limit: args.limit, workers: args.workers })
        return { ok: result.ok, ...result, summary: result.ok ? `开始降噪 ${result.limit} 个` : `没开始：${result.error}` }
      }
      const status = denoiser.status()
      return { ok: true, ...status, summary: `已降噪 ${status.done} 个，失败 ${status.failed} 个，${status.running ? '正在跑' : '空闲'}` }
    },
  }
  const register = (target) => {
    try { target.tools?.register(tool); logger.info?.('dsh-dafeiyu: dfy-denoise 工具已注册') } catch (error) { logger.error?.(`注册降噪工具失败: ${error?.message ?? error}`) }
  }
  if (typeof ctx.inject === 'function') ctx.inject(['tools'], register)
  else register(ctx)
}
