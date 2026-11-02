// 每日投稿：把英文单词视频传成 B 站合集（原 launchd 任务搬进插件里）
// 现在的分工：
//   - 插件定时器到点自己跑（宿主开着就有效）
//   - launchd 那边也保留一份，脚本自带配额判断，两边撞上也不会重复投稿
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PY = '/Library/Developer/CommandLineTools/usr/bin/python3'
const SCRIPT = join(homedir(), '.dsh', 'bili-english', 'daily.py')
const HOURS = [0, 3, 6, 9, 12, 15, 18, 21]

let lastSlot = ''

export function biliAvailable() {
  return existsSync(SCRIPT) && existsSync(PY)
}

export function runDaily({ args = [], timeoutMs = 30 * 60 * 1000 } = {}) {
  return new Promise((resolve) => {
    if (!biliAvailable()) {
      resolve({ ok: false, output: `找不到 ${SCRIPT} 或 python3` })
      return
    }
    const child = spawn(PY, ['-u', SCRIPT, ...args], { cwd: join(homedir(), '.dsh', 'bili-english') })
    let out = ''
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM') } catch {}
    }, timeoutMs)
    child.stdout.on('data', (d) => { out += String(d) })
    child.stderr.on('data', (d) => { out += String(d) })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, code, output: out.trim() })
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, output: String(error?.message ?? error) })
    })
  })
}

export function status() {
  return runDaily({ args: ['--status'], timeoutMs: 5 * 60 * 1000 })
}

export function upload({ dryRun = false, n = 3 } = {}) {
  // jitter 交给插件这边控制（到点就跑），脚本里设 0
  const args = ['--season-title', '英文合集', '--per-run', String(n), '--quota', '10', '--jitter-min', '0']
  if (dryRun) args.push('--dry-run')
  return runDaily({ args })
}

// 到点触发：每 10 分钟看一次，命中整点窗口且这一格没跑过就上传
export function startBiliDailyScheduler({ logger = console, perRun = 3 } = {}) {
  if (!biliAvailable()) {
    logger.info?.('dsh-dafeiyu: 没找到 bili-english/daily.py，投稿定时器不启动')
    return () => {}
  }
  const tick = async () => {
    const now = new Date()
    const hour = now.getHours()
    const slot = `${now.toDateString()}-${hour}`
    if (!HOURS.includes(hour) || now.getMinutes() > 9 || lastSlot === slot) return
    lastSlot = slot
    const result = await upload({ perRun })
    const tail = result.output.split('\n').slice(-3).join(' / ')
    logger.info?.(`dsh-dafeiyu: 每日投稿 ${hour}:00 → ${result.ok ? '完成' : '失败'}｜${tail}`)
  }
  const timer = setInterval(() => { tick().catch(() => {}) }, 10 * 60 * 1000)
  tick().catch(() => {})
  return () => clearInterval(timer)
}

export function registerBiliDailyTool(ctx, { logger = console } = {}) {
  const tool = {
    name: 'dfy-bili',
    description: '每日投稿：查状态 / 立即上传 / 预演（英文单词视频 → B站「英文合集」）',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'run', 'dry-run'] },
        n: { type: 'number' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' } }, additionalProperties: true } },
    async execute(args) {
      if (args.action === 'status') {
        const r = await status()
        return { ok: r.ok, summary: r.output.split('\n').slice(-6).join('\n') }
      }
      const r = await upload({ dryRun: args.action === 'dry-run', n: Number(args.n) || 3 })
      return { ok: r.ok, summary: r.output.split('\n').slice(-8).join('\n') }
    },
  }
  return ctx.tool(tool)
}
