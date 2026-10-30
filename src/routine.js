// 作息记录：按小时累计"你在干活/聊天"的时间，形成日常作息画像。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const ROUTINE_PATH = join(homedir(), '.dsh', 'dsh-dafeiyu-routine.json')

const dayKey = (date = new Date()) => date.toISOString().slice(0, 10)

export function createRoutineStore({ path = ROUTINE_PATH, now = () => new Date(), logger = console } = {}) {
  let data = { days: {} }
  try { data = JSON.parse(readFileSync(path, 'utf8')) } catch {}

  const save = () => {
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`)
    } catch (error) {
      logger.warn?.(`dsh-dafeiyu routine: 写入失败: ${error?.message ?? error}`)
    }
  }

  // 每 5 分钟最多记一次，避免刷数据
  let lastMark = 0
  const record = (kind = 'active') => {
    const current = now()
    if (current.getTime() - lastMark < 5 * 60 * 1000) return
    lastMark = current.getTime()
    const day = dayKey(current)
    const hour = current.getHours()
    const bucket = (data.days[day] ??= { hours: {}, kinds: {} })
    bucket.hours[hour] = (bucket.hours[hour] ?? 0) + 5
    bucket.kinds[kind] = (bucket.kinds[kind] ?? 0) + 5
    save()
  }

  const summary = () => {
    const days = Object.keys(data.days).sort().slice(-14)
    const hourTotals = new Array(24).fill(0)
    let activeMinutes = 0
    let firstHour = null
    let lastHour = null
    for (const day of days) {
      const bucket = data.days[day]
      for (const [hour, minutes] of Object.entries(bucket.hours ?? {})) {
        const h = Number(hour)
        hourTotals[h] += minutes
        activeMinutes += minutes
        if (firstHour == null || h < firstHour) firstHour = h
        if (lastHour == null || h > lastHour) lastHour = h
      }
    }
    const busiest = hourTotals
      .map((minutes, hour) => ({ hour, minutes }))
      .filter((entry) => entry.minutes > 0)
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 3)
    return { days: days.length, activeHours: Number((activeMinutes / 60).toFixed(1)), firstHour, lastHour, busiest, hourTotals }
  }

  const advice = () => {
    const stats = summary()
    const tips = []
    if (stats.lastHour != null && stats.lastHour >= 23) tips.push(`你最近常在 ${stats.lastHour} 点后还在忙，早点休息吧`)
    if (stats.firstHour != null && stats.firstHour <= 7) tips.push('你起得挺早，注意吃早饭')
    if (stats.activeHours >= 8) tips.push('今天累计活跃超过 8 小时了，起来动一动')
    if (tips.length === 0) tips.push('作息还算规律，保持住')
    return tips
  }

  return { record, summary, advice, path, data }
}

const text = (value) => [{ type: 'text', text: value }]

export function registerRoutineTool(ctx, { routine, logger = console } = {}) {
  const tool = {
    name: 'routine',
    description: '记录并查看日常作息：action=summary 看最近两周的活跃时段，action=advice 给作息建议。',
    parameters: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['summary', 'advice'] } },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' } }, additionalProperties: true }, render: (_a, v) => text(v.summary ?? '') },
    async execute(args) {
      if (args.action === 'advice') {
        const tips = routine.advice()
        return { ok: true, tips, summary: tips.join('\n') }
      }
      const stats = routine.summary()
      const hours = stats.busiest.map((entry) => `${entry.hour}:00 前后（${Math.round(entry.minutes / 60 * 10) / 10} 小时）`).join('、')
      return {
        ok: true,
        stats,
        summary: `最近 ${stats.days} 天累计活跃 ${stats.activeHours} 小时；最常活跃：${hours || '还没有足够数据'}；`
          + (stats.firstHour != null ? `最早 ${stats.firstHour} 点、最晚 ${stats.lastHour} 点。` : ''),
      }
    },
  }
  const register = (target) => {
    try { target.tools?.register(tool); logger.info?.('dsh-dafeiyu: routine 工具已注册') } catch (error) { logger.error?.(`注册 routine 失败: ${error?.message ?? error}`) }
  }
  if (typeof ctx.inject === 'function') ctx.inject(['tools'], register)
  else register(ctx)
}
