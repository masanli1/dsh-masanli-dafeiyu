// 自我复刻：把"成功回答过的问题 → 答案"存成可检索的技能，
// 下次类似问题可以直接用复刻答案（不调模型），并统计命中率。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { writeJsonAtomic } from './atomic.js'

export const SELFTOOL_PATH = join(homedir(), '.dsh', 'dsh-dafeiyu-selftool.json')

const STOP = new Set(['的', '了', '是', '我', '你', '他', '她', '在', '有', '和', '就', '不', '也', '都', '这', '那', '吗', '呢', '啊', '吧'])

// 字符 bigram/trigram 向量，够用且不用模型
function grams(text) {
  const value = String(text ?? '').toLowerCase().replace(/[\s，。！？、,.!?;；:：""''（）()\[\]{}]/g, '')
  const out = new Map()
  for (let size = 1; size <= 2; size += 1) {
    for (let i = 0; i + size <= value.length; i += 1) {
      const gram = value.slice(i, i + size)
      if (STOP.has(gram)) continue
      out.set(gram, (out.get(gram) ?? 0) + size)
    }
  }
  return out
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0
  for (const [key, value] of a) { na += value * value; const other = b.get(key); if (other) dot += value * other }
  for (const value of b.values()) nb += value * value
  if (!na || !nb) return 0
  return dot / Math.sqrt(na * nb)
}

export function createSelfTool({ path = SELFTOOL_PATH, threshold = 0.42, limit = 400, logger = console } = {}) {
  let data = { pairs: [], hits: 0, misses: 0 }
  try { data = { ...data, ...JSON.parse(readFileSync(path, 'utf8')) } } catch {}

  const save = () => {
    try {
      mkdirSync(dirname(path), { recursive: true })
      const trimmed = { ...data, pairs: data.pairs.slice(-limit) }
      writeJsonAtomic(path, trimmed)
    } catch (error) { logger.warn?.(`dsh-dafeiyu selftool: 写入失败: ${error?.message ?? error}`) }
  }

  const learn = (question, answer) => {
    const q = String(question ?? '').trim()
    const a = String(answer ?? '').trim()
    if (q.length < 4 || a.length < 4) return null
    const existing = data.pairs.find((pair) => pair.q === q)
    if (existing) { existing.a = a; existing.at = Date.now(); save(); return existing }
    const pair = { q, a, at: Date.now(), hits: 0 }
    data.pairs.push(pair)
    save()
    return pair
  }

  const ask = (question) => {
    const q = String(question ?? '').trim()
    if (!q) return null
    const vector = grams(q)
    let best = null
    let bestScore = 0
    for (const pair of data.pairs) {
      const score = cosine(vector, grams(pair.q))
      if (score > bestScore) { bestScore = score; best = pair }
    }
    if (!best || bestScore < threshold) { data.misses += 1; save(); return null }
    best.hits += 1
    data.hits += 1
    save()
    return { ...best, score: Number(bestScore.toFixed(3)) }
  }

  const stats = () => ({
    pairs: data.pairs.length,
    hits: data.hits,
    misses: data.misses,
    hitRate: Number(((data.hits / Math.max(1, data.hits + data.misses)) * 100).toFixed(1)),
    top: [...data.pairs].sort((a, b) => b.hits - a.hits).slice(0, 5).map((pair) => ({ q: pair.q.slice(0, 40), hits: pair.hits })),
  })

  return { learn, ask, stats, path, threshold }
}

const text = (value) => [{ type: 'text', text: value }]

export function registerSelfTool(ctx, { selfTool, logger = console } = {}) {
  const tool = {
    name: 'selftool',
    description: '自我复刻：action=learn 记住问答对，action=ask 用复刻答案回答类似问题，action=stats 看命中率。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['learn', 'ask', 'stats'] },
        question: { type: 'string' },
        answer: { type: 'string' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' } }, additionalProperties: true }, render: (_a, v) => text(v.summary ?? '') },
    async execute(args) {
      if (args.action === 'learn') {
        const pair = selfTool.learn(args.question, args.answer)
        return { ok: Boolean(pair), summary: pair ? `已复刻：${pair.q}` : '问题和答案太短，没记住' }
      }
      if (args.action === 'ask') {
        const hit = selfTool.ask(args.question)
        return { ok: Boolean(hit), hit, summary: hit ? `（复刻 ${hit.score}）${hit.a}` : '没有足够相似的复刻，需要走模型' }
      }
      const stats = selfTool.stats()
      return { ok: true, ...stats, summary: `复刻 ${stats.pairs} 条 · 命中 ${stats.hits} · 命中率 ${stats.hitRate}%` }
    },
  }
  const register = (target) => {
    try { target.tools?.register(tool); logger.info?.('dsh-dafeiyu: selftool 工具已注册') } catch (error) { logger.error?.(`注册 selftool 失败: ${error?.message ?? error}`) }
  }
  if (typeof ctx.inject === 'function') ctx.inject(['tools'], register)
  else register(ctx)
}
