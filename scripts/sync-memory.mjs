#!/usr/bin/env node
// 把长期记忆打包、切分、复制到多个节点（本地 + NAS），并校验/修复。
// 用法：node scripts/sync-memory.mjs [--verify]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createDistributed } from '../src/distributed.js'
import { getOrCreateKey } from '../src/keychain.js'
import { prune } from '../src/retention.js'

const FILES = [
  ['perm-memory', '.dsh/dsh-dafeiyu-perm-memory.json'],
  ['skills', '.dsh/dsh-dafeiyu-skills.json'],
  ['goldbach', '.dsh/dsh-dafeiyu-goldbach.json'],
  ['memory', '.dsh/dsh-dafeiyu-memory.json'],
  ['long-term', 'Documents/大肥鱼记忆.json'],
  ['mood', '.dsh/dsh-dafeiyu-mood.json'],
  ['evolution', '.dsh/dsh-dafeiyu-evolution.json'],
  ['routine', '.dsh/dsh-dafeiyu-routine.json'],
  ['english', '.dsh/dsh-dafeiyu-english.json'],
  ['rl', '.dsh/dsh-dafeiyu-rl.json'],
  ['director-policy', '.dsh/dsh-dafeiyu-director-policy.json'],
  ['meta', '.dsh/dsh-dafeiyu-meta.json'],
  ['selftool', '.dsh/dsh-dafeiyu-selftool.json'],
  ['mus', '.dsh/dsh-dafeiyu-mus.json'],
]

const NODES = [
  { name: 'local', type: 'file', path: join(homedir(), '.dsh', 'dsh-dafeiyu-nodes', 'local') },
  { name: 'nas', type: 'file', path: '/Volumes/15226550291/大肥鱼记忆' },
]
mkdirSync(NODES[0].path, { recursive: true })

const encryptionKey = getOrCreateKey({ logger: console })
const dist = createDistributed({
  nodes: NODES, shards: 4, encryptionKey,
  statePath: join(homedir(), '.dsh', 'dsh-dafeiyu-dist.json'),
})

const payload = { at: new Date().toISOString(), host: process.env.HOSTNAME ?? 'mac', files: {} }
for (const [name, relative] of FILES) {
  const path = join(homedir(), relative)
  if (!existsSync(path)) continue
  try { payload.files[name] = JSON.parse(readFileSync(path, 'utf8')) } catch { payload.files[name] = { error: 'parse failed' } }
}

if (process.argv.includes('--verify')) {
  const report = await dist.verify()
  console.log(JSON.stringify(report, null, 2))
  process.exit(0)
}

const result = await dist.put('memory', payload)
const verified = await dist.verify()
const retention = prune(dist, { keep: 30, monthly: 1 })
console.log(JSON.stringify({ id: result.id, snapshotFiles: Object.keys(payload.files).length, nodes: result.okNodes, encrypted: Boolean(encryptionKey), retention, verify: verified }, null, 2))
