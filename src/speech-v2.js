// 本地 TTS（macOS `say`）。
// 连贯性策略：
//   1) 相邻 220ms 内的多句话合并成一句（用逗号连接）再合成，少切分；
//   2) 正在播报时来的新句子进入队列，播完接着播，不打断、不留空白；
//   3) 需要音色时先合成到临时文件、整形，再用 afplay 播放（音量交给 afplay）。
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MERGE_WINDOW_MS = 220

export function createSpeaker({
  logger = console,
  sayPath = '/usr/bin/say',
  platform = process.platform,
  preset: factoryPreset = '',
  applyEnvelope = null,
  afplayPath = '/usr/bin/afplay',
} = {}) {
  let child = null
  let queue = []
  let mergeTimer = null
  let disposed = false

  const stop = () => {
    clearTimeout(mergeTimer)
    queue = []
    if (!child) return
    const running = child
    child = null
    try { running.kill('SIGTERM') } catch {}
  }

  const sayArgs = (text, opts) => {
    const args = []
    if (opts.voice) args.push('-v', String(opts.voice))
    if (Number.isFinite(Number(opts.rate)) && Number(opts.rate) > 0) args.push('-r', String(Math.round(Number(opts.rate))))
    return { args, text }
  }

  const start = () => {
    if (disposed || child || queue.length === 0) return
    const opts = queue[queue.length - 1].opts
    const text = queue.map((item) => item.text).join('，')
    queue = []
    const { args } = sayArgs(text, opts)
    const preset = opts.preset || factoryPreset
    const volume = Number(opts.volume)

    const finish = () => {
      child = null
      if (queue.length) setTimeout(start, 30)
    }

    if (preset && typeof applyEnvelope === 'function') {
      let dir
      try {
        dir = mkdtempSync(join(tmpdir(), 'dfy-voice-'))
        const aiff = join(dir, 'say.aiff')
        const wav = join(dir, 'out.wav')
        const synth = spawn(sayPath, [...args, '-o', aiff, text], { stdio: 'ignore' })
        synth.once('error', () => { try { rmSync(dir, { recursive: true, force: true }) } catch {} ; finish() })
        synth.once('exit', (code) => {
          if (code !== 0) { try { rmSync(dir, { recursive: true, force: true }) } catch {} ; finish(); return }
          Promise.resolve(applyEnvelope(preset, aiff, wav))
            .then(() => {
              const playArgs = []
              if (Number.isFinite(volume) && volume > 0 && volume < 1) playArgs.push('-v', volume.toFixed(2))
              child = spawn(afplayPath, [...playArgs, wav], { stdio: 'ignore' })
              child.once('exit', () => { try { rmSync(dir, { recursive: true, force: true }) } catch {} ; finish() })
              child.once('error', () => { try { rmSync(dir, { recursive: true, force: true }) } catch {} ; finish() })
            })
            .catch((error) => {
              logger.warn?.(`dsh-dafeiyu voice: 音色处理失败，回退原声: ${error?.message ?? error}`)
              try { rmSync(dir, { recursive: true, force: true }) } catch {}
              child = spawn(sayPath, [...args, text], { stdio: 'ignore' })
              child.once('exit', finish)
              child.once('error', finish)
            })
        })
        return
      } catch (error) {
        logger.warn?.(`dsh-dafeiyu voice: 音色流程失败: ${error?.message ?? error}`)
        try { if (dir) rmSync(dir, { recursive: true, force: true }) } catch {}
      }
    }

    try {
      child = spawn(sayPath, [...args, text], { stdio: 'ignore' })
      child.once('exit', finish)
      child.once('error', (error) => {
        logger.warn?.(`dsh-dafeiyu voice: say 启动失败: ${error?.message ?? error}`)
        finish()
      })
    } catch (error) {
      logger.warn?.(`dsh-dafeiyu voice: 无法启动 say: ${error?.message ?? error}`)
      child = null
    }
  }

  const speak = (text, opts = {}) => {
    const line = String(text ?? '').replace(/\s+/g, ' ').trim()
    if (!line || platform !== 'darwin') return false
    queue.push({ text: line, opts })
    // 短窗口内的连续句子合并成一句，避免"一句一顿"
    clearTimeout(mergeTimer)
    mergeTimer = setTimeout(start, child ? 0 : MERGE_WINDOW_MS)
    return true
  }

  const dispose = () => {
    disposed = true
    stop()
  }

  return {
    speak,
    stop,
    dispose,
    get speaking() { return child !== null || queue.length > 0 },
  }
}
