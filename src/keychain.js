// 密钥管理：优先用 macOS 钥匙串保存 AES-256 密钥，取不到就生成并写入。
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const SERVICE = 'dsh-dafeiyu-dist'

const read = (kind, service, account) => {
  try {
    const args = kind === 'internet'
      ? ['find-internet-password', '-s', service, '-a', account, '-w']
      : ['find-generic-password', '-s', service, '-a', account, '-w']
    const value = execFileSync('/usr/bin/security', args, { encoding: 'utf8' }).trim()
    return value || ''
  } catch { return '' }
}

export function getOrCreateKey({ service = SERVICE, account = process.env.USER ?? 'ma', logger = console } = {}) {
  // 依次找：通用密码 → 互联网密码（"密码"App 里可见的那条）
  for (const kind of ['generic', 'internet']) {
    const found = read(kind, service, account)
    if (found) return Buffer.from(found, 'hex')
  }
  const key = randomBytes(32)
  const hex = key.toString('hex')
  try {
    // 存成"互联网密码"，这样会出现在「密码」App 里并能随 iCloud 钥匙串同步
    execFileSync('/usr/bin/security', ['add-internet-password', '-s', service, '-a', account, '-l', '大肥鱼-分片密钥', '-r', 'http', '-w', hex, '-U'], { stdio: 'ignore' })
    execFileSync('/usr/bin/security', ['add-generic-password', '-s', service, '-a', account, '-w', hex, '-U'], { stdio: 'ignore' })
    logger.info?.('dsh-dafeiyu: 已生成并保存新的分片加密密钥（密码 App + 钥匙串）')
  } catch (error) {
    logger.warn?.(`dsh-dafeiyu: 写钥匙串失败（将使用临时密钥）: ${error?.message ?? error}`)
  }
  return key
}
