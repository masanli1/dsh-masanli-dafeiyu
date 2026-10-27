// 降噪任务队列 + 目录浏览：给设置页用。
// 同一时刻只跑一个任务（CPU 密集，避免互相抢核），历史写入 ~/.dsh。
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'

const MEDIA_EXT = new Set(['.mp4', '.mov', '.mkv', '.webm', '.m4v', '.avi', '.mp3', '.m4a', '.aac', '.wav', '.flac', '.aiff', '.aif', '.opus', '.ogg'])
const MAX_HISTORY = 8

export function createDenoiseJobs({ tool, logger = console, storePath = join(homedir(), '.dsh', 'dsh-dafeiyu-denoise.json'), root = homedir() }) {
  let history = []
  try {
    const raw = JSON.parse(readFileSync(storePath, 'utf8'))
    if (Array.isArray(raw?.history)) history = raw.history.slice(0, MAX_HISTORY)
  } catch {
    // 首次运行没有历史
  }
  let current = null

  const persist = () => {
    try {
      mkdirSync(dirname(storePath), { recursive: true })
      writeFileSync(storePath, `${JSON.stringify({ history }, null, 2)}\n`)
    } catch (error) {
      logger.warn?.(`dsh-dafeiyu denoise: 历史写入失败: ${error?.message ?? error}`)
    }
  }

  const state = () => ({
    running: current ? { ...current } : null,
    history,
  })

  const start = async ({ input, output, mode, targetDb, fast } = {}) => {
    if (current) throw new Error('已有一个降噪任务在跑，等它结束再开始')
    const file = resolve(String(input ?? ''))
    if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`文件不存在：${file}`)
    const job = {
      startedAt: new Date().toISOString(),
      input: file,
      mode: mode === 'voice' ? 'voice' : 'music',
      targetDb: Number.isFinite(Number(targetDb)) && Number(targetDb) > 0 ? Number(targetDb) : undefined,
      fast: fast === true,
    }
    current = job
    const controller = new AbortController()
    void (async () => {
      try {
        const value = await tool.execute({
          input: file,
          ...(output ? { output: resolve(String(output)) } : {}),
          mode: job.mode,
          ...(job.targetDb ? { targetDb: job.targetDb } : {}),
          ...(job.fast ? { fast: true } : {}),
        }, { signal: controller.signal })
        const entry = { ...job, ok: true, finishedAt: new Date().toISOString(), ...value }
        history = [entry, ...history].slice(0, MAX_HISTORY)
        persist()
        logger.info?.(`dsh-dafeiyu denoise: 完成 ${value.output}`)
      } catch (error) {
        const entry = { ...job, ok: false, finishedAt: new Date().toISOString(), error: String(error?.message ?? error) }
        history = [entry, ...history].slice(0, MAX_HISTORY)
        persist()
        logger.warn?.(`dsh-dafeiyu denoise: 失败 ${entry.error}`)
      } finally {
        current = null
      }
    })()
    return { started: true, job }
  }

  const browse = (dir) => {
    const home = resolve(root)
    const target = dir ? resolve(String(dir)) : home
    const rel = relative(home, target)
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('只能浏览用户目录内的文件')
    const entries = []
    for (const entry of readdirSync(target, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const full = join(target, entry.name)
      if (entry.isDirectory()) {
        entries.push({ name: entry.name, path: full, type: 'dir' })
      } else if (entry.isFile() && MEDIA_EXT.has(extname(entry.name).toLowerCase())) {
        let size = 0
        try { size = statSync(full).size } catch {}
        entries.push({ name: entry.name, path: full, type: 'file', size })
      }
    }
    entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'zh-Hans-CN') : a.type === 'dir' ? -1 : 1))
    return {
      dir: target,
      parent: target === home ? null : dirname(target),
      entries: entries.slice(0, 300),
    }
  }

  return { state, start, browse, storePath }
}
