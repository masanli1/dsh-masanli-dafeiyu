import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from './process.js'

export const name = 'dsh-npss-denoiser'

// Import-time heartbeat, flushed again once the tool registers. It distinguishes
// "the loader never imported this plugin" from "imported but tools unavailable"
// without needing host logs.
function writeHeartbeat(phase) {
  try {
    mkdirSync(join(homedir(), '.dsh'), { recursive: true })
    writeFileSync(join(homedir(), '.dsh', 'dsh-npss-denoiser.json'), `${JSON.stringify({
      plugin: 'dsh-dafeiyu',
      phase,
      tool: 'denoise_audio',
      pid: process.pid,
      at: new Date().toISOString(),
    }, null, 2)}\n`)
  } catch {
    // diagnostics only
  }
}

writeHeartbeat('import')

const pythonDir = fileURLToPath(new URL('../python/', import.meta.url))
const cliPath = join(pythonDir, 'npss_cli.py')
const HEARTBEAT = join(homedir(), '.dsh', 'dsh-npss-denoiser.json')

const AUDIO_EXT = new Set(['.wav', '.mp3', '.m4a', '.aac', '.flac', '.aiff', '.aif', '.opus', '.ogg'])
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.webm'])
const MUX_EXT = new Set(['.mp4', '.mov', '.m4v', '.mkv'])
const MAX_LINES = 3

let pythonInfo
let ffmpegPath

const tail = (text) => String(text ?? '').trim().split('\n').filter(Boolean).slice(-MAX_LINES).join(' | ')

// DSH ships a managed Python runtime for its own skills; when it carries numpy
// it is the best default on machines whose system python3 is Apple's stub.
function managedRuntimePythons(home = homedir()) {
  const base = join(home, '.dsh', 'dsh-runtimes')
  try {
    return readdirSync(base)
      .map((entry) => join(base, entry, 'dependencies', 'python', 'bin', 'python3'))
      .filter((candidate) => existsSync(candidate))
  } catch {
    return []
  }
}

// Python is discovered once per host process. A bare `python3` may resolve to a
// Homebrew/conda install or to Apple's stub, so several candidates are probed
// for the two things the DSP core actually needs: Python 3 and numpy.
export async function findPython({ env = process.env, logger = console } = {}) {
  if (pythonInfo) return pythonInfo
  const candidates = [
    env.DSH_NPSS_PYTHON,
    'python3',
    'python',
    ...managedRuntimePythons(env.DSH_HOME ? dirname(env.DSH_HOME) : homedir()),
    '/opt/homebrew/bin/python3',
    '/usr/local/bin/python3',
    '/usr/bin/python3',
  ].filter(Boolean)
  const failures = []
  for (const bin of candidates) {
    try {
      const probe = await run(bin, ['-c', 'import sys, numpy; sys.stdout.write("%s numpy %s" % (sys.version.split()[0], numpy.__version__))'], { timeoutMs: 30000 })
      if (probe.code === 0) {
        pythonInfo = { bin, version: probe.stdout.trim() }
        logger.info?.(`dsh-npss-denoiser: using ${bin} (${pythonInfo.version})`)
        return pythonInfo
      }
      failures.push(`${bin}: ${tail(probe.stderr) || `exit ${probe.code}`}`)
    } catch (error) {
      failures.push(`${bin}: ${error?.code === 'ENOENT' ? 'not found' : error?.message ?? error}`)
    }
  }
  throw new Error(
    'dsh-npss-denoiser 需要带 numpy 的 Python 3。'
    + `已尝试：${failures.join('；')}。`
    + ' 修复：`python3 -m pip install --user numpy`（或 `brew install numpy`），'
    + '也可以用环境变量 DSH_NPSS_PYTHON 指向一个带 numpy 的解释器。',
  )
}

// ffmpeg is only needed for non-WAV input or for writing a non-WAV/muxed
// output. Prefer a system binary, then imageio-ffmpeg's bundled one.
export async function findFfmpeg(python, { env = process.env } = {}) {
  if (ffmpegPath) return ffmpegPath
  const candidates = [env.DSH_NPSS_FFMPEG, 'ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'].filter(Boolean)
  for (const bin of candidates) {
    try {
      const probe = await run(bin, ['-version'], { timeoutMs: 15000 })
      if (probe.code === 0) {
        ffmpegPath = bin
        return bin
      }
    } catch {
      // try the next candidate
    }
  }
  try {
    const probe = await run(python.bin, ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], { timeoutMs: 30000 })
    const candidate = probe.stdout.trim()
    if (probe.code === 0 && candidate && existsSync(candidate)) {
      ffmpegPath = candidate
      return candidate
    }
  } catch {
    // fall through to the actionable error
  }
  throw new Error('处理非 WAV 输入或写出非 WAV 需要 ffmpeg：`brew install ffmpeg`，或用 DSH_NPSS_FFMPEG 指定路径。')
}

