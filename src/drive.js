// 驱动链：用"分布的商的分布"来决定下一步，而不是靠提示词。
//
// 思路：
//   1. 把每条链压成一个"关系分布"（premise/check/conclusion… 的占比）；
//   2. 按任务类型归类，得到历史分布 P_hist；
//   3. 当前上下文给出 P_now；
//   4. 商 Q = P_now / P_hist（带平滑）→ 哪个环节被"欠采样"就提示补哪一步；
//   5. 用 Q 加权选择下一条链/下一步，并记录决策（可审计）。
import { sanEntropy } from './san.js'

const RELATIONS = ['start', 'premise', 'hypothesis', 'check', 'conclusion', 'associate']

const normalize = (counts) => {
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0) || 1
  return Object.fromEntries(RELATIONS.map((key) => [key, (counts[key] ?? 0) / total]))
}

export function chainDistribution(chain) {
  const counts = {}
  for (const node of chain?.nodes ?? []) counts[node.relation] = (counts[node.relation] ?? 0) + 1
  return normalize(counts)
}

export function createDrive({ chains, logger = console, smoothing = 0.05 } = {}) {
  const history = () => (chains?.list('', 200) ?? []).map((item) => chains.show(item.id)).filter(Boolean)

  // 历史分布：所有推理链的平均关系分布
  const historicalDistribution = () => {
    const items = history().filter((chain) => chain.kind === 'reason')
    if (!items.length) return normalize({})
    const total = normalize({})
    for (const chain of items) {
      const dist = chainDistribution(chain)
      for (const key of RELATIONS) total[key] += dist[key]
    }
    for (const key of RELATIONS) total[key] /= items.length
    return total
  }

  // 当前分布：进行中的链 + 触发上下文（用关系词频近似）
  const currentDistribution = (context = '') => {
    const counts = {}
    const chain = chains?.current?.('reason')
    for (const node of chain?.nodes ?? []) counts[node.relation] = (counts[node.relation] ?? 0) + 1
    for (const [, relation] of context.matchAll(/(start|premise|hypothesis|check|conclusion|associate)/g)) counts[relation] = (counts[relation] ?? 0) + 1
    return normalize(counts)
  }

  // SAN 熵画像：每条链节点的 SAN 指纹熵（替代字频熵）
  const entropyProfile = () => history().map((chain) => ({
    id: chain.id,
    kind: chain.kind,
    entropy: sanEntropy((chain.nodes ?? []).map((node) => node.text ?? '').join('。'), { window: 6 }).entropy,
    nodes: (chain.nodes ?? []).length,
  }))

  // 熵梯度：当前熵 vs 历史均值 → 正=还高（该发散），负=已低（该收束）
  const entropyGradient = () => {
    const profile = entropyProfile()
    if (!profile.length) return { current: 0, historical: 0, gradient: 0, samples: 0 }
    const currentChain = chains?.current?.('reason')
    const current = currentChain
      ? sanEntropy((currentChain.nodes ?? []).map((node) => node.text ?? '').join('。'), { window: 6 }).entropy
      : profile[profile.length - 1].entropy
    const historical = profile.reduce((sum, item) => sum + item.entropy, 0) / profile.length
    return {
      current: Number(current.toFixed(3)),
      historical: Number(historical.toFixed(3)),
      gradient: Number((current - historical).toFixed(3)),
      samples: profile.length,
    }
  }

  // 商：P_now / P_hist（加平滑），返回缺口最大的环节
  const quotient = (context = '') => {
    const now = currentDistribution(context)
    const hist = historicalDistribution()
    const scores = RELATIONS.map((key) => {
      const p = now[key] + smoothing
      const q = hist[key] + smoothing
      return {
        relation: key,
        now: Number(now[key].toFixed(3)),
        hist: Number(q.toFixed(3)),
        quotient: Number((p / q).toFixed(3)),
        // 缺口：历史上有、当前没有的环节（越缺越该补）
        gap: Number((q - p).toFixed(3)),
      }
    })
    // 缺口大的优先（补上历史里常见、当前缺失的环节）
    return scores.sort((a, b) => b.gap - a.gap)
  }

  // 下一步建议：先看 SAN 熵梯度（该发散还是收束），再用商补齐缺失环节
  const suggest = (context = '') => {
    const scores = quotient(context)
    const entropy = entropyGradient()
    const diverging = entropy.gradient > 0
    const preferred = diverging ? ['hypothesis', 'premise'] : ['conclusion', 'check']
    const ranked = [...scores].sort((a, b) => {
      const pa = preferred.includes(a.relation) ? 1 : 0
      const pb = preferred.includes(b.relation) ? 1 : 0
      if (pa !== pb) return pb - pa
      return b.gap - a.gap
    })
    return {
      next: ranked[0].relation,
      scores: ranked.slice(0, 3),
      historical: historicalDistribution(),
      entropy,
      mode: diverging ? '发散（熵高于历史）' : '收束（熵低于历史）',
    }
  }

  return { suggest, quotient, historicalDistribution, currentDistribution, entropyProfile, entropyGradient }
}

const text = (value) => [{ type: 'text', text: value }]

export function registerDriveTool(ctx, { drive, logger = console } = {}) {
  const tool = {
    name: 'drive',
    description: '驱动链：SAN 熵梯度决定发散/收束，商（当前分布 ÷ 历史分布）决定补哪个环节。',
    parameters: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['suggest', 'status'] }, context: { type: 'string' } },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' } }, additionalProperties: true }, render: (_a, v) => text(v.summary ?? '') },
    async execute(args) {
      if (args.action === 'suggest') {
        const result = drive.suggest(args.context ?? '')
        return { ok: true, ...result, summary: `下一步建议：${result.next}（${result.mode}）\nSAN 熵：当前 ${result.entropy.current} / 历史 ${result.entropy.historical} → 梯度 ${result.entropy.gradient}\n` + result.scores.map((item) => `${item.relation}: 当前 ${item.now} / 历史 ${item.hist} → 商 ${item.quotient}`).join('\n') }
      }
      const scores = drive.quotient(args.context ?? '')
      const entropy = drive.entropyGradient()
      return { ok: true, scores, entropy, summary: `SAN 熵：当前 ${entropy.current} / 历史 ${entropy.historical} → 梯度 ${entropy.gradient}\n` + scores.map((item) => `${item.relation}: 商 ${item.quotient}`).join('\n') }
    },
  }
  const register = (target) => {
    try { target.tools?.register(tool); logger.info?.('dsh-dafeiyu: drive 工具已注册') } catch (error) { logger.error?.(`注册 drive 失败: ${error?.message ?? error}`) }
  }
  if (typeof ctx.inject === 'function') ctx.inject(['tools'], register)
  else register(ctx)
}
