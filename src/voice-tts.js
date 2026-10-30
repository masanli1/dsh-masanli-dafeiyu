// 克隆音色 TTS：本机跑 GPT-SoVITS（api_v2.py）当服务，插件按需拉起、常驻复用。
//
// 为什么是「服务」而不是「每次起个进程」：模型加载要 20~40 秒，
// 每句话都重新加载没法用；常驻之后一句 3 秒的话大约 8~20 秒（纯 CPU）。
//
// 接口：POST /tts（form/query 参数），返回 wav 字节流。
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_ROOT = join(process.env.HOME || '', 'Downloads', 'dfy', 'gpt-sovits')

function firstExisting(paths) {
  return paths.find((path) => path && existsSync(path)) || ''
}

export function ffmpegPath() {
  const candidates = [
    process.env.DFF_FFMPEG || process.env.DF_FACTORY_FFMPEG,
    join(process.env.HOME || '', 'Documents', '大肥鱼声音', 'bin', 'ffmpeg'),
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/Applications/NPSS-Enhancer v3.3.1.app/Contents/Resources/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1',
  ]
  return firstExisting(candidates)
}

export function createCloneVoice({
  logger = console,
  root = process.env.GSV_ROOT || DEFAULT_ROOT,
  port = 9880,
  python = '',
  refAudio = '',
  promptText = '',
  afplayPath = '/usr/bin/afplay',
} = {}) {
  const base = `http://127.0.0.1:${port}`
  let child = null
  let starting = null
  let queue = Promise.resolve()
  let busy = 0
  let lastError = ''
  let ready = false

  const pythonBin = () => python
    || firstExisting([
      join(process.env.HOME || '', '.dsh', 'dsh-dafeiyu', 'voice', 'gsv', 'bin', 'python'),
      join(process.env.HOME || '', '.dsh', 'dsh-dafeiyu', 'voice', 'venv', 'bin', 'python'),
    ])

  const probe = async (timeoutMs = 1200) => {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      await fetch(`${base}/`, { signal: controller.signal }).catch(() => null)
      clearTimeout(timer)
      return true
    } catch {
      return false
    }
  }

  const waitReady = async (timeoutMs = 120000) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (await probe()) return true
      if (child && child.exitCode !== null) return false
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
    return false
  }

  const ensureServer = async () => {
    if (await probe()) { ready = true; return true }
    if (starting) return starting
    starting = (async () => {
      const bin = pythonBin()
      const script = join(root, 'api_v2.py')
      if (!bin || !existsSync(script)) {
        lastError = `找不到 GPT-SoVITS（${root}）或它的 python 环境`
        return false
      }
      const env = { ...process.env }
      const ffmpeg = ffmpegPath()
      if (ffmpeg) env.PATH = `${join(ffmpeg, '..')}:${env.PATH || ''}`
      env.PYTHONPATH = [root, join(root, 'GPT_SoVITS'), env.PYTHONPATH || ''].filter(Boolean).join(':')
      logger.info?.(`dsh-dafeiyu: 启动 GPT-SoVITS 服务（${port}）`)
      child = spawn(bin, [script, '-a', '127.0.0.1', '-p', String(port),
        '-c', join(root, 'GPT_SoVITS', 'configs', 'tts_infer.yaml')], {
        cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], detached: false,
      })
      let stderr = ''
      child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString('utf8')).slice(-2000) })
      child.once('exit', (code) => {
        child = null
        ready = false
        if (code !== 0 && code !== null) lastError = stderr.split('\n').slice(-2).join(' ').slice(0, 300)
      })
      const ok = await waitReady()
      ready = ok
      starting = null
      return ok
    })()
    ready = await starting
    return ready
  }

  const synthesize = async (text, options = {}) => {
    const params = new URLSearchParams({
      text: String(text),
      text_lang: options.language || 'en',
      ref_audio_path: options.refAudio || refAudio,
      prompt_text: options.promptText || promptText,
      prompt_lang: options.promptLang || 'en',
      text_split_method: 'cut5',
      batch_size: '1',
      media_type: 'wav',
      speed_factor: String(options.speed ?? 1),
    })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs ?? 180000))
    let response
    try {
      response = await fetch(`${base}/tts?${params.toString()}`, { signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`TTS 服务返回 ${response.status}: ${detail.slice(0, 200)}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length < 1000) throw new Error('TTS 返回的音频太小')
    return buffer
  }

  const play = (buffer) => new Promise((resolve) => {
    let dir
    try {
      dir = mkdtempSync(join(tmpdir(), 'dfy-tts-'))
      const path = join(dir, 'say.wav')
      writeFileSync(path, buffer)
      const player = spawn(afplayPath, [path], { stdio: 'ignore' })
      player.once('exit', () => { try { rmSync(dir, { recursive: true, force: true }) } catch {} ; resolve(true) })
      player.once('error', () => { try { rmSync(dir, { recursive: true, force: true }) } catch {} ; resolve(false) })
    } catch {
      resolve(false)
    }
  })

  return {
    async start() { return ensureServer() },
    get status() { return { ready, busy, lastError, port } },
    /**
     * 说一句：合成 + 播放（排队，不打断）。失败返回 false，让调用方回退到系统语音。
     */
    speak(text, options = {}) {
      const line = String(text ?? '').replace(/\s+/g, ' ').trim()
      if (!line) return Promise.resolve(false)
      busy += 1
      const task = queue.then(async () => {
        try {
          if (!(await ensureServer())) return false
          const audio = await synthesize(line, options)
          if (options.outFile) { writeFileSync(options.outFile, audio); return true }
          return await play(audio)
        } catch (error) {
          lastError = String(error?.message ?? error)
          logger.warn?.(`dsh-dafeiyu TTS 失败: ${lastError}`)
          return false
        } finally {
          busy -= 1
        }
      })
      queue = task.catch(() => {})
      return task
    },
    stop() {
      queue = Promise.resolve()
      if (child) { try { child.kill('SIGTERM') } catch {} ; child = null }
      ready = false
    },
    configure(next = {}) {
      if (typeof next.refAudio === 'string' && next.refAudio) refAudio = next.refAudio
      if (typeof next.promptText === 'string' && next.promptText) promptText = next.promptText
    },
    readRefText(path) {
      try { return readFileSync(path, 'utf8').trim() } catch { return '' }
    },
  }
}
