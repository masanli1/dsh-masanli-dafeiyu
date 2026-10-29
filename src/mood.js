// 持续状态：饿、困、开心、想你。跨会话保存，随时间自然变化。
// 这是"宠物"和"工具"的分界：她的状态不依赖你在不在看。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const MOOD_PATH = join(homedir(), '.dsh', 'dsh-dafeiyu-mood.json')

const HOUR = 3600 * 1000
const DAY = 24 * HOUR

const clamp = (value) => Math.min(1, Math.max(0, value))

export function createMoodStore({ path = MOOD_PATH, now = () => Date.now(), logger = console } = {}) {
  let state = {
    hunger: 0.25,
    sleepiness: 0.35,
    happiness: 0.7,
    lastSeen: null,
    lastChat: null,
    lastPraise: null,
    lastFed: null,
    updatedAt: null,
    met: false,
    // 生物反馈：心跳、呼吸、压力。它们不是装饰，会反过来影响她的状态。
    bio: { heartRate: 72, breathing: 16, stress: 0.2 },
  }

  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    if (raw && typeof raw === 'object') state = { ...state, ...raw }
  } catch {
    // 第一次运行
  }

  const save = () => {
    try {
      mkdirSync(dirname(path), { recursive: true })
      state.updatedAt = new Date(now()).toISOString()
      writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`)
    } catch (error) {
      logger.warn?.(`dsh-dafeiyu mood: 写入失败: ${error?.message ?? error}`)
    }
  }

  const hoursSince = (iso) => (iso ? (now() - new Date(iso).getTime()) / HOUR : Infinity)
  const daysSince = (iso) => (iso ? (now() - new Date(iso).getTime()) / DAY : Infinity)
  const hourOfDay = () => new Date(now()).getHours()

  // 时间流逝：饿会涨、开心会掉、深夜会困；三天不见会开始想你。
  const tick = () => {
    const since = hoursSince(state.updatedAt ?? state.lastChat ?? new Date(now()).toISOString())
    const hours = Math.min(Number.isFinite(since) ? since : 0, 72)
    if (hours > 0.01) {
      state.hunger = clamp(state.hunger + hours * 0.03)
      state.happiness = clamp(state.happiness - hours * 0.004)
      const night = hourOfDay() >= 23 || hourOfDay() < 7
      state.sleepiness = clamp(state.sleepiness + (night ? hours * 0.02 : -hours * 0.012))
    }
    const away = daysSince(state.lastChat)
    if (Number.isFinite(away) && away >= 2) {
      state.happiness = clamp(state.happiness - 0.02 * Math.min(away, 7))
    }
    // 生物反馈：心率/呼吸朝"当下该有的水平"收敛，压力随时间衰减。
    const bio = state.bio ?? { heartRate: 72, breathing: 16, stress: 0.2 }
    bio.stress = clamp(bio.stress - hours * 0.05)
    const targetHr = 66 + bio.stress * 30 + state.hunger * 6 + (state.sleepiness > 0.7 ? -5 : 0) + state.happiness * 3
    const targetBreath = 12 + bio.stress * 7 + (state.sleepiness > 0.7 ? -3 : 0)
    const rate = Math.min(1, Math.max(0.05, hours * 0.35))
    bio.heartRate = clamp((bio.heartRate + (targetHr - bio.heartRate) * rate) / 200, 0, 1) * 200
    bio.breathing = Math.max(8, bio.breathing + (targetBreath - bio.breathing) * rate)
    state.bio = bio
    state.updatedAt = new Date(now()).toISOString()
    return snapshot()
  }

  const poke = (kind) => {
    const at = new Date(now()).toISOString()
    const bio = state.bio ?? (state.bio = { heartRate: 72, breathing: 16, stress: 0.2 })
    if (kind === 'chat') {
      state.lastChat = at; state.lastSeen = at; state.happiness = clamp(state.happiness + 0.06); state.met = true
      bio.stress = clamp(bio.stress - 0.08); bio.heartRate = Math.min(140, bio.heartRate + 6)
    }
    else if (kind === 'seen') { state.lastSeen = at; state.met = true }
    else if (kind === 'praise') { state.lastPraise = at; state.happiness = clamp(state.happiness + 0.18); bio.stress = clamp(bio.stress - 0.2); bio.heartRate = Math.min(140, bio.heartRate + 4) }
    else if (kind === 'feed') { state.lastFed = at; state.hunger = clamp(state.hunger - 0.5); state.happiness = clamp(state.happiness + 0.05) }
    else if (kind === 'play') { state.happiness = clamp(state.happiness + 0.12); state.sleepiness = clamp(state.sleepiness + 0.08); bio.heartRate = Math.min(150, bio.heartRate + 10) }
    else if (kind === 'stress') { bio.stress = clamp(bio.stress + 0.35); bio.heartRate = Math.min(160, bio.heartRate + 14) }
    else if (kind === 'calm') { bio.stress = clamp(bio.stress - 0.15); bio.heartRate = Math.max(58, bio.heartRate - 8) }
    else if (kind === 'nap') { state.sleepiness = clamp(state.sleepiness - 0.6) }
    save()
    return snapshot()
  }

  const label = () => {
    const away = daysSince(state.lastChat)
    if (Number.isFinite(away) && away >= 3) return '想你'
    if (state.hunger >= 0.75) return '饿'
    if (state.sleepiness >= 0.75) return '困'
    if (state.happiness >= 0.75) return '开心'
    if (state.happiness <= 0.3) return '没精神'
    return '普通'
  }

  const snapshot = () => ({
    hunger: Number(state.hunger.toFixed(3)),
    sleepiness: Number(state.sleepiness.toFixed(3)),
    happiness: Number(state.happiness.toFixed(3)),
    mood: label(),
    lastChat: state.lastChat,
    lastSeen: state.lastSeen,
    lastPraise: state.lastPraise,
    lastFed: state.lastFed,
    hoursSinceChat: Number.isFinite(hoursSince(state.lastChat)) ? Number(hoursSince(state.lastChat).toFixed(1)) : null,
    daysSinceChat: Number.isFinite(daysSince(state.lastChat)) ? Number(daysSince(state.lastChat).toFixed(2)) : null,
    met: state.met,
    bio: {
      heartRate: Math.round((state.bio ?? {}).heartRate ?? 72),
      breathing: Number(((state.bio ?? {}).breathing ?? 16).toFixed(1)),
      stress: Number(((state.bio ?? {}).stress ?? 0.2).toFixed(3)),
    },
    path,
  })

  save()
  return { tick, poke, snapshot, label, path }
}
