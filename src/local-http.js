import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'

let lastRecordedHost = ''

// 浏览器每次访问插件接口，都把当前的 Host 记下来：
// GUI 端口每次启动都会变，原生助手靠这个文件拿到最新地址。
function rememberHost(host) {
  if (!host || host === lastRecordedHost) return
  lastRecordedHost = host
  try {
    writeFileSync(`${homedir()}/.dsh/dsh-dafeiyu-webui.txt`, `http://${host}/`)
  } catch {}
}

export function isLocalRequest(req) {
  if (req.headers?.host) rememberHost(req.headers.host)
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress)) return false
  if (req.headers?.host) {
    try {
      const host = new URL(`http://${req.headers.host}`)
      if (host.username || host.password || !['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname)) return false
    } catch { return false }
  }
  if (!req.headers?.origin) return true
  try {
    const origin = new URL(req.headers.origin)
    return ['http:', 'https:'].includes(origin.protocol) && origin.host === req.headers.host
  } catch { return false }
}

export function jsonResponse(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}
