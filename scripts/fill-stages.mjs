#!/usr/bin/env node
// 网页填充：抓取一个 URL（或本地文件），切成舞台追加进舞台库，并让语义桥增量重建索引。
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const STAGES = join(homedir(), '.dsh', 'dsh-dafeiyu-stages.json')
const BRIDGE = 'http://127.0.0.1:18731'

const target = process.argv[2]
if (!target) { console.error('用法: fill-stages.mjs <url|file> [name]'); process.exit(1) }
const name = process.argv[3] ?? target

let text = ''
if (/^https?:/.test(target)) {
  const response = await fetch(target, { headers: { 'user-agent': 'dfy-fill/1.0' } })
  const html = await response.text()
  text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ')
} else {
  text = readFileSync(target, 'utf8')
}
if (text.length < 200) { console.error('内容太少，放弃'); process.exit(2) }

const data = existsSync(STAGES) ? JSON.parse(readFileSync(STAGES, 'utf8')) : { docs: [], stages: [] }
const before = data.stages.length
const CHUNK = 700
let added = 0
for (let offset = 0; offset < text.length; offset += CHUNK) {
  const piece = text.slice(offset, offset + CHUNK).trim()
  if (piece.length < 80) continue
  const sentences = piece.split(/(?<=[。！？\n])/).map((s) => s.trim()).filter((s) => s.length >= 8)
  const slices = []
  for (let i = 0; i < sentences.length; i += 2) {
    const merged = `${sentences[i] ?? ''}${sentences[i + 1] ?? ''}`.trim()
    if (merged.length >= 12) slices.push(merged.slice(0, 240))
  }
  data.stages.push({
    key: `${name}:${before + added}`,
    doc: name,
    rank: (before + added) * 7919 % 2 ** 48,
    units: sentences.length,
    text: piece.slice(0, 600),
    slices: slices.slice(0, 6),
  })
  added += 1
}
data.docs = data.docs.filter((doc) => doc.name !== name).concat([{ name, stages: added, bytes: text.length }])
writeFileSync(STAGES, JSON.stringify(data, null, 1) + '\n')

let reload = null
try {
  const response = await fetch(`${BRIDGE}/reload`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  reload = await response.json()
} catch (error) { reload = { error: String(error?.message ?? error) } }

console.log(JSON.stringify({ name, added, before, after: data.stages.length, reload }, null, 2))
