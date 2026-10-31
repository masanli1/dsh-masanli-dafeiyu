// 分布式存储：把记忆文件切成 N 片，各自带哈希，复制到多个节点。
// 节点可以是本地目录、NAS 路径，或任何支持 PUT/GET 的 HTTP 端点。
// 任一节点丢片，可用其它节点修复。
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

export const DIST_PATH = join(homedir(), '.dsh', 'dsh-dafeiyu-dist.json')

const sha = (buffer) => createHash('sha256').update(buffer).digest('hex').slice(0, 16)

export function createDistributed({ nodes = [], shards = 4, statePath = DIST_PATH, encryptionKey = null, logger = console } = {}) {
  let state = { manifests: {} }
  try { state = { ...state, ...JSON.parse(readFileSync(statePath, 'utf8')) } } catch {}

  const save = () => {
    try {
      mkdirSync(dirname(statePath), { recursive: true })
      writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`)
    } catch (error) { logger.warn?.(`dsh-dafeiyu dist: 写入失败: ${error?.message ?? error}`) }
  }

  const fileNodes = () => nodes.filter((node) => node.type !== 'http')

  // AES-256-GCM：iv(12) + tag(16) + 密文；哈希仍按明文算，便于校验
  const seal = (buffer) => {
    if (!encryptionKey) return buffer
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv)
    const body = Buffer.concat([cipher.update(buffer), cipher.final()])
    return Buffer.concat([Buffer.from('DFY1'), iv, cipher.getAuthTag(), body])
  }
  const open = (buffer) => {
    if (!encryptionKey) return buffer
    if (buffer.subarray(0, 4).toString() !== 'DFY1') return buffer
    const iv = buffer.subarray(4, 16)
    const tag = buffer.subarray(16, 32)
    const body = buffer.subarray(32)
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(body), decipher.final()])
  }

  const writeShard = async (node, id, index, buffer) => {
    if (node.type === 'http') {
      const response = await fetch(`${node.url.replace(/\/$/, '')}/shard/${id}/${index}`, {
        method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: buffer,
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return
    }
    const dir = join(node.path, id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `shard-${index}.bin`), seal(buffer))
  }

  const readShard = async (node, id, index) => {
    if (node.type === 'http') {
      const response = await fetch(`${node.url.replace(/\/$/, '')}/shard/${id}/${index}`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return Buffer.from(await response.arrayBuffer())
    }
    const file = join(node.path, id, `shard-${index}.bin`)
    if (!existsSync(file)) throw new Error('缺少分片')
    return open(readFileSync(file))
  }

  const remove = async (id) => {
    const manifest = state.manifests[id]
    if (!manifest) return false
    for (const node of nodes) {
      if (node.type === 'http') continue
      try {
        const dir = join(node.path, id)
        if (existsSync(dir)) {
          for (const file of readdirSync(dir)) unlinkSync(join(dir, file))
          rmSync(dir, { recursive: true, force: true })
        }
      } catch (error) { logger.warn?.(`dsh-dafeiyu dist: 删除 ${node.name}/${id} 失败: ${error?.message ?? error}`) }
    }
    delete state.manifests[id]
    save()
    return true
  }

  const list = (name = '') => Object.values(state.manifests)
    .filter((manifest) => !name || manifest.name === name)
    .sort((a, b) => a.at - b.at)

  const put = async (name, payload) => {
    const buffer = Buffer.from(JSON.stringify(payload, null, 2))
    const size = Math.ceil(buffer.length / shards)
    const slices = Array.from({ length: shards }, (_, index) => buffer.subarray(index * size, (index + 1) * size))
    const id = `${name}-${Date.now()}`
    const manifest = { id, name, shards: shards, size: buffer.length, hashes: slices.map(sha), replicates: {}, at: Date.now() }
    for (const node of nodes) {
      manifest.replicates[node.name] = []
      for (let index = 0; index < slices.length; index += 1) {
        try { await writeShard(node, id, index, slices[index]); manifest.replicates[node.name].push(index) } catch (error) {
          logger.warn?.(`dsh-dafeiyu dist: ${node.name} 分片 ${index} 失败: ${error?.message ?? error}`)
        }
      }
    }
    state.manifests[id] = manifest
    save()
    return { id, ...manifest, okNodes: Object.entries(manifest.replicates).filter(([, list]) => list.length === shards).length }
  }

  const fetchShards = async (id) => {
    const manifest = state.manifests[id]
    if (!manifest) throw new Error('没有这个清单')
    const buffers = []
    for (let index = 0; index < manifest.shards; index += 1) {
      let buffer = null
      for (const node of nodes) {
        try {
          const candidate = await readShard(node, id, index)
          if (sha(candidate) === manifest.hashes[index]) { buffer = candidate; break }
        } catch {}
      }
      if (!buffer) throw new Error(`分片 ${index} 在所有节点上都缺失`)
      buffers.push(buffer)
    }
    return JSON.parse(Buffer.concat(buffers).toString('utf8'))
  }

  const verify = async () => {
    const report = []
    for (const [id, manifest] of Object.entries(state.manifests)) {
      const row = { id, nodes: {} }
      for (const node of nodes) {
        let healthy = 0
        for (let index = 0; index < manifest.shards; index += 1) {
          try {
            const buffer = await readShard(node, id, index)
            if (sha(buffer) === manifest.hashes[index]) healthy += 1
          } catch {}
        }
        row.nodes[node.name] = `${healthy}/${manifest.shards}`
      }
      report.push(row)
    }
    return report
  }

  const repair = async () => {
    const fixed = []
    for (const [id, manifest] of Object.entries(state.manifests)) {
      for (let index = 0; index < manifest.shards; index += 1) {
        let buffer = null
        for (const node of nodes) {
          try {
            const candidate = await readShard(node, id, index)
            if (sha(candidate) === manifest.hashes[index]) { buffer = candidate; break }
          } catch {}
        }
        if (!buffer) continue
        for (const node of nodes) {
          try {
            const current = await readShard(node, id, index)
            if (sha(current) === manifest.hashes[index]) continue
          } catch {}
          try { await writeShard(node, id, index, buffer); fixed.push(`${node.name}#${index}`) } catch {}
        }
      }
    }
    return fixed
  }

  const stats = () => ({ nodes: nodes.map((node) => node.name), shards, manifests: Object.keys(state.manifests).length })

  // 注意：不能叫 get —— DSH 的 plainConfig 会把带 .get 的对象当成 settings 解包
  return { put, fetch: fetchShards, verify, repair, remove, list, stats, state }
}

