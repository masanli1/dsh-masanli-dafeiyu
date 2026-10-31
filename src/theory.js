// 理论记忆：把"记忆系统的原理"以稀疏矩阵形式存着，按需展开回答。
// 不在权重里，而在可寻址的记忆里——这正是"逆序数的简单形式"。
import { homedir } from 'node:os'
import { join } from 'node:path'
import { MatrixStore } from './matrix-store.js'

export const THEORY_BASE = join(homedir(), '.dsh', 'dsh-dafeiyu-theory-matrix')

function grams(text) {
  const value = String(text ?? '').toLowerCase().replace(/[\s，。！？、,.!?;；:："'（）()\[\]{}]/g, '')
  const out = new Map()
  for (let size = 1; size <= 2; size += 1) {
    for (let i = 0; i + size <= value.length; i += 1) {
      const gram = value.slice(i, i + size)
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

export function createTheory({ base = THEORY_BASE, logger = console } = {}) {
  let store = null
  const load = () => {
    if (store) return store
    store = new MatrixStore({ base, order: 17 })
    try { store.load() } catch (error) { logger.warn?.(`dsh-dafeiyu theory: 读取失败 ${error?.message ?? error}`) }
    logger.info?.(`dsh-dafeiyu theory: 载入 ${store.rows.length} 条理论记忆`)
    return store
  }

  const ask = (query, top = 3) => {
    const current = load()
    const vector = grams(query)
    const scored = []
    for (const row of current.rows) {
      const item = row.payload ?? {}
      const score = 0.7 * cosine(vector, grams(item.q ?? row.key)) + 0.3 * cosine(vector, grams(item.a ?? ''))
      if (score > 0.08) scored.push({ score: Number(score.toFixed(3)), key: row.key, q: item.q, a: item.a })
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, top)
  }

  // 学习 = 编码：把一段知识切块后按逆序数地址存进矩阵，用时再展开。
  const learn = (title, text) => {
    const current = load()
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
    if (!clean) return { stored: 0 }
    const chunks = []
    const size = 400
    for (let i = 0; i < clean.length; i += size) chunks.push(clean.slice(i, i + size))
    let stored = 0
    chunks.forEach((chunk, index) => {
      const key = `learn:${title}#${index + 1}`
      current.put(key, { q: title, a: chunk })
      stored += 1
    })
    const stats = current.save()
    return { stored, total: current.rows.length, ...stats }
  }

  const stats = () => {
    const current = load()
    return { entries: current.rows.length, ...current.stats() }
  }

  const list = (limit = 10) => load().rows.slice(0, limit).map((row) => ({ key: row.key, rank: row.rank }))

  return { load, ask, learn, stats, list, base }
}

const text = (value) => [{ type: 'text', text: value }]

export function registerTheoryTool(ctx, { theory, logger = console } = {}) {
  const tool = {
    name: 'theory',
    description: '理论记忆：按需展开内置的记忆系统原理问答（逆序数编码、哥德巴赫联想、稀疏寻址、矩阵压缩）。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['ask', 'list', 'stats', 'learn'] },
        query: { type: 'string', description: '要问的问题' },
        title: { type: 'string', description: 'learn 时的主题名' },
        text: { type: 'string', description: 'learn 时要记住的内容' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' } }, additionalProperties: true }, render: (_a, v) => text(v.summary ?? '') },
    async execute(args) {
      if (args.action === 'ask') {
        const hits = theory.ask(args.query)
        if (!hits.length) return { ok: false, summary: '理论记忆里没有相关内容' }
        return { ok: true, hits, summary: hits.map((hit, index) => `【${index + 1}】（${hit.score}）${hit.q}\n${hit.a.slice(0, 600)}`).join('\n\n') }
      }
      if (args.action === 'learn') {
        if (!args.title || !args.text) return { ok: false, summary: '需要 title 和 text' }
        const result = theory.learn(args.title, args.text)
        return { ok: true, ...result, summary: `已编码入库：${result.stored} 块（总计 ${result.total} 条，占 ${(result.totalBytes / 1024).toFixed(1)} KB）` }
      }
      if (args.action === 'list') {
        const items = theory.list()
        return { ok: true, items, summary: items.map((item) => item.key).join('\n') }
      }
      const stats = theory.stats()
      return { ok: true, ...stats, summary: `理论记忆 ${stats.entries} 条，占 ${(stats.totalBytes / 1024).toFixed(1)} KB` }
    },
  }
  const register = (target) => {
    try { target.tools?.register(tool); logger.info?.('dsh-dafeiyu: theory 工具已注册') } catch (error) { logger.error?.(`注册 theory 失败: ${error?.message ?? error}`) }
  }
  if (typeof ctx.inject === 'function') ctx.inject(['tools'], register)
  else register(ctx)
}
