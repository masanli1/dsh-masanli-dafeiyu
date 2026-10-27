// 小说写作：把大纲、人物卡、章节落到本地目录，并提供字数统计与导出。
// 结构：<root>/<书名>/{meta.json, outline.md, characters.md, chapters/第NN章-标题.md}
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative, resolve } from 'node:path'

export const DEFAULT_NOVEL_ROOT = join(homedir(), 'Documents', '大肥鱼小说')

const CJK = /[\u4e00-\u9fff\u3400-\u4dbf]/g
const LATIN = /[A-Za-z0-9']+/g

export function countWords(text) {
  const value = String(text ?? '')
  const cjk = (value.match(CJK) ?? []).length
  const latin = (value.replace(CJK, ' ').match(LATIN) ?? []).length
  return { cjk, latin, total: cjk + latin }
}

function safeName(name) {
  const value = String(name ?? '').trim()
  if (!value) throw new Error('缺少书名')
  if (/[\\/]|\.\./.test(value)) throw new Error('书名不能包含路径分隔符')
  return value
}

function bookDir(root, name) {
  return join(root, safeName(name))
}

function readIfExists(path) {
  try { return readFileSync(path, 'utf8') } catch { return undefined }
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true })
}

function chapterFiles(dir) {
  const chapters = join(dir, 'chapters')
  if (!existsSync(chapters)) return []
  return readdirSync(chapters)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => ({ name, path: join(chapters, name) }))
}

function bookStats(dir) {
  const files = chapterFiles(dir)
  let words = 0
  for (const file of files) words += countWords(readIfExists(file.path)).total
  const outline = readIfExists(join(dir, 'outline.md')) ?? ''
  const characters = readIfExists(join(dir, 'characters.md')) ?? ''
  return {
    book: dir.split('/').pop(),
    dir,
    chapters: files.length,
    chapterWords: words,
    outlineWords: countWords(outline).total,
    characterWords: countWords(characters).total,
    updatedAt: newestMtime([join(dir, 'chapters'), join(dir, 'outline.md'), join(dir, 'characters.md')]),
  }
}

function newestMtime(paths) {
  let newest = 0
  for (const path of paths) {
    try {
      const stat = statSync(path)
      newest = Math.max(newest, stat.mtimeMs)
    } catch {
      // 不存在就跳过
    }
  }
  return newest ? new Date(newest).toISOString() : undefined
}

export function createNovelTool({ root = DEFAULT_NOVEL_ROOT, logger = console } = {}) {
  const requireBook = (name) => {
    const dir = bookDir(root, name)
    if (!existsSync(dir)) throw new Error(`没有这本书：${safeName(name)}`)
    return dir
  }

  return {
    name: 'novel',
    description: [
      '管理本地小说项目：创建书籍、写大纲/人物卡、按章写作或追加、统计字数、导出全书。',
      `文件保存在 ${root}，一章一个 Markdown 文件，便于版本管理与二次编辑。`,
      'action 取值：create / write / append / read / outline / characters / status / list / export。',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'write', 'append', 'read', 'outline', 'characters', 'status', 'list', 'export'] },
        book: { type: 'string', description: '书名（目录名）' },
        chapter: { type: 'integer', description: '章节号，从 1 开始' },
        title: { type: 'string', description: '章节标题（可选）' },
        content: { type: 'string', description: '正文 / 大纲 / 人物设定；read 时忽略' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          book: { type: 'string' },
          path: { type: 'string' },
          chapters: { type: 'integer' },
          words: { type: 'integer' },
          text: { type: 'string' },
          books: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
        additionalProperties: true,
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.books
          ? `小说项目 ${value.books.length} 本：\n` + value.books.map((item) => `- 《${item.book}》${item.chapters} 章 · ${item.chapterWords + item.outlineWords + item.characterWords} 字`).join('\n')
          : value.text !== undefined
            ? value.text
            : `《${value.book ?? ''}》${value.ok ? '完成' : '失败'}${value.path ? `\n${value.path}` : ''}${value.words !== undefined ? `\n当前合计 ${value.words} 字` : ''}`,
      }],
    },
    async execute(args) {
      const action = String(args.action ?? '')
      ensureDir(root)

      if (action === 'list') {
        const books = readdirSync(root)
          .map((name) => join(root, name))
          .filter((dir) => existsSync(dir) && statSync(dir).isDirectory())
          .map(bookStats)
          .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
        return { ok: true, books }
      }

      const name = safeName(args.book)
      const dir = join(root, name)

      if (action === 'create') {
        ensureDir(join(dir, 'chapters'))
        if (!existsSync(join(dir, 'meta.json'))) {
          writeFileSync(join(dir, 'meta.json'), JSON.stringify({ title: name, createdAt: new Date().toISOString() }, null, 2))
        }
        if (args.content) writeFileSync(join(dir, 'outline.md'), String(args.content))
        return { ok: true, book: name, path: dir, ...bookStats(dir) }
      }

      if (action === 'status') {
        const stats = bookStats(requireBook(name))
        return { ok: true, ...stats }
      }

      if (action === 'outline' || action === 'characters') {
        const target = join(requireBook(name), action === 'outline' ? 'outline.md' : 'characters.md')
        if (args.content === undefined) {
          return { ok: true, book: name, path: target, text: readIfExists(target) ?? '' }
        }
        writeFileSync(target, String(args.content))
        return { ok: true, book: name, path: target, words: countWords(args.content).total }
      }

      if (action === 'export') {
        const stats = bookStats(requireBook(name))
        const parts = []
        const outline = readIfExists(join(dir, 'outline.md'))
        if (outline) parts.push(`# ${name} · 大纲\n\n${outline}`)
        for (const file of chapterFiles(dir)) {
          parts.push(readIfExists(file.path) ?? '')
        }
        const target = join(dir, `${name}-全书.md`)
        writeFileSync(target, parts.join('\n\n---\n\n'))
        return { ok: true, book: name, path: target, words: stats.chapterWords, chapters: stats.chapters }
      }

      // 章节操作
      const chapter = Number(args.chapter)
      if (!Number.isInteger(chapter) || chapter < 1) throw new Error('chapter 必须是 ≥1 的整数')
      const chapterDir = join(requireBook(name), 'chapters')
      ensureDir(chapterDir)
      const prefix = `第${String(chapter).padStart(2, '0')}章`
      const existing = readdirSync(chapterDir).find((file) => file.startsWith(prefix))

      if (action === 'read') {
        const file = chapterFiles(join(root, name)).find((item) => item.name.startsWith(prefix))
        if (!file) throw new Error(`第 ${chapter} 章还不存在`)
        return { ok: true, book: name, path: file.path, text: readIfExists(file.path) ?? '' }
      }

      if (action === 'write' || action === 'append') {
        const fileName = existing ?? `${prefix}-${(args.title ?? '未命名').replace(/[\\/:*?"<>|]/g, '')}.md`
        const path = join(chapterDir, fileName)
        const body = String(args.content ?? '')
        if (action === 'write') {
          const heading = readIfExists(path)?.match(/^# .*$/m)?.[0] ?? `# ${prefix}${args.title ? ' ' + args.title : ''}`
          writeFileSync(path, `${heading}\n\n${body}\n`)
        } else {
          const previous = readIfExists(path)
          if (previous === undefined) throw new Error(`第 ${chapter} 章还不存在，先用 write`)
          writeFileSync(path, `${previous.trimEnd()}\n\n${body}\n`)
        }
        const stats = bookStats(dir)
        logger.info?.(`dsh-dafeiyu novel: 《${name}》第 ${chapter} 章已更新`)
        return { ok: true, book: name, path, chapter, words: countWords(readIfExists(path)).total, chapters: stats.chapters }
      }

      throw new Error(`未知 action：${action}`)
    },
  }
}

