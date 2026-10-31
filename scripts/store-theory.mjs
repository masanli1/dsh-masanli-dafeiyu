#!/usr/bin/env node
// 把"理论体系"（问答对数据集）稀疏地存进大肥鱼的记忆，并登记成技能。
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { MatrixStore } from '../../goldbach-memory/src/store.js'

const DATA = process.argv[2] ?? join(homedir(), 'Downloads/dfy/lora-theory/train.jsonl')
const BASE = join(homedir(), '.dsh', 'dsh-dafeiyu-theory-matrix')
const SKILLS = join(homedir(), '.dsh', 'dsh-dafeiyu-skills.json')

const store = new MatrixStore({ base: BASE, order: 17 })
if (existsSync(`${BASE}.idx`)) store.load()

let count = 0
const lines = readFileSync(DATA, 'utf8').split('\n').filter(Boolean)
for (const line of lines) {
  const { text } = JSON.parse(line)
  const [question, answer] = text.split('\n大肥鱼：')
  const q = question.replace(/^用户：/, '').trim()
  if (!q || !answer) continue
  store.put(`theory:${q}`, { q, a: answer.trim() })
  count += 1
}
const stats = store.save()

// 登记成技能（触发词用最通用的那几个）
const skill = {
  id: '理论体系',
  trigger: '逆序数 哥德巴赫 稀疏 矩阵 记忆 原理',
  kind: 'tool',
  payload: 'theory-matrix',
  note: `稀疏存储的理论问答：${count} 条，位于 ${BASE}`,
  hits: 0,
  misses: 0,
  level: 'mastered',
  rank: store.address('theory:逆序数怎么编码记忆？'),
  inversion: [],
  at: Date.now(),
}
const skills = existsSync(SKILLS) ? JSON.parse(readFileSync(SKILLS, 'utf8')) : { skills: [] }
skills.skills = (skills.skills ?? []).filter((item) => item.id !== skill.id).concat(skill)
writeFileSync(SKILLS, JSON.stringify(skills, null, 2) + '\n')

console.log(JSON.stringify({
  stored: count,
  entries: stats.entries,
  indexBytes: stats.indexBytes,
  compressedBytes: stats.compressedBytes,
  totalBytes: stats.totalBytes,
  compressionRatio: stats.compressionRatio,
  diskKB: Number(((statSync(`${BASE}.idx`).size + statSync(`${BASE}.dat`).size) / 1024).toFixed(1)),
  skill: skill.id,
}, null, 2))

const verify = new MatrixStore({ base: BASE, order: 17 })
verify.load()
const sample = verify.rows[0]
console.log('按需展开示例:', sample.key, '→', JSON.stringify(verify.get(sample.key)).slice(0, 120))
