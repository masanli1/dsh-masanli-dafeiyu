window.__ModuleLoader__.load({ id: 'dsh-dafeiyu', factory: (require) => {
  const module = { exports: {} }
  const exports = module.exports
  const React = require('react')
  const { useEffect, useRef, useState } = React
  const CONFIG_ENDPOINT = '/plugins/dsh-dafeiyu/config'
  const EVENTS_ENDPOINT = '/plugins/dsh-dafeiyu/events'
  const MANIFEST_ENDPOINT = '/plugins/dsh-dafeiyu/manifest'
  const FRAME_ENDPOINT = '/plugins/dsh-dafeiyu/frame'
  const BALANCE_ENDPOINT = '/plugins/dsh-dafeiyu/balance'

  const cardStyle = {
    listStyle: 'none', border: '1px solid var(--border-color, #d8d8d8)', borderRadius: 12,
    padding: 16, background: 'var(--surface-color, transparent)', display: 'grid', gap: 14,
  }
  const rowStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20 }
  const selectStyle = { minWidth: 120, padding: '6px 10px', borderRadius: 8 }
  const inputStyle = { ...selectStyle, minWidth: 160 }
  const BUBBLE_STATE_OPTIONS = [
    ['IDLE', '空闲'],
    ['THINKING', '思考中'],
    ['WORKING', '工作中'],
    ['WAITING', '等待确认'],
    ['SUCCESS', '完成'],
    ['ERROR', '错误'],
  ]
  const bubbleGridStyle = {
    display: 'grid', gridTemplateColumns: 'repeat(3, auto)', gap: '6px 14px',
    padding: '10px 12px', border: '1px solid var(--border-color, #d8d8d8)', borderRadius: 8,
  }

  function Field({ label, hint, children }) {
    return React.createElement('label', { style: rowStyle },
      React.createElement('span', null,
        React.createElement('span', { style: { display: 'block', fontWeight: 600 } }, label),
        React.createElement('small', { style: { display: 'block', opacity: 0.65, marginTop: 3 } }, hint),
      ),
      children,
    )
  }

  function BubbleStatePicker({ value, disabled, onChange }) {
    const selected = Array.isArray(value) ? value : []
    const toggle = (state, checked) => {
      const next = new Set(selected)
      if (checked) next.add(state)
      else next.delete(state)
      onChange([...next])
    }
    return React.createElement('div', { style: bubbleGridStyle },
      ...BUBBLE_STATE_OPTIONS.map(([state, label]) =>
        React.createElement('label', { key: state, style: { display: 'flex', alignItems: 'center', gap: 4 } },
          React.createElement('input', {
            type: 'checkbox', checked: selected.includes(state), disabled,
            onChange: (event) => toggle(state, event.target.checked),
          }),
          label,
        ),
      ),
    )
  }

  function BalancePanel({ enabled, source }) {
    const [snapshot, setSnapshot] = useState(null)
    const [busy, setBusy] = useState(false)
    const sequence = useRef(0)
    const request = async (force = false) => {
      const current = ++sequence.current
      setBusy(true)
      try {
        const response = await fetch(BALANCE_ENDPOINT, { method: force ? 'POST' : 'GET', cache: 'no-store' })
        if (!response.ok) throw new Error('balance request failed')
        const next = await response.json()
        if (current === sequence.current) setSnapshot(next)
      } catch {
        if (current === sequence.current) setSnapshot((previous) => ({ ...previous, status: 'error', error: '余额查询暂时不可用，请稍后刷新。' }))
      } finally {
        if (current === sequence.current) setBusy(false)
      }
    }
    useEffect(() => {
      setSnapshot(null)
      if (!enabled) return
      void request()
      const timer = setInterval(() => void request(), 60000)
      let stream
      try {
        stream = new EventSource(EVENTS_ENDPOINT)
        stream.onmessage = (event) => {
          try {
            const next = JSON.parse(event.data)
            if (next.kind !== 'balance') return
            sequence.current += 1
            setSnapshot(next)
            setBusy(false)
          } catch {}
        }
      } catch {}
      return () => { clearInterval(timer); stream?.close(); sequence.current += 1 }
    }, [enabled, source])
    if (!enabled) return null
    const money = (row, field) => new Intl.NumberFormat('zh-CN', {
      style: 'currency', currency: row.currency, minimumFractionDigits: 2, maximumFractionDigits: 4,
    }).format(row[field])
    return React.createElement('section', { 'aria-label': 'DeepSeek 余额', 'data-testid': 'dsh-dafeiyu-balance', style: { borderTop: '1px solid var(--border-color, #d8d8d8)', paddingTop: 14 } },
      React.createElement('div', { style: rowStyle },
        React.createElement('strong', null, 'DeepSeek 余额'),
        React.createElement('button', { type: 'button', disabled: busy, onClick: () => void request(true) }, busy ? '查询中…' : '刷新余额'),
      ),
      snapshot?.source ? React.createElement('small', null, snapshot.source === 'account' ? '已登录的 DeepSeek 账户' : 'DSH 模型设置中的 API Key') : null,
      snapshot?.balances?.length ? React.createElement('table', { style: { width: '100%', textAlign: 'left', marginTop: 10 } },
        React.createElement('thead', null, React.createElement('tr', null,
          ...['币种', '总余额', '赠送', '充值'].map((label) => React.createElement('th', { key: label, scope: 'col' }, label)),
        )),
        React.createElement('tbody', null, ...snapshot.balances.map((row) => React.createElement('tr', { key: row.currency },
          React.createElement('th', { scope: 'row' }, row.currency),
          ...['total', 'granted', 'toppedUp'].map((field) => React.createElement('td', { key: field }, money(row, field))),
        ))),
      ) : null,
      snapshot?.error ? React.createElement('p', { role: 'status' }, snapshot.error) : null,
      snapshot?.available === false ? React.createElement('p', { role: 'status' }, '账户当前没有可用余额。') : null,
      snapshot?.checkedAt ? React.createElement('small', null,
        `${snapshot.status === 'error' ? '上次成功查询' : '更新时间'}：${new Date(snapshot.checkedAt).toLocaleTimeString()} · 每分钟自动刷新`,
      ) : !snapshot?.error ? React.createElement('p', { role: 'status' }, '正在查询余额…') : null,
    )
  }


  // ---------------------------------------------------------------- denoise
  // 设置页里的降噪入口：选文件（主机目录浏览）→ 选模式 → 跑 → 看最近结果。
  function DenoisePanel() {
    const [job, setJob] = useState(null)
    const [input, setInput] = useState('')
    const [mode, setMode] = useState('music')
    const [targetDb, setTargetDb] = useState('')
    const [fast, setFast] = useState(true)
    const [browser, setBrowser] = useState(null)
    const [error, setError] = useState('')
    const [starting, setStarting] = useState(false)

    const json = (url, init) => fetch(url, init).then(async (response) => {
      const value = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(value.error || ('请求失败 ' + response.status))
      return value
    })

    const refresh = React.useCallback(() => {
      json('/plugins/dsh-dafeiyu/denoise/state')
        .then((value) => { setJob(value); setError('') })
        .catch((failure) => setError(failure.message))
    }, [])

    React.useEffect(() => {
      refresh()
      const timer = setInterval(refresh, 2500)
      return () => clearInterval(timer)
    }, [refresh])

    const openBrowser = (dir) => {
      json('/plugins/dsh-dafeiyu/denoise/browse' + (dir ? '?dir=' + encodeURIComponent(dir) : ''))
        .then((value) => { setBrowser(value); setError('') })
        .catch((failure) => setError(failure.message))
    }

    const run = () => {
      if (!input || starting) return
      setStarting(true)
      setError('')
      json('/plugins/dsh-dafeiyu/denoise/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          input,
          mode,
          ...(Number(targetDb) > 0 ? { targetDb: Number(targetDb) } : {}),
          fast,
        }),
      })
        .then(() => refresh())
        .catch((failure) => setError(failure.message))
        .finally(() => setStarting(false))
    }

    const running = job && job.running
    const history = (job && job.history) || []
    const last = history[0]
    const sizeText = (bytes) => (bytes ? (bytes / 1048576).toFixed(1) + ' MB' : '')
    const mmss = (seconds) => {
      if (!Number.isFinite(seconds)) return ''
      const s = Math.round(seconds)
      return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
    }

    return React.createElement('div', {
      style: { border: '1px solid var(--border-color, #d8d8d8)', borderRadius: 12, padding: 14, display: 'grid', gap: 10 },
      'data-testid': 'dsh-dafeiyu-denoise',
    },
      React.createElement('div', null,
        React.createElement('strong', { style: { fontSize: 15 } }, '降噪（NPSS）'),
        React.createElement('p', { style: { margin: '4px 0 0', opacity: 0.65, fontSize: 12 } },
          '本地 CPU 处理，不上传；视频只换音轨、画面不重编码。'),
      ),
      React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
        React.createElement('input', {
          readOnly: true, value: input, placeholder: '还没有选择文件',
          style: { flex: 1, padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border-color, #d8d8d8)', background: 'transparent', color: 'inherit', fontSize: 12 },
        }),
        React.createElement('button', {
          type: 'button', onClick: () => openBrowser(input ? input.replace(/\/[^/]*$/, '') : ''),
          style: { padding: '7px 12px', borderRadius: 8, cursor: 'pointer' },
        }, '选择文件'),
      ),
      browser ? React.createElement('div', {
        style: { border: '1px solid var(--border-color, #d8d8d8)', borderRadius: 10, padding: 8, maxHeight: 220, overflowY: 'auto', fontSize: 12 },
      },
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 } },
          React.createElement('code', { style: { fontSize: 11, opacity: 0.7, wordBreak: 'break-all' } }, browser.dir),
          React.createElement('button', { type: 'button', onClick: () => setBrowser(null), style: { border: 'none', background: 'transparent', cursor: 'pointer' } }, '关闭'),
        ),
        browser.parent ? React.createElement('div', {
          role: 'button', onClick: () => openBrowser(browser.parent), style: { cursor: 'pointer', padding: '4px 6px', opacity: 0.8 },
        }, '⬆︎ 上一级') : null,
        ...browser.entries.map((entry) => React.createElement('div', {
          key: entry.path,
          role: 'button',
          onClick: () => {
            if (entry.type === 'dir') openBrowser(entry.path)
            else { setInput(entry.path); setBrowser(null) }
          },
          style: { cursor: 'pointer', padding: '5px 6px', borderRadius: 6, display: 'flex', justifyContent: 'space-between', gap: 10 },
          onMouseEnter: (event) => { event.currentTarget.style.background = 'rgba(127,127,127,0.12)' },
          onMouseLeave: (event) => { event.currentTarget.style.background = 'transparent' },
        },
          React.createElement('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            (entry.type === 'dir' ? '📁 ' : '🎬 ') + entry.name),
          entry.type === 'file' ? React.createElement('span', { style: { opacity: 0.55, flexShrink: 0 } }, sizeText(entry.size)) : null,
        )),
      ) : null,
      React.createElement('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' } },
        React.createElement('label', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
          '模式',
          React.createElement('select', { value: mode, onChange: (event) => setMode(event.target.value), style: selectStyle },
            React.createElement('option', { value: 'music' }, '音乐（全频带）'),
            React.createElement('option', { value: 'voice' }, '人声（16k 带限）')),
        ),
        React.createElement('label', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
          '目标 dB',
          React.createElement('input', {
            type: 'number', min: 1, max: 40, value: targetDb, placeholder: '关闭',
            onChange: (event) => setTargetDb(event.target.value),
            style: { width: 76, padding: '5px 8px', borderRadius: 8 },
          }),
        ),
        React.createElement('label', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
          React.createElement('input', { type: 'checkbox', checked: fast, onChange: (event) => setFast(event.target.checked) }),
          '快速模式'),
        React.createElement('button', {
          type: 'button', onClick: run, disabled: !input || starting || !!running,
          style: {
            marginLeft: 'auto', padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: 'var(--accent-color, #4d6bfe)', color: '#fff',
            opacity: !input || starting || running ? 0.5 : 1,
          },
        }, running ? '处理中…' : starting ? '提交…' : '开始降噪'),
      ),
      running
        ? React.createElement('div', { style: { fontSize: 12, opacity: 0.75 } },
            '正在处理：' + running.input.split('/').pop() + '（' + running.mode + (running.fast ? ' · 快速' : '') + '）')
        : null,
      error ? React.createElement('div', { style: { fontSize: 12, color: '#d33' } }, error) : null,
      last
        ? React.createElement('div', { style: { fontSize: 12, borderTop: '1px solid var(--border-color, #d8d8d8)', paddingTop: 8 } },
            React.createElement('div', { style: { fontWeight: 600, marginBottom: 4 } },
              last.ok ? '上次处理完成' : '上次处理失败',
              ' · ', new Date(last.finishedAt || last.startedAt).toLocaleString()),
            last.ok
              ? React.createElement('div', { style: { opacity: 0.8, wordBreak: 'break-all' } },
                  last.output,
                  React.createElement('div', { style: { marginTop: 3, opacity: 0.75 } },
                    (last.mode === 'voice' ? '人声' : '音乐') + ' · ' + mmss(last.durationSeconds) + ' 音频 · 用时 ' + last.processSeconds + 's · RTF ' + last.rtf
                    + (last.targetDb ? ' · 目标 ' + last.targetDb + ' dB → 实测 ' + last.achievedDb + ' dB' : '')))
              : React.createElement('div', { style: { color: '#d33' } }, last.error),
          )
        : null,
      history.length > 1
        ? React.createElement('details', { style: { fontSize: 12 } },
            React.createElement('summary', { style: { cursor: 'pointer', opacity: 0.75 } }, '最近 ' + history.length + ' 条记录'),
            ...history.slice(1).map((entry, index) => React.createElement('div', {
              key: String(index) + entry.startedAt, style: { padding: '4px 0', opacity: 0.75, wordBreak: 'break-all' },
            }, (entry.ok ? '✅ ' : '❌ ') + (entry.output || entry.input).split('/').pop() + ' · ' + new Date(entry.finishedAt || entry.startedAt).toLocaleString())),
          )
        : null,
    )
  }


  // ---------------------------------------------------------------- 小说工坊
  function NovelWorkshop() {
    const [data, setData] = useState(null)
    const [detail, setDetail] = useState(null)
    const [openBook, setOpenBook] = useState('')
    const [draft, setDraft] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')

    const load = React.useCallback(() => {
      fetch('/plugins/dsh-dafeiyu/novel/books', { cache: 'no-store' })
        .then(async (response) => {
          const value = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(value.error || '读取失败')
          setData(value)
          setError('')
        })
        .catch((failure) => setError(failure.message))
    }, [])

    React.useEffect(() => { load() }, [load])

    const showBook = (book) => {
      if (openBook === book) { setOpenBook(''); setDetail(null); return }
      setOpenBook(book)
      fetch('/plugins/dsh-dafeiyu/novel/book?book=' + encodeURIComponent(book))
        .then((response) => response.json())
        .then((value) => { if (value.error) throw new Error(value.error); setDetail(value) })
        .catch((failure) => setError(failure.message))
    }

    const post = (path, body) => fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async (response) => {
      const value = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(value.error || '请求失败')
      return value
    })

    const create = () => {
      const name = draft.trim()
      if (!name || busy) return
      setBusy(true)
      post('/plugins/dsh-dafeiyu/novel/create', { book: name })
        .then(() => { setDraft(''); load() })
        .catch((failure) => setError(failure.message))
        .finally(() => setBusy(false))
    }

    const openFolder = (book) => {
      post('/plugins/dsh-dafeiyu/novel/open', { book }).catch((failure) => setError(failure.message))
    }
    const exportBook = (book) => {
      post('/plugins/dsh-dafeiyu/novel/export', { book })
        .then((value) => setError('已导出：' + value.path))
        .catch((failure) => setError(failure.message))
    }

    const books = (data && data.books) || []
    const words = (count) => count >= 10000 ? (count / 10000).toFixed(1) + ' 万字' : (count || 0) + ' 字'

    return React.createElement('div', {
      style: { border: '1px solid var(--border-color, #d8d8d8)', borderRadius: 12, padding: 14, display: 'grid', gap: 10 },
      'data-testid': 'dsh-dafeiyu-novel',
    },
      React.createElement('div', null,
        React.createElement('strong', { style: { fontSize: 15 } }, '小说工坊'),
        React.createElement('p', { style: { margin: '4px 0 0', opacity: 0.65, fontSize: 12 } },
          data ? '项目目录：' + data.root + '　·　一章一个 Markdown 文件' : '正在读取…'),
      ),
      React.createElement('div', { style: { display: 'flex', gap: 8 } },
        React.createElement('input', {
          value: draft, placeholder: '新书名，例如：长夜灯火',
          onChange: (event) => setDraft(event.target.value),
          onKeyDown: (event) => { if (event.key === 'Enter') create() },
          style: { flex: 1, padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border-color, #d8d8d8)', background: 'transparent', color: 'inherit', fontSize: 12 },
        }),
        React.createElement('button', {
          type: 'button', onClick: create, disabled: busy || !draft.trim(),
          style: { padding: '7px 12px', borderRadius: 8, cursor: 'pointer', opacity: busy || !draft.trim() ? 0.5 : 1 },
        }, '新建'),
      ),
      error ? React.createElement('div', { style: { fontSize: 12, color: error.startsWith('已导出') ? 'inherit' : '#d33', opacity: 0.8, wordBreak: 'break-all' } }, error) : null,
      books.length === 0
        ? React.createElement('div', { style: { fontSize: 12, opacity: 0.6 } },
            '还没有书。新建一本后，对 Agent 说「给我写第 1 章，1200 字」，它会用 novel 工具落盘。')
        : books.map((book) => React.createElement('div', {
            key: book.book,
            style: { border: '1px solid var(--border-color, #d8d8d8)', borderRadius: 10, padding: 10, display: 'grid', gap: 6 },
          },
          React.createElement('div', {
            role: 'button', onClick: () => showBook(book.book),
            style: { display: 'flex', justifyContent: 'space-between', gap: 10, cursor: 'pointer' },
          },
            React.createElement('span', { style: { fontWeight: 600 } }, (openBook === book.book ? '▾ ' : '▸ ') + '《' + book.book + '》'),
            React.createElement('span', { style: { fontSize: 12, opacity: 0.7 } },
              book.chapters + ' 章 · ' + words(book.chapterWords + book.outlineWords + book.characterWords)),
          ),
          openBook === book.book && detail
            ? React.createElement('div', { style: { display: 'grid', gap: 4, fontSize: 12 } },
                detail.chapters.length === 0
                  ? React.createElement('div', { style: { opacity: 0.6 } }, '还没有章节')
                  : detail.chapters.map((chapter) => React.createElement('div', {
                      key: chapter.name,
                      style: { display: 'flex', justifyContent: 'space-between', gap: 10, opacity: 0.85 },
                    },
                      React.createElement('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, '第 ' + chapter.index + ' 章 · ' + chapter.title),
                      React.createElement('span', { style: { opacity: 0.6, flexShrink: 0 } }, words(chapter.words)),
                    )),
                React.createElement('div', { style: { display: 'flex', gap: 8, marginTop: 4 } },
                  React.createElement('button', { type: 'button', onClick: () => openFolder(book.book), style: { padding: '5px 10px', borderRadius: 8, cursor: 'pointer' } }, '打开目录'),
                  React.createElement('button', { type: 'button', onClick: () => exportBook(book.book), style: { padding: '5px 10px', borderRadius: 8, cursor: 'pointer' } }, '导出全书'),
                ),
              )
            : null,
        )),
    )
  }


  // ---------------------------------------------------------------- 记忆管理
  function MemoryPanel() {
    const [data, setData] = useState(null)
    const [key, setKey] = useState('')
    const [value, setValue] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')

    const load = React.useCallback(() => {
      fetch('/plugins/dsh-dafeiyu/memory', { cache: 'no-store' })
        .then(async (response) => {
          const body = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(body.error || '读取失败')
          setData(body)
          setError('')
        })
        .catch((failure) => setError(failure.message))
    }, [])
    React.useEffect(() => { load() }, [load])

    const call = (payload) => {
      setBusy(true)
      fetch('/plugins/dsh-dafeiyu/memory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then(async (response) => {
          const body = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(body.error || '操作失败')
          setData(body)
          setError('')
        })
        .catch((failure) => setError(failure.message))
        .finally(() => setBusy(false))
    }

    const add = () => {
      if (!key.trim() || !value.trim()) return
      call({ action: 'add', key: key.trim(), value: value.trim() })
      setKey('')
      setValue('')
    }

    const items = (data && data.items) || []
    return React.createElement('div', {
      style: { border: '1px solid var(--border-color, #d8d8d8)', borderRadius: 12, padding: 14, display: 'grid', gap: 10 },
      'data-testid': 'dsh-dafeiyu-memory',
    },
      React.createElement('div', null,
        React.createElement('strong', { style: { fontSize: 15 } }, '长期记忆'),
        React.createElement('p', { style: { margin: '4px 0 0', opacity: 0.65, fontSize: 12 } },
          data ? `${items.length} 条 · 文件：${data.path}` : '读取中…'),
      ),
      error ? React.createElement('div', { style: { color: '#d33', fontSize: 12 } }, error) : null,
      items.length === 0
        ? React.createElement('div', { style: { fontSize: 12, opacity: 0.6 } }, '还没有记忆。可以在这里手动添加，或对她说「记住我喜欢蓝色」。')
        : React.createElement('div', { style: { display: 'grid', gap: 6 } },
            ...items.map((item) => React.createElement('div', {
              key: item.id || item.key,
              style: { display: 'flex', gap: 10, alignItems: 'center', fontSize: 12.5 },
            },
              React.createElement('span', { style: { fontWeight: 600, flexShrink: 0 } }, item.key),
              React.createElement('span', { style: { opacity: 0.8, flex: 1, wordBreak: 'break-all' } }, item.value),
              React.createElement('button', {
                type: 'button', disabled: busy,
                onClick: () => call({ action: 'remove', target: item.id || item.key }),
                style: { border: 'none', background: 'transparent', color: '#d33', cursor: 'pointer', fontSize: 12 },
              }, '删除'),
            )),
          ),
      React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
        React.createElement('input', {
          value: key, placeholder: '名称，如 喜欢的颜色',
          onChange: (event) => setKey(event.target.value),
          style: { width: 150, padding: '6px 9px', borderRadius: 8, border: '1px solid var(--border-color, #d8d8d8)', background: 'transparent', color: 'inherit', fontSize: 12 },
        }),
        React.createElement('input', {
          value: value, placeholder: '内容，如 蓝色',
          onChange: (event) => setValue(event.target.value),
          onKeyDown: (event) => { if (event.key === 'Enter') add() },
          style: { flex: 1, minWidth: 140, padding: '6px 9px', borderRadius: 8, border: '1px solid var(--border-color, #d8d8d8)', background: 'transparent', color: 'inherit', fontSize: 12 },
        }),
        React.createElement('button', { type: 'button', disabled: busy || !key.trim() || !value.trim(), onClick: add, style: { padding: '6px 12px', borderRadius: 8, cursor: 'pointer' } }, '添加'),
        items.length > 0
          ? React.createElement('button', { type: 'button', disabled: busy, onClick: () => call({ action: 'clear' }), style: { padding: '6px 12px', borderRadius: 8, cursor: 'pointer', color: '#d33' } }, '清空')
          : null,
      ),
    )
  }

  function BigFishCard({ view } = {}) {
    const [status, setStatus] = useState('loading')
    const [value, setValue] = useState({})
    const [busy, setBusy] = useState(false)
    const patchSeq = useRef(0)
    const sliderTimers = useRef(new Map())
    const [voices, setVoices] = useState([])
    const writable = status === 'ready' && !busy
    useEffect(() => {
      fetch('/plugins/dsh-dafeiyu/voices', { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : { voices: [] }))
        .then((body) => setVoices(Array.isArray(body.voices) ? body.voices : []))
        .catch(() => setVoices([]))
    }, [])
    useEffect(() => {
      let active = true
      fetch(CONFIG_ENDPOINT, { cache: 'no-store' })
        .then(async (response) => {
          if (!response.ok) throw new Error(`settings request failed: ${response.status}`)
          return response.json()
        })
        .then((next) => { if (active) { setValue(next); setStatus('ready') } })
        .catch(() => { if (active) setStatus('unavailable') })
      return () => {
        active = false
        for (const timer of sliderTimers.current.values()) clearTimeout(timer)
        sliderTimers.current.clear()
      }
    }, [])
    const write = async (field, next) => {
      const seq = ++patchSeq.current
      setBusy(true)
      try {
        const response = await fetch(CONFIG_ENDPOINT, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ [field]: next }),
        })
        if (!response.ok) throw new Error(`settings write failed: ${response.status}`)
        const updated = await response.json()
        if (seq === patchSeq.current) {
          setValue(updated)
          setStatus('ready')
        }
      } catch {
        if (seq === patchSeq.current) setStatus('unavailable')
      } finally {
        if (seq === patchSeq.current) setBusy(false)
      }
    }
    const writeSlider = (field, next) => {
      // Keep the slider responsive while dragging: update the local value
      // immediately and send a single debounced PATCH once the user pauses.
      setValue((prev) => ({ ...prev, [field]: next }))
      // Invalidate any in-flight write so a stale response cannot overwrite
      // the optimistic slider value while the user keeps dragging.
      patchSeq.current += 1
      const pending = sliderTimers.current.get(field)
      if (pending) clearTimeout(pending)
      const timer = setTimeout(() => {
        sliderTimers.current.delete(field)
        void write(field, next)
      }, 250)
      sliderTimers.current.set(field, timer)
    }
    return React.createElement(view === 'page' ? 'section' : 'li', { style: cardStyle, 'data-testid': 'dsh-dafeiyu-settings' },
      React.createElement('div', null,
        React.createElement('strong', { style: { fontSize: 16 } }, '大肥鱼桌面伴侣'),
        React.createElement('p', { style: { margin: '5px 0 0', opacity: 0.72 } }, '跟随 DSH WebUI 或桌面端启动，在桌面上显示任务状态和余额。'),
      ),
      status === 'unavailable'
        ? React.createElement('span', { role: 'status' }, '大肥鱼设置尚未连接到 DSH Host。')
        : status === 'loading'
        ? React.createElement('span', null, '正在读取设置…')
        : React.createElement(React.Fragment, null,
          React.createElement(Field, { label: '启用大肥鱼', hint: '关闭后立即退出；重新开启无需单独启动程序。' },
            React.createElement('input', {
              type: 'checkbox', checked: value.enabled !== false, disabled: !writable,
              onChange: (event) => void write('enabled', event.target.checked),
            }),
          ),
          React.createElement(Field, { label: '角色大小', hint: `${Math.round((value.scale ?? 1) * 100)}%` },
            React.createElement('input', {
              type: 'range', min: 0.55, max: 1.4, step: 0.05, value: value.scale ?? 1,
              disabled: status !== 'ready',
              onChange: (event) => void writeSlider('scale', Number(event.target.value)),
            }),
          ),
          React.createElement(Field, { label: '活跃程度', hint: '待机动作结束后休息：安静 45～90 秒、标准 25～45 秒、活泼 12～22 秒。' },
            React.createElement('select', {
              value: value.activityLevel ?? 'normal', disabled: !writable, style: selectStyle,
              onChange: (event) => void write('activityLevel', event.target.value),
            },
            React.createElement('option', { value: 'quiet' }, '安静'),
            React.createElement('option', { value: 'normal' }, '标准'),
            React.createElement('option', { value: 'lively' }, '活泼')),
          ),
          React.createElement(Field, { label: '减少动态效果', hint: '减少走动、循环帧和程序化晃动。' },
            React.createElement('input', {
              type: 'checkbox', checked: value.reducedMotion === true, disabled: !writable,
              onChange: (event) => void write('reducedMotion', event.target.checked),
            }),
          ),
          React.createElement(Field, { label: '提示音', hint: '任务完成或出错时播放大肥鱼提示音。' },
            React.createElement('input', {
              type: 'checkbox', checked: value.soundEnabled !== false, disabled: !writable,
              onChange: (event) => void write('soundEnabled', event.target.checked),
            }),
          ),
          React.createElement(Field, { label: '语音说话', hint: '用 macOS 本机语音（say）播报，不联网、不消耗 token。' },
            React.createElement('input', {
              type: 'checkbox', checked: value.voiceEnabled !== false, disabled: !writable,
              onChange: (event) => void write('voiceEnabled', event.target.checked),
            }),
          ),
          value.voiceEnabled !== false
            ? React.createElement(Field, { label: '音色', hint: '选择系统中文语音；没有的声音会退回默认。' },
                React.createElement('select', {
                  value: value.voiceName ?? 'Tingting', disabled: !writable, style: selectStyle,
                  onChange: (event) => void write('voiceName', event.target.value),
                },
                React.createElement('option', { value: 'Tingting' }, 'Tingting（女声，推荐）'),
                React.createElement('option', { value: 'Eddy (中文（中国大陆）)' }, 'Eddy'),
                React.createElement('option', { value: 'Flo (中文（中国大陆）)' }, 'Flo'),
                React.createElement('option', { value: 'Sandy (中文（中国大陆）)' }, 'Sandy'),
                React.createElement('option', { value: 'Grandma (中文（中国大陆）)' }, 'Grandma'),
                React.createElement('option', { value: 'Grandpa (中文（中国大陆）)' }, 'Grandpa')),
              )
            : null,
          value.voiceEnabled !== false
            ? React.createElement(Field, {
                label: '自定义音色',
                hint: voices.length
                  ? `已学会 ${voices.length} 个音色；选「原声」= 不加音色`
                  : '还没有学过的音色，先在「声音复刻」里学一个',
              },
                React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
                  React.createElement('select', {
                    value: value.voicePreset ?? '',
                    disabled: !writable,
                    style: selectStyle,
                    onChange: (event) => void write('voicePreset', event.target.value),
                  },
                    React.createElement('option', { value: '' }, '原声（默认）'),
                    ...voices.map((item) => React.createElement('option', { key: item.name, value: item.name },
                      item.name + (item.mse ? `（MSE ${item.mse}）` : ''))),
                  ),
                  React.createElement('button', {
                    type: 'button',
                    style: { ...selectStyle, cursor: 'pointer' },
                    onClick: () => {
                      fetch('/plugins/dsh-dafeiyu/voice/preview', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ voice: value.voicePreset || '' }),
                      }).catch(() => {})
                    },
                  }, '试听'),
                ),
              )
            : null,
          value.voiceEnabled !== false
            ? React.createElement(Field, { label: '语速', hint: `${Math.round(value.voiceRate ?? 180)} 字/分钟` },
                React.createElement('input', {
                  type: 'range', min: 100, max: 320, step: 10, value: value.voiceRate ?? 180,
                  disabled: status !== 'ready',
                  onChange: (event) => void writeSlider('voiceRate', Number(event.target.value)),
                }),
              )
            : null,
          value.voiceEnabled !== false
            ? React.createElement(Field, { label: '音量', hint: `${Math.round((value.voiceVolume ?? 0.9) * 100)}%` },
                React.createElement('input', {
                  type: 'range', min: 0.05, max: 1, step: 0.05, value: value.voiceVolume ?? 0.9,
                  disabled: status !== 'ready',
                  onChange: (event) => void writeSlider('voiceVolume', Number(Number(event.target.value).toFixed(2))),
                }),
              )
            : null,
          value.voiceEnabled !== false
            ? React.createElement(Field, { label: '任务播报', hint: '任务完成或出错时，用语音说一句。' },
                React.createElement('input', {
                  type: 'checkbox', checked: value.voiceAnnouncements !== false, disabled: !writable,
                  onChange: (event) => void write('voiceAnnouncements', event.target.checked),
                }),
              )
            : null,
          React.createElement(Field, { label: '聊天会话', hint: '宠物专属会新建一个固定会话并一直复用，聊过的内容就是上下文；跟随当前则发到你正在看的会话。' },
            React.createElement('select', {
              value: value.chatMode ?? 'dedicated', disabled: !writable, style: selectStyle,
              onChange: (event) => void write('chatMode', event.target.value),
            },
            React.createElement('option', { value: 'dedicated' }, '宠物专属（记住上下文）'),
            React.createElement('option', { value: 'current' }, '跟随当前会话')),
          ),
          React.createElement(Field, { label: '任务时防休眠', hint: 'DSH 正在跑任务时为系统挂上 sleep 抑制，任务结束自动放开。' },
            React.createElement('input', {
              type: 'checkbox', checked: value.preventSleep !== false, disabled: !writable,
              onChange: (event) => void write('preventSleep', event.target.checked),
            }),
          ),
          value.preventSleep !== false
            ? React.createElement(Field, { label: '屏幕也常亮', hint: '勾选后连显示器都不休眠；默认只防系统休眠，屏幕可以正常变暗。' },
                React.createElement('input', {
                  type: 'checkbox', checked: value.preventSleepDisplay === true, disabled: !writable,
                  onChange: (event) => void write('preventSleepDisplay', event.target.checked),
                }),
              )
            : null,
          React.createElement(Field, { label: '无聊时打招呼', hint: '长时间没人动 DSH 时，她会冒个泡打个招呼（最多连续 3 次）。' },
            React.createElement('input', {
              type: 'checkbox', checked: value.greetingEnabled !== false, disabled: !writable,
              onChange: (event) => void write('greetingEnabled', event.target.checked),
            }),
          ),
          value.greetingEnabled !== false
            ? React.createElement(Field, { label: '多久打招呼', hint: '空闲达到这个分钟数后开始；两次之间至少间隔 25 分钟。' },
                React.createElement('input', {
                  type: 'number', min: 1, max: 240, step: 1, value: value.greetingAfterMinutes ?? 12,
                  disabled: !writable, style: { width: 92, padding: '5px 8px', borderRadius: 8 },
                  onChange: (event) => void write('greetingAfterMinutes', Math.max(1, Math.min(240, Number(event.target.value) || 12))),
                }),
              )
            : null,
          React.createElement(Field, { label: '气泡显示', hint: '常驻显示、完全隐藏，或自定义哪些状态显示气泡。' },
            React.createElement('select', {
              value: value.bubbleMode ?? 'always', disabled: !writable, style: selectStyle,
              onChange: (event) => void write('bubbleMode', event.target.value),
            },
            React.createElement('option', { value: 'always' }, '常驻显示'),
            React.createElement('option', { value: 'hidden' }, '完全隐藏'),
            React.createElement('option', { value: 'custom' }, '自定义显示状态')),
          ),
          (value.bubbleMode ?? 'always') !== 'hidden'
            ? React.createElement(Field, { label: '气泡大小', hint: `${Math.round((value.bubbleScale ?? 1) * 100)}%` },
                React.createElement('input', {
                  type: 'range', min: 0.8, max: 1.2, step: 0.05, value: value.bubbleScale ?? 1,
                  disabled: status !== 'ready',
                  onChange: (event) => void writeSlider('bubbleScale', Number(event.target.value)),
                }),
              )
            : null,
          (value.bubbleMode ?? 'always') === 'custom'
            ? React.createElement(Field, { label: '自定义显示状态', hint: '勾选后，只有这些状态出现时才会显示气泡。' },
                React.createElement(BubbleStatePicker, {
                  value: value.bubbleStates ?? ['SUCCESS', 'ERROR', 'WAITING'],
                  disabled: !writable,
                  onChange: (next) => void write('bubbleStates', next),
                }),
              )
            : null,
          React.createElement(Field, { label: '响应子 Agent', hint: '默认只跟随顶层任务，避免状态过度跳动。' },
            React.createElement('input', {
              type: 'checkbox', checked: value.includeSubagents === true, disabled: !writable,
              onChange: (event) => void write('includeSubagents', event.target.checked),
            }),
          ),
          React.createElement(Field, { label: '页面内桌宠', hint: '在 DSH 页面右下角显示一只跟随状态的小桌宠（纯装饰）；开关后刷新页面生效。' },
            React.createElement('input', {
              type: 'checkbox', checked: value.webOverlay === true, disabled: !writable,
              onChange: (event) => void write('webOverlay', event.target.checked),
            }),
          ),
          React.createElement(Field, { label: '打开 DSH', hint: '自动识别当前客户端；识别不准时可手动选择。' },
            React.createElement('select', { value: value.clientTarget ?? 'auto', disabled: !writable, style: selectStyle,
              onChange: (event) => void write('clientTarget', event.target.value) },
              React.createElement('option', { value: 'auto' }, '自动识别'),
              React.createElement('option', { value: 'web' }, 'WebUI'),
              React.createElement('option', { value: 'desktop' }, '桌面端'),
            ),
          ),
          React.createElement(Field, { label: '显示余额', hint: '气泡显示总余额，下方可查看赠送／充值明细。' },
            React.createElement('input', { type: 'checkbox', checked: value.balanceEnabled !== false, disabled: !writable,
              onChange: (event) => void write('balanceEnabled', event.target.checked) }),
          ),
          React.createElement(Field, { label: '余额来源', hint: '自动模式优先使用 API Key；账户余额和 API Key 余额可能不同。' },
            React.createElement('select', { value: value.balanceSource ?? 'auto', disabled: !writable, style: selectStyle,
              onChange: (event) => void write('balanceSource', event.target.value) },
              React.createElement('option', { value: 'auto' }, '自动'),
              React.createElement('option', { value: 'api-key' }, 'API Key'),
              React.createElement('option', { value: 'account' }, '已登录账户'),
            ),
          ),
          React.createElement(BalancePanel, { enabled: value.balanceEnabled !== false && value.enabled !== false, source: value.balanceSource ?? 'auto' }),
          React.createElement(DenoisePanel, null),
          React.createElement(NovelWorkshop, null),
          React.createElement(MemoryPanel, null),
          busy ? React.createElement('small', { role: 'status' }, '正在保存…') : null,
        ),
    )
  }

  // In-page companion (opt-in via the webOverlay setting). Purely decorative:
  // it mirrors the DSH state as a small looping sprite in the page corner and
  // never blocks or outlives the page. Every failure path ends in "no pet",
  // never in an exception reaching the WebUI.
  function PetOverlay() {
    const [src, setSrc] = useState(null)
    useEffect(() => {
      let alive = true
      let raf = 0
      let source = null
      fetch(MANIFEST_ENDPOINT, { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error('manifest'))))
        .then((manifest) => {
          if (!alive) return
          const runtime = { name: '', frames: [], frameMs: 42, loop: true, index: 0, base: 'idle', pulseUntil: 0, reducedMotion: false }
          let preloader = null
          let spent = 0
          const applyClip = (name) => {
            if (runtime.name === name) return
            const clip = manifest.clips[name] || manifest.clips.idle
            runtime.name = name
            runtime.frames = clip.frames
            runtime.frameMs = clip.frameMs || 42
            runtime.loop = clip.loop !== false
            runtime.index = 0
            spent = 0
          }
          const frameUrl = (frame) => FRAME_ENDPOINT + '?frame=' + encodeURIComponent(frame)
          const show = () => {
            if (!alive || runtime.frames.length === 0) return
            setSrc(frameUrl(runtime.frames[runtime.index]))
            if (runtime.frames.length > 1 && typeof Image === 'function') {
              try {
                preloader = preloader || new Image()
                preloader.src = frameUrl(runtime.frames[(runtime.index + 1) % runtime.frames.length])
              } catch {}
            }
          }
          applyClip('idle')
          show()
          if (typeof requestAnimationFrame !== 'function') return
          let previous = 0
          const step = (now) => {
            if (!alive) return
            if (runtime.pulseUntil && Date.now() >= runtime.pulseUntil) {
              runtime.pulseUntil = 0
              applyClip(runtime.base)
              previous = now
              show()
            }
            if (previous && !runtime.reducedMotion) {
              spent += now - previous
              if (spent >= runtime.frameMs) {
                const frames = Math.floor(spent / runtime.frameMs)
                spent %= runtime.frameMs
                runtime.index = runtime.loop
                  ? (runtime.index + frames) % runtime.frames.length
                  : Math.min(runtime.index + frames, runtime.frames.length - 1)
                show()
              }
            }
            previous = now
            raf = requestAnimationFrame(step)
          }
          raf = requestAnimationFrame(step)
          if (typeof EventSource !== 'undefined') {
            try {
              source = new EventSource(EVENTS_ENDPOINT)
              source.onmessage = (event) => {
                try {
                  const message = JSON.parse(event.data)
                  const clipFor = (state, activity) => state === 'WORKING' && manifest.workingActivityMap?.[activity]
                    || manifest.stateMap[state] || 'idle'
                  if (message.kind === 'config') runtime.reducedMotion = message.reducedMotion === true
                  if (message.kind === 'state' && message.state && manifest.stateMap[message.state]) {
                    runtime.base = clipFor(message.state, message.activity)
                    if (message.state !== 'IDLE') runtime.pulseUntil = 0
                    if (!runtime.pulseUntil) applyClip(runtime.base)
                  }
                  if (message.kind === 'task' && message.state === 'WORKING' && message.activity
                    && manifest.workingActivityMap && manifest.workingActivityMap[message.activity]) {
                    runtime.base = clipFor('WORKING', message.activity)
                    if (!runtime.pulseUntil) applyClip(runtime.base)
                  }
                  if (message.kind === 'pulse' && manifest.stateMap[message.state] && message.ttlMs > 0) {
                    runtime.base = clipFor(message.resumeState, message.resumeActivity)
                    const name = clipFor(message.state)
                    const clip = manifest.clips[name]
                    const duration = runtime.reducedMotion ? 0 : clip.frames.length * clip.frameMs
                    const deadline = runtime.name === name ? runtime.pulseUntil : 0
                    runtime.pulseUntil = Math.max(Date.now() + message.ttlMs, deadline || Date.now() + duration)
                    applyClip(name)
                  }
                  show()
                } catch {}
              }
            } catch {}
          }
        })
        .catch(() => {})
      return () => {
        alive = false
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
        try { source?.close() } catch {}
      }
    }, [])
    if (!src) return null
    return React.createElement('img', {
      src, alt: '', 'aria-hidden': true, draggable: false,
      style: {
        position: 'fixed', right: 16, bottom: 12, width: 132, zIndex: 2147483000,
        pointerEvents: 'none', userSelect: 'none', opacity: 0.96,
        filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.25))',
      },
    })
  }


  // ---------------------------------------------------------------- chat dock
  // A small in-page panel that talks to the selected Harness session through
  // the Host's loopback endpoints. Independent from the native pet window so a
  // broken chat can never take the companion down.
  const CHAT_STATE_ENDPOINT = '/plugins/dsh-dafeiyu/chat/state'
  const CHAT_SEND_ENDPOINT = '/plugins/dsh-dafeiyu/chat/send'
  const CHAT_TARGET_ENDPOINT = '/plugins/dsh-dafeiyu/chat/target'

  // Transport: prefer XMLHttpRequest. The desktop shell patches window.fetch
  // in a way that rejects plugin requests with "reading 'throwIfAborted'", while
  // XHR stays untouched. fetch remains a fallback for shells that do the
  // opposite. Both add a timeout so a stalled host cannot freeze the panel.
  const CHAT_CLIENT_VERSION = 'v4'
  const chatRequest = (url, init) => new Promise((resolve, reject) => {
    if (typeof XMLHttpRequest !== 'function') {
      reject(new Error('xhr:unavailable'))
      return
    }
    try {
      const xhr = new XMLHttpRequest()
      xhr.open((init && init.method) || 'GET', url, true)
      xhr.timeout = 20000
      xhr.setRequestHeader('cache-control', 'no-store')
      if (init && init.headers) {
        for (const [key, value] of Object.entries(init.headers)) xhr.setRequestHeader(key, value)
      }
      xhr.onload = () => {
        const ok = xhr.status >= 200 && xhr.status < 300
        let value = null
        try { value = xhr.responseText ? JSON.parse(xhr.responseText) : null } catch {}
        resolve({ ok, status: xhr.status, value })
      }
      xhr.onerror = () => reject(new Error('xhr:network'))
      xhr.ontimeout = () => reject(new Error('xhr:timeout'))
      xhr.send((init && init.body) || null)
    } catch (failure) {
      reject(new Error('xhr:' + (failure && failure.message ? failure.message : 'failed')))
    }
  })

  const chatJson = async (url, init) => {
    let response
    try {
      response = await chatRequest(url, init)
    } catch (xhrError) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null
      const timer = controller ? setTimeout(() => controller.abort(), 20000) : null
      try {
        const raw = await fetch(url, { ...init, cache: 'no-store', signal: controller ? controller.signal : undefined })
        const value = await raw.json().catch(() => null)
        response = { ok: raw.ok, status: raw.status, value }
      } catch (fetchError) {
        throw new Error('传输失败（' + xhrError.message + ' / fetch:' + (fetchError && fetchError.message ? fetchError.message : 'failed') + '）')
      } finally {
        if (timer) clearTimeout(timer)
      }
    }
    if (!response.ok) {
      throw new Error((response.value && response.value.error) || ('聊天服务返回 ' + response.status))
    }
    return response.value
  }

  const chatButtonStyle = {
    position: 'fixed', right: 18, bottom: 148, zIndex: 2147483001,
    width: 44, height: 44, borderRadius: 999, border: 'none', cursor: 'pointer',
    background: 'var(--accent-color, #4d6bfe)', color: '#fff', fontSize: 19,
    boxShadow: '0 6px 18px rgba(0,0,0,0.25)', display: 'grid', placeItems: 'center',
  }
  const chatPanelStyle = {
    position: 'fixed', right: 18, bottom: 200, zIndex: 2147483002,
    width: 340, maxWidth: 'calc(100vw - 36px)', height: 430, maxHeight: '68vh',
    display: 'flex', flexDirection: 'column', borderRadius: 14, overflow: 'hidden',
    background: 'var(--surface-color, #ffffff)', border: '1px solid var(--border-color, #d8d8d8)',
    boxShadow: '0 18px 48px rgba(0,0,0,0.28)', color: 'var(--text-color, #1d1d1f)',
    font: '13px/1.45 system-ui, -apple-system, "PingFang SC", sans-serif',
  }

  const stripContext = (text) => String(text || '').replace(/<dfy-context>[\s\S]*?<\/dfy-context>\s*/g, '').trim()

  function ChatDock() {
    const [open, setOpen] = React.useState(false)
    const [snapshot, setSnapshot] = React.useState(null)
    const [draft, setDraft] = React.useState('')
    const [sending, setSending] = React.useState(false)
    const [error, setError] = React.useState('')
    const listRef = React.useRef(null)

    const refresh = React.useCallback(() => {
      chatJson(CHAT_STATE_ENDPOINT)
        .then((value) => {
          setSnapshot(value)
          setError(value && value.error ? String(value.error) : '')
        })
        .catch((failure) => setError(failure && failure.message ? failure.message : '聊天服务不可用'))
    }, [])

    React.useEffect(() => {
      if (!open) return undefined
      refresh()
      const timer = setInterval(refresh, 2500)
      return () => clearInterval(timer)
    }, [open, refresh])

    const count = snapshot && Array.isArray(snapshot.messages) ? snapshot.messages.length : 0
    React.useEffect(() => {
      const node = listRef.current
      if (node) node.scrollTop = node.scrollHeight
    }, [open, count, snapshot && snapshot.busy])

    const send = () => {
      const text = draft.trim()
      if (!text || sending) return
      setSending(true)
      setError('')
      setDraft('')
      setSnapshot((previous) => previous
        ? { ...previous, busy: true, messages: [...(previous.messages || []), { role: 'user', text, at: Date.now() }] }
        : previous)
      const post = () => chatJson(CHAT_SEND_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      // The desktop shell can reject proxied POSTs before they reach the Host;
      // the same payload over a local GET is the reliable fallback.
      const get = () => chatJson(CHAT_SEND_ENDPOINT + '?text=' + encodeURIComponent(text))
      post().catch(() => get())
        .then(() => {
          setTimeout(refresh, 600)
          setTimeout(refresh, 2200)
        })
        .catch((failure) => {
          setError(failure && failure.message ? failure.message : '发送失败')
          setDraft(text)
        })
        .finally(() => setSending(false))
    }

    const pick = (event) => {
      const sessionId = event.target.value
      if (!sessionId) return
      const post = () => chatJson(CHAT_TARGET_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
      const get = () => chatJson(CHAT_TARGET_ENDPOINT + '?sessionId=' + encodeURIComponent(sessionId))
      post().catch(() => get())
        .then(() => refresh())
        .catch((failure) => setError(failure && failure.message ? failure.message : '切换会话失败'))
    }

    const onKeyDown = (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent?.isComposing) {
        event.preventDefault()
        send()
      }
    }

    if (!open) {
      return React.createElement('button', {
        type: 'button', title: '和大肥鱼聊天', 'aria-label': '和大肥鱼聊天',
        style: chatButtonStyle, onClick: () => setOpen(true),
      }, '💬')
    }

    const sessions = snapshot && Array.isArray(snapshot.sessions) ? snapshot.sessions : []
    const messages = snapshot && Array.isArray(snapshot.messages) ? snapshot.messages : []

    return React.createElement('div', { style: chatPanelStyle },
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--border-color, #d8d8d8)' },
      },
        React.createElement('div', { style: { flex: 1, minWidth: 0 } },
          React.createElement('div', { style: { fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
            '和大肥鱼聊天',
            React.createElement('span', { style: { fontSize: 10, opacity: 0.35, marginLeft: 6, fontWeight: 400 } }, CHAT_CLIENT_VERSION),
          ),
          React.createElement('div', { style: { fontSize: 11, opacity: 0.6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
            snapshot && snapshot.title ? snapshot.title : '跟随你最近使用的会话'),
        ),
        React.createElement('button', {
          type: 'button', title: '收起', onClick: () => setOpen(false),
          style: { border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 16, color: 'inherit', opacity: 0.7 },
        }, '×'),
      ),
      sessions.length > 1
        ? React.createElement('div', { style: { padding: '6px 12px', borderBottom: '1px solid var(--border-color, #d8d8d8)' } },
            React.createElement('select', {
              value: (snapshot && snapshot.sessionId) || '', onChange: pick,
              style: { width: '100%', padding: '5px 8px', borderRadius: 8 },
            }, ...sessions.map((session) => React.createElement('option', { key: session.id, value: session.id },
              (session.title || session.id.slice(0, 8)) + (session.busy ? ' · 进行中' : '')))),
          )
        : null,
      React.createElement('div', {
        ref: listRef,
        style: { flex: 1, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 },
      },
        messages.length === 0
          ? React.createElement('div', { style: { opacity: 0.55, textAlign: 'center', marginTop: 24, fontSize: 12 } },
              '还没有消息。说点什么，她会带着当前会话的模型和工具回答你。')
          : messages.map((message, index) => React.createElement('div', {
              key: String(index) + String(message.at || ''),
              style: {
                alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%', padding: '7px 10px', borderRadius: 12,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                background: message.role === 'user' ? 'var(--accent-color, #4d6bfe)' : 'rgba(127,127,127,0.14)',
                color: message.role === 'user' ? '#fff' : 'inherit',
              },
            }, stripContext(message.text) || '（自动附带的工作上下文）')),
        snapshot && snapshot.busy
          ? React.createElement('div', { style: { alignSelf: 'flex-start', opacity: 0.6, fontSize: 12 } }, '大肥鱼正在想…')
          : null,
      ),
      error
        ? React.createElement('div', { style: { padding: '6px 12px', color: '#d33', fontSize: 12, borderTop: '1px solid var(--border-color, #d8d8d8)' } }, error)
        : null,
      React.createElement('div', {
        style: { display: 'flex', gap: 8, padding: 10, borderTop: '1px solid var(--border-color, #d8d8d8)' },
      },
        React.createElement('textarea', {
          value: draft, onChange: (event) => setDraft(event.target.value), onKeyDown,
          rows: 2, placeholder: '和大肥鱼说点什么… Enter 发送，Shift+Enter 换行',
          style: {
            flex: 1, resize: 'none', padding: '7px 9px', borderRadius: 10, fontSize: 13,
            border: '1px solid var(--border-color, #d8d8d8)', background: 'transparent', color: 'inherit',
            font: 'inherit', outline: 'none',
          },
        }),
        React.createElement('button', {
          type: 'button', onClick: send, disabled: sending || draft.trim() === '',
          style: {
            alignSelf: 'stretch', padding: '0 14px', borderRadius: 10, border: 'none', cursor: 'pointer',
            background: 'var(--accent-color, #4d6bfe)', color: '#fff', opacity: sending || draft.trim() === '' ? 0.5 : 1,
          },
        }, sending ? '…' : '发送'),
      ),
    )
  }

  function registerChatDock(ctx) {
    try {
      ctx.slots.inject('shell.overlay', () => {
        try {
          ctx.slots.register({ name: 'shell.overlay', id: 'dsh-dafeiyu-chat', order: 1000 }, () => React.createElement(ChatDock, {}))
        } catch (error) {
          if (typeof console !== 'undefined' && console.error) console.error('[dsh-dafeiyu] failed to register chat dock:', error)
        }
      })
    } catch (error) {
      if (typeof console !== 'undefined' && console.error) console.error('[dsh-dafeiyu] failed to inject chat slot:', error)
    }
  }

  function registerWebOverlay(ctx) {
    const registerOverlay = () => {
      try {
        ctx.slots.register({ name: 'shell.overlay', id: 'dsh-dafeiyu-overlay', order: 999 }, () =>
          React.createElement(PetOverlay, {}))
      } catch (error) {
        if (typeof console !== 'undefined' && console.error) {
          console.error('[dsh-dafeiyu] failed to register web overlay:', error)
        }
      }
    }
    try {
      ctx.slots.inject('shell.overlay', registerOverlay)
    } catch (error) {
      if (typeof console !== 'undefined' && console.error) {
        console.error('[dsh-dafeiyu] failed to inject overlay slot:', error)
      }
    }
  }

  function apply(ctx) {
    // If DSH changes the slot contract again, fail this card quietly instead of failing the whole
    // WebUI load (that regressed before as 'other plugins stop working').
    // The guard must live INSIDE the inject callback because DSH may invoke
    // it asynchronously, outside any try around the inject() call itself.
    const registerCard = (slot) => () => {
      try {
        ctx.slots.register({
          name: slot, key: 'dsh-dafeiyu', id: 'dsh-dafeiyu', order: 30,
          label: () => '大肥鱼',
          inject: () => ({}),
        }, BigFishCard)
      } catch (error) {
        if (typeof console !== 'undefined' && console.error) {
          console.error('[dsh-dafeiyu] failed to register settings card:', error)
        }
      }
    }
    for (const slot of ['plugins.bundle.config', 'settings.plugins.tab', 'settings.plugin.item']) {
      try {
        ctx.slots.inject(slot, registerCard(slot))
      } catch (error) {
        if (typeof console !== 'undefined' && console.error) {
          console.error('[dsh-dafeiyu] failed to inject settings slot:', error)
        }
      }
    }

    registerChatDock(ctx)

    // The in-page pet is opt-in; read the local config once at mount. Any
    // failure (endpoint absent, offline host, closed page) just means no pet.
    try {
      fetch(CONFIG_ENDPOINT, { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : null))
        .then((config) => {
          if (config && config.webOverlay === true) registerWebOverlay(ctx)
        })
        .catch(() => {})
    } catch {}
  }

  module.exports = {
    name: 'dsh-dafeiyu-client',
    inject: ['slots'],
    apply,
  }
  return module.exports
} })
