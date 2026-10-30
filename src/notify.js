// 消息推送：通过 webhook 把消息发到企业微信/飞书/钉钉/Slack。
// 微信个人号和 QQ 都没有可用的官方接口，这里走的是"群机器人 webhook"这条合规路径。
const text = (value) => [{ type: 'text', text: value }]

const KIND_LABEL = {
  wecom: '企业微信', feishu: '飞书', dingtalk: '钉钉', slack: 'Slack',
  serverchan: 'Server酱（微信）', pushplus: 'PushPlus（微信）', bark: 'Bark（iPhone）', custom: '自定义',
}

function payloadFor(kind, content) {
  if (kind === 'feishu') return { msg_type: 'text', content: { text: content } }
  if (kind === 'dingtalk') return { msgtype: 'text', text: { content } }
  if (kind === 'slack') return { text: content }
  if (kind === 'serverchan') return { title: '大肥鱼', desp: content }
  if (kind === 'pushplus') return { token: '', title: '大肥鱼', content, template: 'txt' }
  // 企业微信群机器人
  return { msgtype: 'text', text: { content } }
}

function requestFor(hook, content) {
  const kind = hook.kind ?? 'wecom'
  if (kind === 'bark') {
    // BARK: https://api.day.app/<key>/<标题>/<正文>
    const url = `${hook.url.replace(/\/$/, '')}/${encodeURIComponent('大肥鱼')}/${encodeURIComponent(content)}`
    return { url, init: { method: 'GET' } }
  }
  if (kind === 'pushplus') {
    const token = hook.token ?? ''
    return { url: hook.url || 'https://www.pushplus.plus/send', init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payloadFor(kind, content)) } }
  }
  return { url: hook.url, init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payloadFor(kind, content)) } }
}

export function createNotifier({ webhooks = [], logger = console } = {}) {
  const send = async (content, { name } = {}) => {
    const targets = webhooks.filter((hook) => hook && hook.url && (!name || hook.name === name))
    if (targets.length === 0) throw new Error('还没有配置 webhook')
    const results = []
    for (const hook of targets) {
      const kind = hook.kind ?? 'wecom'
      try {
        const { url, init } = requestFor(hook, content)
        const response = await fetch(url, init)
        results.push({ name: hook.name ?? kind, ok: response.ok, status: response.status })
      } catch (error) {
        results.push({ name: hook.name ?? kind, ok: false, error: String(error?.message ?? error) })
      }
    }
    return results
  }
  return { send, webhooks }
}

export function registerNotifyTool(ctx, { notifier, logger = console } = {}) {
  const tool = {
    name: 'notify',
    description: '把一条消息推送到已配置的群机器人（企业微信 / 飞书 / 钉钉 / Slack webhook）。',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要发送的内容' },
        name: { type: 'string', description: '只发给某个配置好的名字（可省略=全部）' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' } }, additionalProperties: true }, render: (_a, v) => text(v.summary ?? '') },
    async execute(args) {
      const content = String(args.text ?? '').trim()
      if (!content) throw new Error('text 不能为空')
      const results = await notifier.send(content, { name: args.name })
      const okCount = results.filter((item) => item.ok).length
      return {
        ok: okCount > 0,
        results,
        summary: `已推送到 ${okCount}/${results.length} 个渠道：` + results.map((item) => `${item.name}${item.ok ? '✓' : '✗'}`).join(' '),
      }
    },
  }
  const register = (target) => {
    try { target.tools?.register(tool); logger.info?.('dsh-dafeiyu: notify 工具已注册') } catch (error) { logger.error?.(`注册 notify 失败: ${error?.message ?? error}`) }
  }
  if (typeof ctx.inject === 'function') ctx.inject(['tools'], register)
  else register(ctx)
}
