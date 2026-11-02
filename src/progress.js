// 进度汇总：读书 + 单词降噪，写到文件供原生状态卡显示。
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const PROGRESS_PATH = join(homedir(), '.dsh', 'dsh-dafeiyu-progress.json')
const STATS_HUB = join(homedir(), '.dsh', 'dfy-stats.json')

// 统一统计文件：每个模块只写自己那一段，卡片只读这一个文件
function hubUpdate(section, data) {
  try {
    let all = {}
    try { all = JSON.parse(readFileSync(STATS_HUB, 'utf8')) } catch {}
    all[section] = { ...(all[section] ?? {}), ...data }
    all.updated = new Date().toISOString().replace('T', ' ').slice(0, 19)
    const tmp = STATS_HUB + '.tmp'
    writeFileSync(tmp, JSON.stringify(all, null, 1))
    renameSync(tmp, STATS_HUB)
  } catch {}
}
const BOOKS_DIR = '/Volumes/DISK1/书库/kindle，正版的，自己购买'
const BOOKS_MANIFEST = join(homedir(), '.dsh', 'dfy-books-read.json')
const DENOISE_MANIFEST = join(homedir(), 'Downloads/dfy/word-denoise/manifest.json')
const CACHE_STATS = join(homedir(), '.dsh', 'dfy-cache-stats.json')
const OCR_PROGRESS = join(homedir(), '.dsh', 'dfy-ocr-progress.json')

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
    const booksFailed = Object.keys(booksManifest.failed ?? {}).length
    // 读不了的（扫描版 PDF 之类）不算进总数，否则永远到不了 100%
    const booksTotal = Math.max(0, countFiles(BOOKS_DIR) - booksFailed)
    const booksDone = Object.keys(booksManifest.read ?? {}).length
    const denoiseTotal = 7753
    const denoiseDone = Object.keys(denoiseManifest.done ?? {}).length
    const cache = readJson(CACHE_STATS) ?? null
    const ocr = readJson(OCR_PROGRESS) ?? null
    const payload = {
      books: { done: booksDone, total: booksTotal, percent: booksTotal ? Number((booksDone / booksTotal * 100).toFixed(1)) : 0 },
      // 段表缓存命中：宠物状态卡上会多一行"段 xxx万 · 命中 xx%"
      cache: cache ? { hitRate: Number(cache.hitRate ?? 0), segments: Number(cache.segments ?? 0) } : undefined,
      ocr: ocr ? { done: Number(ocr.books_done ?? 0), total: Number(ocr.books_total ?? 0),
                   pages: Number(ocr.pages ?? 0), percent: Number(ocr.percent ?? 0) } : undefined,
      denoise: { done: denoiseDone, total: denoiseTotal, percent: Number((denoiseDone / denoiseTotal * 100).toFixed(1)) },
      at: Date.now(),
    }
    try { writeFileSync(PROGRESS_PATH, JSON.stringify(payload, null, 2) + '\n') } catch {}
    hubUpdate('books', { done: payload.books?.done ?? 0, total: payload.books?.total ?? 0,
                         percent: payload.books?.percent ?? 0 })
    if (payload.denoise) hubUpdate('denoise', payload.denoise)
    if (payload.cache) hubUpdate('segments', { distinct: payload.cache.segments ?? 0,
                                               hitRate: payload.cache.hitRate ?? 0 })
    return payload
  }

  snapshot()
  const timer = setInterval(() => { try { snapshot() } catch {} }, intervalMs)
  if (typeof timer.unref === 'function') timer.unref()
  return { snapshot, path: PROGRESS_PATH }
}