export function createNovelService({ tool, root = DEFAULT_NOVEL_ROOT, logger = console }) {
  const bookDetail = (name) => {
    const dir = bookDir(root, safeName(name))
    if (!existsSync(dir)) throw new Error(`没有这本书：${safeName(name)}`)
    const chapters = chapterFiles(dir).map((file, index) => ({
      index: index + 1,
      name: file.name,
      title: (readIfExists(file.path) ?? '').match(/^#\s+(.*)$/m)?.[1] ?? file.name.replace(/\.md$/, ''),
      words: countWords(readIfExists(file.path)).total,
      updatedAt: (() => { try { return new Date(statSync(file.path).mtimeMs).toISOString() } catch { return undefined } })(),
    }))
    const stats = bookStats(dir)
    return { ...stats, chapters, totalWords: stats.chapterWords + stats.outlineWords + stats.characterWords }
  }

  const createBook = (name) => {
    const dir = bookDir(root, safeName(name))
    ensureDir(join(dir, 'chapters'))
    if (!existsSync(join(dir, 'meta.json'))) {
      writeFileSync(join(dir, 'meta.json'), JSON.stringify({ title: safeName(name), createdAt: new Date().toISOString() }, null, 2))
    }
    return bookStats(dir)
  }

  const exportBook = (name) => {
    const dir = bookDir(root, safeName(name))
    if (!existsSync(dir)) throw new Error(`没有这本书：${safeName(name)}`)
    const parts = []
    const outline = readIfExists(join(dir, 'outline.md'))
    if (outline) parts.push(`# ${safeName(name)} · 大纲\n\n${outline}`)
    const characters = readIfExists(join(dir, 'characters.md'))
    if (characters) parts.push(`# 人物设定\n\n${characters}`)
    for (const file of chapterFiles(dir)) parts.push(readIfExists(file.path) ?? '')
    const target = join(dir, `${safeName(name)}-全书.md`)
    writeFileSync(target, parts.join('\n\n---\n\n'))
    return { path: target, words: countWords(parts.join('\n')).total }
  }

  const listBooks = () => {
    try {
      return readdirSync(root)
        .map((name) => join(root, name))
        .filter((dir) => existsSync(dir) && statSync(dir).isDirectory())
        .map(bookStats)
        .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
    } catch {
      return []
    }
  }
  const bookPath = (name) => {
    const dir = bookDir(root, name)
    if (!existsSync(dir)) throw new Error(`没有这本书：${name}`)
    return dir
  }
  return { root, listBooks, bookDetail, createBook, exportBook, bookPath, tool }
}

export function registerNovelTool(ctx, { logger = console, root = DEFAULT_NOVEL_ROOT } = {}) {
  const register = (target) => {
    try {
      if (!target.tools?.register) {
        logger.warn?.('dsh-dafeiyu: 没有找到 ctx.tools，小说工具未注册')
        return
      }
      target.tools.register(createNovelTool({ root, logger }))
      logger.info?.('dsh-dafeiyu: novel 工具已注册')
    } catch (error) {
      logger.error?.(`dsh-dafeiyu 注册小说工具失败: ${error?.message ?? error}`)
    }
  }
  if (typeof ctx.inject === 'function') ctx.inject(['tools'], register)
  else register(ctx)
}
