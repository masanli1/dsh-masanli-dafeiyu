// 密钥管理：优先用 macOS 钥匙串保存 AES-256 密钥，取不到就生成并写入。
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const SERVICE = 'dsh-dafeiyu-dist'

export function getOrCreateKey({ service = SERVICE, account = process.env.USER ?? 'ma', logger = console } = {}) {
  try {
    const existing = execFileSync('/usr/bin/security', ['find-generic-password', '-s', service, '-a', account, '-w'], { encoding: 'utf8' }).trim()
    if (existing) return Buffer.from(existing, 'hex')
  } catch {}
  const key = randomBytes(32)
  try {
    execFileSync('/usr/bin/security', ['add-generic-password', '-s', service, '-a', account, '-w', key.toString('hex'), '-U'], { stdio: 'ignore' })
    logger.info?.('dsh-dafeiyu: 已生成并保存新的分片加密密钥')
  } catch (error) {
    logger.warn?.(`dsh-dafeiyu: 写钥匙串失败（将使用临时密钥）: ${error?.message ?? error}`)
  }
  return key
}
