// 保留策略：最近 N 份原样保留；更早的按"月"归档，每月只留最新一份。
export function prune(dist, { keep = 30, monthly = 1, name = 'memory', dryRun = false, logger = console } = {}) {
  const all = dist.list(name)
  if (all.length <= keep) return { removed: [], kept: all.length, reason: '数量未超上限' }
  const recent = all.slice(-keep)
  const older = all.slice(0, all.length - keep)
  // 更早的按月份分组
  const byMonth = new Map()
  for (const manifest of older) {
    const month = new Date(manifest.at).toISOString().slice(0, 7)
    const list = byMonth.get(month) ?? []
    list.push(manifest)
    byMonth.set(month, list)
  }
  const keepSet = new Set(recent.map((manifest) => manifest.id))
  for (const [, manifests] of byMonth) {
    manifests.sort((a, b) => b.at - a.at)
    manifests.slice(0, monthly).forEach((manifest) => keepSet.add(manifest.id))
  }
  const removed = []
  for (const manifest of all) {
    if (keepSet.has(manifest.id)) continue
    if (!dryRun) dist.remove(manifest.id)
    removed.push(manifest.id)
  }
  logger.info?.(`dsh-dafeiyu retention: 保留 ${keepSet.size} 份，清理 ${removed.length} 份`)
  return { removed, kept: keepSet.size, months: byMonth.size, dryRun }
}
