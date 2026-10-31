// 哥德巴赫式联想：把每条记忆映射成一个素数；
// 两条记忆的"关联"由两个素数周期的叠加产生：
//   命中点重合周期 = lcm(a,b) = a·b（互素时）
//   两个周期的错位间距 = 贝祖系数给出的最小桥 |x·a − y·b| = gcd(a,b)
//   互素 → 桥为 1（任意偶数都能被两个素数凑出来）→ 直接相连
//   不互素 → 桥为 gcd（有公共周期，关联变弱）
// 把命中点序列的间距收集起来，就是这条联想链的"节奏"。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const GOLDBACH_PATH = join(homedir(), '.dsh', 'dsh-dafeiyu-goldbach.json')

// 用小素数池（前 24 个：2…89）：周期小、叠加出的间距才有纹理
const PRIMES = (() => {
  const out = []
  for (let n = 2; out.length < 24; n += 1) {
    let prime = true
    for (let d = 2; d * d <= n; d += 1) if (n % d === 0) { prime = false; break }
    if (prime) out.push(n)
  }
  return out
})()

function grams(value) {
  const out = new Map()
  const text = String(value ?? '').toLowerCase().replace(/[\s，。！？、,.!?;；:："'（）()\[\]{}]/g, '')
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

// 哥德巴赫分解：把 n 写成两组素数之和的方式数（用素数池里的素数）
function partitions(n) {
  const set = new Set(PRIMES)
  let count = 0
  for (const prime of PRIMES) {
    if (prime > n / 2) break
    if (set.has(n - prime)) count += 1
  }
  return count
}

// CRT 余数距离：两个数在互素模数下的"结构性差异"，与语义无关
const CRT_MODULI = [3, 5, 7, 11, 13]
function crtDistance(a, b) {
  let total = 0
  let max = 0
  for (const m of CRT_MODULI) {
    const diff = Math.abs((a % m) - (b % m))
    total += diff
    max += m - 1
  }
  return max ? Number((total / max).toFixed(4)) : 0
}

const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b))
const lcm = (a, b) => (a * b) / gcd(a, b)

function bezout(a, b) {
  if (b === 0) return { x: 1, y: 0, g: a }
  const next = bezout(b, a % b)
  return { x: next.y, y: next.x - Math.floor(a / b) * next.y, g: next.g }
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

export function createGoldbachMemory({ path = GOLDBACH_PATH, logger = console } = {}) {
  let data = { nodes: {}, chains: [] }
  try { data = { ...data, ...JSON.parse(readFileSync(path, 'utf8')) } } catch {}

  const save = () => {
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`)
    } catch (error) { logger.warn?.(`dsh-dafeiyu goldbach: 写入失败: ${error?.message ?? error}`) }
  }

  const primeOf = (key) => PRIMES[hashKey(key) % PRIMES.length]

  const register = (key, text = '') => {
    const id = String(key ?? '').trim()
    if (!id) return null
    const node = data.nodes[id] ?? { key: id, prime: primeOf(id), text, at: Date.now() }
    if (text) node.text = String(text)
    node.at = Date.now()
    data.nodes[id] = node
    save()
    return node
  }

  // 两个素数周期叠加：桥长、重合周期、间距节奏
  const beat = (a, b) => {
    const g = gcd(a, b)
    const { x, y } = bezout(a, b)
    const period = lcm(a, b)
    // 间距序列：在 [0, period) 内，两个周期命中点的排序差
    const hits = []
    for (let v = 0; v < period; v += a) hits.push(v)
    for (let v = 0; v < period; v += b) hits.push(v)
    hits.sort((m, n) => m - n)
    const gaps = []
    for (let i = 1; i < hits.length; i += 1) {
      const gap = hits[i] - hits[i - 1]
      if (gap > 0) gaps.push(gap)
    }
    const unique = [...new Set(gaps)].sort((m, n) => m - n)
    return { primeA: a, primeB: b, gcd: g, bezout: { x, y }, period, bridge: g, gaps: unique, hits: hits.length }
  }

  const link = (keyA, keyB) => {
    const a = data.nodes[keyA] ?? register(keyA)
    const b = data.nodes[keyB] ?? register(keyB)
    if (!a || !b) return null
    const stats = beat(a.prime, b.prime)
    // 语义相似度：内容像不像
    const semantic = cosine(grams(a.text || a.key), grams(b.text || b.key))
    // 素数耦合：贝祖系数越小，两个周期越容易对上（"错开得少"）
    const coupling = 1 / (1 + Math.abs(stats.bezout.x) + Math.abs(stats.bezout.y))
    // 哥德巴赫丰富度：两个素数的和有多少种"素数对"写法
    const sumPartitions = partitions(a.prime + b.prime)
    // 综合强度：语义为主，周期耦合调制，再乘哥德巴赫丰富度
    const richness = 1 + Math.min(1, sumPartitions / 4)
    const distance = crtDistance(a.prime, b.prime)
    const strength = Number((semantic * (0.5 + coupling) * richness * (1.1 - 0.2 * distance)).toFixed(4))
    return {
      from: keyA, to: keyB,
      primeA: a.prime, primeB: b.prime,
      bridge: stats.bridge, period: stats.period,
      bezout: stats.bezout, semantic: Number(semantic.toFixed(3)),
      coupling: Number(coupling.toFixed(4)),
      sum: a.prime + b.prime, sumPartitions, crtDistance: distance, strength,
      gaps: stats.gaps.slice(0, 8),
    }
  }

  const neighbors = (key, limit = 5) => {
    const node = data.nodes[key] ?? register(key)
    if (!node) return []
    return Object.keys(data.nodes)
      .filter((other) => other !== key)
      .map((other) => link(key, other))
      .sort((m, n) => n.strength - m.strength || m.period - n.period)
      .slice(0, limit)
  }

  // 联想链：从起点出发，每次走最强且未访问的关联
  const chain = (key, length = 6) => {
    const visited = new Set([key])
    const path = [key]
    let current = key
    while (path.length < length) {
      const next = neighbors(current, 20).find((edge) => !visited.has(edge.to))
      if (!next) break
      visited.add(next.to)
      path.push(next.to)
      current = next.to
    }
    const steps = []
    for (let i = 1; i < path.length; i += 1) steps.push(link(path[i - 1], path[i]))
    const rhythm = steps.flatMap((step) => step.gaps).slice(0, 24)
    data.chains = [{ at: Date.now(), path, rhythm }, ...(data.chains ?? [])].slice(0, 50)
    save()
    return { path, steps, rhythm }
  }

  // 按"和"分族：a+b = n 的记忆对归到同一族，族的丰富度就是素数对数
  const families = (limit = 6) => {
    const keys = Object.keys(data.nodes)
    const bySum = new Map()
    for (let i = 0; i < keys.length; i += 1) {
      for (let j = i + 1; j < keys.length; j += 1) {
        const a = data.nodes[keys[i]].prime
        const b = data.nodes[keys[j]].prime
        const n = a + b
        const list = bySum.get(n) ?? []
        list.push({ a: keys[i], b: keys[j], primeA: a, primeB: b, partitions: partitions(n) })
        bySum.set(n, list)
      }
    }
    return [...bySum.entries()]
      .map(([sum, pairs]) => ({ sum, size: pairs.length, partitions: pairs[0]?.partitions ?? 0, pairs }))
      .sort((m, n) => n.partitions - m.partitions || n.size - m.size)
      .slice(0, limit)
  }

  // 从一条链的节奏生成动作名（供动画使用）
  const rhythmClipName = (key, length = 6) => {
    const result = chain(key, length)
    const signature = result.rhythm.join('-') || '0'
    return { clip: `rhythm_${signature.replace(/-/g, '_')}`, rhythm: result.rhythm, path: result.path }
  }

  const stats = () => ({
    nodes: Object.keys(data.nodes).length,
    primes: PRIMES.length,
    pool: PRIMES,
    chains: data.chains?.length ?? 0,
    sample: Object.entries(data.nodes).slice(0, 5).map(([key, node]) => ({ key, prime: node.prime })),
  })

  return { register, link, neighbors, chain, families, rhythmClipName, stats, beat, primeOf, path }
}

const text = (value) => [{ type: 'text', text: value }]

export function registerGoldbachTool(ctx, { goldbach, logger = console } = {}) {
  const tool = {
    name: 'goldbach',
    description: '哥德巴赫式联想：用素数周期叠加算记忆之间的桥、重合周期与节奏（register/link/neighbors/chain/stats）。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['register', 'link', 'neighbors', 'chain', 'families', 'rhythm', 'stats'] },
        a: { type: 'string' },
        b: { type: 'string' },
        text: { type: 'string' },
        length: { type: 'number' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' } }, additionalProperties: true }, render: (_a, v) => text(v.summary ?? '') },
    async execute(args) {
      if (args.action === 'register') {
        const node = goldbach.register(args.a, args.text)
        return { ok: Boolean(node), node, summary: node ? `已登记「${node.key}」→ 素数 ${node.prime}` : '缺少 a' }
      }
      if (args.action === 'link') {
        const edge = goldbach.link(args.a, args.b)
        return { ok: Boolean(edge), edge, summary: edge ? `${edge.primeA} × ${edge.primeB}：桥 ${edge.bridge}，重合周期 ${edge.period}，强度 ${edge.strength}，节奏 ${edge.gaps.join(',')}` : '缺少 a/b' }
      }
      if (args.action === 'neighbors') {
        const edges = goldbach.neighbors(args.a)
        return { ok: true, edges, summary: edges.map((edge) => `${edge.to}(素数 ${edge.primeB}, 强度 ${edge.strength})`).join('、') || '没有邻居' }
      }
      if (args.action === 'families') {
        const families = goldbach.families()
        return { ok: true, families, summary: families.map((family) => `和 ${family.sum}（${family.partitions} 种素数对，${family.size} 对记忆）`).join('；') || '节点太少' }
      }
      if (args.action === 'rhythm') {
        const result = goldbach.rhythmClipName(args.a, Number(args.length) || 6)
        return { ok: true, ...result, summary: `节奏动作：${result.clip}\n链：${result.path.join(' → ')}\n节奏：${result.rhythm.join(',')}` }
      }
      if (args.action === 'chain') {
        const result = goldbach.chain(args.a, Number(args.length) || 6)
        return { ok: true, ...result, summary: `联想链：${result.path.join(' → ')}\n节奏：${result.rhythm.join(',')}` }
      }
      const stats = goldbach.stats()
      return { ok: true, ...stats, summary: `节点 ${stats.nodes} 个（素数池 ${stats.primes}）` }
    },
  }
  const register = (target) => {
    try { target.tools?.register(tool); logger.info?.('dsh-dafeiyu: goldbach 工具已注册') } catch (error) { logger.error?.(`注册 goldbach 失败: ${error?.message ?? error}`) }
  }
  if (typeof ctx.inject === 'function') ctx.inject(['tools'], register)
  else register(ctx)
}
