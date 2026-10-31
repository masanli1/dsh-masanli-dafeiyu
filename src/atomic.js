// 原子写入：先写临时文件、fsync，再 rename 覆盖；断电/崩溃不会留下半个 JSON。
// 同时提供一个"多文档分片存储"：大对象按 part 拆分，只重写变化的分片。
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, openSync, fsyncSync, closeSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'

export function writeJsonAtomic(path, data) {
  const text = `${JSON.stringify(data, null, 2)}\n`
  const tmp = `${path}.tmp-${process.pid}`
  mkdirSync(dirname(path), { recursive: true })
  const fd = openSync(tmp, 'w')
  try {
    writeFileSync(fd, text)
    fsyncSync(fd)
  } finally {
    try { closeSync(fd) } catch {}
  }
  renameSync(tmp, path)
}

export function readJsonSafe(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return fallback }
}

// 多文档存储：<base>.d/part-0001.json；每个分片独立文件，只重写变化的那一片
export function createPartitionedStore({ base, partSize = 500, name = 'items', logger = console } = {}) {
  const dir = `${base}.d`
  let parts = []
  let dirtyParts = new Set()

  const load = () => {
    if (existsSync(dir)) {
      const files = readdirSync(dir).filter((file) => file.endsWith('.json')).sort()
      parts = files.map((file) => readJsonSafe(join(dir, file), { [name]: [] }))
      return
    }
    // 迁移：旧的单文件存在就切成多片
    const legacy = readJsonSafe(base)
    if (legacy) {
      const items = legacy[name] ?? []
      parts = []
      for (let index = 0; index < items.length; index += partSize) parts.push({ [name]: items.slice(index, index + partSize) })
      if (parts.length) flushAll()
      try { unlinkSync(`${base}.migrated`) } catch {}
    }
  }

  const all = () => parts.flatMap((part) => part[name] ?? [])

  const replaceAll = (items) => {
    parts = []
    for (let index = 0; index < items.length; index += partSize) parts.push({ [name]: items.slice(index, index + partSize) })
    dirtyParts = new Set(parts.map((_, index) => index))
  }

  const markDirty = (index) => dirtyParts.add(index)

  const flushAll = () => {
    mkdirSync(dir, { recursive: true })
    const files = new Set(parts.map((_, index) => `part-${String(index + 1).padStart(4, '0')}.json`))
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue
      if (!files.has(file)) { try { unlinkSync(join(dir, file)) } catch {} }
    }
    parts.forEach((part, index) => writeJsonAtomic(join(dir, `part-${String(index + 1).padStart(4, '0')}.json`), part))
    dirtyParts.clear()
  }

  const flushDirty = () => {
    mkdirSync(dir, { recursive: true })
    for (const index of dirtyParts) {
      if (!parts[index]) continue
      writeJsonAtomic(join(dir, `part-${String(index + 1).padStart(4, '0')}.json`), parts[index])
    }
    dirtyParts.clear()
  }

  const append = (item) => {
    const last = parts[parts.length - 1]
    if (!last || (last[name] ?? []).length >= partSize) {
      parts.push({ [name]: [item] })
      markDirty(parts.length - 1)
    } else {
      last[name].push(item)
      markDirty(parts.length - 1)
    }
    flushDirty()
  }

  const stats = () => ({ parts: parts.length, items: all().length, dir })

  return { load, all, replaceAll, append, flushAll, flushDirty, stats, dir }
}
