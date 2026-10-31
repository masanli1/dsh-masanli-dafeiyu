// 矩阵记忆：用"逆序数（Lehmer 码）"把记忆编码进排列。
// 一个 n 阶排列有 n! 种，逆序数向量就是它的轨迹；展开逆序数 = 逐位读出记忆。
// 容量随 n 阶乘增长：n=10 → 362 万，n=12 → 4.79 亿，n=14 → 871 亿。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const PERM_PATH = join(homedir(), '.dsh', 'dsh-dafeiyu-perm-memory.json')

const FACT = [1]
for (let i = 1; i <= 20; i += 1) FACT[i] = FACT[i - 1] * i

export const capacityOf = (n) => FACT[n] ?? Infinity

// 排名 → 排列（Lehmer 码展开，也就是"展开逆序数"）
export function unrank(rank, n) {
  let r = Math.max(0, Math.floor(rank)) % capacityOf(n)
  const available = Array.from({ length: n }, (_, i) => i)
  const permutation = []
  const inversion = []
  for (let i = n; i >= 1; i -= 1) {
    const block = FACT[i - 1]
    const index = Math.floor(r / block)
    r %= block
    inversion.push(index)
    permutation.push(available.splice(index, 1)[0])
  }
  return { permutation, inversion }
}

// 排列 → 排名（逆序数向量的加权和）
export function rankOf(permutation) {
  const n = permutation.length
  let rank = 0
  for (let i = 0; i < n; i += 1) {
    let smaller = 0
    for (let j = i + 1; j < n; j += 1) if (permutation[j] < permutation[i]) smaller += 1
    rank += smaller * FACT[n - i - 1]
  }
  return rank
}

export function inversionOf(permutation) {
  const n = permutation.length
  const out = []
  for (let i = 0; i < n; i += 1) {
    let smaller = 0
    for (let j = i + 1; j < n; j += 1) if (permutation[j] < permutation[i]) smaller += 1
    out.push(smaller)
  }
  return out
}

function hashKey(key) {
  let hash = 2166136261
  const value = String(key)
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash
}

export function createPermMemory({ path = PERM_PATH, order = 10, logger = console } = {}) {
  let data = { order, entries: [], surges: 0 }
  try { data = { ...data, ...JSON.parse(readFileSync(path, 'utf8')) } } catch {}

  const save = () => {
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`)
    } catch (error) { logger.warn?.(`dsh-dafeiyu perm-memory: 写入失败: ${error?.message ?? error}`) }
  }

  const index = new Map(data.entries.map((entry) => [entry.key, entry]))

  const probe = (key, step = 0) => {
    const cap = capacityOf(data.order)
    return (hashKey(key) + step) % Math.min(cap, Number.MAX_SAFE_INTEGER)
  }

  const remember = (key, text, meta = {}) => {
    const id = String(key ?? '').trim()
    if (!id) return null
    const existing = index.get(id)
    if (existing) {
      existing.text = String(text ?? existing.text)
      existing.meta = { ...existing.meta, ...meta }
      existing.at = Date.now()
      save()
      return existing
    }
    let step = 0
    let rank = probe(id, step)
    const used = new Set(data.entries.map((entry) => entry.rank))
    while (used.has(rank) && step < 10_000) { step += 1; rank = probe(id, step) }
    const { permutation, inversion } = unrank(rank, data.order)
    const entry = {
      key: id,
      text: String(text ?? ''),
      rank,
      step,
      permutation,
      inversion,
      meta,
      at: Date.now(),
    }
    entry.surges = inversion.reduce((sum, value) => sum + value, 0)
    data.entries.push(entry)
    data.surges += entry.surges
    index.set(id, entry)
    save()
    return entry
  }

  const recall = (key) => {
    const id = String(key ?? '').trim()
    const hit = index.get(id)
    if (hit) return hit
    // 退化路径：按排名扫描，模拟"展开逆序数"逐个比对
    for (let step = 0; step < 256; step += 1) {
      const rank = probe(id, step)
      const found = data.entries.find((entry) => entry.rank === rank && entry.key === id)
      if (found) return found
    }
    return null
  }

  const expand = (delta = 2) => {
    data.order = Math.min(14, data.order + delta)
    // 重新编码已有记忆（排列变长，轨迹信息保留）
    for (const entry of data.entries) {
      const { permutation, inversion } = unrank(entry.rank % capacityOf(data.order), data.order)
      entry.permutation = permutation
      entry.inversion = inversion
      entry.surges = inversion.reduce((sum, value) => sum + value, 0)
    }
    save()
    return stats()
  }

  const stats = () => ({
    order: data.order,
    capacity: capacityOf(data.order),
    used: data.entries.length,
    load: Number((data.entries.length / capacityOf(data.order) * 100).toFixed(6)),
    surges: data.surges,
    sample: data.entries.slice(-2).map((entry) => ({
      key: entry.key,
      rank: entry.rank,
      inversion: entry.inversion.slice(0, 6),
      permutation: entry.permutation.slice(0, 6),
      surges: entry.surges,
    })),
  })

  const list = (limit = 20) => data.entries.slice(-limit).map((entry) => ({ key: entry.key, text: entry.text, rank: entry.rank, at: entry.at }))

  return { remember, recall, expand, stats, list, path }
}

const text = (value) => [{ type: 'text', text: value }]

export function registerPermMemoryTool(ctx, { memory, logger = console } = {}) {
  const tool = {
    name: 'matrix-memory',
    description: '矩阵记忆：用逆序数编码记忆（remember/recall/stats/expand）。阶数每 +2，容量乘 90 倍以上。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['remember', 'recall', 'stats', 'expand', 'list'] },
        key: { type: 'string' },
        text: { type: 'string' },
        delta: { type: 'number', description: 'expand 时增加的阶数（默认 2）' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' } }, additionalProperties: true }, render: (_a, v) => text(v.summary ?? '') },
    async execute(args) {
      if (args.action === 'remember') {
        const entry = memory.remember(args.key, args.text)
        return { ok: Boolean(entry), entry, summary: entry ? `已写入矩阵：${entry.key} → 排名 ${entry.rank}，逆序 ${entry.inversion.slice(0, 5).join('')}…` : '缺少 key' }
      }
      if (args.action === 'recall') {
        const entry = memory.recall(args.key)
        return { ok: Boolean(entry), entry, summary: entry ? `${entry.key}：${entry.text}（排名 ${entry.rank}）` : '没有这条记忆' }
      }
      if (args.action === 'expand') {
        const stats = memory.expand(Number(args.delta) || 2)
        return { ok: true, stats, summary: `矩阵扩到 ${stats.order} 阶：容量 ${stats.capacity.toLocaleString()} 条，已用 ${stats.used}` }
      }
      if (args.action === 'list') {
        const items = memory.list()
        return { ok: true, items, summary: items.map((item) => `${item.key}（${item.rank}）`).join('、') || '还没有记忆' }
      }
      const stats = memory.stats()
      return { ok: true, stats, summary: `${stats.order} 阶矩阵：容量 ${stats.capacity.toLocaleString()} 条，已用 ${stats.used}（${stats.load}%），累计浪涌 ${stats.surges}` }
    },
  }
  const register = (target) => {
    try { target.tools?.register(tool); logger.info?.('dsh-dafeiyu: matrix-memory 工具已注册') } catch (error) { logger.error?.(`注册 matrix-memory 失败: ${error?.message ?? error}`) }
  }
  if (typeof ctx.inject === 'function') ctx.inject(['tools'], register)
  else register(ctx)
}
