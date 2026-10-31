#!/usr/bin/env node
// 路线模型：不用 n-gram，用"路线 + 商 + 截断 + 熵"来生成。
//   一条路线 = 一个语义片段（舞台切片）
//   商       = 两条路线的单位分布差异（越小越像同一话题）
//   截断     = 取路线的前 k 个单元
//   生成     = 从输入的路线出发，走向"商最小、熵略低"的下一条路线
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// 语料改为"问答路线"：每条路线是一个完整回答（而不是文档小节）
function loadQARoutes() {
  const out = []
  const theory = join(homedir(), 'Downloads/dfy/lora-theory/train.jsonl')
  try {
    for (const line of readFileSync(theory, 'utf8').split('\n')) {
      if (!line.trim()) continue
      const text = JSON.parse(line).text
      const [q, a] = text.split('\n大肥鱼：')
      if (a) out.push({ q: q.replace('用户：', '').trim(), a: a.trim() })
    }
  } catch {}
  const qa = join(homedir(), 'Downloads/dfy/local-llm-memory/qa_corpus_mem.json')
  try {
    for (const item of JSON.parse(readFileSync(qa, 'utf8'))) out.push({ q: item.q, a: item.a })
  } catch {}
  return out
}

function tokenize(text) {
  const out = []
  const re = /[A-Za-z]+|[\u4e00-\u9fff]{1,2}|[，。！？；：、]/g
  let m
  while ((m = re.exec(text))) out.push(m[0].toLowerCase())
  return out
}

function entropyOf(tokens) {
  const counts = new Map()
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1)
  const total = tokens.length || 1
  let h = 0
  for (const v of counts.values()) { const p = v / total; h -= p * Math.log2(p) }
  return h
}

function distOf(tokens) {
  const counts = new Map()
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1)
  const total = tokens.length || 1
  const out = new Map()
  for (const [k, v] of counts) out.set(k, v / total)
  return out
}

// 商：两条路线分布的 L1 差异 / 2（0 = 完全一样，1 = 完全不相交）
function quotient(a, b) {
  let sum = 0
  const keys = new Set([...a.keys(), ...b.keys()])
  for (const k of keys) sum += Math.abs((a.get(k) ?? 0) - (b.get(k) ?? 0))
  return sum / 2
}

// 建路线库
const routes = []
for (const item of loadQARoutes()) {
  const tokens = tokenize(item.q)
  const answerTokens = tokenize(item.a)
  routes.push({
    text: item.a.slice(0, 300),
    question: item.q,
    tokens: answerTokens,
    dist: distOf([...tokens, ...answerTokens]),
    entropy: entropyOf(answerTokens),
    doc: 'qa',
  })
}
console.log('路线数量', routes.length, '| 平均熵', (routes.reduce((s, r) => s + r.entropy, 0) / routes.length).toFixed(3))

function walk(query, { hops = 3, truncate = 0.6 } = {}) {
  const qd = distOf(tokenize(query))
  // 起点：商最小的路线
  let current = routes.map((r) => ({ r, q: quotient(qd, r.dist) })).sort((a, b) => a.q - b.q)[0].r
  const path = [current]
  for (let i = 1; i < hops; i += 1) {
    const next = routes
      .filter((r) => r !== current && r.entropy <= current.entropy)
      .map((r) => ({
        r,
        q: quotient(current.dist, r.dist) + (r.doc === current.doc ? 0 : 0.25),
        drop: current.entropy - r.entropy,
      }))
      // 商超过阈值就不再跳（宁停不跑题）
      .filter((item) => item.q <= 0.75)
      .sort((a, b) => (a.q + a.drop * 0.2) - (b.q + b.drop * 0.2))[0]
    if (!next) break
    path.push(next.r)
    current = next.r
  }
  // 截断：每条路线只取前 60% 的单元
  return path.map((r) => r.text.slice(0, Math.max(40, Math.floor(r.text.length * truncate)))).join(' ')
}

for (const q of ['三条链分别在哪一层', '记忆怎么备份才安全', '逆序数怎么编码记忆', '你叫什么名字']) {
  console.log('\n问：', q)
  console.log('答：', walk(q).slice(0, 260))
}
