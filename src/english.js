// 英语学习：每天一个单词 + 小测，进度本地保存。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { writeJsonAtomic } from './atomic.js'

export const ENGLISH_PATH = join(homedir(), '.dsh', 'dsh-dafeiyu-english.json')

export const WORDS = [
  { en: 'serendipity', zh: '意外发现美好事物的运气', ex: 'Meeting her was pure serendipity.' },
  { en: 'resilient', zh: '有韧性的、能屈能伸的', ex: 'She is resilient after every setback.' },
  { en: 'meticulous', zh: '一丝不苟的', ex: 'He keeps meticulous notes.' },
  { en: 'ambiguous', zh: '模棱两可的', ex: 'The answer was deliberately ambiguous.' },
  { en: 'inevitable', zh: '不可避免的', ex: 'Change is inevitable.' },
  { en: 'pragmatic', zh: '务实的', ex: 'Take a pragmatic approach.' },
  { en: 'vulnerable', zh: '脆弱的、易受伤的', ex: 'It is okay to feel vulnerable.' },
  { en: 'curious', zh: '好奇的', ex: 'Stay curious about the world.' },
  { en: 'deliberate', zh: '深思熟虑的；故意的', ex: 'It was a deliberate choice.' },
  { en: 'gratitude', zh: '感激', ex: 'Practice gratitude daily.' },
  { en: 'consistent', zh: '一致的、稳定的', ex: 'Consistency beats intensity.' },
  { en: 'subtle', zh: '细微的、不易察觉的', ex: 'There is a subtle difference.' },
  { en: 'thorough', zh: '彻底的、周密的', ex: 'A thorough check found the bug.' },
  { en: 'reluctant', zh: '不情愿的', ex: 'She was reluctant to leave.' },
  { en: 'coherent', zh: '连贯的、条理清楚的', ex: 'Give a coherent explanation.' },
  { en: 'robust', zh: '健壮的、可靠的', ex: 'The design is robust.' },
  { en: 'feasible', zh: '可行的', ex: 'Is the plan feasible?' },
  { en: 'concise', zh: '简洁的', ex: 'Keep the report concise.' },
  { en: 'empathy', zh: '共情、同理心', ex: 'Show some empathy.' },
  { en: 'diligent', zh: '勤勉的', ex: 'A diligent student.' },
]

const dayKey = (date = new Date()) => date.toISOString().slice(0, 10)
const pick = (index) => WORDS[Math.abs(index) % WORDS.length]

export function createEnglishStore({ path = ENGLISH_PATH, now = () => new Date(), logger = console } = {}) {
  let data = { learned: [], streak: 0, lastDay: '', quizzes: 0, correct: 0 }
  try { data = { ...data, ...JSON.parse(readFileSync(path, 'utf8')) } } catch {}

  const save = () => {
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeJsonAtomic(path, data)
    } catch (error) { logger.warn?.(`dsh-dafeiyu english: 写入失败: ${error?.message ?? error}`) }
  }

  const today = () => {
    const day = dayKey(now())
    const index = Math.floor(new Date(day).getTime() / 86400000)
    const word = pick(index)
    return { day, word, learned: data.learned.includes(word.en) }
  }

  const learn = () => {
    const { day, word } = today()
    if (data.lastDay !== day) {
      data.lastDay = day
      data.streak += 1
    }
    if (!data.learned.includes(word.en)) data.learned.push(word.en)
    save()
    return word
  }

  const quiz = () => {
    const { word } = today()
    const options = [word, pick(Date.now() + 3), pick(Date.now() + 7), pick(Date.now() + 11)]
      .map((item) => item.zh)
      .filter((zh, index, list) => list.indexOf(zh) === index)
    while (options.length < 4) options.push(pick(Date.now() + options.length * 5 + 2).zh)
    options.sort(() => Math.random() - 0.5)
    data.quizzes += 1
    save()
    return { question: `"${word.en}" 是什么意思？`, options, answer: word.zh }
  }

  const check = (answer) => {
    const { word } = today()
    const ok = String(answer ?? '').trim() === word.zh
    if (ok) data.correct += 1
    save()
    return { ok, answer: word.zh, word }
  }

  const progress = () => ({
    learned: data.learned.length,
    streak: data.streak,
    quizzes: data.quizzes,
    accuracy: data.quizzes ? Math.round((data.correct / data.quizzes) * 100) : 0,
  })

  return { today, learn, quiz, check, progress, path, data }
}

const text = (value) => [{ type: 'text', text: value }]

export function registerEnglishTool(ctx, { english, logger = console } = {}) {
  const tool = {
    name: 'english',
    description: '英语学习：action=word 今日单词，action=learn 打卡，action=quiz 出题，action=answer 判分，action=progress 看进度。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['word', 'learn', 'quiz', 'answer', 'progress'] },
        answer: { type: 'string', description: 'answer 时的中文答案' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' } }, additionalProperties: true }, render: (_a, v) => text(v.summary ?? '') },
    async execute(args) {
      if (args.action === 'word') {
        const { word, learned } = english.today()
        return { ok: true, word, summary: `今日单词：**${word.en}** — ${word.zh}\n例句：${word.ex}${learned ? '\n（已经学过）' : ''}` }
      }
      if (args.action === 'learn') {
        const word = english.learn()
        return { ok: true, word, summary: `已打卡：${word.en}（${word.zh}）` }
      }
      if (args.action === 'quiz') {
        const quiz = english.quiz()
        return { ok: true, ...quiz, summary: `${quiz.question}\n${quiz.options.map((option, index) => `${index + 1}. ${option}`).join('\n')}` }
      }
      if (args.action === 'answer') {
        const result = english.check(args.answer)
        return { ok: true, ...result, summary: result.ok ? `答对了！${result.word.en} = ${result.answer}` : `不对，正确答案是：${result.answer}` }
      }
      const stats = english.progress()
      return { ok: true, ...stats, summary: `已学 ${stats.learned} 个 · 连续打卡 ${stats.streak} 天 · 小测 ${stats.quizzes} 次 · 正确率 ${stats.accuracy}%` }
    },
  }
  const register = (target) => {
    try { target.tools?.register(tool); logger.info?.('dsh-dafeiyu: english 工具已注册') } catch (error) { logger.error?.(`注册 english 失败: ${error?.message ?? error}`) }
  }
  if (typeof ctx.inject === 'function') ctx.inject(['tools'], register)
  else register(ctx)
}