function defaultOutput(input, isVideo) {
  const ext = extname(input)
  const stem = basename(input, ext)
  return join(dirname(input), `${stem}-denoised${isVideo ? ext : '.wav'}`)
}

async function decodeToWav(ffmpeg, input, target, signal) {
  const result = await run(ffmpeg, ['-hide_banner', '-nostdin', '-y', '-i', input, '-vn', '-c:a', 'pcm_s16le', target], { signal })
  if (result.code !== 0) throw new Error(`无法把输入解码成 WAV：${tail(result.stderr)}`)
}

async function muxVideo(ffmpeg, video, wav, output, signal) {
  const result = await run(ffmpeg, [
    '-hide_banner', '-nostdin', '-y',
    '-i', video, '-i', wav,
    '-map', '0:v:0?', '-map', '1:a:0',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest',
    output,
  ], { signal })
  if (result.code !== 0) throw new Error(`把降噪音轨写回视频失败：${tail(result.stderr)}`)
}

async function transcode(ffmpeg, wav, output, signal) {
  const result = await run(ffmpeg, ['-hide_banner', '-nostdin', '-y', '-i', wav, output], { signal })
  if (result.code !== 0) throw new Error(`输出转码失败：${tail(result.stderr)}`)
}

const PARAMETERS = {
  type: 'object',
  properties: {
    input: {
      type: 'string',
      description: 'Absolute path to the input file (wav, mp3, m4a, flac, aiff, mp4, mov, mkv...).',
    },
    output: {
      type: 'string',
      description: 'Absolute output path. Defaults to "<name>-denoised.wav" next to the input; video inputs default to the same container with the denoised audio.',
    },
    mode: {
      type: 'string',
      enum: ['music', 'voice'],
      description: 'Content mode: "music" (default, full-band for 48k) or "voice".',
    },
    targetDb: {
      type: 'number',
      description: 'Optional target noise reduction in dB, e.g. 15. Enables calibration (定果寻因); omit to use the fixed thresholds.',
    },
    fast: {
      type: 'boolean',
      description: 'Fast mode: fewer passes, lower quality (roughly 2x faster).',
    },
    workers: {
      type: 'integer',
      description: 'Worker processes for long files. 0/omitted lets the pipeline decide.',
    },
  },
  required: ['input'],
  additionalProperties: false,
}

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    output: { type: 'string' },
    mode: { type: 'string' },
    sampleRate: { type: 'integer' },
    channels: { type: 'integer' },
    durationSeconds: { type: 'number' },
    processSeconds: { type: 'number' },
    rtf: { type: 'number' },
    targetDb: { type: 'number' },
    achievedDb: { type: 'number' },
    hit: { type: 'boolean' },
  },
  required: ['output'],
  additionalProperties: false,
}

// The registry hands model-generated arguments straight to execute, so the
// tool validates them itself. Kept deliberately small: six flat parameters.
export function checkArguments(args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) throw new Error('参数必须是一个对象')
  if (typeof args.input !== 'string' || args.input.trim() === '') throw new Error('input 必须是非空字符串（文件绝对路径）')
  if (args.output !== undefined && (typeof args.output !== 'string' || args.output.trim() === '')) {
    throw new Error('output 必须是非空字符串')
  }
  if (args.mode !== undefined && !['music', 'voice'].includes(args.mode)) throw new Error('mode 只能是 "music" 或 "voice"')
  if (args.targetDb !== undefined && !Number.isFinite(args.targetDb)) throw new Error('targetDb 必须是数字')
  if (args.fast !== undefined && typeof args.fast !== 'boolean') throw new Error('fast 必须是布尔值')
  if (args.workers !== undefined && !Number.isInteger(args.workers)) throw new Error('workers 必须是整数')
}

const DESCRIPTION = [
  'Denoise a local audio or video file with NPSS-Enhancer: a training-free, CPU-only speech/music enhancer (no GPU, no model download).',
  'Returns the output path plus sample rate, duration and real-time factor.',
  'Use mode "voice" for speech, "music" for music (default). targetDb enables 定果寻因: calibrate the dose so the noise floor lands exactly that many dB lower (e.g. 15).',
  'WAV input is processed directly; other audio containers and videos are decoded with ffmpeg, and video output keeps the original picture with the denoised audio track.',
].join(' ')

