// 小宇宙模拟法（Micro-Universe Simulation, MUS）——"定果寻因"的实现：
//   定果：先给定想要的结果（目标值 / 约束）
//   寻因：随机生成海量"世界线"（参数组合），用模拟器+约束筛选，唯一幸存者就是"现实"
//   滚动：每次只坍缩当前时刻，下一次重新采样（rolling horizon）
// 这是逆问题求解器：不设计算法，只生成-评估-选择。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { writeJsonAtomic } from './atomic.js'

export const MUS_PATH = join(homedir(), '.dsh', 'dsh-dafeiyu-mus.json')

// 安全表达式求值：只允许数学运算与白名单函数
function compile(expression, names = []) {
  const safe = String(expression ?? '')
  if (!/^[\p{L}\p{N}_+\-*/().,\s<>!=?:&|%^]*$/u.test(safe)) throw new Error('表达式里有不允许的字符')
  // 屏蔽危险标识符
  for (const word of ['require', 'process', 'global', 'import', 'eval', 'Function', 'this', 'constructor']) {
    if (new RegExp(`\\b${word}\\b`).test(safe)) throw new Error(`表达式里不允许 ${word}`)
  }
  const bindings = names
    .filter((name) => /^[\p{L}_][\p{L}\p{N}_]*$/u.test(name))
    .map((name) => `const ${name} = p[${JSON.stringify(name)}];`)
    .join(' ')
  const fn = new Function('p', `const {sin,cos,tan,abs,min,max,floor,ceil,round,sqrt,pow,log,exp,PI,E}=Math; ${bindings} return (${safe});`)
  return (params) => fn(params)
}

const rand = (min, max) => min + Math.random() * (max - min)

export function createMus({ path = MUS_PATH, logger = console } = {}) {
  let data = { specs: {}, realities: [], collapses: 0 }
  try { data = { ...data, ...JSON.parse(readFileSync(path, 'utf8')) } } catch {}

  const save = () => {
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeJsonAtomic(path, data)
    } catch (error) { logger.warn?.(`dsh-dafeiyu mus: 写入失败: ${error?.message ?? error}`) }
  }

  const define = (name, spec) => {
    const id = String(name ?? '').trim()
    if (!id) throw new Error('缺少 name')
    const parameters = Array.isArray(spec?.parameters) ? spec.parameters.map((item) => ({
      name: String(item.name), min: Number(item.min ?? 0), max: Number(item.max ?? 1),
    })) : []
    if (!parameters.length) throw new Error('至少需要一个参数')
    const entry = {
      name: id,
      parameters,
      objective: String(spec?.objective ?? '0'),
      constraints: Array.isArray(spec?.constraints) ? spec.constraints.map(String) : [],
      target: spec?.target === undefined ? null : Number(spec.target),
      at: Date.now(),
    }
    // 先编译一遍，早失败
    const names = parameters.map((item) => item.name)
    compile(entry.objective, names)
    for (const constraint of entry.constraints) compile(constraint, names)
    data.specs[id] = entry
    save()
    return entry
  }

  // 定果寻因：随机采样 → 约束过滤 → 打分 → 幸存者
  const simulate = (name, { samples = 4000 } = {}) => {
    const spec = data.specs[String(name ?? '')]
    if (!spec) throw new Error(`没有这个宇宙：${name}`)
    const names = spec.parameters.map((item) => item.name)
    const objective = compile(spec.objective, names)
    const constraints = spec.constraints.map((constraint) => compile(constraint, names))
    let best = null
    let accepted = 0
    const scores = []
    for (let i = 0; i < Math.max(1, Math.min(200000, samples)); i += 1) {
      const world = {}
      for (const parameter of spec.parameters) world[parameter.name] = rand(parameter.min, parameter.max)
      let ok = true
      for (const constraint of constraints) {
        try { if (!constraint(world)) { ok = false; break } } catch { ok = false; break }
      }
      if (!ok) continue
      let score
      try { score = Number(objective(world)) } catch { continue }
      if (!Number.isFinite(score)) continue
      accepted += 1
      if (scores.length < 200) scores.push(score)
      // 目标值：越接近 target 越好；没有 target 时越大越好
      const fitness = spec.target === null ? score : -Math.abs(score - spec.target)
      if (!best || fitness > best.fitness) best = { ...world, score, fitness }
    }
    data.collapses += 1
    const reality = {
      at: Date.now(),
      universe: spec.name,
      samples: Math.max(1, Math.min(200000, samples)),
      accepted,
      best: best ? { ...best } : null,
      target: spec.target,
    }
    data.realities = [reality, ...(data.realities ?? [])].slice(0, 100)
    save()
    return {
      ...reality,
      acceptedRate: Number((accepted / Math.max(1, reality.samples) * 100).toFixed(2)),
      spread: scores.length > 1 ? Number((Math.max(...scores) - Math.min(...scores)).toFixed(4)) : 0,
    }
  }

  const stats = () => ({
    universes: Object.keys(data.specs).length,
    collapses: data.collapses,
    recent: (data.realities ?? []).slice(0, 5),
    specs: Object.entries(data.specs).map(([name, spec]) => ({
      name,
      parameters: spec.parameters.map((item) => `${item.name}[${item.min},${item.max}]`).join(' '),
      objective: spec.objective,
      target: spec.target,
    })),
  })

  return { define, simulate, stats, path }
}

