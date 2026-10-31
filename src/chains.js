// 三条链：思考链（think）、推理链（reason）、联想链（associate）。
// 每个节点 = 一条记忆的地址（逆序数排名）+ 一句摘要；边带关系类型。
// 链可以持久化、回放、导出，供模型下次直接接着走。
import { mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { writeJsonAtomic } from './atomic.js'

export const CHAINS_PATH = join(homedir(), '.dsh', 'dsh-dafeiyu-chains.json')

export const KINDS = ['think', 'reason', 'associate']

export function createChainStore({ path = CHAINS_PATH, logger = console } = {}) {
  let data = { chains: [], open: {} }
  try { data = { ...data, ...JSON.parse(readFileSync(path, 'utf8')) } } catch {}

  const save = () => {
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeJsonAtomic(path, data)
    } catch (error) { logger.warn?.(`dsh-dafeiyu chains: 写入失败: ${error?.message ?? error}`) }
  }

  const open = (kind, title) => {
    if (!KINDS.includes(kind)) throw new Error(`未知的链类型：${kind}`)
    const chain = {
      id: `${kind}-${Date.now().toString(36)}`,
      kind,
      title: String(title ?? ''),
      nodes: [],
      at: Date.now(),
      closed: false,
    }
    data.chains = [chain, ...(data.chains ?? [])].slice(0, 200)
    data.open[kind] = chain.id
    save()
    return chain
  }

  const current = (kind) => (data.chains ?? []).find((chain) => chain.id === data.open?.[kind]) ?? null

  const add = (kind, node) => {
    let chain = current(kind)
    if (!chain) chain = open(kind, node?.title ?? '')
    const text = String(node?.text ?? '').trim()
    if (!text) return null
    const entry = {
      text,
      address: node?.address ?? null,
      relation: node?.relation ?? (chain.nodes.length ? 'next' : 'start'),
      at: Date.now(),
    }
    chain.nodes.push(entry)
    save()
    return entry
  }

  const close = (kind) => {
    const chain = current(kind)
    if (!chain) return null
    chain.closed = true
    chain.closedAt = Date.now()
    delete data.open[kind]
    save()
    return chain
  }

  const list = (kind = '', limit = 20) => (data.chains ?? [])
    .filter((chain) => !kind || chain.kind === kind)
    .slice(0, limit)
    .map((chain) => ({ id: chain.id, kind: chain.kind, title: chain.title, nodes: chain.nodes.length, closed: chain.closed, at: chain.at }))

  const show = (id) => (data.chains ?? []).find((chain) => chain.id === id) ?? null

  const replay = (id) => {
    const chain = show(id)
    if (!chain) return []
    return chain.nodes.map((node, index) => `${index + 1}. [${node.relation}] ${node.text}`)
  }

  const stats = () => {
    const byKind = {}
    for (const kind of KINDS) byKind[kind] = (data.chains ?? []).filter((chain) => chain.kind === kind).length
    return { total: (data.chains ?? []).length, byKind, open: { ...data.open } }
  }

  return { open, add, close, current, list, show, replay, stats, path }
}

const text = (value) => [{ type: 'text', text: value }]

export function registerChainTool(ctx, { chains, logger = console } = {}) {
  const tool = {
    name: 'chain',
    description: '三条链：思考链/推理链/联想链。open 开始、add 追加、close 收尾、show 查看、replay 回放。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['open', 'add', 'close', 'list', 'show', 'replay', 'stats'] },
        kind: { type: 'string', enum: ['think', 'reason', 'associate'] },
        title: { type: 'string' },
        text: { type: 'string' },
        relation: { type: 'string', description: '关系：start/premise/conclusion/hypothesis/check/associate' },
        id: { type: 'string' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' } }, additionalProperties: true }, render: (_a, v) => text(v.summary ?? '') },
    async execute(args) {
      if (args.action === 'open') {
        const chain = chains.open(args.kind ?? 'think', args.title)
        return { ok: true, chain, summary: `已开始${args.kind ?? 'think'}链：${chain.id}` }
      }
      if (args.action === 'add') {
        const node = chains.add(args.kind ?? 'think', { text: args.text, relation: args.relation, title: args.title })
        return { ok: Boolean(node), node, summary: node ? `已追加：${node.text}` : '内容为空' }
      }
      if (args.action === 'close') {
        const chain = chains.close(args.kind ?? 'think')
        return { ok: Boolean(chain), chain, summary: chain ? `已收尾：${chain.id}（${chain.nodes.length} 步）` : '没有进行中的链' }
      }
      if (args.action === 'show') {
        const chain = chains.show(args.id)
        return { ok: Boolean(chain), chain, summary: chain ? chains.replay(chain.id).join('\n') : '找不到这条链' }
      }
      if (args.action === 'replay') {
        const lines = chains.replay(args.id)
        return { ok: lines.length > 0, lines, summary: lines.join('\n') || '找不到这条链' }
      }
      if (args.action === 'list') {
        const items = chains.list(args.kind)
        return { ok: true, items, summary: items.map((item) => `${item.id}（${item.kind}，${item.nodes} 步${item.closed ? '，已收尾' : ''}）`).join('\n') || '还没有链' }
      }
      const stats = chains.stats()
      return { ok: true, ...stats, summary: `思考链 ${stats.byKind.think} · 推理链 ${stats.byKind.reason} · 联想链 ${stats.byKind.associate}` }
    },
  }
  const register = (target) => {
    try { target.tools?.register(tool); logger.info?.('dsh-dafeiyu: chain 工具已注册') } catch (error) { logger.error?.(`注册 chain 失败: ${error?.message ?? error}`) }
  }
  if (typeof ctx.inject === 'function') ctx.inject(['tools'], register)
  else register(ctx)
}
