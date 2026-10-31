// 元优化：用 MUS（随机采样 + 选择）给 RL 自己调超参。
// 评估方式：拿历史 (context, action, reward) 做离线重放，
// 候选超参跑一遍 → 平均奖励最高的那组胜出 → 写回策略。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const META_PATH = join(homedir(), '.dsh', 'dsh-dafeiyu-meta.json')

function replay(history, { alpha, epsilon }) {
  const q = new Map()
  let total = 0
  let count = 0
  for (const step of history) {
    const key = `${step.context}|${step.action}`
    const value = q.get(key) ?? 0
    // 稀疏更新的近似：只有被选中的动作会更新
    q.set(key, value + alpha * (step.reward - value))
    total += step.reward
    count += 1
  }
  const mean = count ? total / count : 0
  // 探索惩罚：ε 越大越随机，稍微扣一点
  return mean - epsilon * 0.05
}

export function createMeta({ path = META_PATH, logger = console } = {}) {
  let data = { rounds: 0, best: {}, history: [] }
  try { data = { ...data, ...JSON.parse(readFileSync(path, 'utf8')) } } catch {}

  const save = () => {
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`)
    } catch (error) { logger.warn?.(`dsh-dafeiyu meta: 写入失败: ${error?.message ?? error}`) }
  }

  const optimize = (policy, { samples = 1500, name = 'policy' } = {}) => {
    const history = policy?.exportHistory?.() ?? []
    if (history.length < 8) return { ok: false, reason: `历史样本不足（${history.length}/8）` }
    let best = null
    for (let i = 0; i < samples; i += 1) {
      const candidate = {
        alpha: 0.02 + Math.random() * 0.58,
        epsilon: 0.02 + Math.random() * 0.38,
      }
      const score = replay(history, candidate)
      if (!best || score > best.score) best = { ...candidate, score }
    }
    const before = policy.hyper?.() ?? null
    policy.applyHyper?.({ alpha: best.alpha, epsilon: best.epsilon })
    const after = policy.hyper?.() ?? null
    data.rounds += 1
    data.best[name] = { at: Date.now(), before, after, score: Number(best.score.toFixed(4)), samples }
    data.history = [{ at: Date.now(), name, before, after, score: Number(best.score.toFixed(4)) }, ...(data.history ?? [])].slice(0, 50)
    save()
    return { ok: true, name, before, after, score: Number(best.score.toFixed(4)), samples, samplesUsed: history.length }
  }

  const status = () => ({
    rounds: data.rounds,
    best: data.best,
    recent: (data.history ?? []).slice(0, 5),
  })

  return { optimize, status, path }
}

const text = (value) => [{ type: 'text', text: value }]

export function registerMetaTool(ctx, { meta, policies, logger = console } = {}) {
  const tool = {
    name: 'meta',
    description: '元优化：用 MUS 给强化学习自己调超参（status 查看，optimize 手动优化）。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'optimize'] },
        which: { type: 'string', enum: ['chat', 'director', 'all'] },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' } }, additionalProperties: true }, render: (_a, v) => text(v.summary ?? '') },
    async execute(args) {
      if (args.action === 'status') {
        const status = meta.status()
        const names = Object.keys(status.best)
        return { ok: true, ...status, summary: `已优化 ${status.rounds} 轮；` + (names.map((name) => `${name}: α=${status.best[name].after?.alpha?.toFixed(3)} ε=${status.best[name].after?.epsilon?.toFixed(3)}`).join('；') || '还没有结果') }
      }
      const targets = args.which && args.which !== 'all' ? [args.which] : ['chat', 'director']
      const results = []
      for (const name of targets) {
        const policy = policies?.[name]
        if (!policy) { results.push({ name, ok: false, reason: '没有这个策略' }); continue }
        results.push({ name, ...meta.optimize(policy, { name }) })
      }
      return { ok: results.some((item) => item.ok), results, summary: results.map((item) => item.ok ? `${item.name}: α=${item.after.alpha.toFixed(3)} ε=${item.after.epsilon.toFixed(3)}（得分 ${item.score}）` : `${item.name}: ${item.reason}`).join('；') }
    },
  }
  const register = (target) => {
    try { target.tools?.register(tool); logger.info?.('dsh-dafeiyu: meta 工具已注册') } catch (error) { logger.error?.(`注册 meta 失败: ${error?.message ?? error}`) }
  }
  if (typeof ctx.inject === 'function') ctx.inject(['tools'], register)
  else register(ctx)
}
