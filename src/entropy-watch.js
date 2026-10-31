// 熵观察：把最近对话的 SAN 熵记成序列，供原生状态卡画曲线。
import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { sanEntropy } from './san.js'

export const ENTROPY_PATH = `${homedir()}/.dsh/dsh-dafeiyu-entropy.json`

export function createEntropyWatch({ limit = 40, throttleMs = 4000 } = {}) {
  const series = []
  let lastWrite = 0

  const record = (messages = []) => {
    const text = messages.slice(-6).map((m) => String(m.text ?? m)).join('。')
    if (!text.trim()) return null
    const { entropy, paths, distinctSad } = sanEntropy(text, { window: 6 })
    const now = Date.now()
    if (now - lastWrite < throttleMs && series.length) {
      series[series.length - 1] = Number(entropy.toFixed(3))
    } else {
      series.push(Number(entropy.toFixed(3)))
      if (series.length > limit) series.shift()
      lastWrite = now
    }
    const payload = {
      current: Number(entropy.toFixed(3)),
      series,
      paths,
      distinctSad,
      at: now,
    }
    try { writeFileSync(ENTROPY_PATH, JSON.stringify(payload, null, 2) + '\n') } catch {}
    return payload
  }

  return { record, series, path: ENTROPY_PATH }
}
