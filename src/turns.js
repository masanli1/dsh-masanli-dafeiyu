// 转折检测：用 SAN 熵的突降来标出"结构突变"。
//   每句算 SAN 熵 → 序列 → 局部 z 分数 → 突降点即转折。
import { sanEntropy } from './san.js'

export function unitEntropies(units, { window = 6 } = {}) {
  return units.map((text) => sanEntropy(text, { window }).entropy)
}

export function detectTurns(units, { span = 8, z = 1.2, minDrop = 0.3 } = {}) {
  const entropies = unitEntropies(units)
  const diffs = entropies.map((value, index) => (index === 0 ? 0 : value - entropies[index - 1]))
  const drops = []
  for (let i = 1; i < diffs.length; i += 1) {
    const lo = Math.max(0, i - span)
    const local = diffs.slice(lo, i + span)
    const mean = local.reduce((sum, value) => sum + value, 0) / Math.max(1, local.length)
    const variance = local.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, local.length)
    const sigma = Math.sqrt(variance) + 1e-9
    const score = (diffs[i] - mean) / sigma
    // 突降：差值为负且比局部更负
    if (score < -z && diffs[i] < -minDrop) {
      drops.push({
        index: i,
        drop: Number(diffs[i].toFixed(3)),
        score: Number(score.toFixed(2)),
        before: Number(entropies[i - 1].toFixed(3)),
        after: Number(entropies[i].toFixed(3)),
        text: `${units[i - 1]?.slice(0, 40) ?? ''} → ${units[i]?.slice(0, 40) ?? ''}`,
      })
    }
  }
  return {
    units: units.length,
    entropies,
    mean: Number((entropies.reduce((sum, v) => sum + v, 0) / Math.max(1, entropies.length)).toFixed(3)),
    turns: drops.sort((a, b) => a.drop - b.drop),
  }
}

const text = (value) => [{ type: 'text', text: value }]

export function registerTurnTool(ctx, { logger = console } = {}) {
  const tool = {
    name: 'dfy-turns',
    description: '转折检测：用 SAN 熵的突降定位文本里的结构突变（情节/场景切换）。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['detect'] },
        units: { type: 'array', items: { type: 'string' }, description: '句子列表' },
        text: { type: 'string', description: '一整段文本，内部按句号切分' },
        span: { type: 'number' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' } }, additionalProperties: true }, render: (_a, v) => text(v.summary ?? '') },
    async execute(args) {
      const units = Array.isArray(args.units) && args.units.length
        ? args.units
        : String(args.text ?? '').split(/(?<=[。！？])/).map((s) => s.trim()).filter((s) => s.length >= 8)
      if (units.length < 4) return { ok: false, summary: '至少需要 4 句才能检测转折' }
      const result = detectTurns(units, { span: args.span ?? 8 })
      return {
        ok: true,
        ...result,
        summary: `句数 ${result.units}｜平均 SAN 熵 ${result.mean}｜检测到转折 ${result.turns.length} 处\n`
          + result.turns.slice(0, 5).map((turn) => `#${turn.index} 熵 ${turn.before}→${turn.after}（${turn.drop}）｜${turn.text}`).join('\n'),
      }
    },
  }
  const register = (target) => {
    try { target.tools?.register(tool); logger.info?.('dsh-dafeiyu: dfy-turns 工具已注册') } catch (error) { logger.error?.(`注册转折工具失败: ${error?.message ?? error}`) }
  }
  if (typeof ctx.inject === 'function') ctx.inject(['tools'], register)
  else register(ctx)
}
