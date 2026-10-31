// 中国剩余定理（CRT）编码层：
//   x < M = ∏ m_i 由余数 (x mod m_i) 唯一确定（m_i 两两互素）
//   作用不是"压缩"（CRT 是双射，比特数守恒），而是：
//     1) 并行寻址：每个模数独立算余数，可分段定位；
//     2) 打包：多个小字段合成一个大整数（混合进制/CRT）；
//     3) 纠错：多用 1–2 个模数做冗余，单个余数被改坏也能发现并纠正。
const PRIMES = [3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n, 43n, 47n, 53n, 59n, 61n, 67n, 71n, 73n]

const mod = (a, m) => ((a % m) + m) % m

// 扩展欧几里得（BigInt）
function egcd(a, b) {
  if (b === 0n) return { g: a, x: 1n, y: 0n }
  const { g, x, y } = egcd(b, a % b)
  return { g: g, x: y, y: x - (a / b) * y }
}

export function productOf(moduli) {
  return moduli.reduce((acc, m) => acc * m, 1n)
}

export function encodeResidues(value, moduli) {
  const x = BigInt(value)
  return moduli.map((m) => Number(mod(x, m)))
}

// CRT 重建（Garner）
export function decodeResidues(residues, moduli) {
  const M = productOf(moduli)
  let x = 0n
  let prefix = 1n
  for (let i = 0; i < moduli.length; i += 1) {
    const m = moduli[i]
    const r = BigInt(residues[i])
    // 当前余数在当前前缀下的修正量
    const diff = mod(r - x, m)
    const { x: inv } = egcd(mod(prefix, m), m)
    const step = mod(diff * inv, m)
    x += step * prefix
    prefix *= m
  }
  return mod(x, M)
}

// 冗余校验：moduli 比"信息位"多 1 个，可检出单个余数被篡改
export function verifyResidues(residues, moduli) {
  const M = productOf(moduli)
  const x = decodeResidues(residues, moduli)
  const re = encodeResidues(x, moduli)
  const bad = re.map((value, index) => (value === residues[index] ? null : index)).filter((index) => index !== null)
  return { ok: bad.length === 0, repaired: bad.length ? { index: bad[0], was: residues[bad[0]], shouldBe: re[bad[0]] } : null, value: x, capacity: M }
}

// 混合进制打包：多字段 → 一个整数（无比特浪费）
export function packFields(fields, ranges) {
  let acc = 0n
  let scale = 1n
  for (let i = 0; i < fields.length; i += 1) {
    acc += BigInt(fields[i]) * scale
    scale *= BigInt(ranges[i])
  }
  return { value: acc, capacity: scale, bits: Math.ceil(Math.log2(Number(scale))) }
}

export function unpackFields(value, ranges) {
  let v = BigInt(value)
  const out = []
  for (const range of ranges) {
    const r = BigInt(range)
    out.push(Number(v % r))
    v /= r
  }
  return out
}

// 文本的余数素描：把字符按位置加权求和后取余（类似 Count-Min 的简化版）
export function residueSketch(text, moduli = PRIMES.slice(0, 5)) {
  const value = String(text ?? '')
  return moduli.map((m) => {
    let sum = 0n
    const M = BigInt(m)
    for (let i = 0; i < value.length; i += 1) {
      sum = (sum * 131n + BigInt(value.charCodeAt(i)) + BigInt(i)) % M
    }
    return Number(sum)
  })
}

export function sketchDistance(a, b, moduli = PRIMES.slice(0, 5)) {
  const sa = residueSketch(a, moduli)
  const sb = residueSketch(b, moduli)
  let total = 0
  let max = 0
  for (let i = 0; i < moduli.length; i += 1) {
    total += Math.abs(sa[i] - sb[i])
    max += Number(moduli[i]) - 1
  }
  return { residuesA: sa, residuesB: sb, distance: max ? Number((total / max).toFixed(4)) : 0 }
}

