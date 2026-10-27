import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { countWords, createNovelService, createNovelTool } from '../src/novel.js'

const root = mkdtempSync(join(tmpdir(), 'dfy-novel-'))
const tool = createNovelTool({ root, logger: { info() {}, warn() {}, error() {} } })
const svc = createNovelService({ root })

assert.equal(countWords('你好 world 123').total, 2 + 2, '中英混排字数')
console.log('ok   字数统计', countWords('长夜灯火 chapter one'))

await tool.execute({ action: 'create', book: '长夜灯火', content: '# 大纲\n\n少年在雨夜捡到一盏灯。' })
let status = await tool.execute({ action: 'status', book: '长夜灯火' })
assert.equal(status.chapters, 0)
assert.ok(status.outlineWords > 0)

const write = await tool.execute({ action: 'write', book: '长夜灯火', chapter: 1, title: '雨夜', content: '雨下得很大，他把灯抱在怀里。' })
assert.ok(write.words > 0)
await tool.execute({ action: 'append', book: '长夜灯火', chapter: 1, content: '灯忽然亮了。' })

const read = await tool.execute({ action: 'read', book: '长夜灯火', chapter: 1 })
assert.match(read.text, /灯忽然亮了/)
assert.match(read.text, /^# 第01章 雨夜/m, '章节标题保留')

await tool.execute({ action: 'write', book: '长夜灯火', chapter: 2, content: '第二章的草稿。' })
const list = await tool.execute({ action: 'list' })
assert.equal(list.books.length, 1)
assert.equal(list.books[0].chapters, 2)

const detail = svc.bookDetail('长夜灯火')
assert.equal(detail.chapters.length, 2)
assert.equal(detail.chapters[0].title, '第01章 雨夜')

const exported = svc.exportBook('长夜灯火')
assert.ok(existsSync(exported.path))
assert.match(readFileSync(exported.path, 'utf8'), /第二章的草稿/)

await assert.rejects(() => tool.execute({ action: 'read', book: '不存在的书', chapter: 1 }), /没有这本书/)
await assert.rejects(() => tool.execute({ action: 'write', book: '../escape', chapter: 1, content: 'x' }), /书名/)
console.log('ok   小说：创建 / 写作 / 追加 / 读取 / 列表 / 章节明细 / 导出 / 非法书名')
