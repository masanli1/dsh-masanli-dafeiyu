#!/usr/bin/env node
// 灾难恢复：只从 NAS 节点读取最新快照，写回本机 ~/.dsh 与 ~/Documents。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createDistributed } from '../src/distributed.js'
import { getOrCreateKey } from '../src/keychain.js'

const TARGETS = {
  'perm-memory': '.dsh/dsh-dafeiyu-perm-memory.json',
  skills: '.dsh/dsh-dafeiyu-skills.json',
  goldbach: '.dsh/dsh-dafeiyu-goldbach.json',
  memory: '.dsh/dsh-dafeiyu-memory.json',
  'long-term': 'Documents/大肥鱼记忆.json',
  mood: '.dsh/dsh-dafeiyu-mood.json',
  evolution: '.dsh/dsh-dafeiyu-evolution.json',
  routine: '.dsh/dsh-dafeiyu-routine.json',
  english: '.dsh/dsh-dafeiyu-english.json',
  rl: '.dsh/dsh-dafeiyu-rl.json',
  'director-policy': '.dsh/dsh-dafeiyu-director-policy.json',
  meta: '.dsh/dsh-dafeiyu-meta.json',
  selftool: '.dsh/dsh-dafeiyu-selftool.json',
  mus: '.dsh/dsh-dafeiyu-mus.json',
}

const statePath = join(homedir(), '.dsh', 'dsh-dafeiyu-dist.json')
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { manifests: {} }
const ids = Object.keys(state.manifests ?? {}).filter((id) => state.manifests[id].name === 'memory').sort()
if (!ids.length) { console.error('没有找到快照'); process.exit(1) }
const latest = ids[ids.length - 1]

const dist = createDistributed({
  nodes: [{ name: 'nas', type: 'file', path: '/Volumes/15226550291/大肥鱼记忆' }],
  encryptionKey: getOrCreateKey({ logger: { info() {}, warn() {} } }),
  statePath,
  logger: { warn() {} },
})
const payload = await dist.fetch(latest)
let restored = 0
for (const [key, relative] of Object.entries(TARGETS)) {
  if (!payload.files?.[key]) continue
  const path = join(homedir(), relative)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(payload.files[key], null, 2)}\n`)
  restored += 1
}
console.log(JSON.stringify({ ok: true, snapshot: latest, at: payload.at, restored }, null, 2))