const text = (value) => [{ type: 'text', text: value }]

export function registerDistTool(ctx, { dist, logger = console } = {}) {
  const tool = {
    name: 'dist',
    description: '分布式存储：把记忆切成 N 片复制到多个节点（本地目录/NAS/HTTP），支持校验与修复。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['put', 'get', 'verify', 'repair', 'stats'] },
        name: { type: 'string', description: '存储名' },
        id: { type: 'string', description: '取回时的清单 id' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' } }, additionalProperties: true }, render: (_a, v) => text(v.summary ?? '') },
    async execute(args) {
      if (args.action === 'put') {
        const payload = { name: args.name, at: Date.now(), note: '记忆快照' }
        const result = await dist.put(args.name ?? 'memory', payload)
        return { ok: true, ...result, summary: `已分片复制：${result.id}（${result.okNodes}/${dist.stats().nodes.length} 个节点完整）` }
      }
      if (args.action === 'get') {
        const payload = await dist.fetch(args.id)
        return { ok: true, payload, summary: `取回成功：${JSON.stringify(payload).slice(0, 120)}` }
      }
      if (args.action === 'verify') {
        const report = await dist.verify()
        return { ok: true, report, summary: report.map((row) => `${row.id}: ${Object.entries(row.nodes).map(([name, value]) => `${name} ${value}`).join('  ')}`).join('\n') }
      }
      if (args.action === 'repair') {
        const fixed = await dist.repair()
        return { ok: true, fixed, summary: fixed.length ? `已修复 ${fixed.length} 片：${fixed.join(',')}` : '没有需要修复的分片' }
      }
      const stats = dist.stats()
      return { ok: true, ...stats, summary: `节点 ${stats.nodes.join('、')} · 每份 ${stats.shards} 片 · 清单 ${stats.manifests} 个` }
    },
  }
  const register = (target) => {
    try { target.tools?.register(tool); logger.info?.('dsh-dafeiyu: dist 工具已注册') } catch (error) { logger.error?.(`注册 dist 失败: ${error?.message ?? error}`) }
  }
  if (typeof ctx.inject === 'function') ctx.inject(['tools'], register)
  else register(ctx)
}
