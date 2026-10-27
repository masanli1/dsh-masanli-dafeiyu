import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createPowerKeeper } from '../src/power.js'

const spawns = []
const kills = []
const fakeSpawn = (command, args) => {
  const child = new EventEmitter()
  child.args = args
  child.kill = (signal) => { kills.push({ args, signal }); return true }
  spawns.push({ command, args, child })
  return child
}

const keeper = createPowerKeeper({ logger: { info() {}, warn() {} }, spawnFn: fakeSpawn })

assert.equal(keeper.acquire(), true)
assert.equal(spawns.length, 1)
assert.deepEqual(spawns[0].args, ['-i', '-m'])

// 第二个持有者复用同一个 caffeinate
assert.equal(keeper.acquire(), false)
assert.equal(spawns.length, 1)
assert.equal(keeper.holders, 2)

keeper.release()
assert.equal(kills.length, 0, '还有持有者时不能放行')

keeper.release()
assert.equal(kills.length, 1)
assert.equal(kills[0].signal, 'SIGTERM')

// 再次需要时能重新挂上
assert.equal(keeper.acquire(), true)
assert.equal(spawns.length, 2)

keeper.stop()
assert.equal(kills.length, 2)
assert.equal(keeper.holders, 0)

// 屏幕常亮参数
const keeper2 = createPowerKeeper({
  logger: { info() {}, warn() {} },
  spawnFn: fakeSpawn,
  extraArgs: () => ['-i', '-m', '-d'],
})
keeper2.acquire()
assert.deepEqual(spawns.at(-1).args, ['-i', '-m', '-d'])
keeper2.stop()

console.log('ok   power：单实例 / 引用计数 / 释放 / 重新挂载 / 屏幕参数')
