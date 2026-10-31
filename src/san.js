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
  const counts = new Map()
  let paths = 0
  for (let i = 0; i + span <= coords.length; i += span) {
    const sad = sadSum(coords.slice(i, i + span))
    counts.set(sad, (counts.get(sad) ?? 0) + 1)
    paths += 1
  }
  return { entropy: entropyOfCounts(counts), paths, distinctSad: counts.size, window: span }
}
