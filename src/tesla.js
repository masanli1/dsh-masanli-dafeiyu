// 特斯拉阀 · 复刻：把 tesla_valve_v2 的阀阵/水塔网络接进来，
// 并加一层「复刻」——朝想要的结果逐轮试阀（哪些边该开、该关），存成学会的功能。
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findPython } from './denoise.js'

const here = dirname(fileURLToPath(import.meta.url))
export const TESLA_CLI = join(here, '..', 'python', 'tesla', 'tesla_cli.py')
export const SKILLS_DIR = join(homedir(), 'Documents', '大肥鱼技能')

function runCli(python, args, { timeoutMs = 300000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, [TESLA_CLI, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch {}
      reject(new Error('复刻超时'))
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-2000) })
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('exit', (code) => {
      clearTimeout(timer)
      const lines = stdout.split('\n').filter((line) => line.trim().startsWith('{'))
      const parsed = lines.map((line) => { try { return JSON.parse(line) } catch { return null } }).filter(Boolean)
      if (code !== 0) return reject(new Error(stderr.split('\n').slice(-2).join(' ') || `退出码 ${code}`))
      resolve(parsed)
    })
  })
}

export function listSkills() {
  if (!existsSync(SKILLS_DIR)) return []
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const metaPath = join(SKILLS_DIR, entry.name, 'meta.json')
      try { return JSON.parse(readFileSync(metaPath, 'utf8')) } catch { return { name: entry.name } }
    })
}

const text = (value) => [{ type: 'text', text: value }]

