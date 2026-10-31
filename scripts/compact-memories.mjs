#!/usr/bin/env node
// 把现有记忆文件压成"矩阵压缩存储"：索引只留排名，载荷整体 brotli，按需展开。
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { MatrixStore } from '../../goldbach-memory/src/store.js'

const SOURCES = [
  ['perm-memory', '.dsh/dsh-dafeiyu-perm-memory.json', (d) => (d.entries ?? []).map((e) => [e.key, { text: e.text, rank: e.rank, at: e.at }])],
  ['skills', '.dsh/dsh-dafeiyu-skills.json', (d) => (d.skills ?? []).map((s) => [s.id, { trigger: s.trigger, kind: s.kind, payload: s.payload, hits: s.hits }])],
  ['goldbach', '.dsh/dsh-dafeiyu-goldbach.json', (d) => Object.entries(d.nodes ?? {}).map(([k, v]) => [k, { text: v.text, prime: v.prime }])],
  ['memory', '.dsh/dsh-dafeiyu-memory.json', (d) => (d.items ?? []).map((m) => [m.key, { value: m.value, at: m.at }])],
  ['long-term', 'Documents/大肥鱼记忆.json', (d) => (d.items ?? []).map((m) => [m.key, { value: m.value, at: m.at }])],
]

const store = new MatrixStore({ base: join(homedir(), '.dsh', 'dsh-dafeiyu-matrix'), order: 17 })
let before = 0
let records = 0
for (const [name, relative, pick] of SOURCES) {
  const path = join(homedir(), relative)
  if (!existsSync(path)) continue
  before += statSync(path).size
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'))
    for (const [key, value] of pick(data)) { store.put(`${name}:${key}`, value); records += 1 }
  } catch (error) {
    console.log(`跳过 ${name}: ${error.message}`)
  }
}

const stats = store.save()
const after = statSync(store.idxPath).size + statSync(store.datPath).size
console.log(JSON.stringify({
  records,
  beforeBytes: before,
  afterBytes: after,
  ratio: Number((before / Math.max(1, after)).toFixed(2)),
  compressionRatio: stats.compressionRatio,
  bytesPerEntry: stats.bytesPerEntry,
  indexPath: store.idxPath,
  dataPath: store.datPath,
}, null, 2))

// 按需展开验证
const reloaded = new MatrixStore({ base: join(homedir(), '.dsh', 'dsh-dafeiyu-matrix'), order: 17 })
reloaded.load()
const sample = reloaded.rows.find((row) => row.key.startsWith('long-term:名字')) ?? reloaded.rows[0]
console.log('按需展开示例:', sample.key, '→', JSON.stringify(reloaded.get(sample.key)).slice(0, 80))
