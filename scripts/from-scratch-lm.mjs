#!/usr/bin/env node
// 从头做一个"数学结构"的语言模型：不用神经网络，只用矩阵（n-gram 计数）+ 插值平滑。
// 目的：给出一个真实的起点数字（困惑度），而不是空谈。
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ORDER = 3
const files = [
  join(homedir(), 'Downloads/1. 项目结构.md'),
  join(homedir(), 'Downloads/dfy/goldbach-memory/README.md'),
  join(homedir(), 'Downloads/dfy/dsh-dafeiyu-chat/README.md'),
]

// 单元：中文单字 + 英文词 + 标点
function tokenize(text) {
  const out = []
  const re = /[A-Za-z]+|[\u4e00-\u9fff]|[0-9]+|[，。！？；：、（）「」]/g
  let match
  while ((match = re.exec(text))) {
    const token = match[0]
    out.push(/[A-Za-z]/.test(token) ? token.toLowerCase() : token)
  }
  return out
}

const corpus = []
for (const file of files) {
  try { corpus.push(readFileSync(file, 'utf8')) } catch {}
}
const tokens = tokenize(corpus.join('\n'))
console.log('单元总数', tokens.length, '| 词表', new Set(tokens).size)

// 切分训练/测试（按 9:1，测试取末尾，避免同段重复）
const cut = Math.floor(tokens.length * 0.9)
const train = tokens.slice(0, cut)
const test = tokens.slice(cut, cut + 20000)

// 统计 1..ORDER 阶计数
const counts = new Map()   // 阶数 -> Map(contextKey -> Map(token -> count))
const totals = new Map()
for (let order = 1; order <= ORDER; order += 1) {
  counts.set(order, new Map())
  totals.set(order, new Map())
}
for (let i = 0; i < train.length; i += 1) {
  for (let order = 1; order <= ORDER; order += 1) {
    if (i < order - 1) continue
    const context = train.slice(i - order + 1, i).join('\u0001')
    const token = train[i]
    const table = counts.get(order)
    const row = table.get(context) ?? new Map()
    row.set(token, (row.get(token) ?? 0) + 1)
    table.set(context, row)
    totals.get(order).set(context, (totals.get(order).get(context) ?? 0) + 1)
  }
}

// 插值：P = 0.5*P3 + 0.3*P2 + 0.15*P1 + 0.05*uniform
const VOCAB = new Set(train)
const vocabSize = VOCAB.size
function prob(token, context3, context2, context1) {
  const p3 = (() => {
    const row = counts.get(3).get(context3)
    if (!row) return 0
    return (row.get(token) ?? 0) / (totals.get(3).get(context3) ?? 1)
  })()
  const p2 = (() => {
    const row = counts.get(2).get(context2)
    if (!row) return 0
    return (row.get(token) ?? 0) / (totals.get(2).get(context2) ?? 1)
  })()
  const p1 = (() => {
    const row = counts.get(1).get(context1)
    if (!row) return 0
    return (row.get(token) ?? 0) / (totals.get(1).get(context1) ?? 1)
  })()
  return 0.5 * p3 + 0.3 * p2 + 0.15 * p1 + 0.05 / vocabSize
}

// 困惑度
let logSum = 0
let counted = 0
for (let i = ORDER - 1; i < test.length; i += 1) {
  const token = test[i]
  const c3 = test.slice(i - 2, i).join('\u0001')
  const c2 = test.slice(i - 1, i).join('\u0001')
  const c1 = ''
  const p = prob(token, c3, c2, c1)
  logSum += Math.log(Math.max(p, 1e-9))
  counted += 1
}
const perplexity = Math.exp(-logSum / counted)
console.log('测试单元', counted)
console.log('困惑度（PPL）', perplexity.toFixed(2))

// 对照：均匀分布基线
console.log('对照：均匀分布 PPL =', vocabSize, '（词表大小）')
console.log('对照：不同阶数单独使用的 PPL：')
for (const order of [1, 2, 3]) {
  let s = 0, n = 0
  for (let i = order - 1; i < test.length; i += 1) {
    const context = test.slice(i - order + 1, i).join('\u0001')
    const row = counts.get(order).get(context)
    const total = totals.get(order).get(context) ?? 0
    const p = row ? (row.get(test[i]) ?? 0) / total : 1 / vocabSize
    s += Math.log(Math.max(p, 1e-9)); n += 1
  }
  console.log(`  ${order}-gram PPL = ${Math.exp(-s / n).toFixed(2)}`)
}
