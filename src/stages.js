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
export const SELECTOR_PATH = process.env.DFY_SELECTOR ?? `${process.env.HOME}/.dsh/dsh-dafeiyu-selector.json`

// 自训练选择器：5 个特征 → 归一化 → 线性打分
let SELECTOR = null
function loadSelector() {
  if (SELECTOR) return SELECTOR
  try {
    SELECTOR = JSON.parse(readFileSync(SELECTOR_PATH, 'utf8'))
  } catch {
    SELECTOR = null
  }
  return SELECTOR
}

function selectorScore({ quotient, bigram, entropy, length, semantic }) {
  const model = loadSelector()
  if (!model?.w) return null
  const raw = [quotient, bigram, entropy / 10, Math.min(1, length / 200), semantic]
  const normal = raw.map((value, index) => (value - (model.mu?.[index] ?? 0)) / (model.sigma?.[index] || 1))
  return model.w.reduce((sum, weight, index) => sum + weight * normal[index], 0) + model.b
}

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
  // 检索 = bge 召回 top-6 + 自训练选择器重排
  const contextForAsync = async (query) => {
    const hits = await searchViaBridge(query, { top: 6 })
    if (hits && hits.length) {
      const qd = distributionOf(query)
      const qb = bigramsOf(query)
      const ranked = hits.map((hit) => {
        const text = hit.text ?? ''
        const td = distributionOf(text)
        const quotient = quotientOfDist(qd, td)
        const bigram = cosineOfMaps(qb, bigramsOf(text))
        const entropy = entropyOfText(text)
        const length = tokenLength(text)
        const semantic = Number(hit.score ?? 0)
        const score = selectorScore({ quotient, bigram, entropy, length, semantic })
        return { ...hit, features: { quotient: +quotient.toFixed(3), bigram: +bigram.toFixed(3), entropy: +entropy.toFixed(2), length, semantic: +semantic.toFixed(3) }, selector: score === null ? null : +score.toFixed(3) }
      })
      // 选择器是在"问答路线"上训练的，直接搬来排"文档舞台"会偏移（实测会跑偏），
      // 所以只做混合：bge 为主，选择器做小幅调整。
      const valid = ranked.filter((hit) => hit.selector !== null)
      if (valid.length) {
        const scores = valid.map((hit) => hit.selector)
        const min = Math.min(...scores)
        const max = Math.max(...scores)
        for (const hit of valid) {
          // 选择器是在问答路线上训练的，搬到文档舞台会偏移；只用两成权重做微调
        hit.blend = Number((0.8 * Number(hit.score ?? 0) + 0.2 * ((hit.selector - min) / (max - min || 1))).toFixed(4))
        }
      }
      ranked.sort((a, b) => (b.blend ?? b.score) - (a.blend ?? a.score))
      return ranked.slice(0, 2).map((hit, index) =>
        `[舞台${index + 1}｜${hit.doc}｜bge ${hit.score}${hit.selector !== null ? `｜选择器 ${hit.selector}` : ''}] ${hit.text}`).join('\n')
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

  const findRanked = async (query, { top = 6, keep = 3 } = {}) => {
    const hits = await searchViaBridge(query, { top })
    if (!hits || !hits.length) return find(query, { top: keep })
    const qd = distributionOf(query)
    const qb = bigramsOf(query)
    const ranked = hits.map((hit) => {
      const text = hit.text ?? ''
      const score = selectorScore({
        quotient: quotientOfDist(qd, distributionOf(text)),
        bigram: cosineOfMaps(qb, bigramsOf(text)),
        entropy: entropyOfText(text),
        length: tokenLength(text),
        semantic: Number(hit.score ?? 0),
      })
      return { ...hit, selector: score === null ? null : +score.toFixed(3) }
    })
    const valid = ranked.filter((hit) => hit.selector !== null)
    if (valid.length) {
      const scores = valid.map((hit) => hit.selector)
      const min = Math.min(...scores)
      const max = Math.max(...scores)
      for (const hit of valid) {
        // 选择器是在问答路线上训练的，搬到文档舞台会偏移；只用两成权重做微调
        hit.blend = Number((0.8 * Number(hit.score ?? 0) + 0.2 * ((hit.selector - min) / (max - min || 1))).toFixed(4))
      }
    }
    return ranked.sort((a, b) => (b.blend ?? b.score) - (a.blend ?? a.score)).slice(0, keep)
  }

  return { load, reload, find, findRanked, contextFor, contextForAsync, stats, path }
}

function tokenize(text) {
  const out = []
  const re = /[A-Za-z]+|[\u4e00-\u9fff]{1,2}|[，。！？；：、]/g
  let match
  while ((match = re.exec(String(text).toLowerCase()))) out.push(match[0])
  return out
}

function distributionOf(text) {
  const tokens = tokenize(text)
  const counts = new Map()
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
  const total = tokens.length || 1
  const dist = new Map()
  for (const [key, value] of counts) dist.set(key, value / total)
  return dist
}

function quotientOfDist(a, b) {
  let sum = 0
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    sum += Math.abs((a.get(key) ?? 0) - (b.get(key) ?? 0))
  }
  return sum / 2
}

function bigramsOf(text) {
  const value = String(text).toLowerCase().replace(/\s+/g, '')
  const map = new Map()
  for (let i = 0; i + 1 < value.length; i += 1) {
    const gram = value.slice(i, i + 2)
    map.set(gram, (map.get(gram) ?? 0) + 1)
  }
  return map
}

function cosineOfMaps(a, b) {
  let dot = 0, na = 0, nb = 0
  for (const [key, value] of a) { na += value * value; const other = b.get(key); if (other) dot += value * other }
  for (const value of b.values()) nb += value * value
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

function entropyOfText(text) {
  const dist = distributionOf(text)
  let entropy = 0
  for (const p of dist.values()) if (p > 0) entropy -= p * Math.log2(p)
  return entropy
}

function tokenLength(text) {
  return tokenize(text).length
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
