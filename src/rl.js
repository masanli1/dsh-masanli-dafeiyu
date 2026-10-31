// 强化学习（上下文老虎机）：按"时段 + 你上一条的语气"选择回复风格，
// 用你下一条消息的情绪当奖励，持续更新 Q 值，ε 随时间衰减（先探索后利用）。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const RL_PATH = join(homedir(), '.dsh', 'dsh-dafeiyu-rl.json')

export const ACTIONS = ['tsundere', 'gentle', 'playful', 'brief', 'teasing', 'caring', 'curious', 'deadpan']
export const STYLE_HINT = {
  tsundere: '这轮用更傲娇的语气：嘴硬、先怼一句再顺着说。',
  gentle: '这轮温柔一点：语气放松、多关心一句。',
  playful: '这轮活泼一点：可以开玩笑、用感叹号。',
  brief: '这轮简短一点：一句话说完。',
  teasing: '这轮用调侃的语气：可以损他一句，但要笑着损。',
  caring: '这轮关心他：问一句他累不累、要不要歇会儿。',
  curious: '这轮多问一点：对他刚说的事表现出兴趣，追问一个细节。',
  deadpan: '这轮冷淡一点：少用语气词，平静地回。',
}

const POSITIVE = /(可爱|好棒|厉害|喜欢你|真聪明|谢谢|爱你|哈哈|笑死|好玩|有意思|不错|可以)/
const NEGATIVE = /(蠢|笨|傻|呆|无聊|没意思|讨厌|烦|不行|不对|闭嘴|算了)/

// 三档情绪：-1 负 / 0 中性 / +1 正
export function sentimentOf(text) {
  const value = String(text ?? '')
  if (NEGATIVE.test(value)) return -1
  if (POSITIVE.test(value)) return 1
  return 0
}

const sentimentBucket = (value) => (value > 0 ? 'pos' : value < 0 ? 'neg' : 'neu')
const dayBucket = (date = new Date()) => (date.getDay() === 0 || date.getDay() === 6 ? 'weekend' : 'workday')

const hourBucket = (date = new Date()) => {
  const hour = date.getHours()
  if (hour < 6) return 'night'
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
}

export function createPolicy({ path = RL_PATH, epsilon = 0.35, explorationFloor = 0.15, explorationConstant = 0.6, logger = console, actions = ACTIONS, hints = STYLE_HINT } = {}) {
  let data = {
    q: {}, counts: {}, plays: 0,
    epsilon, alpha: 0.3,
    floor: explorationFloor, c: explorationConstant,
    actions, hints, history: [],
  }
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
    // 探索率不衰减到 0：保底 floor，保证"总有新选择"
    const floor = Number.isFinite(data.floor) ? data.floor : 0.15
    const eps = Math.max(floor, (Number.isFinite(data.epsilon) ? data.epsilon : 0.35) * Math.pow(0.998, data.plays))
    if (Math.random() < eps) {
      // 随机探索时也稍微偏向"没怎么试过"的动作
      const fresh = [...actions].sort((a, b) => (data.counts[keyOf(context, a)] ?? 0) - (data.counts[keyOf(context, b)] ?? 0))
      const pool = fresh.slice(0, Math.max(1, Math.ceil(actions.length / 2)))
      return { action: pool[Math.floor(Math.random() * pool.length)], explored: true, epsilon: eps }
    }
    // 利用时用 UCB：Q + c·√(ln N / n)，给冷门动作一点机会
    const total = Object.values(data.counts).reduce((sum, value) => sum + value, 0) + 1
    const c = Number.isFinite(data.c) ? data.c : 0.6
    let best = actions[0]
    let bestValue = -Infinity
    for (const action of actions) {
      const key = keyOf(context, action)
      const value = (data.q[key] ?? 0) + c * Math.sqrt(Math.log(total + 1) / ((data.counts[key] ?? 0) + 1))
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
    const alpha = Number.isFinite(data.alpha) ? data.alpha : 0.3
    data.q[key] = Number((previous + alpha * (reward - previous)).toFixed(4))
    data.history = [...(data.history ?? []), { context, action, reward }].slice(-600)
    save()
    return { key, before: previous, after: data.q[key] }
  }

  const status = () => ({
    plays: data.plays,
    matrix: matrix(),
    epsilon: Number(Math.max(0.05, data.epsilon * Math.pow(0.995, data.plays)).toFixed(3)),
    q: data.q,
    counts: data.counts,
    best: Object.entries(data.q)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([key, value]) => ({ key, value })),
  })

  // 状态空间：时段(4) × 情绪(3) × 工作/休息日(2) × 忙闲(2) = 48 个上下文
  const contextOf = (text, date = new Date(), busy = false) =>
    `${hourBucket(date)}|${sentimentBucket(sentimentOf(text))}|${dayBucket(date)}|${busy ? 'busy' : 'idle'}`

  const matrix = () => ({
    actions: actions.length,
    contexts: new Set(Object.keys(data.q).map((key) => key.split('|').slice(0, 4).join('|'))).size,
    capacity: 48 * actions.length,
    filled: Object.keys(data.q).length,
    fillRate: Number((Object.keys(data.q).length / (48 * actions.length) * 100).toFixed(1)),
  })

  const exportHistory = () => [...(data.history ?? [])]
  const applyHyper = ({ alpha, epsilon, floor, c }) => {
    if (Number.isFinite(alpha)) data.alpha = Math.min(0.9, Math.max(0.02, Number(alpha)))
    if (Number.isFinite(epsilon)) data.epsilon = Math.min(0.9, Math.max(0.15, Number(epsilon)))
    if (Number.isFinite(floor)) data.floor = Math.min(0.9, Math.max(0.15, Number(floor)))
    if (Number.isFinite(c)) data.c = Math.min(1.5, Math.max(0.1, Number(c)))
    save()
    return { alpha: data.alpha, epsilon: data.epsilon, floor: data.floor ?? 0.15, c: data.c ?? 0.6 }
  }
  const hyper = () => ({ alpha: data.alpha ?? 0.3, epsilon: data.epsilon ?? 0.35, floor: data.floor ?? 0.15, c: data.c ?? 0.6 })

  return { choose, update, status, matrix, contextOf, exportHistory, applyHyper, hyper, path }
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
