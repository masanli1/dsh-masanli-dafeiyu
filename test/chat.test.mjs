import assert from 'node:assert/strict'
import { createChatService, messagesFromEvents } from '../src/chat.js'

const silent = { info() {}, warn() {}, error() {} }

const userEvent = (text, kind = 'user') => ({ type: 'user/message', seq: 1, data: { source: { kind }, content: [{ type: 'text', text }] } })
const assistantEvent = (text) => ({ type: 'assistant/message', seq: 2, data: { message: { content: [{ type: 'text', text }] } } })

const events = [
  userEvent('第一句'),
  assistantEvent('收到'),
  userEvent('系统注入', 'system'),
  assistantEvent('多段'),
]
const parsed = messagesFromEvents(events)
assert.deepEqual(parsed.map((message) => message.role), ['user', 'assistant', 'assistant'])
assert.deepEqual(parsed.map((message) => message.text), ['第一句', '收到', '多段'])
console.log('ok   messagesFromEvents 过滤系统消息')

const observed = {
  header: { id: 's1', title: '测试会话', cwd: '/tmp/work', origin: 'user' },
  events,
  [Symbol.dispose]() { observed.disposed = true },
}
const prompts = []
const ctx = {
  get(service) {
    if (service === 'sessionQuery') {
      return {
        observeSession: async (id) => {
          if (id !== 's1') throw new Error('not found')
          return observed
        },
      }
    }
    if (service === 'sessionController') {
      return {
        prompt: async (request, signal) => {
          assert.ok(signal && typeof signal.throwIfAborted === 'function', 'prompt 必须收到 AbortSignal')
          prompts.push(request)
          return { accepted: true }
        },
      }
    }
    return undefined
  },
}

const chat = createChatService({ ctx, logger: silent })
assert.equal((await chat.state()).sessionId, null)

chat.note({ header: { id: 's1', title: '测试会话', cwd: '/tmp/work' } }, { type: 'turn/start' })
chat.note({ header: { id: 's1', title: '测试会话', cwd: '/tmp/work' } }, { type: 'turn/end' })

const snapshot = await chat.state()
assert.equal(snapshot.sessionId, 's1')
assert.equal(snapshot.title, '测试会话')
assert.equal(snapshot.busy, false)
assert.equal(snapshot.messages.length, 3)
assert.equal(snapshot.sessions.length, 1)
assert.equal(observed.disposed, true, 'observation lease disposed')

const receipt = await chat.send('  你好呀  ')
assert.equal(receipt.accepted, true)
assert.equal(prompts.length, 1)
assert.equal(prompts[0].sessionId, 's1')
assert.equal(prompts[0].mode, 'queue')
// send() 可能把 <dfy-context> 工作摘要/长期记忆前缀拼在正文前面
assert.equal(prompts[0].content[0].type, 'text')
assert.ok(prompts[0].content[0].text.includes('你好呀'))
assert.match(prompts[0].requestId, /^[0-9a-f-]{36}$/)
console.log('ok   state / send 走 sessionQuery + sessionController')

await assert.rejects(() => chat.send('   '), /不能为空/)
await chat.select('s1')
await assert.rejects(() => chat.select('missing'), /not found/)
console.log('ok   target 选择校验')

// ---------------------------------------------------------------- HTTP layer
import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChatHandlers } from '../src/chat.js'

const handlers = createChatHandlers(chat, silent)
const server = createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
  if (path === '/chat/state') return handlers.state(req, res)
  if (path === '/chat/send') return handlers.send(req, res)
  if (path === '/chat/target') return handlers.target(req, res)
  res.writeHead(404).end()
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

const stateResponse = await fetch(`${base}/chat/state`)
assert.equal(stateResponse.status, 200)
const stateBody = await stateResponse.json()
assert.equal(stateBody.sessionId, 's1')

const sendResponse = await fetch(`${base}/chat/send`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ text: '再聊一句' }),
})
assert.equal(sendResponse.status, 200)
assert.equal((await sendResponse.json()).accepted, true)
assert.equal(prompts.at(-1).content[0].text, '再聊一句')

const getEmpty = await fetch(`${base}/chat/send`)
assert.equal(getEmpty.status, 400, 'GET without text is rejected')

const getSend = await fetch(`${base}/chat/send?text=${encodeURIComponent('走 GET 通道')}`)
assert.equal(getSend.status, 200)
assert.equal((await getSend.json()).accepted, true)
assert.equal(prompts.at(-1).content[0].text, '走 GET 通道')

const badMethod = await fetch(`${base}/chat/send`, { method: 'PUT' })
assert.equal(badMethod.status, 405)
const emptyBody = await fetch(`${base}/chat/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
assert.equal(emptyBody.status, 400)

server.close()
console.log('ok   HTTP 端点：状态 / 发送 / 方法校验')

// ---------------------------------------------------------------- 宠物专属会话
{
  let created = 0
  const sentTo = []
  const fakeStorePath = join(mkdtempSync(join(tmpdir(), 'dfy-chat-store-')), 'chat.json')
  const chatCtx = {
    get(service) {
      if (service === 'sessionQuery') {
        return {
          observeSession: async (id) => ({ header: { id, title: '宠物会话', origin: 'user' }, events: [], [Symbol.dispose]() {} }),
        }
      }
      if (service === 'sessionController') {
        return {
          create: async () => { created += 1; return { sessionId: 'session-pet' } },
          prompt: async (request) => { sentTo.push(request.sessionId); return { accepted: true } },
        }
      }
      return undefined
    },
  }
  const { createChatService: make } = await import('../src/chat.js')
  const petChat = make({ ctx: chatCtx, logger: silent, config: () => ({ chatMode: 'dedicated' }), storePath: fakeStorePath })

  const first = await petChat.state()
  assert.equal(first.sessionId, 'session-pet')
  assert.equal(created, 1, '第一次自动建会话')

  const again = await petChat.state()
  assert.equal(again.sessionId, 'session-pet')
  assert.equal(created, 1, '之后复用同一个会话')

  await petChat.send('还记得刚才说了什么吗')
  assert.equal(sentTo.at(-1), 'session-pet', '消息发到专属会话，上下文连续')

  // 手动切到别的会话后优先用手动选择
  await petChat.select('session-other')
  await petChat.send('换个会话')
  assert.equal(sentTo.at(-1), 'session-other')
  console.log('ok   宠物专属会话：自动创建 / 复用 / 连续上下文 / 手动切换')
}
