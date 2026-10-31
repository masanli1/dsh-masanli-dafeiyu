// 三条链各自绑定一层：
//   推理链 ← 混沌层（熵推动）
//   联想链 ← 黎曼层（时序）+ 哥德巴赫（素数周期）
//   思考链 ← 空间层（坐标），由人为标定的强化学习决定探索哪个坐标
import { chaosLayer, riemannLayer, spaceLayer } from './chaos-layers.js'
import { chaosAddress } from './perm-memory.js'

export const CHAIN_LAYER = { reason: 'chaos', associate: 'riemann', think: 'space' }

export const LAYER_DUTY = {
  chaos: '只提供熵：决定"该多想还是该收束"',
  riemann: '只提供时序：决定"先想哪个、后想哪个"',
  space: '只提供坐标：决定"在哪儿想"，坐标由人为标定选择',
}

// 语义正确来自人为标定：space 层的选择权重
export function createLayers({ chains, policy, config = {}, logger = console } = {}) {
  const settings = {
    targetEntropy: Number(config.chaosTargetEntropy) || 3.6,
    steps: Number(config.chaosSteps) || 48,
    primePool: Number(config.primePool) || 512,
  }

  // 混沌层：给当前状态一个熵值（用 key 的混沌流窗口熵近似）
  const entropyOf = (key = String(Date.now())) => {
    const chaos = chaosLayer({ seed: (Math.abs(hash(key)) % 100000) / 100000, length: settings.steps, targetEntropy: settings.targetEntropy })
    const windowEntropy = chaos.entropies.reduce((sum, value) => sum + value, 0) / Math.max(1, chaos.entropies.length)
    return { entropy: Number(windowEntropy.toFixed(3)), r: Number(chaos.r.toFixed(3)), target: settings.targetEntropy }
  }

  // 黎曼层：给一串 key 排出时序（第几个先想）
  const timeOrder = (keys = []) => {
    const stream = keys.map((key) => (Math.abs(hash(key)) % 10000) / 10000)
    const { ranks } = riemannLayer(stream)
    return keys.map((key, index) => ({ key, timeIndex: ranks[index] })).sort((a, b) => a.timeIndex - b.timeIndex)
  }

  // 空间层：给一组记忆算坐标距离（小的就是"近邻"）
  const spatialNeighbors = (key, candidates = []) => {
    const origin = chaosAddress(key, 17)
    return candidates
      .map((candidate) => ({ candidate, distance: Math.abs(chaosAddress(candidate, 17) - origin) }))
      .sort((a, b) => a.distance - b.distance)
  }

  // 每条链的"下一站"由它自己的那层决定
  const next = (kind, context = {}) => {
    const layer = CHAIN_LAYER[kind] ?? 'chaos'
    if (layer === 'chaos') {
      const state = entropyOf(context.key ?? String(Date.now()))
      const high = state.entropy >= settings.targetEntropy
      return {
        layer, kind,
        signal: state,
        relation: high ? 'hypothesis' : 'conclusion',
        reason: high ? '熵高于目标：先发散试探' : '熵已低于目标：应收束下结论',
      }
    }
    if (layer === 'riemann') {
      const ordered = timeOrder(context.keys ?? [])
      return { layer, kind, signal: { order: ordered.slice(0, 5) }, relation: 'associate', reason: '按时序取最近的一站' }
    }
    const near = spatialNeighbors(context.key ?? '', context.candidates ?? [])
    const preference = policy?.hyper?.() ?? {}
    return {
      layer, kind,
      signal: { nearest: near.slice(0, 3) },
      relation: 'check',
      reason: `按空间距离取最近坐标（探索率 ${Number(preference.epsilon ?? 0).toFixed(2)}，由人为标定决定）`,
    }
  }

  const status = () => ({
    mapping: CHAIN_LAYER,
    duty: LAYER_DUTY,
    settings,
    counts: {
      reason: chains?.list?.('reason', 100)?.length ?? 0,
      associate: chains?.list?.('associate', 100)?.length ?? 0,
      think: chains?.list?.('think', 100)?.length ?? 0,
    },
  })

  return { next, entropyOf, timeOrder, spatialNeighbors, status, settings }
}

function hash(value) {
  let h = 2166136261
  const text = String(value)
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 }
  return h
}

const text = (value) => [{ type: 'text', text: value }]

export function registerLayerTool(ctx, { layers, logger = console } = {}) {
  const tool = {
    name: 'layer',
    description: '三层分工：推理链←熵（混沌）、联想链←时序（黎曼）、思考链←坐标（空间，由人为标定选择）。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'next', 'entropy', 'order', 'neighbors'] },
        kind: { type: 'string', enum: ['think', 'reason', 'associate'] },
        key: { type: 'string' },
        keys: { type: 'array', items: { type: 'string' } },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' } }, additionalProperties: true }, render: (_a, v) => text(v.summary ?? '') },
    async execute(args) {
      if (args.action === 'status') {
        const status = layers.status()
        return { ok: true, ...status, summary: Object.entries(status.mapping).map(([kind, layer]) => `${kind} ← ${layer}`).join('\n') }
      }
      if (args.action === 'entropy') {
        const state = layers.entropyOf(args.key)
        return { ok: true, ...state, summary: `熵 ${state.entropy} bit（目标 ${state.target}，r=${state.r}）` }
      }
      if (args.action === 'order') {
        const ordered = layers.timeOrder(args.keys ?? [])
        return { ok: true, ordered, summary: ordered.map((item) => `${item.timeIndex}: ${item.key}`).join('\n') }
      }
      if (args.action === 'neighbors') {
        const near = layers.spatialNeighbors(args.key, args.keys ?? [])
        return { ok: true, near: near.slice(0, 5), summary: near.slice(0, 5).map((item) => `${item.candidate}: 距离 ${item.distance}`).join('\n') }
      }
      const result = layers.next(args.kind ?? 'think', { key: args.key, keys: args.keys })
      return { ok: true, ...result, summary: `【${result.layer}】${result.reason}\n建议关系：${result.relation}` }
    },
  }
  const register = (target) => {
    try { target.tools?.register(tool); logger.info?.('dsh-dafeiyu: layer 工具已注册') } catch (error) { logger.error?.(`注册 layer 失败: ${error?.message ?? error}`) }
  }
  if (typeof ctx.inject === 'function') ctx.inject(['tools'], register)
  else register(ctx)
}
