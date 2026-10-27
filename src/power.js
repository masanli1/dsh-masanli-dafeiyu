// 防休眠：DSH 有任务在跑（或降噪在处理）时，用 caffeinate 顶住系统空闲休眠。
// 引用计数保证多个来源（会话轮次、降噪任务）叠加时不会提前释放。
import { spawn } from 'node:child_process'

export function createPowerKeeper({
  logger = console,
  command = '/usr/bin/caffeinate',
  platform = process.platform,
  spawnFn = spawn,
  extraArgs = ['-i', '-m'],
} = {}) {
  const argsOf = () => (typeof extraArgs === 'function' ? extraArgs() : extraArgs)
  let child = null
  let holders = 0

  const acquire = () => {
    holders += 1
    if (holders > 1) return false
    if (platform !== 'darwin') return false
    if (child) return false
    try {
      child = spawnFn(command, [...argsOf()], { stdio: 'ignore' })
      child.once('exit', () => { child = null })
      child.once('error', (error) => {
        logger.warn?.(`dsh-dafeiyu power: 无法启动 caffeinate: ${error?.message ?? error}`)
        child = null
      })
      logger.info?.('dsh-dafeiyu power: 已阻止空闲休眠')
      return true
    } catch (error) {
      logger.warn?.(`dsh-dafeiyu power: 启动失败: ${error?.message ?? error}`)
      child = null
      return false
    }
  }

  const release = () => {
    holders = Math.max(0, holders - 1)
    if (holders > 0) return
    if (!child) return
    const running = child
    child = null
    try {
      running.kill('SIGTERM')
    } catch {
      // already gone
    }
    logger.info?.('dsh-dafeiyu power: 已恢复允许休眠')
  }

  const stop = () => {
    holders = 0
    if (!child) return
    const running = child
    child = null
    try {
      running.kill('SIGTERM')
    } catch {
      // already gone
    }
  }

  return {
    acquire,
    release,
    stop,
    get active() { return child !== null },
    get holders() { return holders },
  }
}
