// SAN：对一组点采样哈密顿回路（每个点恰好走一次），每条回路一个 SAD，
// 所有 SAD 构成分布（SAN）。这是"点集"的拓扑指纹，不是切窗口。
export function sadSum(path) {
  if (!path || path.length < 2) return 0
  let max = -Infinity
  for (const value of path) if (value > max) max = value
  let sum = 0
  let previous = max + 1
  for (const value of path) { sum += Math.abs(value - previous); previous = value }
  return sum
}

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function entropyOfCounts(counts) {
  let total = 0
  for (const value of counts) total += value
  if (!total) return 0
  let entropy = 0
  for (const value of counts) {
    if (!value) continue
    const p = value / total
    entropy -= p * Math.log2(p)
  }
  return Number(entropy.toFixed(4))
}

// 点集 → SAN 统计量
export function sanOf(values, { samples = 600, seed = 1, bins = 12 } = {}) {
  const points = Array.isArray(values) ? values.slice() : toCoordinates(values)
  const n = points.length
  if (n < 4) return { n, samples: 0, colors: bins, entropy: 0, meanSad: 0, stdSad: 0, histogram: [] }
  const random = mulberry32(seed)
  const order = Array.from({ length: n }, (_, i) => i)
  const sads = []
  for (let i = 0; i < samples; i += 1) {
    for (let k = n - 1; k > 0; k -= 1) {
      const j = Math.floor(random() * (k + 1))
      ;[order[k], order[j]] = [order[j], order[k]]
    }
    sads.push(sadSum(order.map((index) => points[index])))
  }
  const mean = sads.reduce((sum, value) => sum + value, 0) / sads.length
  const variance = sads.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sads.length
  const min = Math.min(...sads)
  const max = Math.max(...sads)
  const width = Math.max(1e-9, (max - min) / bins)
  const counts = new Array(bins).fill(0)
  for (const value of sads) counts[Math.min(bins - 1, Math.floor((value - min) / width))] += 1
  return {
    n, samples: sads.length, bins,
    entropy: entropyOfCounts(counts),
    meanSad: Number(mean.toFixed(2)),
    stdSad: Number(Math.sqrt(variance).toFixed(2)),
    histogram: counts,
  }
}

export function toCoordinates(text) {
  const out = []
  for (const ch of String(text ?? '')) out.push(ch.codePointAt(0) ?? 0)
  return out
}

// 兼容：文本 → 码点 → SAN
export function sanEntropy(text, options = {}) {
  return sanOf(Array.isArray(text) ? text : toCoordinates(text), options)
}
