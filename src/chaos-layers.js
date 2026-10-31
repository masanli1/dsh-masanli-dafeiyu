// 三层生成：混沌层（有熵、无时空）→ 黎曼层（有时序）→ 空间层（有坐标）。
//
// 混沌层：用逻辑斯蒂映射 x_{t+1} = r·x_t·(1−x_t)，自适应调 r 让熵逼近目标；
//         此层没有"时间"和"空间"，只有信息熵的涨落（推动力）。
// 黎曼层：把混沌流累加/排序，得到严格的时序（第 i 个元素就是第 i 步），
//         这一步把"无时序"变成"有时序"。
// 空间层：把时序序列映射成空间坐标（排列 + 素数对），得到可寻址的"位置"。

function shannonEntropy(buckets) {
  const total = buckets.reduce((sum, value) => sum + value, 0) || 1
  let entropy = 0
  for (const value of buckets) {
    if (!value) continue
    const p = value / total
    entropy -= p * Math.log2(p)
  }
  return entropy
}

// 混沌层：返回 0..1 的流，并记录每段的熵
export function chaosLayer({ seed = 0.4, length = 1024, buckets = 16, targetEntropy = 3.6 } = {}) {
  let x = seed
  let r = 3.9
  const stream = []
  const entropies = []
  const window = []
  for (let i = 0; i < length; i += 1) {
    x = r * x * (1 - x)
    // 自适应：熵高的段把 r 往 3.57（混沌边缘）拉，熵低就往 4.0 推
    if (i % 64 === 63) {
      const hist = new Array(buckets).fill(0)
      for (const value of window) hist[Math.min(buckets - 1, Math.floor(value * buckets))] += 1
      const entropy = shannonEntropy(hist)
      entropies.push(entropy)
      const error = targetEntropy - entropy
      r = Math.min(4, Math.max(3.57, r + error * 0.02))
      window.length = 0
    }
    stream.push(x)
    window.push(x)
  }
  // 收尾：把最后一个不完整窗口也算进去，短序列也能给出熵
  if (window.length > 0) {
    const hist = new Array(buckets).fill(0)
    for (const value of window) hist[Math.min(buckets - 1, Math.floor(value * buckets))] += 1
    entropies.push(shannonEntropy(hist))
  }
  return { stream, entropies, r }
}

// 黎曼层：混沌流 → 时序（累积和 + 排名），第 i 个元素对应第 i 步
export function riemannLayer(stream) {
  // 用"去均值后的累积和"（随机游走）：单调递增的累积和没有时序信息
  const cumulative = []
  let acc = 0
  for (const value of stream) { acc += value - 0.5; cumulative.push(acc) }
  const order = [...cumulative.keys()].sort((a, b) => cumulative[a] - cumulative[b])
  const ranks = new Array(cumulative.length)
  order.forEach((index, position) => { ranks[index] = position })
  return { cumulative, ranks }
}

// 空间层：时序 → 空间坐标（用素数对做地址，保证唯一性）
const PRIMES = (() => {
  const out = []
  for (let n = 2; out.length < 512; n += 1) if (out.every((p) => n % p !== 0)) out.push(n)
  return out
})()

export function spaceLayer(ranks) {
  // 排名 → 素数对：低位取一个素数、高位取另一个，rank < 512² 时地址唯一
  return ranks.map((rank) => {
    const low = rank % PRIMES.length
    const high = Math.floor(rank / PRIMES.length) % PRIMES.length
    return { x: PRIMES[low], y: PRIMES[high], address: PRIMES[low] * PRIMES[high], rank }
  })
}

export function generateWorld({ seed = 0.4, length = 1024, targetEntropy = 3.6 } = {}) {
  const chaos = chaosLayer({ seed, length, targetEntropy })
  const time = riemannLayer(chaos.stream)
  const space = spaceLayer(time.ranks)
  const addresses = space.map((point) => point.address)
  const unique = new Set(addresses).size
  const buckets = new Array(16).fill(0)
  for (const value of chaos.stream) buckets[Math.min(15, Math.floor(value * 16))] += 1
  return {
    chaosEntropy: Number(shannonEntropy(buckets).toFixed(3)),
    avgWindowEntropy: Number((chaos.entropies.reduce((sum, value) => sum + value, 0) / Math.max(1, chaos.entropies.length)).toFixed(3)),
    r: Number(chaos.r.toFixed(3)),
    points: space.length,
    uniqueAddresses: unique,
    collisions: space.length - unique,
    sample: space.slice(0, 3),
  }
}
