// Local text-to-speech for the companion. macOS ships a good offline voice
// (`say`), so nothing leaves the machine and no model call is involved.
// One utterance at a time: a new line cancels the previous one.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function createSpeaker({
  logger = console,
  sayPath = '/usr/bin/say',
  platform = process.platform,
  // 音色：给出 applyEnvelope 时，先合成到临时文件、整形、再播放
  preset: factoryPreset = '',
  applyEnvelope = null,
  afplayPath = '/usr/bin/afplay',
} = {}) {
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

  const speak = (text, { voice, rate, volume, preset: callPreset = '' } = {}) => {
    const line = String(text ?? '').replace(/\s+/g, ' ').trim()
    if (!line || platform !== 'darwin') return false
    stop()
    const args = []
    if (voice) args.push('-v', String(voice))
    if (Number.isFinite(Number(rate)) && Number(rate) > 0) args.push('-r', String(Math.round(Number(rate))))
    // `say` has no volume flag; the Speech Manager command sets it inline.
    const gain = Number(volume)
    const body = Number.isFinite(gain) && gain > 0 && gain < 1 ? `[[volm ${gain.toFixed(2)}]]${line}` : line

    // 有音色预设：say 到文件 → 频响整形 → 播放整形的结果
    const preset = callPreset || factoryPreset
    if (preset && typeof applyEnvelope === 'function') {
      let dir
      try {
        dir = mkdtempSync(join(tmpdir(), 'dfy-voice-'))
        const aiff = join(dir, 'say.aiff')
        const wav = join(dir, 'out.wav')
        const synth = spawn(sayPath, [...args, '-o', aiff, body], { stdio: 'ignore' })
        synth.once('error', () => { try { rmSync(dir, { recursive: true, force: true }) } catch {} })
        synth.once('exit', (code) => {
          if (code !== 0) { try { rmSync(dir, { recursive: true, force: true }) } catch {} ; return }
          Promise.resolve(applyEnvelope(preset, aiff, wav))
            .then(() => {
              child = spawn(afplayPath, [wav], { stdio: 'ignore' })
              child.once('exit', () => { child = null; try { rmSync(dir, { recursive: true, force: true }) } catch {} })
              child.once('error', () => { child = null; try { rmSync(dir, { recursive: true, force: true }) } catch {} })
            })
            .catch((error) => {
              logger.warn?.(`dsh-dafeiyu voice: 音色处理失败，回退原声: ${error?.message ?? error}`)
              try { rmSync(dir, { recursive: true, force: true }) } catch {}
              child = spawn(sayPath, [...args, body], { stdio: 'ignore' })
              child.once('exit', () => { child = null })
            })
        })
        return true
      } catch (error) {
        logger.warn?.(`dsh-dafeiyu voice: 音色流程失败: ${error?.message ?? error}`)
        try { if (dir) rmSync(dir, { recursive: true, force: true }) } catch {}
      }
    }

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