const text = (value) => [{ type: 'text', text: value }]

export function registerMusTool(ctx, { mus, logger = console } = {}) {
  const tool = {
    name: 'mus',
    description: '小宇宙模拟法（定果寻因）：define 定义宇宙，simulate 随机采样+约束筛选出唯一现实，stats 查看。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['define', 'simulate', 'stats'] },
        name: { type: 'string', description: '宇宙名' },
        parameters: {
          type: 'array', description: '参数表：[{name,min,max}]',
          items: { type: 'object', properties: { name: { type: 'string' }, min: { type: 'number' }, max: { type: 'number' } }, required: ['name'] },
        },
        objective: { type: 'string', description: '打分表达式，可用参数名与 Math 函数' },
        constraints: { type: 'array', items: { type: 'string' }, description: '约束表达式，为真才保留' },
        target: { type: 'number', description: '想要的结果值（定果）；不填则越大越好' },
        samples: { type: 'number', description: '采样世界线数量（默认 4000）' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' } }, additionalProperties: true }, render: (_a, v) => text(v.summary ?? '') },
    async execute(args) {
      if (args.action === 'define') {
        const spec = mus.define(args.name, args)
        return { ok: true, spec, summary: `宇宙「${spec.name}」已定义：${spec.parameters.map((p) => `${p.name}∈[${p.min},${p.max}]`).join(' ')}，目标 ${spec.target ?? '越大越好'}` }
      }
      if (args.action === 'simulate') {
        const result = mus.simulate(args.name, { samples: args.samples })
        if (!result.best) return { ok: false, summary: '所有世界线都被物理规则杀死了（约束太严）' }
        const world = Object.entries(result.best).filter(([key]) => key !== 'fitness').map(([key, value]) => `${key}=${Number(value).toFixed(5)}`).join(' ')
        return { ok: true, ...result, summary: `坍缩完成：${world}（得分 ${result.best.score.toFixed(5)}，接受率 ${result.acceptedRate}%）` }
      }
      const stats = mus.stats()
      return { ok: true, ...stats, summary: `宇宙 ${stats.universes} 个 · 累计坍缩 ${stats.collapses} 次` }
    },
  }
  const register = (target) => {
    try { target.tools?.register(tool); logger.info?.('dsh-dafeiyu: mus 工具已注册') } catch (error) { logger.error?.(`注册 mus 失败: ${error?.message ?? error}`) }
  }
  if (typeof ctx.inject === 'function') ctx.inject(['tools'], register)
  else register(ctx)
}
