// 进化：互动攒经验，外表分阶段变化（光晕 → 星点 → 王冠）。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { writeJsonAtomic } from './atomic.js'

export const EVOLUTION_PATH = join(homedir(), '.dsh', 'dsh-dafeiyu-evolution.json')

export const STAGES = [
  { level: 0, name: '初生', xp: 0 },
  { level: 1, name: '成长', xp: 60 },
  { level: 2, name: '闪耀', xp: 240 },
  { level: 3, name: '完全体', xp: 700 },
  { level: 4, name: '传说', xp: 1800 },
]

const stageOf = (xp) => [...STAGES].reverse().find((stage) => xp >= stage.xp) ?? STAGES[0]

export function createEvolutionStore({ path = EVOLUTION_PATH, logger = console } = {}) {
  let data = { xp: 0, born: new Date().toISOString() }
  try { data = { ...data, ...JSON.parse(readFileSync(path, 'utf8')) } } catch {}

  const save = () => {
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeJsonAtomic(path, data)
    } catch (error) { logger.warn?.(`dsh-dafeiyu evolution: 写入失败: ${error?.message ?? error}`) }
  }

  const addXp = (amount) => {
    const before = stageOf(data.xp)
    data.xp += Math.max(0, Number(amount) || 0)
    const after = stageOf(data.xp)
    save()
    return { before, after, evolved: after.level > before.level, xp: data.xp }
  }

  const snapshot = () => {
    const stage = stageOf(data.xp)
    const next = STAGES.find((item) => item.xp > data.xp)
    return {
      xp: data.xp,
      stage: stage.name,
      level: stage.level,
      next: next ? { name: next.name, need: next.xp - data.xp } : null,
      progress: next ? Number(((data.xp - stage.xp) / (next.xp - stage.xp)).toFixed(2)) : 1,
    }
  }

  return { addXp, snapshot, path, data }
}

const text = (value) => [{ type: 'text', text: value }]

export function registerEvolutionTool(ctx, { evolution, logger = console } = {}) {
  const tool = {
    name: 'evolution',
    description: '查看大肥鱼的进化状态（经验、阶段、距离下一阶段还差多少）。',
    parameters: { type: 'object', properties: { action: { type: 'string', enum: ['status'] } }, required: ['action'], additionalProperties: false },
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' } }, additionalProperties: true }, render: (_a, v) => text(v.summary ?? '') },
    async execute() {
      const snap = evolution.snapshot()
      return {
        ok: true,
        ...snap,
        summary: `当前阶段：${snap.stage}（Lv.${snap.level}）· 经验 ${snap.xp}`
          + (snap.next ? `\n距离「${snap.next.name}」还差 ${snap.next.need} 点` : '\n已经是最高阶段了'),
      }
    },
  }
  const register = (target) => {
    try { target.tools?.register(tool); logger.info?.('dsh-dafeiyu: evolution 工具已注册') } catch (error) { logger.error?.(`注册 evolution 失败: ${error?.message ?? error}`) }
  }
  if (typeof ctx.inject === 'function') ctx.inject(['tools'], register)
  else register(ctx)
}
