// 自动记忆：从用户这句话里抽取"值得记住的"事实，不需要模型参与。
// 规则保守：只收明确的偏好/身份/居住/作息，宁可少记，不要乱记。

const CUT = '[^\\s，。,.!！?？；;：:、]{1,20}'

const RULES = [
  { key: () => '名字', re: new RegExp(`我(?:的名字)?叫\\s*(${CUT})`) },
  { key: () => '昵称', re: new RegExp(`(?:叫我|可以叫我)\\s*(${CUT})`) },
  { key: () => '住在', re: new RegExp(`我(?:住在|住在|家住在|家在)\\s*(${CUT})`) },
  { key: (match) => match[1], global: true, re: new RegExp(`(?:我)?(?:很|最|特别|超级|超|有点)?(喜欢|讨厌|害怕|怕|不爱|爱吃|爱喝|爱听)\\s*(${CUT})`, 'g') },
  { key: () => '生日', re: /生日(?:是|在)?\s*(\d{1,2}\s*月\s*\d{1,2}\s*[日号]?)/ },
  { key: () => '工作', re: new RegExp(`我(?:在|是做|从事)\\s*(${CUT}?)(?:工作|的|行业)`) },
  { key: () => '作息', re: /我(?:每天|一般|通常)\s*(\d{1,2}\s*点(?:左右)?(?:睡|起|下班|上班)[^，。,.!?]*)/ },
]

export function extractFacts(text) {
  const source = String(text ?? '')
  const facts = []
  for (const rule of RULES) {
    if (rule.global) {
      const re = new RegExp(rule.re.source, 'g')
      let match
      while ((match = re.exec(source)) !== null) {
        const key = rule.key(match)
        const value = (match[2] ?? match[1] ?? '').trim()
        if (key && value) facts.push({ key: String(key).slice(0, 20), value: String(value).slice(0, 40) })
      }
      continue
    }
    const match = rule.re.exec(source)
    if (!match) continue
    const key = typeof rule.key === 'function' ? rule.key(match) : rule.key
    const value = (match[2] ?? match[1] ?? '').trim()
    if (!key || !value) continue
    facts.push({ key: String(key).slice(0, 20), value: String(value).slice(0, 40) })
  }
  // 去重（同一句话里的重复捕获）
  const seen = new Set()
  return facts.filter((fact) => {
    const id = `${fact.key}:${fact.value}`
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

export function rememberFacts(memory, text, { source = 'auto' } = {}) {
  const facts = extractFacts(text)
  const added = []
  for (const fact of facts) {
    const exists = memory.list().some((item) => item.key === fact.key && item.value === fact.value)
    if (exists) continue
    try {
      memory.add(fact.key, fact.value)
      added.push(fact)
    } catch {
      // 忽略单条失败
    }
  }
  return { added, source }
}
