import { spawn } from 'node:child_process'

const MAX_BUFFER = 64 * 1024

function append(buffer, chunk) {
  const text = buffer + String(chunk)
  return text.length > MAX_BUFFER ? text.slice(-MAX_BUFFER) : text
}

// Small promise wrapper over child_process.spawn: no shell, cooperatively
// cancellable, and it never throws on a non-zero exit (callers decide).
export function run(command, args, { signal, timeoutMs = 0, cwd } = {}) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      reject(error)
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    let timer

    const finish = (result) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
      resolve(result)
    }
    const fail = (error) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
      reject(error)
    }
    const onAbort = () => {
      try {
        child.kill('SIGKILL')
      } catch {
        // already gone
      }
      fail(Object.assign(new Error(`${command} aborted`), { code: 'ABORTED' }))
    }

    child.stdout?.on('data', (chunk) => {
      stdout = append(stdout, chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr = append(stderr, chunk)
    })
    child.once('error', (error) => {
      fail(Object.assign(error, { stderr }))
    })
    child.once('close', (code, signalName) => {
      finish({ code, signal: signalName, stdout, stderr })
    })

    if (signal) {
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // already gone
        }
        fail(Object.assign(new Error(`${command} timed out after ${timeoutMs} ms`), { code: 'TIMEOUT', stderr }))
      }, timeoutMs)
      timer.unref?.()
    }
  })
}
