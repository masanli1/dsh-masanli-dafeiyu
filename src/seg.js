// 大肥鱼专用：用训练好的 U-Net 给图片抠图，并能直接做成骨骼动画 clip。
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ROOT = join(homedir(), 'Downloads/dfy')
export const SEG_PYTHON = join(ROOT, '3d-venv/bin/python')
const SEG_SCRIPT = join(ROOT, 'seg-train/seg_pet.py')

export function createSegService({ logger = console } = {}) {
  const call = (args) => new Promise((resolve, reject) => {
    import('node:child_process').then(({ spawn }) => {
      if (!existsSync(SEG_PYTHON) || !existsSync(SEG_SCRIPT)) {
        reject(new Error('缺少分割脚本或 Python 环境'))
        return
      }
      const child = spawn(SEG_PYTHON, [SEG_SCRIPT, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      let err = ''
      child.stdout.on('data', (chunk) => { out += chunk })
      child.stderr.on('data', (chunk) => { err += chunk })
      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) resolve(out.trim())
        else reject(new Error((err || out).slice(-400) || `退出码 ${code}`))
      })
    })
  })

  const matte = async (input, output) => ({ output, log: await call(['matte', input, output]) })
  const clip = async (input, name, action = 'alive') => {
    const output = await call(['clip', input, name, action])
    return { name, action, output }
  }
  return { matte, clip }
}

const text = (value) => [{ type: 'text', text: value }]

export function registerSegTool(ctx, { seg, logger = console } = {}) {
  const tool = {
    name: 'dfy-seg',
    description: '抠图/做动作：用训练好的 U-Net 把图片里的宠物抠成透明 PNG，或直接生成骨骼动画 clip。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['matte', 'clip'], description: 'matte=只抠图，clip=抠图并生成动作' },
        input: { type: 'string', description: '输入图片绝对路径' },
        output: { type: 'string', description: 'matte 时的输出路径' },
        name: { type: 'string', description: 'clip 时的动作名（英文）' },
        motion: { type: 'string', enum: ['alive', 'wave', 'nod', 'walk'], description: 'clip 的骨骼动作' },
      },
      required: ['action', 'input'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' } }, additionalProperties: true }, render: (_a, v) => text(v.summary ?? '') },
    async execute(args) {
      try {
        if (args.action === 'matte') {
          const output = args.output ?? args.input.replace(/\.(png|jpg|jpeg|webp)$/i, '-matte.png')
          const result = await seg.matte(args.input, output)
          return { ok: true, ...result, summary: `抠图完成：${result.output}` }
        }
        const name = (args.name ?? 'custom').replace(/[^a-zA-Z0-9_]/g, '')
        const result = await seg.clip(args.input, name, args.motion ?? 'alive')
        return { ok: true, ...result, summary: `已生成动作 ${result.name}（${result.output}），重启大肥鱼后可用 /emote?clip=${result.name}_${args.motion ?? 'alive'}` }
      } catch (error) {
        return { ok: false, summary: `失败：${error?.message ?? error}` }
      }
    },
  }
  const register = (target) => {
    try { target.tools?.register(tool); logger.info?.('dsh-dafeiyu: dfy-seg 工具已注册') } catch (error) { logger.error?.(`注册抠图工具失败: ${error?.message ?? error}`) }
  }
  if (typeof ctx.inject === 'function') ctx.inject(['tools'], register)
  else register(ctx)
}
