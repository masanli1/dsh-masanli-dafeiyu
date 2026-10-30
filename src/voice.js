// 语音唤醒：把 python/voice/wakeword.py 当常驻子进程跑起来，
// 它每听见一次唤醒词就吐一行 JSON，这里翻译成插件内部事件。
//
// 设计取舍：
// - 语音识别全在本机（sherpa-onnx 关键词检测，约 36MB 模型，CPU 占用很低），
//   不联网、不上传录音；
// - 子进程只负责「听见」，要不要说话、开不开对话面板都由插件决定；
// - 麦克风由 ffmpeg 的 avfoundation 采集，不额外装 PortAudio。
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const WAKEWORD_PY = join(here, '..', 'python', 'voice', 'wakeword.py')
export const VOICE_HOME = join(homedir(), '.dsh', 'dsh-dafeiyu', 'voice')
export const VOICE_MODELS = join(homedir(), 'Documents', '大肥鱼声音', 'models')
export const KWS_MODEL = join(VOICE_MODELS, 'kws')

const PROBE = 'import sys, numpy, sherpa_onnx; sys.stdout.write("ok")'

function runProbe(bin) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(bin, ['-c', PROBE], { stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      resolve(false)
      return
    }
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch {} ; resolve(false) }, 20000)
    child.once('error', () => { clearTimeout(timer); resolve(false) })
    child.once('exit', (code) => { clearTimeout(timer); resolve(code === 0) })
  })
}

// 语音识别要加载 onnxruntime 这类带签名的 dylib，DSH 自带的 python 有硬运行时限制，
// 所以单独准备一个 venv（scripts/setup-voice.sh 会装好）。
export async function findVoicePython({ env = process.env, logger = console } = {}) {
  const candidates = [
    env.DSH_VOICE_PYTHON,
    join(VOICE_HOME, 'venv', 'bin', 'python'),
    join(VOICE_HOME, 'python', 'bin', 'python3.12'),
    join(VOICE_HOME, 'python', 'bin', 'python3'),
  ].filter(Boolean)
  for (const bin of candidates) {
    if (!existsSync(bin)) continue
    if (await runProbe(bin)) return bin
  }
  logger.warn?.('dsh-dafeiyu: 没有可用的语音运行时（先跑 scripts/setup-voice.sh）')
  return ''
}

export function createWakeService({
  logger = console,
  keyword = '大肥鱼',
  modelDir = KWS_MODEL,
  onWake = () => {},
  onStatus = () => {},
} = {}) {
  let child = null
  let stopping = false
  let buffer = ''
  let restarts = 0
  let restartTimer = null
  const status = {
    enabled: false,
    running: false,
    ready: false,
    keyword,
    modelDir,
    lastWakeAt: 0,
    lastWakeKeyword: '',
    lastError: '',
    restarts: 0,
  }

  const publish = (patch = {}) => {
    Object.assign(status, patch)
    try { onStatus({ ...status }) } catch {}
  }

  const handle = (message) => {
    if (!message || typeof message !== 'object') return
    switch (message.event) {
      case 'ready':
        publish({ running: true, ready: true, lastError: '' })
        logger.info?.(`dsh-dafeiyu 语音唤醒已就绪：${message.keyword}（${message.device}）`)
        break
      case 'wake':
        publish({ lastWakeAt: Date.now(), lastWakeKeyword: String(message.keyword ?? keyword) })
        logger.info?.(`dsh-dafeiyu 听见唤醒词：${message.keyword}`)
        try { onWake(String(message.keyword ?? keyword)) } catch (error) {
          logger.error?.(`dsh-dafeiyu 唤醒处理失败: ${error?.message ?? error}`)
        }
        break
      case 'error':
        publish({ lastError: String(message.error ?? '未知错误'), ready: false })
        logger.warn?.(`dsh-dafeiyu 语音唤醒：${message.error}`)
        break
      case 'restart':
        publish({ ready: false, restarts: Number(message.attempt) || restarts })
        break
      default:
        break
    }
  }

  const start = async () => {
    if (child || stopping) return status
    const python = await findVoicePython({ logger })
    if (!python) {
      publish({ enabled: true, running: false, ready: false, lastError: '缺少语音运行时，请先运行 scripts/setup-voice.sh' })
      return status
    }
    if (!existsSync(join(modelDir, 'tokens.txt'))) {
      publish({ enabled: true, running: false, ready: false, lastError: `唤醒模型缺失：${modelDir}` })
      return status
    }
    try {
      child = spawn(python, [
        WAKEWORD_PY,
        '--keyword', keyword,
        '--model-dir', modelDir,
      ], { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      publish({ enabled: true, running: false, lastError: String(error?.message ?? error) })
      return status
    }
    publish({ enabled: true, running: true, ready: false, keyword, modelDir })
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const text = line.trim()
        if (!text.startsWith('{')) continue
        try { handle(JSON.parse(text)) } catch {}
      }
    })
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-800)
    })
    const current = child
    current.once('error', (error) => {
      if (child === current) child = null
      publish({ running: false, ready: false, lastError: String(error?.message ?? error) })
    })
    current.once('exit', (code) => {
      if (child === current) child = null
      publish({ running: false, ready: false })
      if (stopping) return
      restarts += 1
      const delay = Math.min(1000 * restarts, 15000)
      logger.warn?.(`dsh-dafeiyu 语音唤醒退出（${code}）${stderr ? `：${stderr.split('\n').slice(-1)[0]}` : ''}，${delay / 1000}s 后重试`)
      restartTimer = setTimeout(() => { restartTimer = null; start() }, delay)
      if (typeof restartTimer.unref === 'function') restartTimer.unref()
    })
    return status
  }

  const stop = () => {
    stopping = true
    if (restartTimer) { clearTimeout(restartTimer); restartTimer = null }
    const running = child
    child = null
    if (running) {
      try { running.kill('SIGTERM') } catch {}
      setTimeout(() => { try { running.kill('SIGKILL') } catch {} }, 3000).unref?.()
    }
    publish({ running: false, ready: false, enabled: false })
  }

  const restart = async () => {
    stop()
    stopping = false
    return start()
  }

  return {
    start,
    stop,
    restart,
    get status() { return { ...status } },
    configure(next = {}) {
      let changed = false
      if (typeof next.keyword === 'string' && next.keyword && next.keyword !== keyword) { keyword = next.keyword; changed = true }
      if (typeof next.modelDir === 'string' && next.modelDir && next.modelDir !== modelDir) { modelDir = next.modelDir; changed = true }
      return changed
    },
  }
}
