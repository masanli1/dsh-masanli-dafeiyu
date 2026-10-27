import assert from 'node:assert/strict'
import { createGreeter, GREETING_LINES, slotForHour } from '../src/greeter.js'

const silent = { info() {}, warn() {}, error() {} }

function rig(overrides = {}) {
  let clock = 0
  let config = {
    enabled: true,
    greetingEnabled: true,
    greetingAfterMinutes: 10,
    greetingRepeatMinutes: 20,
    voiceEnabled: true,
    voiceAnnouncements: true,
    voiceName: 'Tingting',
    voiceRate: 180,
    ...overrides,
  }
  const bubbles = []
  const spoken = []
  let busy = false
  const greeter = createGreeter({
    config: () => config,
    speak: (text, options) => spoken.push({ text, options }),
    send: (message) => bubbles.push(message),
    logger: silent,
    now: () => clock,
    isBusy: () => busy,
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn: () => {},
  })
  return {
    greeter,
    bubbles,
    spoken,
    advance: (minutes) => { clock += minutes * 60_000 },
    setBusy: (value) => { busy = value },
    setConfig: (patch) => { config = { ...config, ...patch } },
  }
}

const allLines = Object.values(GREETING_LINES).flat()

// 1. 未到阈值不打扰
{
  const r = rig()
  r.advance(9)
  r.greeter.tick()
  assert.equal(r.bubbles.length, 0)
  assert.equal(r.spoken.length, 0)
}

// 2. 到点打招呼：气泡 + 语音
{
  const r = rig()
  r.advance(11)
  r.greeter.tick()
  assert.equal(r.bubbles.length, 1)
  assert.equal(r.bubbles[0].kind, 'pulse')
  assert.ok(allLines.includes(r.bubbles[0].message), '用预设台词')
  assert.equal(r.spoken.length, 1)
  assert.equal(r.spoken[0].options.voice, 'Tingting')
}

// 3. 忙的时候不打扰
{
  const r = rig()
  r.setBusy(true)
  r.advance(60)
  r.greeter.tick()
  assert.equal(r.bubbles.length, 0)
}

// 4. 两次之间要隔够时间
{
  const r = rig()
  r.advance(11)
  r.greeter.tick()
  r.advance(5)
  r.greeter.tick()
  assert.equal(r.bubbles.length, 1, '间隔内不重复')
  r.advance(21)
  r.greeter.tick()
  assert.equal(r.bubbles.length, 2)
}

// 5. 连续三次后闭嘴，直到有人活动
{
  const r = rig()
  for (let i = 0; i < 3; i += 1) {
    r.advance(25)
    r.greeter.tick()
  }
  assert.equal(r.bubbles.length, 3)
  r.advance(60)
  r.greeter.tick()
  assert.equal(r.bubbles.length, 3, '连续打招呼上限')
  r.greeter.noteActivity()
  r.advance(11)
  r.greeter.tick()
  assert.equal(r.bubbles.length, 4, '有人活动后重新计时')
}

// 6. 关掉语音只出气泡
{
  const r = rig({ voiceEnabled: false })
  r.advance(11)
  r.greeter.tick()
  assert.equal(r.bubbles.length, 1)
  assert.equal(r.spoken.length, 0)
}

// 7. 任务播报：30 秒内只一次
{
  const r = rig()
  r.greeter.announce('success')
  r.greeter.announce('success')
  assert.equal(r.bubbles.length, 1)
  r.advance(1)
  r.greeter.announce('error')
  assert.equal(r.bubbles.length, 2)
  assert.equal(r.bubbles[1].state, 'ERROR')
}

// 8. 时段映射
assert.equal(slotForHour(3), 'night')
assert.equal(slotForHour(8), 'morning')
assert.equal(slotForHour(15), 'afternoon')
assert.equal(slotForHour(20), 'evening')

console.log('ok   greeter：阈值 / 忙碌 / 间隔 / 上限 / 语音开关 / 播报节流 / 时段')
