// Local text-to-speech for the companion. macOS ships a good offline voice
// (`say`), so nothing leaves the machine and no model call is involved.
// One utterance at a time: a new line cancels the previous one.
import { spawn } from 'node:child_process'

export function createSpeaker({ logger = console, sayPath = '/usr/bin/say', platform = process.platform } = {}) {
  let child = null

  const stop = () => {
    if (!child) return
    const running = child
    child = null
    try {
      running.kill('SIGTERM')
    } catch {
      // already gone
    }
  }

  const speak = (text, { voice, rate, volume } = {}) => {
    const line = String(text ?? '').replace(/\s+/g, ' ').trim()
    if (!line || platform !== 'darwin') return false
    stop()
    const args = []
    if (voice) args.push('-v', String(voice))
    if (Number.isFinite(Number(rate)) && Number(rate) > 0) args.push('-r', String(Math.round(Number(rate))))
    // `say` has no volume flag; the Speech Manager command sets it inline.
    const gain = Number(volume)
    const body = Number.isFinite(gain) && gain > 0 && gain < 1 ? `[[volm ${gain.toFixed(2)}]]${line}` : line
    try {
      child = spawn(sayPath, [...args, body], { stdio: 'ignore' })
    } catch (error) {
      logger.warn?.(`dsh-dafeiyu voice: 无法启动 say: ${error?.message ?? error}`)
      return false
    }
    child.once('error', (error) => {
      logger.warn?.(`dsh-dafeiyu voice: say 启动失败: ${error?.message ?? error}`)
      child = null
    })
    child.once('exit', () => {
      child = null
    })
    return true
  }

  return {
    speak,
    stop,
    get speaking() {
      return child !== null
    },
  }
}
