// SAN 指纹熵（插件侧精简版，与 goldbach-memory 的 san-entropy.js 同算法）
export function toCoordinates(text) {
  const out = []
  for (const ch of String(text ?? '')) out.push(ch.codePointAt(0) ?? 0)
  return out
}

export function sadSum(path) {
  if (!path || path.length < 2) return 0
  let max = -Infinity
  for (const value of path) if (value > max) max = value
  let sum = 0
  let previous = max + 1
  for (const value of path) { sum += Math.abs(value - previous); previous = value }
  return sum
}

function entropyOfCounts(counts) {
  let total = 0
  for (const value of counts.values()) total += value
  if (!total) return 0
  let entropy = 0
  for (const value of counts.values()) { const p = value / total; entropy -= p * Math.log2(p) }
  return Number(entropy.toFixed(4))
}

// 文本 → SAN 指纹熵（窗口默认 6，实测在该尺度结构最丰富）
export function sanEntropy(text, { window = 6 } = {}) {
  const coords = Array.isArray(text) ? text : toCoordinates(text)
  // 短文本自动缩小窗口，否则窗口内只有一条路径、熵恒为 0
  const span = coords.length >= 2 * window ? window : Math.max(2, Math.floor(coords.length / 2))
  if (coords.length < span + 1) return { entropy: 0, paths: 0, distinctSad: 0, window: span, short: true }
  // 先收集 SAD，再分桶：不分桶的话几乎每个窗口都不同，熵会饱和成 log2(路径数)
  const values = []
  for (let i = 0; i + span <= coords.length; i += span) values.push(sadSum(coords.slice(i, i + span)))
  const buckets = Math.min(32, Math.max(4, Math.ceil(Math.sqrt(values.length))))
  const min = Math.min(...values)
  const max = Math.max(...values)
  const width = Math.max(1, (max - min) / buckets)
  const counts = new Map()
  for (const value of values) {
    const bin = Math.min(buckets - 1, Math.floor((value - min) / width))
    counts.set(bin, (counts.get(bin) ?? 0) + 1)
  }
  return {
    entropy: entropyOfCounts(counts),
    paths: values.length,
    distinctSad: new Set(values).size,
    buckets,
    window: span,
  }
}
