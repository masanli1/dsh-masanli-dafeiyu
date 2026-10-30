// 三层闭环：上层（强化学习）选指令 → 中层（DSH 会话）执行 → 下层结果回到上层评估 → 更新 Q。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

export const DIRECTOR_PATH = join(homedir(), '.dsh', 'dsh-dafeiyu-director.json')
const WORKSPACE = join(homedir(), 'Documents', '大肥鱼工作台')

export const ORDERS = [
  { id: 'status_report', title: '巡检任务', prompt: '【内部巡检】看一眼当前有没有正在跑的任务、有没有失败的，用两句话汇报，不要调用工具。' },
  { id: 'daily_summary', title: '总结今天', prompt: '【内部巡检】用两句话总结今天做过的事（从长期记忆和最近对话推断），不要调用工具。' },
  { id: 'english_word', title: '今日单词', prompt: '【内部巡检】给出今天的英语单词和例句，一句话，不要调用工具。' },
  { id: 'routine_check', title: '作息建议', prompt: '【内部巡检】根据作息数据给一条作息建议，一句话，不要调用工具。' },
  { id: 'memory_tidy', title: '整理记忆', prompt: '【内部巡检】回顾长期记忆，指出一条值得记住或该忘掉的，一句话，不要调用工具。' },
  { id: 'idle_chat', title: '主动搭话', prompt: '【内部巡检】主动跟主人搭一句话，短、有性格，不要调用工具。' },
]

const hourBucket = (date = new Date()) => {
  const hour = date.getHours()
  if (hour < 6) return 'night'
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
}

export function createDirector({ ctx, policy, logger = console, orders = ORDERS, shareCwd = WORKSPACE } = {}) {
  let sessionId = ''
  let store = { sessionId: '', history: [] }
  try { store = { ...store, ...JSON.parse(readFileSync(DIRECTOR_PATH, 'utf8')) } } catch {}
  sessionId = store.sessionId ?? ''

  const save = () => {
    try {
      mkdirSync(dirname(DIRECTOR_PATH), { recursive: true })
      writeFileSync(DIRECTOR_PATH, `${JSON.stringify(store, null, 2)}\n`)
    } catch (error) { logger.warn?.(`dsh-dafeiyu director: 写入失败: ${error?.message ?? error}`) }
  }

  const ensureSession = async () => {
    const controller = ctx.get?.('sessionController')
    if (!controller) return ''
    if (sessionId) {
      try {
        const query = ctx.get?.('sessionQuery')
        const observation = await query?.observeSession?.(sessionId)
        try { observation?.[Symbol.dispose]?.() } catch {}
        return sessionId
      } catch { sessionId = '' }
    }
    if (!controller.create) return ''
    try { mkdirSync(shareCwd, { recursive: true }) } catch {}
    const created = await controller.create({ cwd: shareCwd })
    sessionId = String(created?.sessionId ?? '')
    if (sessionId) {
      try { await controller.rename?.({ sessionId, title: '大肥鱼调度台' }) } catch {}
      store.sessionId = sessionId
      save()
    }
    return sessionId
  }

  // 用与宠物会话相同的模型
  const adoptModel = async (target, resolver) => {
    const controller = ctx.get?.('sessionController')
    try {
      const selection = resolver?.()
      if (selection?.provider && selection?.model) {
        await controller?.selectModel?.({ sessionId: target, provider: selection.provider, model: selection.model })
      }
    } catch {}
  }

  // 下层：读会话事件，判断这一单成功还是失败
  const evaluate = async (target, timeoutMs = 120000) => {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 1200))
      try {
        const query = ctx.get?.('sessionQuery')
        const observation = await query?.observeSession?.(target)
        const events = observation?.events ?? []
        try { observation?.[Symbol.dispose]?.() } catch {}
        const ended = [...events].reverse().find((event) => event?.type === 'turn/end')
        if (!ended) continue
        const kind = ended?.data?.kind ?? 'ok'
        const assistant = [...events].reverse().find((event) => event?.type === 'assistant/message')
        const text = assistant?.data?.message?.content?.filter?.((part) => part.type === 'text')?.map((part) => part.text).join('') ?? ''
        return { ok: kind === 'ok' || kind === 'completed', kind, text: text.slice(0, 400), elapsedMs: Date.now() - started }
      } catch {}
    }
    return { ok: false, kind: 'timeout', text: '', elapsedMs: Date.now() - started }
  }

  const runOnce = async ({ resolver, reason = 'manual' } = {}) => {
    const target = await ensureSession()
    if (!target) return { ok: false, error: '无法创建调度会话' }
    await adoptModel(target, resolver)
    const context = `${hourBucket()}|${reason}`
    const choice = policy.choose(context)
    const order = orders.find((item) => item.id === choice.action) ?? orders[0]
    const controller = ctx.get?.('sessionController')
    const admission = new AbortController()
    const receipt = await controller.prompt({
      sessionId: target,
      requestId: randomUUID(),
      mode: 'queue',
      content: [{ type: 'text', text: order.prompt }],
      clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }, admission.signal)
    if (receipt?.accepted === false) {
      policy.update(context, order.id, -1)
      return { ok: false, order: order.id, error: receipt?.error ?? '未受理' }
    }
    const result = await evaluate(target)
    const reward = result.ok ? 1 : -1
    policy.update(context, order.id, reward)
    const record = { at: new Date().toISOString(), order: order.id, context, reward, ...result }
    store.history = [{ at: record.at, order: order.id, context, reward, kind: result.kind, text: result.text.slice(0, 160) }, ...(store.history ?? [])].slice(0, 100)
    save()
    logger.info?.(`dsh-dafeiyu director: ${order.id} → ${result.ok ? '成功' : '失败'} (${result.kind})，奖励 ${reward}`)
    return { ok: result.ok, order: order.id, orderTitle: order.title, context, reward, result }
  }

  const status = () => ({
    sessionId,
    runs: store.history?.length ?? 0,
    recent: (store.history ?? []).slice(0, 8),
    policy: policy.status(),
  })

  return { runOnce, status, ensureSession, orders }
}

const text = (value) => [{ type: 'text', text: value }]

export function registerDirectorTool(ctx, { director, logger = console } = {}) {
  const tool = {
    name: 'director',
    description: '三层闭环调度：上层用强化学习挑一条指令，交给 DSH 执行，再把结果反馈给上层更新策略。',
    parameters: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['run', 'status'] } },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' } }, additionalProperties: true }, render: (_a, v) => text(v.summary ?? '') },
    async execute(args) {
      if (args.action === 'status') {
        const stats = director.status()
        return { ok: true, ...stats, summary: `已执行 ${stats.runs} 单；最近：` + (stats.recent.map((item) => `${item.order}(${item.reward > 0 ? '+' : ''}${item.reward})`).join('、') || '还没有') }
      }
      const result = await director.runOnce({ reason: 'tool' })
      return { ok: result.ok, ...result, summary: result.ok ? `执行成功：${result.orderTitle}（奖励 +1）` : `执行失败：${result.order ?? ''}（奖励 −1）` }
    },
  }
  const register = (target) => {
    try { target.tools?.register(tool); logger.info?.('dsh-dafeiyu: director 工具已注册') } catch (error) { logger.error?.(`注册 director 失败: ${error?.message ?? error}`) }
  }
  if (typeof ctx.inject === 'function') ctx.inject(['tools'], register)
  else register(ctx)
}
