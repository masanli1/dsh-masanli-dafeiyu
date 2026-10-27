import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { checkArguments, createDenoiseTool } from '../src/denoise.js'

const silent = { info() {}, warn() {}, error() {} }
const tool = createDenoiseTool({ logger: silent })

assert.equal(tool.name, 'denoise_audio')
assert.equal(tool.parameters.required[0], 'input')
assert.equal(typeof tool.execute, 'function')
assert.throws(() => checkArguments({}), /input/)
assert.throws(() => checkArguments({ input: 'a.wav', mode: 'video' }), /mode/)
checkArguments({ input: 'a.wav', targetDb: 15, fast: true })

// 3 秒正弦波：验证 python 核心能跑通并写出结果
const dir = mkdtempSync(join(tmpdir(), 'dfy-denoise-test-'))
const wav = join(dir, 'tone.wav')
const py = process.env.DF_FACTORY_PYTHON
  ?? '/Users/ma/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3'
const gen = spawnSync(py, ['-c', `
import wave, math, struct
sr=16000; n=sr*3
with wave.open(${JSON.stringify(wav)}, 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
    frames=b''.join(struct.pack('<h', int(12000*math.sin(2*math.pi*440*i/sr)+3000*math.sin(2*math.pi*7000*i/sr))) for i in range(n))
    w.writeframes(frames)
`], { encoding: 'utf8' })
assert.equal(gen.status, 0, gen.stderr)

const result = await tool.execute({ input: wav, fast: true, mode: 'music' }, { signal: new AbortController().signal })
assert.equal(result.sampleRate, 16000)
assert.ok(existsSync(result.output))
assert.ok(statSync(result.output).size > 1000)
console.log('ok   denoise_audio：参数校验 + 真实 3 秒降噪', JSON.stringify({ seconds: result.processSeconds, rtf: result.rtf }))
