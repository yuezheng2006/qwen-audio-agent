import { useCallback, useEffect, useRef, useState } from 'react'
import WereadReaderPanel from './WereadReaderPanel.jsx'
import {
  cursorFor,
  fileToBase64,
  organizeBooks,
} from './reading-library.js'
import { apiUrl } from './app-paths.js'

const TABS = [
  ['shelf', '书架'],
  ['import', '导入'],
  ['weread', '微信读书'],
]

async function readJson(response) {
  const resolved = await response
  const payload = await resolved.json().catch(() => ({}))
  if (!resolved.ok) {
    throw new Error(payload.error || `请求失败（${resolved.status}）`)
  }
  return payload
}

export default function ReadingPanel({
  open,
  onClose,
  initialTab = 'shelf',
  voiceSessionActive = false,
  liveProgress = null,
}) {
  const [tab, setTab] = useState(initialTab)
  const [shelves, setShelves] = useState([])
  const [cursors, setCursors] = useState([])
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [speaking, setSpeaking] = useState(false)
  const [paste, setPaste] = useState('')
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const audioRef = useRef(null)
  const objectUrlRef = useRef('')

  const stopAudio = useCallback(() => {
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = ''
    }
    setSpeaking(false)
  }, [])

  const refreshBooks = useCallback(async () => {
    const payload = await readJson(await fetch(apiUrl('content/books')))
    setShelves(organizeBooks(payload))
    setCursors(payload.cursors || [])
  }, [])

  useEffect(() => {
    if (!open) return undefined
    setTab(initialTab || 'shelf')
    setError('')
    let cancelled = false
    refreshBooks().catch(err => {
      if (!cancelled) setError(err.message)
    })
    return () => {
      cancelled = true
    }
  }, [open, initialTab, refreshBooks])

  useEffect(() => () => stopAudio(), [stopAudio])

  useEffect(() => {
    const contentId = liveProgress?.contentId || liveProgress?.content_id
    if (!contentId) return
    setCursors(current => {
      const next = (current || []).filter(item => item.contentId !== contentId)
      next.push({
        contentId,
        index: liveProgress.index,
        total: liveProgress.total,
        title: liveProgress.title,
      })
      return next
    })
  }, [liveProgress])

  const saveCursor = async (chapter, index = 0, total = 1) => {
    await fetch(apiUrl('content/progress'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentId: chapter.id,
        bookSlug: selected?.slug,
        index,
        total,
        title: chapter.title,
      }),
    }).catch(() => {})
  }

  const speakChapter = async (chapter) => {
    if (!chapter?.id) return
    setBusy(true)
    setError('')
    stopAudio()
    try {
      if (voiceSessionActive) {
        const control = await fetch(apiUrl('content/control'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'start_read',
            content_id: chapter.id,
            offset: cursorFor(cursors, chapter.id)?.index || 0,
          }),
        })
        if (control.ok) {
          await saveCursor(chapter, cursorFor(cursors, chapter.id)?.index || 0)
          setSpeaking(true)
          return
        }
      }
      const response = await fetch(apiUrl('content/speak'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content_id: chapter.id, title: chapter.title }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error || `朗读失败（${response.status}）`)
      }
      const blob = await response.blob()
      const href = URL.createObjectURL(blob)
      objectUrlRef.current = href
      audioRef.current.src = href
      setSpeaking(true)
      await audioRef.current.play()
      await saveCursor(chapter, 1, 1)
      await refreshBooks()
    } catch (err) {
      setError(err.message)
      setSpeaking(false)
    } finally {
      setBusy(false)
    }
  }

  const controlReader = async (action) => {
    setBusy(true)
    try {
      await readJson(await fetch(apiUrl('content/control'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      }))
      if (action === 'stop') stopAudio()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const importPayload = async (body) => {
    setBusy(true)
    setError('')
    try {
      await readJson(await fetch(apiUrl('content/import'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }))
      setPaste('')
      setUrl('')
      setTitle('')
      setTab('shelf')
      await refreshBooks()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const importPaste = () => importPayload({
    title: title || '粘贴长文',
    markdown: paste,
  })

  const importUrl = () => importPayload({
    title: title || '',
    url,
  })

  const importFile = async (file) => {
    if (!file) return
    const isText = /\.(md|markdown|txt)$/i.test(file.name)
    if (isText) {
      const markdown = await file.text()
      return importPayload({ title: title || file.name, markdown })
    }
    const fileBase64 = await fileToBase64(file)
    return importPayload({
      title: title || file.name.replace(/\.[^.]+$/, ''),
      fileName: file.name,
      fileBase64,
    })
  }

  if (!open) return null

  return (
    <div className="settings-drawer reading-drawer" role="dialog" aria-label="阅读">
      <div className="settings-panel settings-panel-wide">
        <header>
          <h2>阅读</h2>
          <button className="ghost" onClick={() => { stopAudio(); onClose?.() }} disabled={busy}>
            关闭
          </button>
        </header>
        <p className="hint">
          书架朗读 · 导入长文 · 微信读书划线
          {voiceSessionActive ? ' · 语音会话已开，可被打断' : ' · 无需开麦也可听'}
        </p>
        <div className="weread-tabs" role="tablist">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              className={tab === id ? 'active' : ''}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {error && <p className="settings-error">{error}</p>}

        {tab === 'shelf' && (
          <section>
            {!selected && (
              <ul className="memory-list">
                {shelves.map(book => (
                  <li key={book.slug}>
                    <div>
                      <b>{book.title}</b>
                      <span>{book.chapterCount} 章</span>
                    </div>
                    <button className="ghost" type="button" onClick={() => setSelected(book)}>
                      打开
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {selected && (
              <>
                <div className="weread-current-book">
                  <div>
                    <b>{selected.title}</b>
                    <small>{selected.chapterCount} 章</small>
                  </div>
                  <div className="weread-row-actions">
                    {voiceSessionActive && (
                      <>
                        <button className="ghost" type="button" disabled={busy} onClick={() => controlReader('pause')}>暂停</button>
                        <button className="ghost" type="button" disabled={busy} onClick={() => controlReader('resume')}>继续</button>
                        <button className="ghost" type="button" disabled={busy} onClick={() => controlReader('stop')}>停止</button>
                      </>
                    )}
                    <button className="ghost" type="button" onClick={() => setSelected(null)}>返回</button>
                  </div>
                </div>
                <ul className="memory-list">
                  {selected.chapters.map(chapter => {
                    const cursor = cursorFor(cursors, chapter.id)
                    return (
                      <li key={chapter.id}>
                        <div>
                          <b>{chapter.title}</b>
                          <span>
                            {chapter.relativePath || ''}
                            {cursor ? ` · 进度 ${cursor.index}/${cursor.total || '?'}` : ''}
                          </span>
                        </div>
                        <button
                          className="ghost"
                          type="button"
                          disabled={busy}
                          onClick={() => speakChapter(chapter)}
                        >
                          {cursor ? '续听' : '朗读'}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
            {!shelves.length && (
              <div className="empty-memories">书架还空。去「导入」贴长文或选文件。</div>
            )}
            <audio
              ref={audioRef}
              className="weread-audio"
              controls
              onEnded={() => setSpeaking(false)}
            />
            {speaking && !voiceSessionActive && (
              <p className="hint">正在播放当前章节</p>
            )}
          </section>
        )}

        {tab === 'import' && (
          <section>
            <label className="voice-field">
              <span>标题（可选）</span>
              <input
                value={title}
                disabled={busy}
                onChange={event => setTitle(event.target.value)}
                placeholder="夜话"
              />
            </label>
            <label className="voice-field">
              <span>粘贴长文</span>
              <textarea
                rows={8}
                value={paste}
                disabled={busy}
                onChange={event => setPaste(event.target.value)}
                placeholder="Markdown 或纯文本"
              />
            </label>
            <div className="row-actions">
              <button
                className="ghost"
                type="button"
                disabled={busy || !paste.trim()}
                onClick={importPaste}
              >
                导入粘贴
              </button>
            </div>
            <label className="voice-field">
              <span>网页 URL</span>
              <input
                value={url}
                disabled={busy}
                onChange={event => setUrl(event.target.value)}
                placeholder="https://"
              />
            </label>
            <div className="row-actions">
              <button
                className="ghost"
                type="button"
                disabled={busy || !url.trim()}
                onClick={importUrl}
              >
                导入链接
              </button>
            </div>
            <label className="voice-field">
              <span>本地文件（md / txt / pdf / docx）</span>
              <input
                type="file"
                disabled={busy}
                onChange={event => importFile(event.target.files?.[0])}
              />
            </label>
          </section>
        )}

        {tab === 'weread' && (
          <WereadReaderPanel
            open
            embedded
            persistToShelf
            onPersisted={refreshBooks}
            onClose={onClose}
          />
        )}
      </div>
      <button
        type="button"
        className="settings-backdrop"
        aria-label="关闭阅读"
        onClick={() => { stopAudio(); onClose?.() }}
      />
    </div>
  )
}