// A plain registry-ready definition: no runtime dependency on
// @deepseek-ai/dsh-tools, whose peer graph (agent, llm, session, sandbox...)
// would otherwise have to be installed inside the plugin.
export function createDenoiseTool({ logger = console } = {}) {
  return {
    name: 'denoise_audio',
    description: DESCRIPTION,
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: [
          `降噪完成：${value.output}`,
          `${value.mode} · ${value.sampleRate} Hz · ${value.channels} ch · ${value.durationSeconds}s（用时 ${value.processSeconds}s，RTF ${value.rtf}）`,
          value.targetDb !== undefined ? `定果寻因：目标 ${value.targetDb} dB → 实测 ${value.achievedDb} dB（${value.hit ? '命中' : '未命中'}）` : '',
        ].filter(Boolean).join('\n'),
      }],
    },
    timeoutMs: 1_800_000,
    async execute(args, exec) {
      checkArguments(args)
      const input = resolve(args.input)
      if (!existsSync(input) || !statSync(input).isFile()) throw new Error(`输入文件不存在：${input}`)
      const inputExt = extname(input).toLowerCase()
      const isVideo = VIDEO_EXT.has(inputExt)
      const mode = args.mode ?? 'music'
      const output = resolve(args.output ?? defaultOutput(input, isVideo))
      if (output === input) throw new Error('输出路径不能与输入相同')
      const outputExt = extname(output).toLowerCase()
      if (outputExt !== '.wav' && !AUDIO_EXT.has(outputExt) && !MUX_EXT.has(outputExt)) {
        throw new Error(`不支持的输出格式：${outputExt || '(无扩展名)'}`)
      }
      mkdirSync(dirname(output), { recursive: true })

      const python = await findPython({ logger })
      const needsFfmpeg = inputExt !== '.wav' || outputExt !== '.wav'
      const ffmpeg = needsFfmpeg ? await findFfmpeg(python) : undefined

      const workdir = mkdtempSync(join(tmpdir(), 'dsh-npss-'))
      try {
        const wavInput = inputExt === '.wav' ? input : join(workdir, 'input.wav')
        if (wavInput !== input) await decodeToWav(ffmpeg, input, wavInput, exec.signal)

        const wavOut = join(workdir, 'denoised.wav')
        const cliArgs = [cliPath, wavInput, wavOut, '--mode', mode]
        if (args.fast) cliArgs.push('--fast')
        if (Number.isFinite(args.targetDb)) cliArgs.push('--target-nr', String(args.targetDb))
        if (Number.isFinite(args.workers) && args.workers > 0) cliArgs.push('--workers', String(Math.floor(args.workers)))

        logger.info?.(`dsh-npss-denoiser: denoise ${input} -> ${output} (${mode})`)
        const denoise = await run(python.bin, cliArgs, { signal: exec.signal })
        if (denoise.code !== 0) throw new Error(`降噪失败（python 退出 ${denoise.code}）：${tail(denoise.stderr) || tail(denoise.stdout)}`)

        let summary
        try {
          summary = JSON.parse(denoise.stdout.trim().split('\n').filter(Boolean).pop())
        } catch {
          throw new Error(`降噪输出不是预期 JSON：${tail(denoise.stdout) || tail(denoise.stderr)}`)
        }
        if (summary?.error) throw new Error(String(summary.error))

        if (outputExt === '.wav') copyFileSync(wavOut, output)
        else if (MUX_EXT.has(outputExt)) {
          if (!isVideo) throw new Error('只有视频输入才能写出视频容器，音频输入请输出 wav/mp3/m4a/flac')
          await muxVideo(ffmpeg, input, wavOut, output, exec.signal)
        } else {
          await transcode(ffmpeg, wavOut, output, exec.signal)
        }

        const value = {
          output,
          mode,
          sampleRate: Number(summary.sampleRate) || undefined,
          channels: Number(summary.channels) || undefined,
          durationSeconds: Number(summary.durationSeconds) || undefined,
          processSeconds: Number(summary.seconds) || undefined,
          rtf: Number(summary.rtf) || undefined,
        }
        if (summary.targetDb !== undefined) {
          value.targetDb = Number(summary.targetDb)
          value.achievedDb = Number(summary.achievedDb)
          value.hit = summary.hit === true
        }
        return value
      } finally {
        try {
          rmSync(workdir, { recursive: true, force: true })
        } catch {
          // best effort
        }
      }
    },
  }
}

export function apply(ctx) {
  const logger = ctx.logger ?? console
  const register = (target) => {
    try {
      if (!target.tools?.register) {
        logger.warn?.('dsh-npss-denoiser: 没有找到 ctx.tools，工具未注册（需要 DSH 的 tools 服务）')
        return
      }
      target.tools.register(createDenoiseTool({ logger }))
      logger.info?.('dsh-npss-denoiser: denoise_audio tool registered')
      writeHeartbeat('registered')
    } catch (error) {
      // A registration failure must not take the whole host down.
      logger.error?.(`dsh-npss-denoiser 注册工具失败，本次已停用: ${error?.message ?? error}`)
    }
  }
  // Wait for the tool registry instead of hard-injecting it: a host without
  // the tools service should keep booting, just without this tool.
  if (typeof ctx.inject === 'function') ctx.inject(['tools'], register)
  else register(ctx)
}
