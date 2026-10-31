// 技能系统：把记忆升格为"可复用的技能"。
// 每条技能在矩阵记忆里占一个排列（逆序数 = 它的指纹），
// 命中次数达标后从"候选"升为"已掌握"。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { writeJsonAtomic } from './atomic.js'

export const SKILLS_PATH = join(homedir(), '.dsh', 'dsh-dafeiyu-skills.json')
const PROMOTE_AT = 3

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

export function createSkillStore({ path = SKILLS_PATH, memory, threshold = 0.5, logger = console } = {}) {
  let data = { skills: [] }
  try { data = { ...data, ...JSON.parse(readFileSync(path, 'utf8')) } } catch {}

  const save = () => {
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeJsonAtomic(path, data)
    } catch (error) { logger.warn?.(`dsh-dafeiyu skills: 写入失败: ${error?.message ?? error}`) }
  }

  // 学一条技能：触发词 + 执行方式（模板/工具），矩阵里登记指纹
  const learn = ({ name, trigger, kind = 'template', payload = '', note = '' }) => {
    const id = String(name ?? trigger ?? '').trim()
    if (!id) return null
    const existing = data.skills.find((skill) => skill.id === id)
    if (existing) {
      existing.trigger = String(trigger ?? existing.trigger)
      existing.kind = kind
      existing.payload = String(payload ?? existing.payload)
      existing.note = note || existing.note
      existing.at = Date.now()
      save()
      return existing
    }
    const fingerprint = memory?.remember?.(`skill:${id}`, `${trigger} → ${payload}`) ?? null
    const skill = {
      id,
      trigger: String(trigger ?? id),
      kind,
      payload,
      note,
      hits: 0,
      misses: 0,
      level: 'candidate',
      rank: fingerprint?.rank ?? null,
      inversion: fingerprint?.inversion ?? [],
      at: Date.now(),
    }
    data.skills.push(skill)
    save()
    return skill
  }

  const match = (query) => {
    const vector = grams(query)
    let best = null
    let bestScore = 0
    for (const skill of data.skills) {
      const score = cosine(vector, grams(skill.trigger))
      if (score > bestScore) { bestScore = score; best = skill }
    }
    if (!best || bestScore < threshold) return null
    best.hits += 1
    if (best.hits >= PROMOTE_AT) best.level = 'mastered'
    save()
    return { ...best, score: Number(bestScore.toFixed(3)) }
  }

  // 实际执行：模板替换 {input}、{date}
  const run = (skill, input = '') => {
    if (!skill) return null
    if (skill.kind === 'template') {
      return skill.payload
        .replaceAll('{input}', String(input))
        .replaceAll('{date}', new Date().toISOString().slice(0, 10))
    }
    if (skill.kind === 'tool') {
      return { tool: skill.payload, input }
    }
    return null
  }

  const stats = () => ({
    total: data.skills.length,
    mastered: data.skills.filter((skill) => skill.level === 'mastered').length,
    candidates: data.skills.filter((skill) => skill.level === 'candidate').length,
    top: [...data.skills].sort((a, b) => b.hits - a.hits).slice(0, 6)
      .map((skill) => ({ id: skill.id, hits: skill.hits, level: skill.level, rank: skill.rank })),
  })

  const list = (limit = 20) => data.skills.slice(-limit).map((skill) => ({
    id: skill.id, trigger: skill.trigger, kind: skill.kind, hits: skill.hits, level: skill.level,
  }))

  return { learn, match, run, stats, list, path }
}

const text = (value) => [{ type: 'text', text: value }]

export function registerSkillTool(ctx, { skills, logger = console } = {}) {
  const tool = {
    name: 'dfy-skill',
    description: '技能库：把记忆升格成可复用技能（learn 学、match 匹配、list 列表、stats 统计）。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['learn', 'match', 'run', 'list', 'stats'] },
        skill: { type: 'string', description: '技能名（不要用 name，避免和工具名冲突）' },
        trigger: { type: 'string' },
        kind: { type: 'string', enum: ['template', 'tool'] },
        payload: { type: 'string' },
        query: { type: 'string' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' } }, additionalProperties: true }, render: (_a, v) => text(v.summary ?? '') },
    async execute(args) {
      if (args.action === 'learn') {
        const skill = skills.learn({ name: args.skill ?? args.trigger, trigger: args.trigger, kind: args.kind, payload: args.payload })
        return { ok: Boolean(skill), skill, summary: skill ? `已登记技能「${skill.id}」（指纹排名 ${skill.rank}）` : '缺少 name/trigger' }
      }
      if (args.action === 'match' || args.action === 'run') {
        const hit = skills.match(args.query)
        if (!hit) return { ok: false, summary: '没有匹配的技能' }
        const output = args.action === 'run' ? skills.run(hit, args.query) : undefined
        return JSON.parse(JSON.stringify({ ok: true, hit, output, summary: `匹配「${hit.id}」（${hit.score}，命中 ${hit.hits} 次）` + (output ? `：${output}` : '') }))
      }
      if (args.action === 'list') {
        const items = skills.list()
        return { ok: true, items, summary: items.map((item) => `${item.id}(${item.level},${item.hits})`).join('、') || '技能库是空的' }
      }
      const stats = skills.stats()
      return { ok: true, ...stats, summary: `技能 ${stats.total} 个（已掌握 ${stats.mastered}）` }
    },
  }
  const register = (target) => {
    try { target.tools?.register(tool); logger.info?.('dsh-dafeiyu: skill 工具已注册') } catch (error) { logger.error?.(`注册 skill 失败: ${error?.message ?? error}`) }
  }
  if (typeof ctx.inject === 'function') ctx.inject(['tools'], register)
  else register(ctx)
}