export function createCrtMemory({ infoCount = 8, checkCount = 3, logger = console } = {}) {
  // 前 infoCount 个模数编码信息，后 checkCount 个做冗余校验
  const infoModuli = PRIMES.slice(0, infoCount)
  const checkModuli = PRIMES.slice(infoCount, infoCount + checkCount)
  const allModuli = [...infoModuli, ...checkModuli]
  const M = productOf(infoModuli)
  const bits = Math.floor(Math.log2(Number(M)))

  const encode = (value) => {
    const info = encodeResidues(value, infoModuli)
    const x = decodeResidues(info, infoModuli)
    return [...info, ...encodeResidues(x, checkModuli)]
  }
  const decode = (residues) => decodeResidues(residues.slice(0, infoModuli.length), infoModuli)
  const verify = (residues) => {
    const x = decode(residues)
    const expected = encode(x)
    const bad = expected.map((value, index) => (value === residues[index] ? null : index)).filter((index) => index !== null)
    return {
      ok: bad.length === 0,
      value: x.toString(),
      bad,
      repaired: bad.length ? { index: bad[0], was: residues[bad[0]], shouldBe: expected[bad[0]] } : null,
    }
  }

  // 纠错：单个余数被改坏时，枚举"哪个位置、改成什么"能让校验位全部对上
  const correct = (residues) => {
    const verify = (candidate) => {
      const x = decodeResidues(candidate.slice(0, infoModuli.length), infoModuli)
      const expected = encode(x)
      const bad = expected.map((value, index) => (value === candidate[index] ? null : index)).filter((index) => index !== null)
      return { ok: bad.length === 0, value: x, bad }
    }
    const direct = verify(residues)
    if (direct.ok) return { ok: true, corrected: false, errors: 0, value: direct.value.toString() }

    const attempt = (candidate, changed) => {
      const result = verify(candidate)
      if (!result.ok) return null
      return { ok: true, corrected: true, errors: changed.length, changed, value: result.value.toString() }
    }

    // 1 位错误
    for (let index = 0; index < infoModuli.length; index += 1) {
      for (let value = 0; value < Number(infoModuli[index]); value += 1) {
        if (value === residues[index]) continue
        const candidate = [...residues]
        candidate[index] = value
        const fixed = attempt(candidate, [{ index, was: residues[index], now: value }])
        if (fixed) return fixed
      }
    }
    // 2 位错误
    for (let i = 0; i < infoModuli.length; i += 1) {
      for (let j = i + 1; j < infoModuli.length; j += 1) {
        for (let vi = 0; vi < Number(infoModuli[i]); vi += 1) {
          if (vi === residues[i]) continue
          for (let vj = 0; vj < Number(infoModuli[j]); vj += 1) {
            if (vj === residues[j]) continue
            const candidate = [...residues]
            candidate[i] = vi
            candidate[j] = vj
            const fixed = attempt(candidate, [{ index: i, was: residues[i], now: vi }, { index: j, was: residues[j], now: vj }])
            if (fixed) return fixed
          }
        }
      }
    }
    return { ok: false, corrected: false, errors: -1 }
  }

  const stats = () => ({
    infoModuli: infoModuli.map(Number),
    checkModuli: checkModuli.map(Number),
    capacity: M.toString(),
    bits,
    redundancy: checkCount,
  })

  return { encode, decode, verify, correct, stats, moduli: allModuli, infoModuli, checkModuli, packFields, unpackFields }
}

const text = (value) => [{ type: 'text', text: value }]

export function registerCrtTool(ctx, { crt, logger = console } = {}) {
  const tool = {
    name: 'crt',
    description: '中国剩余定理编码：encode 把整数拆成余数，decode 重建，verify 校验/纠错，pack 多字段打包。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['encode', 'decode', 'verify', 'correct', 'stats', 'pack', 'sketch'] },
        value: { type: 'string', description: '要编码的整数（十进制字符串）' },
        residues: { type: 'array', items: { type: 'number' }, description: 'decode/verify 时的余数' },
        fields: { type: 'array', items: { type: 'number' }, description: 'pack 时的字段值' },
        ranges: { type: 'array', items: { type: 'number' }, description: 'pack 时每个字段的取值范围' },
        text: { type: 'string', description: 'sketch 时的第一段文本' },
        textB: { type: 'string', description: 'sketch 时的第二段文本（可选）' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' } }, additionalProperties: true }, render: (_a, v) => text(v.summary ?? '') },
    async execute(args) {
      if (args.action === 'encode') {
        const residues = crt.encode(args.value)
        return { ok: true, residues, summary: `余数：${residues.join(', ')}（模数 ${crt.moduli.map(Number).join(',')}）` }
      }
      if (args.action === 'correct') {
        const result = crt.correct(args.residues ?? [])
        return {
          ok: result.ok,
          ...result,
          summary: result.ok
            ? (result.corrected ? `已纠正：第 ${result.index} 位 ${result.was} → ${result.now}，真值 ${result.value}` : `无需纠正，真值 ${result.value}`)
            : '无法纠正（错误超过 1 位）',
        }
      }
      if (args.action === 'decode' || args.action === 'verify') {
        const result = args.action === 'verify' ? crt.verify(args.residues) : { value: crt.decode(args.residues).toString() }
        return { ok: true, ...result, summary: `重建值：${result.value}` + (result.repaired ? `；第 ${result.repaired.index} 位被改坏（${result.repaired.was}→应为 ${result.repaired.shouldBe}）` : '') }
      }
      if (args.action === 'sketch') {
        const result = args.textB ? sketchDistance(args.text, args.textB) : { residuesA: residueSketch(args.text) }
        return { ok: true, ...result, summary: `余数素描：${(result.residuesA ?? []).join(',')}` + (result.distance !== undefined ? `；距离 ${result.distance}` : '') }
      }
      if (args.action === 'pack') {
        const packed = crt.packFields(args.fields ?? [], args.ranges ?? [])
        const back = crt.unpackFields(packed.value, args.ranges ?? [])
        return { ok: true, value: packed.value.toString(), capacity: packed.capacity.toString(), bits: packed.bits, unpacked: back, summary: `打包成 ${packed.value}（容量 ${packed.capacity}，${packed.bits} bit），还原：${back.join(',')}` }
      }
      const stats = crt.stats()
      return { ok: true, ...stats, summary: `信息模数 ${stats.infoModuli.join('×')} → 容量 ${stats.capacity}（${stats.bits} bit）；校验模数 ${stats.checkModuli.join('×')}` }
    },
  }
  const register = (target) => {
    try { target.tools?.register(tool); logger.info?.('dsh-dafeiyu: crt 工具已注册') } catch (error) { logger.error?.(`注册 crt 失败: ${error?.message ?? error}`) }
  }
  if (typeof ctx.inject === 'function') ctx.inject(['tools'], register)
  else register(ctx)
}
