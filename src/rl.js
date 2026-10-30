// 强化学习（上下文老虎机）：按"时段 + 你上一条的语气"选择回复风格，
// 用你下一条消息的情绪当奖励，持续更新 Q 值，ε 随时间衰减（先探索后利用）。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const RL_PATH = join(homedir(), '.dsh', 'dsh-dafeiyu-rl.json')

export const ACTIONS = ['tsundere', 'gentle', 'playful', 'brief']
export const STYLE_HINT = {
  tsundere: '这轮用更傲娇的语气：嘴硬、先怼一句再顺着说。',
  gentle: '这轮温柔一点：语气放松、多关心一句。',
  playful: '这轮活泼一点：可以开玩笑、用感叹号。',
  brief: '这轮简短一点：一句话说完。',
}

const POSITIVE = /(可爱|好棒|厉害|喜欢你|真聪明|谢谢|爱你|哈哈|笑死|好玩|有意思)/
const NEGATIVE = /(蠢|笨|傻|呆|无聊|没意思|讨厌|烦|不行|不对|闭嘴)/

export function sentimentOf(text) {
  const value = String(text ?? '')
  if (NEGATIVE.test(value)) return -1
  if (POSITIVE.test(value)) return 1
  return 0
}

const hourBucket = (date = new Date()) => {
  const hour = date.getHours()
  if (hour < 6) return 'night'
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
}

export function createPolicy({ path = RL_PATH, epsilon = 0.25, logger = console } = {}) {
  let data = { q: {}, counts: {}, plays: 0, epsilon }
  try { data = { ...data, ...JSON.parse(readFileSync(path, 'utf8')) } } catch {}

  const save = () => {
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`)
    } catch (error) { logger.warn?.(`dsh-dafeiyu rl: 写入失败: ${error?.message ?? error}`) }
  }

  const keyOf = (context, action) => `${context}|${action}`

  const choose = (context) => {
    data.plays += 1
    const eps = Math.max(0.05, data.epsilon * Math.pow(0.995, data.plays))
    if (Math.random() < eps) return { action: ACTIONS[Math.floor(Math.random() * ACTIONS.length)], explored: true, epsilon: eps }
    let best = ACTIONS[0]
    let bestValue = -Infinity
    for (const action of ACTIONS) {
      const value = data.q[keyOf(context, action)] ?? 0
      if (value > bestValue) { bestValue = value; best = action }
    }
    return { action: best, explored: false, epsilon: eps }
  }

  const update = (context, action, reward) => {
    if (!context || !action) return null
    const key = keyOf(context, action)
    const previous = data.q[key] ?? 0
    data.counts[key] = (data.counts[key] ?? 0) + 1
    // 简单的指数滑动平均
    data.q[key] = Number((previous + 0.3 * (reward - previous)).toFixed(4))
    save()
    return { key, before: previous, after: data.q[key] }
  }

  const status = () => ({
    plays: data.plays,
    epsilon: Number(Math.max(0.05, data.epsilon * Math.pow(0.995, data.plays)).toFixed(3)),
    q: data.q,
    counts: data.counts,
    best: Object.entries(data.q)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([key, value]) => ({ key, value })),
  })

  return { choose, update, status, contextOf: (text, date = new Date()) => `${hourBucket(date)}|${sentimentOf(text) >= 0 ? 'ok' : 'neg'}`, path }
}

const text = (value) => [{ type: 'text', text: value }]

export function registerRlTool(ctx, { policy, logger = console } = {}) {
  const tool = {
    name: 'rl',
    description: '查看强化学习策略：每个（时段+语气）上下文下各回复风格的 Q 值。',
    parameters: { type: 'object', properties: { action: { type: 'string', enum: ['status'] } }, required: ['action'], additionalProperties: false },
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' } }, additionalProperties: true }, render: (_a, v) => text(v.summary ?? '') },
    async execute() {
      const stats = policy.status()
      const lines = stats.best.map((item) => `- ${item.key} → ${item.value}`)
      return {
        ok: true,
        ...stats,
        summary: `已学习 ${stats.plays} 轮，当前探索率 ε=${stats.epsilon}\n` + (lines.length ? lines.join('\n') : '还没有足够数据'),
      }
    },
  }
  const register = (target) => {
    try { target.tools?.register(tool); logger.info?.('dsh-dafeiyu: rl 工具已注册') } catch (error) { logger.error?.(`注册 rl 失败: ${error?.message ?? error}`) }
  }
  if (typeof ctx.inject === 'function') ctx.inject(['tools'], register)
  else register(ctx)
}
