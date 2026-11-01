// 进度汇总：读书 + 单词降噪，写到文件供原生状态卡显示。
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const PROGRESS_PATH = join(homedir(), '.dsh', 'dsh-dafeiyu-progress.json')
const BOOKS_DIR = '/Volumes/DISK1/书库/kindle，正版的，自己购买'
const BOOKS_MANIFEST = join(homedir(), '.dsh', 'dfy-books-read.json')
const DENOISE_MANIFEST = join(homedir(), 'Downloads/dfy/word-denoise/manifest.json')

function countFiles(dir) {
  try { return readdirSync(dir).filter((name) => {
    try { return statSync(join(dir, name)).isFile() } catch { return false }
  }).length } catch { return 0 }
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}

export function createProgressReporter({ logger = console, intervalMs = 60000 } = {}) {
  const snapshot = () => {
    const booksManifest = readJson(BOOKS_MANIFEST) ?? { read: {}, failed: {} }
    const denoiseManifest = readJson(DENOISE_MANIFEST) ?? { done: {}, failed: {} }
    const booksTotal = countFiles(BOOKS_DIR)
    const booksDone = Object.keys(booksManifest.read ?? {}).length
    const denoiseTotal = 7753
    const denoiseDone = Object.keys(denoiseManifest.done ?? {}).length
    const payload = {
      books: { done: booksDone, total: booksTotal, percent: booksTotal ? Number((booksDone / booksTotal * 100).toFixed(1)) : 0 },
      denoise: { done: denoiseDone, total: denoiseTotal, percent: Number((denoiseDone / denoiseTotal * 100).toFixed(1)) },
      at: Date.now(),
    }
    try { writeFileSync(PROGRESS_PATH, JSON.stringify(payload, null, 2) + '\n') } catch {}
    return payload
  }

  snapshot()
  const timer = setInterval(() => { try { snapshot() } catch {} }, intervalMs)
  if (typeof timer.unref === 'function') timer.unref()
  return { snapshot, path: PROGRESS_PATH }
}