export function registerTeslaTool(ctx, { logger = console } = {}) {
  const tool = {
    name: 'tesla',
    description: [
      '特斯拉阀水塔网络（tesla_valve_v2）与「复刻」能力。',
      'action=simulate：跑一个样本，看 24 维出口水位向量和判定结果；',
      'action=replicate：复刻一个功能——给定目标数字，逐轮试阀（哪些边该开、该关、朝哪边），',
      '把能复现该结果的阀态存成一项学会的功能（默认 12 轮，约 10–30 秒）；',
      'action=use：用某项已学会的功能跑一个样本；action=skills：列出已学会的功能。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['simulate', 'replicate', 'use', 'skills', 'program-record', 'program-fit', 'program-run', 'program-compile', 'programs'] },
        sample: { type: 'integer', description: 'MNIST 测试样本序号（0–9999）' },
        target: { type: 'integer', description: 'replicate 时的目标数字 0–9' },
        name: { type: 'string', description: 'replicate 时给这项功能起的名' },
        rounds: { type: 'integer', description: 'replicate 轮数，默认 12' },
        skill: { type: 'string', description: 'use 时用哪项功能（skills 里列出的名字）' },
        samples: { type: 'array', items: { type: 'integer' }, description: 'program-record 时要记录的样本序号' },
        source: { type: 'string', description: '录制/拟合的起点：baseline、random、zero、技能名或程序名' },
        spec: {
          type: 'object',
          description: 'program-compile 的程序描述：{name, expr, output_dim}，expr 里可用 x(批量 784 维)、x0(单条)、n',
          additionalProperties: true,
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          summary: { type: 'string' },
          trace: { type: 'array', items: { type: 'object', additionalProperties: true } },
          skills: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
        additionalProperties: true,
      },
      render: (_args, value) => text(value.summary ?? ''),
    },
    async execute(args) {
      if (!existsSync(TESLA_CLI)) throw new Error('找不到 tesla_cli.py')
      const python = (await findPython({ logger })).bin
      const programs = () => {
        const dir = join(SKILLS_DIR, 'programs')
        if (!existsSync(dir)) return []
        return readdirSync(dir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => {
            try { return JSON.parse(readFileSync(join(dir, entry.name, 'meta.json'), 'utf8')) } catch { return { name: entry.name } }
          })
      }
      if (args.action === 'programs') {
        const items = programs()
        return {
          ok: true,
          skills: items,
          summary: items.length
            ? `复刻过的程序（${items.length} 个）：\n` + items.map((item) => `- ${item.name}：${item.examples ?? 0} 个样例，MSE ${item.mse ?? '—'}`).join('\n')
            : '还没有复刻过任何程序',
        }
      }
      if (args.action === 'program-record') {
        const name = String(args.name ?? '').trim()
        if (!name) throw new Error('program-record 需要 name')
        const samples = (args.samples ?? []).map(Number).filter((value) => Number.isInteger(value))
        if (samples.length === 0) throw new Error('program-record 需要 samples（样本序号）')
        const extra = args.source ? ['--source', String(args.source)] : []
        const [result] = await runCli(python, ['program', '--name', name, '--record', ...samples.map(String), ...extra], { timeoutMs: 300000 })
        return { ok: true, ...result, summary: `已记录 ${result.count} 个样例到程序「${name}」` }
      }
      if (args.action === 'program-fit') {
        const name = String(args.name ?? '').trim()
        if (!name) throw new Error('program-fit 需要 name')
        const extra = args.source ? ['--source', String(args.source)] : []
        const lines = await runCli(python, ['program', '--name', name, '--fit', '--rounds', String(args.rounds ?? 20), ...extra], { timeoutMs: 1800000 })
        const done = lines.find((line) => line.event === 'fitted') ?? {}
        const trace = lines.filter((line) => line.event === 'start' || line.round)
        const opened = trace.reduce((sum, entry) => sum + (entry.opened ?? 0), 0)
        const closed = trace.reduce((sum, entry) => sum + (entry.closed ?? 0), 0)
        return {
          ok: true,
          ...done,
          trace,
          summary: `程序「${name}」复刻完成：累计试开 ${opened} 条边、试关 ${closed} 条边，最终 MSE ${done.mse}。`,
        }
      }
      if (args.action === 'program-run') {
        const name = String(args.name ?? '').trim()
        if (!name) throw new Error('program-run 需要 name')
        const [result] = await runCli(python, ['program', '--name', name, '--run', String(args.sample ?? 0)], { timeoutMs: 300000 })
        if (!result) throw new Error('没有拿到结果')
        return {
          ok: true,
          ...result,
          summary: `程序「${name}」跑样本 #${result.sample}（真值 ${result.true}），`
            + (result.mse_vs_recorded === null || result.mse_vs_recorded === undefined
              ? '该样本未记录过，输出为新计算。'
              : `与记录输出的 MSE = ${result.mse_vs_recorded}。`),
        }
      }
      if (args.action === 'program-compile') {
        const name = String(args.name ?? (args.spec && args.spec.name) ?? 'program').trim()
        if (!args.spec || !args.spec.expr) throw new Error('program-compile 需要 spec.expr（程序表达式）')
        const specPath = join(homedir(), '.cache', `dfy-tesla-${Date.now()}.json`)
        try { mkdirSync(dirname(specPath), { recursive: true }) } catch {}
        writeFileSync(specPath, JSON.stringify({ name, ...args.spec }, null, 2))
        const lines = await runCli(python, ['compile', '--spec', specPath, '--name', name,
          '--samples', String(args.samples ?? 32), '--rounds', String(args.rounds ?? 10),
          ...(args.source ? ['--source', String(args.source)] : [])], { timeoutMs: 1800000 })
        const done = lines.find((line) => line.event === 'compiled') ?? {}
        const trace = lines.filter((line) => line.event !== 'compiled')
        const opened = trace.reduce((sum, entry) => sum + (entry.opened ?? 0), 0)
        const closed = trace.reduce((sum, entry) => sum + (entry.closed ?? 0), 0)
        return {
          ok: true,
          ...done,
          trace,
          summary: `程序「${name}」编译完成：累计试开 ${opened} 条边、试关 ${closed} 条边；`
            + `训练 MSE ${done.mse}，留出集 MSE ${done.holdout_mse}（保真度 ${done.fidelity}）。`,
        }
      }
      if (args.action === 'skills') {
        const skills = listSkills()
        return {
          ok: true,
          skills,
          summary: skills.length
            ? `已学会 ${skills.length} 项功能：\n` + skills.map((skill) => `- ${skill.name}（目标 ${skill.target}，分数 ${skill.score}，准确率 ${Math.round((skill.accuracy ?? 0) * 100)}%）`).join('\n')
            : '还没有学会任何功能',
        }
      }
      if (args.action === 'simulate') {
        const [result] = await runCli(python, ['simulate', '--sample', String(args.sample ?? 0)], { timeoutMs: 180000 })
        if (!result) throw new Error('没有拿到结果')
        return {
          ok: true,
          ...result,
          summary: `样本 #${result.sample}（真值 ${result.true}）→ 判定 ${result.predicted}；出口 24 维向量已计算。`,
        }
      }
      if (args.action === 'replicate') {
        const target = Number(args.target)
        if (!Number.isInteger(target) || target < 0 || target > 9) throw new Error('target 必须是 0–9')
        const name = String(args.name ?? `digit-${target}`).replace(/[^\w.\-\u4e00-\u9fa5]+/g, '-')
        const lines = await runCli(python, ['replicate', '--target', String(target), '--name', name, '--rounds', String(args.rounds ?? 12)], { timeoutMs: 900000 })
        const done = lines.find((line) => line.event === 'done') ?? {}
        const trace = lines.filter((line) => line.event !== 'done')
        const opened = trace.reduce((sum, entry) => sum + (entry.opened ?? 0), 0)
        const closed = trace.reduce((sum, entry) => sum + (entry.closed ?? 0), 0)
        return {
          ok: true,
          ...done,
          trace,
          summary: `复刻完成：目标数字 ${target}，${trace.length} 轮内累计试开 ${opened} 条边、试关 ${closed} 条边，`
            + `相对 margin 从起点提升到 ${done.score}，存入 ${done.dir}。`,
        }
      }
      if (args.action === 'use') {
        const skill = String(args.skill ?? '').trim()
        if (!skill) throw new Error('use 需要 skill 名称')
        const [result] = await runCli(python, ['use', '--skill', join(SKILLS_DIR, skill), '--sample', String(args.sample ?? 0)], { timeoutMs: 180000 })
        if (!result) throw new Error('没有拿到结果')
        return { ok: true, ...result, summary: `用「${skill}」跑样本 #${result.sample}：真值 ${result.true} → 判定 ${result.predicted}` }
      }
      throw new Error(`未知 action：${args.action}`)
    },
  }

  const register = (target) => {
    try {
      if (!target.tools?.register) return
      target.tools.register(tool)
      logger.info?.('dsh-dafeiyu: tesla 工具已注册')
    } catch (error) {
      logger.error?.(`dsh-dafeiyu 注册 tesla 工具失败: ${error?.message ?? error}`)
    }
  }
  if (typeof ctx.inject === 'function') ctx.inject(['tools'], register)
  else register(ctx)
}
