#!/usr/bin/env node
// 把基础单元写进压缩矩阵存储（索引只存排名，载荷压缩），并更新进度文件。
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { MatrixStore } from '../../goldbach-memory/src/store.js'
import { chaosAddress } from '../src/perm-memory.js'

const SRC = process.argv[2] ?? join(homedir(), 'Downloads/dfy/local-llm-memory/units_words.json')
const BASE = join(homedir(), '.dsh', 'dsh-dafeiyu-units-matrix')
const PROGRESS = join(homedir(), '.dsh', 'dsh-dafeiyu-training.json')

const writeProgress = (phase, done, total) => {
  const ratio = total ? done / total : 0
  writeFileSync(PROGRESS, JSON.stringify({
    phase, done, total, percent: Number((ratio * 100).toFixed(1)), at: Date.now(),
  }, null, 2) + '\n')
}

const store = new MatrixStore({ base: BASE, order: 17 })
if (existsSync(`${BASE}.idx`)) store.load()

const data = JSON.parse(readFileSync(SRC, 'utf8'))
const units = data.units ?? []
let done = 0
for (const item of units) {
  const rank = chaosAddress(`unit:${item.unit}`, 17)
  store.put(`unit:${item.unit}`, { unit: item.unit, kind: item.kind, count: item.count, rank })
  done += 1
  if (done % 200 === 0) writeProgress('单元入库', done, units.length)
}
const stats = store.save()
writeProgress('单元入库完成', units.length, units.length)

const disk = statSync(`${BASE}.idx`).size + statSync(`${BASE}.dat`).size
console.log(JSON.stringify({
  units: stats.entries,
  indexBytes: stats.indexBytes,
  compressedBytes: stats.compressedBytes,
  totalBytes: stats.totalBytes,
  compressionRatio: stats.compressionRatio,
  diskKB: Number((disk / 1024).toFixed(1)),
  progress: JSON.parse(readFileSync(PROGRESS, 'utf8')),
}, null, 2))
