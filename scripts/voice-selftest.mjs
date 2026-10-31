#!/usr/bin/env node
// 重启 DSH 之后跑一遍，确认语音功能真的挂上了：
//   node scripts/voice-selftest.mjs
//
// 检查项：
//   1. 插件配置里有没有 wakeEnabled / ttsEngine 这些新字段
//   2. 唤醒服务的状态（模型、麦克风、是否就绪）
//   3. 模拟一次唤醒（不开口）
//   4. 让克隆音色说一句英文（会真的出声，最好戴耳机或调小音量）
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const hint = join(homedir(), '.dsh', 'dsh-dafeiyu-webui.txt')
let base = process.env.DSH_WEBUI_BASE || ''
if (!base) {
  try {
    base = readFileSync(hint, 'utf8').trim().replace(/\/$/, '')
  } catch {}
}
if (!base) {
  console.error('找不到 DSH 页面地址：先打开一次 DSH 页面，或用环境变量 DSH_WEBUI_BASE 指定')
  process.exit(2)
}

const results = []
const check = async (name, fn) => {
  try {
    const detail = await fn()
    results.push({ name, ok: true, detail })
    console.log(`✓ ${name}${detail ? `：${detail}` : ''}`)
  } catch (error) {
    results.push({ name, ok: false, detail: String(error?.message ?? error) })
    console.log(`✗ ${name}：${error?.message ?? error}`)
  }
}

await check('插件配置', async () => {
  const response = await fetch(`${base}/plugins/dsh-dafeiyu/config`)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const config = await response.json()
  const missing = ['wakeEnabled', 'ttsEngine', 'ttsRefAudio'].filter((key) => !(key in config))
  if (missing.length) throw new Error(`缺少字段 ${missing.join(', ')}（插件可能还是旧版，重启 DSH）`)
  return `ttsEngine=${config.ttsEngine} wakeEnabled=${config.wakeEnabled} 唤醒词=${config.wakeKeyword}`
})

await check('唤醒服务', async () => {
  const response = await fetch(`${base}/plugins/dsh-dafeiyu/wake/status`)
  if (!response.ok) throw new Error(`HTTP ${response.status}（唤醒路由不存在，插件可能还是旧版）`)
  const body = await response.json()
  const status = body.status ?? body
  if (!status.ready) throw new Error(`未就绪：${status.lastError || '还在启动或没开麦克风'}`)
  return `模型=${status.modelDir} 麦克风=${status.keyword}`
})

await check('模拟唤醒', async () => {
  const response = await fetch(`${base}/plugins/dsh-dafeiyu/wake/status`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ test: true, keyword: '自检' }),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return '已触发（她应该说「在呢，我在听」）'
})

await check('克隆音色说英文', async () => {
  const response = await fetch(`${base}/plugins/dsh-dafeiyu/chat/speak`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'This is a voice self test. It should sound like the reference.' }),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return '已提交合成（首次要等 10–20 秒加载模型）'
})

const failed = results.filter((row) => !row.ok)
console.log(failed.length ? `\n${failed.length} 项失败` : '\n全部通过')
process.exit(failed.length ? 1 : 0)
