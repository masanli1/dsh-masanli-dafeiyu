// Boredom greeter: when nobody has touched DSH for a while, the companion says
// something short in her bubble (and out loud, when voice is enabled).
//
// Three rules keep it from becoming noise:
//   * only while the host is idle (no running turn),
//   * at most `greetingRepeatMinutes` between greetings,
//   * stop after three greetings in a row until the human does something.
import { CompanionMessageKind, createMessage } from './protocol.js'

const MAX_STREAK = 3

const LINES = Object.freeze({
  morning: [
    '早上好呀，今天也要元气满满哦。',
    '早呀，先喝口水再开工吧。',
    '新的一天，要不要先列个清单？',
  ],
  afternoon: [
    '下午好，站起来活动一下肩膀吧。',
    '忙到现在啦，歇一会儿再继续？',
    '我在旁边看着你呢，别太累。',
  ],
  evening: [
    '晚上好，我在这里陪你。',
    '天黑了，灯光调暗一点会更舒服哦。',
    '今天辛苦了，剩下的明天再说也行。',
  ],
  night: [
    '夜深了，早点睡吧。',
    '这么晚还在忙呀？身体要紧。',
    '再干十分钟就收工，好不好？',
  ],
  bored: [
    '在吗？我有点无聊了。',
    '要不要一起听首歌？',
    '刷到好玩的记得叫我一起看。',
    '你忙你的，我就安静待着。',
  ],
  success: ['搞定啦！', '任务完成，辛苦啦。', '又完成一件，厉害。'],
  error: ['好像出错了，别急，我们再看一遍。', '这一步没成功，要不要换个思路？'],
})

const pick = (list) => list[Math.floor(Math.random() * list.length)]

export function slotForHour(hour) {
  if (hour >= 23 || hour < 5) return 'night'
  if (hour < 11) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
}

export function createGreeter({
  config,
  speak,
  send,
  logger = console,
  now = () => Date.now(),
  isBusy = () => false,
  intervalMs = 60_000,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  let lastActivity = now()
  let lastGreeting = 0
  let lastAnnounce = Number.NEGATIVE_INFINITY
  let streak = 0
  let disposed = false

  const cfg = () => {
    try {
      return config() ?? {}
    } catch {
      return {}
    }
  }

  const emit = (text, state = 'SUCCESS') => {
    try {
      send?.(createMessage(CompanionMessageKind.PULSE, {
        state,
        message: text,
        detail: '大肥鱼',
        ttlMs: 6000,
        resumeState: 'IDLE',
      }))
    } catch (error) {
      logger.warn?.(`dsh-dafeiyu greeting: 气泡发送失败: ${error?.message ?? error}`)
    }
  }

  const say = (text, force = false) => {
    const current = cfg()
    if (!force && current.voiceEnabled === false) return
    try {
      speak?.(text, { voice: current.voiceName, rate: current.voiceRate, volume: current.voiceVolume })
    } catch (error) {
      logger.warn?.(`dsh-dafeiyu greeting: 语音失败: ${error?.message ?? error}`)
    }
  }

  const greet = (bucket = slotForHour(new Date().getHours())) => {
    const text = pick(LINES[bucket] ?? LINES.bored)
    emit(text)
    say(text)
    lastGreeting = now()
    streak += 1
    return text
  }

  const tick = () => {
    if (disposed) return
    const current = cfg()
    if (current.enabled === false || current.greetingEnabled === false) return
    if (isBusy()) return
    const idleMs = now() - lastActivity
    const afterMs = Math.max(1, Number(current.greetingAfterMinutes ?? 12)) * 60_000
    if (idleMs < afterMs) return
    const repeatMs = Math.max(5, Number(current.greetingRepeatMinutes ?? 25)) * 60_000
    if (lastGreeting > 0 && now() - lastGreeting < repeatMs) return
    if (streak >= MAX_STREAK) return
    greet()
  }

  const noteActivity = () => {
    lastActivity = now()
    streak = 0
  }

  // 任务完成 / 出错时的口头播报，30 秒内最多一次，避免连续任务时吵。
  const announce = (kind) => {
    const current = cfg()
    if (current.enabled === false || current.voiceEnabled === false) return
    if (current.voiceAnnouncements === false) return
    if (now() - lastAnnounce < 30_000) return
    lastAnnounce = now()
    const text = pick(kind === 'error' ? LINES.error : LINES.success)
    emit(text, kind === 'error' ? 'ERROR' : 'SUCCESS')
    say(text)
    lastActivity = now()
    streak = 0
  }

  const timer = setIntervalFn(tick, intervalMs)
  timer?.unref?.()

  return {
    tick,
    greet,
    announce,
    noteActivity,
    stop() {
      disposed = true
      clearIntervalFn(timer)
    },
  }
}

export const GREETING_LINES = LINES
