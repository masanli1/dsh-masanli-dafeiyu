// 哔哩哔哩：查视频信息、看排行、下载（下载只用于你有权保存的内容）。
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'
const DL_SCRIPT = process.env.DFY_BILI_DL ?? join(homedir(), 'Downloads/dfy/dfy-factory/scripts/bili-dl.mjs')
const YTDLP = process.env.YTDLP ?? join(homedir(), 'Downloads/dfy/tools/yt-dlp')
const DEFAULT_DIR = join(homedir(), 'Downloads', '大肥鱼视频')

let cookie = ''
async function bootstrap() {
  if (cookie) return cookie
  try {
    const response = await fetch('https://www.bilibili.com/', { headers: { 'user-agent': UA } })
    const jar = response.headers.getSetCookie?.() ?? []
    cookie = jar.map((entry) => entry.split(';')[0]).join('; ')
  } catch {}
  return cookie
}

async function api(path, params = {}) {
  const url = new URL(path, 'https://api.bilibili.com')
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
  const response = await fetch(url, {
    headers: { 'user-agent': UA, referer: 'https://www.bilibili.com/', ...(cookie ? { cookie } : {}) },
  })
  const body = await response.json()
  if (body.code !== 0) throw new Error(`B 站接口返回 ${body.code}: ${body.message ?? ''}`)
  return body.data
}

const bvidOf = (text) => {
  const match = /BV[0-9A-Za-z]{10}/.exec(String(text ?? ''))
  return match ? match[0] : ''
}

function run(command, args, { timeoutMs = 600000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch {} ; reject(new Error('超时')) }, timeoutMs)
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-1500) })
    child.once('error', reject)
    child.once('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(stderr.split('\n').slice(-2).join(' ') || `退出码 ${code}`))
      else resolve({ stdout, stderr })
    })
  })
}

const text = (value) => [{ type: 'text', text: value }]

export function registerBilibiliTool(ctx, { logger = console, downloadDir = DEFAULT_DIR } = {}) {
  const tool = {
    name: 'bilibili',
    description: [
      '哔哩哔哩（B 站）：action=info 查视频信息；action=hot 看热门排行；',
      'action=download 下载一条视频（需要链接或 BV 号，只用于你有权保存的内容）。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['info', 'hot', 'download'] },
        url: { type: 'string', description: '视频链接或 BV 号（info / download 用）' },
        keyword: { type: 'string', description: 'hot 时可以给分区关键词，如 音乐 / 科技（可省略）' },
        quality: { type: 'integer', description: '下载最高分辨率，默认 1080' },
        audioOnly: { type: 'boolean', description: '只下载音频' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: { ok: { type: 'boolean' }, summary: { type: 'string' } },
        additionalProperties: true,
      },
      render: (_args, value) => text(value.summary ?? ''),
    },
    async execute(args) {
      if (args.action === 'info') {
        await bootstrap()
        const bvid = bvidOf(args.url)
        if (!bvid) throw new Error('没识别出 BV 号')
        const data = await api('/x/web-interface/view', { bvid })
        const minutes = Math.floor((data.duration ?? 0) / 60)
        const seconds = (data.duration ?? 0) % 60
        return {
          ok: true,
          bvid,
          title: data.title,
          owner: data.owner?.name,
          duration: `${minutes}:${String(seconds).padStart(2, '0')}`,
          views: data.stat?.view,
          likes: data.stat?.like,
          summary: `《${data.title}》\nUP：${data.owner?.name} · 时长 ${minutes}:${String(seconds).padStart(2, '0')} · 播放 ${data.stat?.view} · 点赞 ${data.stat?.like}`,
        }
      }
      if (args.action === 'hot') {
        await bootstrap()
        const data = await api('/x/web-interface/ranking/v2', { rid: 3, type: 'all' })
        const list = (data.list ?? []).slice(0, 10)
        return {
          ok: true,
          items: list.map((item) => ({ bvid: item.bvid, title: item.title, owner: item.owner?.name, views: item.stat?.view })),
          summary: `B 站音乐区热门 TOP10：\n` + list.map((item, index) => `${index + 1}. ${item.title}（${item.owner?.name}，播放 ${item.stat?.view}）`).join('\n'),
        }
      }
      if (args.action === 'download') {
        const url = String(args.url ?? '').trim()
        if (!url) throw new Error('download 需要 url')
        if (!existsSync(DL_SCRIPT)) throw new Error(`找不到下载脚本：${DL_SCRIPT}`)
        if (!existsSync(YTDLP)) throw new Error(`找不到 yt-dlp：${YTDLP}`)
        const dir = downloadDir
        const quality = String(args.quality ?? 1080)
        const extra = args.audioOnly ? ['--audio-only'] : ['--quality', quality]
        const { stdout } = await run(process.execPath, [DL_SCRIPT, url, '--out', dir, ...extra])
        const tail = stdout.trim().split('\n').slice(-3).join('\n')
        let saved = ''
        try {
          const files = readdirSync(dir).map((name) => join(dir, name)).filter((path) => statSync(path).isFile())
          files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
          saved = files[0] ?? ''
        } catch {}
        return { ok: true, dir, saved, summary: `下载完成${saved ? `：${saved}` : ''}\n${tail}` }
      }
      throw new Error(`未知 action：${args.action}`)
    },
  }

  const register = (target) => {
    try {
      if (!target.tools?.register) return
      target.tools.register(tool)
      logger.info?.('dsh-dafeiyu: bilibili 工具已注册')
    } catch (error) {
      logger.error?.(`dsh-dafeiyu 注册 bilibili 工具失败: ${error?.message ?? error}`)
    }
  }
  if (typeof ctx.inject === 'function') ctx.inject(['tools'], register)
  else register(ctx)
}
