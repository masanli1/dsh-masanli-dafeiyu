// 长期记忆：跨会话共享的偏好/事实，存在 ~/Documents/大肥鱼记忆.json，可手动管理。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { writeJsonAtomic } from './atomic.js'

export const MEMORY_PATH = join(homedir(), 'Documents', '大肥鱼记忆.json')

export function createMemoryStore({ path = MEMORY_PATH, logger = console } = {}) {
  let items = []
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    if (Array.isArray(raw?.items)) items = raw.items.filter((item) => item && typeof item.key === 'string')
  } catch {
    // 首次运行没有文件
  }

  const save = () => {
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeJsonAtomic(path, { items })
    } catch (error) {
      logger.warn?.(`dsh-dafeiyu memory: 写入失败: ${error?.message ?? error}`)
    }
  }

  const add = (key, value) => {
    const name = String(key ?? '').trim()
    const text = String(value ?? '').trim()
    if (!name || !text) throw new Error('key 和 value 都不能为空')
    const existing = items.find((item) => item.key === name)
    if (existing) {
      existing.value = text
      existing.at = new Date().toISOString()
    } else {
      items.push({ id: `m${Date.now().toString(36)}`, key: name, value: text, at: new Date().toISOString() })
    }
    save()
    return list()
  }

  const remove = (idOrKey) => {
    const target = String(idOrKey ?? '')
    const before = items.length
    items = items.filter((item) => item.id !== target && item.key !== target)
    if (items.length !== before) save()
    return list()
  }

  const clear = () => {
    items = []
    save()
    return list()
  }

  const list = () => items.map((item) => ({ ...item }))
  const summary = (limit = 12) => items.slice(0, limit).map((item) => `- ${item.key}：${item.value}`).join('\n')

  return { path, add, remove, clear, list, summary }
}

export function registerMemoryTool(ctx, { memory, logger = console } = {}) {
  const tool = {
    name: 'memory',
    description: '记住或查看用户的长期偏好/事实（跨会话共享）。action：add / list / remove / clear。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'list', 'remove', 'clear'] },
        key: { type: 'string', description: '记忆项名称，如 名字、喜欢的颜色' },
        value: { type: 'string', description: '记忆内容' },
        target: { type: 'string', description: 'remove 时用：记忆 id 或 key' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          items: { type: 'array', items: { type: 'object', additionalProperties: true } },
          path: { type: 'string' },
        },
        additionalProperties: true,
      },
      render: (_args, value) => [{
        type: 'text',
        text: (value.items ?? []).length
          ? `长期记忆（${(value.items ?? []).length} 条，${value.path}）：\n` + value.items.map((item) => `- ${item.key}：${item.value}`).join('\n')
          : '长期记忆是空的',
      }],
    },
    async execute(args) {
      const action = String(args.action ?? '')
      if (action === 'add') memory.add(args.key, args.value)
      else if (action === 'remove') memory.remove(args.target)
      else if (action === 'clear') memory.clear()
      else if (action !== 'list') throw new Error(`未知 action：${action}`)
      return { ok: true, items: memory.list(), path: memory.path }
    },
  }
  const register = (target) => {
    try {
      if (!target.tools?.register) return
      target.tools.register(tool)
      logger.info?.('dsh-dafeiyu: memory 工具已注册')
    } catch (error) {
      logger.error?.(`dsh-dafeiyu 注册记忆工具失败: ${error?.message ?? error}`)
    }
  }
  if (typeof ctx.inject === 'function') ctx.inject(['tools'], register)
  else register(ctx)
}
