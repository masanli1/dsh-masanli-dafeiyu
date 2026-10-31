#!/usr/bin/env node
// 多文档投位：把不同文档切成舞台（矩阵 + 索引 + 截断 + 阶段长度），写入舞台库。
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DOCS = [
  ['项目结构', join(homedir(), 'Downloads/1. 项目结构.md')],
  ['记忆库README', join(homedir(), 'Downloads/dfy/goldbach-memory/README.md')],
  ['插件README', join(homedir(), 'Downloads/dfy/dsh-dafeiyu-chat/README.md')],
]
const OUT = join(homedir(), '.dsh', 'dsh-dafeiyu-stages.json')
const CHUNK = 700

function slug(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 }
  return h.toString(36)
}

const stages = []
const docs = []
for (const [name, path] of DOCS) {
  if (!existsSync(path)) { console.log('跳过（不存在）', name); continue }
  const text = readFileSync(path, 'utf8')
  let count = 0
  for (let offset = 0; offset < text.length; offset += CHUNK) {
    const piece = text.slice(offset, offset + CHUNK).trim()
    if (piece.length < 80) continue
    // 切片：按句子再切成可提取片段
    const sentences = piece.split(/(?<=[。！？\n])/).map((s) => s.trim()).filter((s) => s.length >= 8)
    const slices = []
    for (let i = 0; i < sentences.length; i += 2) {
      const merged = `${sentences[i] ?? ''}${sentences[i + 1] ?? ''}`.trim()
      if (merged.length >= 12) slices.push(merged.slice(0, 240))
    }
    stages.push({
      key: `${name}:${slug(piece)}`,
      doc: name,
      rank: parseInt(slug(piece), 36) % 2 ** 48,
      units: sentences.length,
      text: piece.slice(0, 600),
      slices: slices.slice(0, 6),
    })
    count += 1
  }
  docs.push({ name, stages: count, bytes: statSync(path).size })
}

writeFileSync(OUT, JSON.stringify({ docs, stages }, null, 1) + '\n')
console.log(JSON.stringify({
  docs, stages: stages.length,
  units: stages.reduce((sum, stage) => sum + stage.units, 0),
  slices: stages.reduce((sum, stage) => sum + (stage.slices?.length ?? 0), 0),
  bytes: statSync(OUT).size, path: OUT,
}, null, 2))
