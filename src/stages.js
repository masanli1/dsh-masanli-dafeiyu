// 舞台库：从多份文档投位而来的可提取片段，供对话检索注入。
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'

export const STAGES_PATH = joinStages()
function joinStages() { return `${homedir()}/.dsh/dsh-dafeiyu-stages.json` }

function grams(value) {
  const text = String(value ?? '').toLowerCase().replace(/[\s，。！？、,.!?;；:："'（）()\[\]{}]/g, '')
  const out = new Map()
  for (let size = 1; size <= 2; size += 1) {
    for (let i = 0; i + size <= text.length; i += 1) {
      const gram = text.slice(i, i + size)
      out.set(gram, (out.get(gram) ?? 0) + size)
    }
  }
  return out
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0
  for (const [key, value] of a) { na += value * value; const other = b.get(key); if (other) dot += value * other }
  for (const value of b.values()) nb += value * value
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

export const BRIDGE_URL = process.env.DFY_BRIDGE_URL ?? 'http://127.0.0.1:18731'

// 通过本地语义桥检索（bge-small-zh）；失败则回退到本地字面匹配
export async function searchViaBridge(query, { top = 2, timeoutMs = 1200 } = {}) {
  try {
    const response = await fetch(`${BRIDGE_URL}/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, top }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return null
    const data = await response.json()
    return Array.isArray(data.hits) ? data.hits : null
  } catch {
    return null
  }
}

export async function bridgeHealth() {
  try {
    const response = await fetch(`${BRIDGE_URL}/health`, { signal: AbortSignal.timeout(800) })
    return response.ok ? await response.json() : null
  } catch { return null }
}

export function createStageLibrary({ path = STAGES_PATH, logger = console } = {}) {
  let data = { stages: [], docs: [] }
  try { data = { ...data, ...JSON.parse(readFileSync(path, 'utf8')) } } catch {}

  const load = () => data
  const reload = () => {
    try { data = JSON.parse(readFileSync(path, 'utf8')) } catch {}
    return data
  }

  // 找最贴合的舞台，并在其中滑窗找最贴合的片段
  const find = (query, { top = 1, minScore = 0.05 } = {}) => {
    const vector = grams(query)
    const queryKeys = [...vector.keys()].filter((key) => key.length >= 2)
    const scored = data.stages.map((stage) => {
      const semantic = Math.max(
        cosine(vector, grams(stage.text)),
        ...(stage.slices ?? []).map((piece) => cosine(vector, grams(piece))),
      )
      // 关键词兜底：共同二元词越多越相关
      const haystack = stage.text + ' ' + (stage.slices ?? []).join(' ')
      const shared = queryKeys.filter((key) => haystack.includes(key)).length
      const keyword = queryKeys.length ? shared / queryKeys.length : 0
      return { stage, score: Number((0.6 * semantic + 0.4 * keyword).toFixed(4)), semantic, keyword }
    }).filter((item) => item.score >= minScore).sort((a, b) => b.score - a.score).slice(0, top)

    return scored.map(({ stage, score }) => {
      let bestText = stage.text.slice(0, 220)
      let bestScore = score
      for (const piece of stage.slices ?? []) {
        const pieceScore = cosine(vector, grams(piece))
        if (pieceScore > bestScore) { bestScore = pieceScore; bestText = piece }
      }
      return { key: stage.key, doc: stage.doc, score: Number(bestScore.toFixed(3)), text: bestText }
    })
  }

  // 给对话用的上下文片段
  const contextForAsync = async (query) => {
    const hits = await searchViaBridge(query, { top: 2 })
    if (hits && hits.length) {
      return hits.map((hit, index) => `[舞台${index + 1}｜${hit.doc}｜${hit.score}] ${hit.text}`).join('\n')
    }
    return contextFor(query)
  }

  const contextFor = (query) => {
    const hits = find(query, { top: 2 })
    if (!hits.length) return ''
    return hits.map((hit, index) => `[舞台${index + 1}｜${hit.doc}｜${hit.score}] ${hit.text}`).join('\n')
  }

  const stats = () => ({
    stages: data.stages.length,
    docs: data.docs.length,
    units: data.stages.reduce((sum, stage) => sum + (stage.units ?? 0), 0),
    sources: data.docs.map((doc) => `${doc.name}(${doc.stages})`),
  })

  return { load, reload, find, contextFor, contextForAsync, stats, path }
}

const text = (value) => [{ type: 'text', text: value }]

export function registerStageTool(ctx, { stages, logger = console } = {}) {
  const tool = {
    name: 'dfy-stages',
    description: '舞台库：从多份文档投位得到的可提取片段，按问题检索并注入对话。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['find', 'stats', 'reload'] },
        query: { type: 'string' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' } }, additionalProperties: true }, render: (_a, v) => text(v.summary ?? '') },
    async execute(args) {
      if (args.action === 'reload') {
        const data = stages.reload()
        return { ok: true, stages: data.stages.length, summary: `已重载 ${data.stages.length} 个舞台` }
      }
      if (args.action === 'stats') {
        const stats = stages.stats()
        return { ok: true, ...stats, summary: `${stats.stages} 个舞台，来自 ${stats.docs} 份文档：${stats.sources.join('、')}` }
      }
      const hits = stages.find(args.query ?? '', { top: 3 })
      return {
        ok: hits.length > 0,
        hits,
        summary: hits.map((hit) => `（${hit.score}｜${hit.doc}）${hit.text.slice(0, 160)}`).join('\n\n') || '没有匹配的舞台',
      }
    },
  }
  const register = (target) => {
    try { target.tools?.register(tool); logger.info?.('dsh-dafeiyu: dfy-stages 工具已注册') } catch (error) { logger.error?.(`注册舞台工具失败: ${error?.message ?? error}`) }
  }
  if (typeof ctx.inject === 'function') ctx.inject(['tools'], register)
  else register(ctx)
}
