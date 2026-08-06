import { useCallback, useEffect, useState } from 'react'

const TTS_PROVIDERS = ['dashscope', 'voicebox', 'fish', 'listenhub', 'minimax']
const MEMORY_SCOPES = [
  { id: 'all', label: '全部' },
  { id: 'profile', label: '档案' },
  { id: 'long_term', label: '长期' },
  { id: 'rules', label: '约定' },
]
const SECTIONS = [
  { id: 'mode', label: '模式' },
  { id: 'tts', label: 'TTS' },
  { id: 'memory', label: '记忆' },
  { id: 'notes', label: '清单' },
  { id: 'reminders', label: '提醒' },
  { id: 'knowledge', label: '知识' },
  { id: 'reader', label: '朗读' },
  { id: 'skills', label: '能力' },
]

async function readJson(response) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload.error || `请求失败（${response.status}）`)
  }
  return payload
}

function cascadeVoiceHint(runtime) {
  const provider = runtime?.cascade?.ttsProvider || 'tts'
  const model = runtime?.cascade?.tts || 'model'
  const voice = runtime?.cascade?.voiceLabel
    || runtime?.realtimeVoiceLabel
    || runtime?.cascade?.voice
    || runtime?.realtimeVoice
    || '未配置音色'
  return `VAD→STT→LLM→TTS · ${provider} · ${model} · ${voice}`
}

function s2sVoiceHint(runtime) {
  const voice = runtime?.realtimeVoiceLabel || runtime?.realtimeVoice || '系统音色'
  const model = runtime?.realtimeModel || 'Realtime'
  return `${model} · ${voice}`
}

function scopeLabel(scope) {
  if (scope === 'profile') return '档案'
  if (scope === 'rules') return '约定'
  return '长期'
}

function toLocalInputValue(ms) {
  if (!ms) return ''
  const date = new Date(ms)
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function waitForHealth(match, { timeoutMs = 25000 } = {}) {
  const deadline = Date.now() + timeoutMs
  return (async () => {
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 500))
      try {
        const health = await readJson(await fetch('api/health'))
        if (match(health)) return health
      } catch {
        // gateway restarting
      }
    }
    throw new Error('Gateway 重启超时，请稍后刷新页面')
  })()
}

export default function RuntimeSettings({
  open,
  onClose,
  runtime,
  onRuntimeChange,
  onModeSwitching,
}) {
  const [section, setSection] = useState('mode')
  const [memories, setMemories] = useState([])
  const [memoryScope, setMemoryScope] = useState('all')
  const [memoryDraft, setMemoryDraft] = useState({ scope: 'long_term', content: '' })
  const [editingMemoryId, setEditingMemoryId] = useState('')
  const [editingMemoryContent, setEditingMemoryContent] = useState('')
  const [notesLists, setNotesLists] = useState([])
  const [activeList, setActiveList] = useState('')
  const [noteItems, setNoteItems] = useState([])
  const [noteListDraft, setNoteListDraft] = useState('购物')
  const [noteItemDraft, setNoteItemDraft] = useState('')
  const [reminders, setReminders] = useState([])
  const [reminderDraft, setReminderDraft] = useState({
    executeAt: toLocalInputValue(Date.now() + 3600_000),
    reminder: '',
    recurrence: 'once',
  })
  const [knowledge, setKnowledge] = useState(null)
  const [knowledgeQuery, setKnowledgeQuery] = useState('')
  const [knowledgeHits, setKnowledgeHits] = useState([])
  const [content, setContent] = useState(null)
  const [skills, setSkills] = useState(null)
  const [capabilities, setCapabilities] = useState(null)
  const [modeDraft, setModeDraft] = useState(runtime?.frontendMode || 'cascade')
  const [ttsDraft, setTtsDraft] = useState({
    provider: runtime?.cascade?.ttsProvider || 'dashscope',
    model: runtime?.cascade?.tts || '',
    voice: runtime?.cascade?.voice || runtime?.realtimeVoice || '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refreshMemories = useCallback(async (scope = memoryScope) => {
    const query = scope === 'all' ? '' : `?scope=${encodeURIComponent(scope)}`
    const payload = await readJson(await fetch(`api/memory${query}`))
    setMemories(payload.memories || [])
  }, [memoryScope])

  const refreshNotes = useCallback(async (listName = activeList) => {
    const payload = await readJson(await fetch('api/notes'))
    const lists = payload.lists || []
    setNotesLists(lists)
    const nextList = listName && lists.some(item => item.list === listName)
      ? listName
      : (lists[0]?.list || '')
    setActiveList(nextList)
    if (!nextList) {
      setNoteItems([])
      return
    }
    const shown = await readJson(await fetch(`api/notes/${encodeURIComponent(nextList)}`))
    setNoteItems(shown.items || [])
  }, [activeList])

  const refreshReminders = useCallback(async () => {
    const payload = await readJson(await fetch('api/reminders'))
    setReminders(payload.reminders || [])
  }, [])

  const refreshLibraries = useCallback(async () => {
    const [knowledgePayload, contentPayload, skillsPayload, capabilitiesPayload] = await Promise.all([
      readJson(await fetch('api/knowledge')),
      readJson(await fetch('api/content')),
      readJson(await fetch('api/skills')),
      readJson(await fetch('api/capabilities')),
    ])
    setKnowledge(knowledgePayload)
    setContent(contentPayload)
    setSkills(skillsPayload)
    setCapabilities(capabilitiesPayload)
  }, [])

  useEffect(() => {
    if (!open) return undefined
    setModeDraft(runtime?.frontendMode || 'cascade')
    setTtsDraft({
      provider: runtime?.cascade?.ttsProvider || 'dashscope',
      model: runtime?.cascade?.tts || '',
      voice: runtime?.cascade?.voice || runtime?.realtimeVoice || '',
    })
    setError('')
    let cancelled = false
    Promise.all([
      refreshMemories(),
      refreshNotes(),
      refreshReminders(),
      refreshLibraries(),
    ]).catch(err => {
      if (!cancelled) setError(err.message)
    })
    return () => {
      cancelled = true
    }
  }, [
    open,
    runtime?.frontendMode,
    runtime?.cascade?.ttsProvider,
    runtime?.cascade?.tts,
    runtime?.cascade?.voice,
    runtime?.realtimeVoice,
    refreshMemories,
    refreshNotes,
    refreshReminders,
    refreshLibraries,
  ])

  if (!open) return null

  const run = async (fn) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const switchMode = async () => {
    if (!modeDraft || modeDraft === runtime?.frontendMode) return
    await run(async () => {
      onModeSwitching?.(true)
      try {
        await readJson(await fetch('api/runtime/mode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: modeDraft }),
        }))
        const next = await waitForHealth(health => health.frontendMode === modeDraft)
        onRuntimeChange?.(next)
        onClose?.()
      } finally {
        onModeSwitching?.(false)
      }
    })
  }

  const applyTts = async () => {
    await run(async () => {
      onModeSwitching?.(true)
      try {
        await readJson(await fetch('api/runtime/cascade-tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ttsDraft),
        }))
        const next = await waitForHealth(health => (
          health.frontendMode === 'cascade'
          && (!ttsDraft.provider || health.cascade?.ttsProvider === ttsDraft.provider)
        ))
        onRuntimeChange?.(next)
      } finally {
        onModeSwitching?.(false)
      }
    })
  }

  const createMemory = async () => {
    await run(async () => {
      await readJson(await fetch('api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(memoryDraft),
      }))
      setMemoryDraft(current => ({ ...current, content: '' }))
      await refreshMemories()
      onRuntimeChange?.(await readJson(await fetch('api/health')))
    })
  }

  const saveMemoryEdit = async (id) => {
    await run(async () => {
      await readJson(await fetch(`api/memory/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editingMemoryContent }),
      }))
      setEditingMemoryId('')
      await refreshMemories()
    })
  }

  const deleteMemory = async (id) => {
    await run(async () => {
      await readJson(await fetch(`api/memory/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }))
      await refreshMemories()
      onRuntimeChange?.(await readJson(await fetch('api/health')))
    })
  }

  const clearLongTerm = async () => {
    if (!window.confirm('确认清空全部长期记忆？档案（profile）不会被删除。')) {
      return
    }
    await run(async () => {
      await readJson(await fetch('api/memory?confirm=true', { method: 'DELETE' }))
      await refreshMemories()
      onRuntimeChange?.(await readJson(await fetch('api/health')))
    })
  }

  const addNoteItems = async () => {
    const items = noteItemDraft.split(/[,，\n]/).map(item => item.trim()).filter(Boolean)
    if (!items.length) return
    await run(async () => {
      await readJson(await fetch('api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add',
          list: activeList || noteListDraft,
          items,
        }),
      }))
      setNoteItemDraft('')
      await refreshNotes(activeList || noteListDraft)
    })
  }

  const removeNoteItem = async (text) => {
    await run(async () => {
      await readJson(await fetch('api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'remove',
          list: activeList,
          items: [text],
        }),
      }))
      await refreshNotes(activeList)
    })
  }

  const clearOrDropList = async (action) => {
    if (!activeList) return
    const label = action === 'drop' ? '删除整个清单' : '清空清单条目'
    if (!window.confirm(`确认${label}「${activeList}」？`)) return
    await run(async () => {
      await readJson(await fetch('api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, list: activeList }),
      }))
      await refreshNotes(action === 'drop' ? '' : activeList)
    })
  }

  const createReminder = async () => {
    const executeAt = reminderDraft.executeAt
      ? new Date(reminderDraft.executeAt).toISOString()
      : ''
    await run(async () => {
      await readJson(await fetch('api/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          execute_at: executeAt,
          reminder: reminderDraft.reminder,
          recurrence: reminderDraft.recurrence,
        }),
      }))
      setReminderDraft(current => ({ ...current, reminder: '' }))
      await refreshReminders()
    })
  }

  const cancelReminder = async (id) => {
    await run(async () => {
      await readJson(await fetch(`api/reminders/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }))
      await refreshReminders()
    })
  }

  const searchKnowledge = async () => {
    await run(async () => {
      const payload = await readJson(await fetch('api/knowledge/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: knowledgeQuery }),
      }))
      setKnowledgeHits(payload.hits || [])
    })
  }

  const reindexKnowledge = async () => {
    await run(async () => {
      await readJson(await fetch('api/knowledge/reindex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }))
      await refreshLibraries()
    })
  }

  const controlReader = async (action, extra = {}) => {
    await run(async () => {
      const payload = await readJson(await fetch('api/content/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      }))
      if (payload.progress) {
        setContent(current => ({
          ...(current || {}),
          reader: payload.progress,
        }))
      }
      await refreshLibraries()
    })
  }

  return (
    <div className="settings-drawer" role="dialog" aria-label="语音设置">
      <div className="settings-panel settings-panel-wide">
        <header>
          <h2>语音设置</h2>
          <button className="ghost" onClick={onClose} disabled={busy}>关闭</button>
        </header>

        <nav className="settings-tabs" aria-label="设置分区">
          {SECTIONS.map(item => (
            <button
              key={item.id}
              type="button"
              className={section === item.id ? 'active' : ''}
              disabled={busy}
              onClick={() => setSection(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {section === 'mode' && (
          <section>
            <h3>高级：切换前台模式</h3>
            <p>
              Fork 能力：会写入配置并<strong>重启 Gateway</strong>。
            </p>
            <label className="mode-option">
              <input
                type="radio"
                name="frontend-mode"
                checked={modeDraft === 'cascade'}
                onChange={() => setModeDraft('cascade')}
                disabled={busy}
              />
              <span>
                <b>级联 cascade（推荐）</b>
                <small>{cascadeVoiceHint(runtime)}</small>
              </span>
            </label>
            <label className="mode-option">
              <input
                type="radio"
                name="frontend-mode"
                checked={modeDraft === 's2s'}
                onChange={() => setModeDraft('s2s')}
                disabled={busy}
              />
              <span>
                <b>S2S（低延迟旁路）</b>
                <small>{s2sVoiceHint(runtime)}</small>
              </span>
            </label>
            <button
              className="primary"
              disabled={busy || modeDraft === runtime?.frontendMode}
              onClick={switchMode}
            >
              {busy ? '切换中…' : '应用并重启 Gateway'}
            </button>
            <p className="voice-line">
              <b>{runtime?.realtimeVoiceLabel || '未配置'}</b>
              <small>{runtime?.realtimeVoice || ''}</small>
            </p>
          </section>
        )}

        {section === 'tts' && (
          <section>
            <h3>Cascade TTS</h3>
            {runtime?.frontendMode !== 'cascade' ? (
              <p className="hint">当前非 cascade 模式，请先切换模式。</p>
            ) : (
              <>
                <label className="settings-field">
                  <span>Provider</span>
                  <select
                    value={ttsDraft.provider}
                    disabled={busy}
                    onChange={event => setTtsDraft(current => ({
                      ...current,
                      provider: event.target.value,
                    }))}
                  >
                    {TTS_PROVIDERS.map(id => (
                      <option key={id} value={id}>{id}</option>
                    ))}
                  </select>
                </label>
                <label className="settings-field">
                  <span>Model</span>
                  <input
                    value={ttsDraft.model}
                    disabled={busy}
                    onChange={event => setTtsDraft(current => ({
                      ...current,
                      model: event.target.value,
                    }))}
                    placeholder="qwen-audio-3.0-tts-flash"
                  />
                </label>
                <label className="settings-field">
                  <span>Voice ID</span>
                  <input
                    value={ttsDraft.voice}
                    disabled={busy}
                    onChange={event => setTtsDraft(current => ({
                      ...current,
                      voice: event.target.value,
                    }))}
                    placeholder="音色 ID"
                  />
                </label>
                <button className="primary" disabled={busy} onClick={applyTts}>
                  {busy ? '应用中…' : '应用 TTS 并重启'}
                </button>
              </>
            )}
          </section>
        )}

        {section === 'memory' && (
          <section>
            <div className="section-head">
              <h3>记忆</h3>
              <button
                className="ghost danger-text"
                disabled={busy || !memories.some(item => item.scope !== 'profile')}
                onClick={clearLongTerm}
              >
                清空长期记忆
              </button>
            </div>
            <p>
              Provider：{runtime?.memoryProvider || runtime?.frontendMemory?.kind || 'local'}
            </p>
            <div className="settings-chip-row">
              {MEMORY_SCOPES.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className={memoryScope === item.id ? 'chip active' : 'chip'}
                  disabled={busy}
                  onClick={() => {
                    setMemoryScope(item.id)
                    run(async () => refreshMemories(item.id))
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="settings-inline-form">
              <select
                value={memoryDraft.scope}
                disabled={busy}
                onChange={event => setMemoryDraft(current => ({
                  ...current,
                  scope: event.target.value,
                }))}
              >
                <option value="long_term">长期</option>
                <option value="rules">约定</option>
                <option value="profile">档案</option>
              </select>
              <input
                value={memoryDraft.content}
                disabled={busy}
                placeholder="记住一条内容"
                onChange={event => setMemoryDraft(current => ({
                  ...current,
                  content: event.target.value,
                }))}
              />
              <button
                className="primary"
                disabled={busy || !memoryDraft.content.trim()}
                onClick={createMemory}
              >
                添加
              </button>
            </div>
            {!memories.length && <div className="empty-memories">暂无记忆</div>}
            <ul className="memory-list">
              {memories.map(memory => (
                <li key={memory.id}>
                  <div>
                    <b>{scopeLabel(memory.scope)}</b>
                    {editingMemoryId === memory.id ? (
                      <input
                        value={editingMemoryContent}
                        disabled={busy}
                        onChange={event => setEditingMemoryContent(event.target.value)}
                      />
                    ) : (
                      <span>{memory.content}</span>
                    )}
                  </div>
                  <div className="row-actions">
                    {editingMemoryId === memory.id ? (
                      <>
                        <button className="ghost" disabled={busy} onClick={() => saveMemoryEdit(memory.id)}>
                          保存
                        </button>
                        <button className="ghost" disabled={busy} onClick={() => setEditingMemoryId('')}>
                          取消
                        </button>
                      </>
                    ) : (
                      <>
                        {memory.editable !== false && (
                          <button
                            className="ghost"
                            disabled={busy}
                            onClick={() => {
                              setEditingMemoryId(memory.id)
                              setEditingMemoryContent(memory.content || '')
                            }}
                          >
                            编辑
                          </button>
                        )}
                        {memory.editable !== false && (
                          <button className="ghost" disabled={busy} onClick={() => deleteMemory(memory.id)}>
                            删除
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {section === 'notes' && (
          <section>
            <h3>清单</h3>
            <div className="settings-inline-form">
              <input
                value={noteListDraft}
                disabled={busy}
                placeholder="清单名"
                onChange={event => setNoteListDraft(event.target.value)}
              />
              <button
                className="ghost"
                disabled={busy || !noteListDraft.trim()}
                onClick={() => {
                  setActiveList(noteListDraft.trim())
                  run(async () => refreshNotes(noteListDraft.trim()))
                }}
              >
                打开/新建
              </button>
            </div>
            <div className="settings-chip-row">
              {notesLists.map(item => (
                <button
                  key={item.list}
                  type="button"
                  className={activeList === item.list ? 'chip active' : 'chip'}
                  disabled={busy}
                  onClick={() => run(async () => refreshNotes(item.list))}
                >
                  {item.list} ({item.count})
                </button>
              ))}
            </div>
            {activeList && (
              <>
                <div className="settings-inline-form">
                  <input
                    value={noteItemDraft}
                    disabled={busy}
                    placeholder="条目，逗号分隔"
                    onChange={event => setNoteItemDraft(event.target.value)}
                  />
                  <button className="primary" disabled={busy || !noteItemDraft.trim()} onClick={addNoteItems}>
                    添加
                  </button>
                </div>
                <div className="row-actions">
                  <button className="ghost" disabled={busy} onClick={() => clearOrDropList('clear')}>
                    清空条目
                  </button>
                  <button className="ghost danger-text" disabled={busy} onClick={() => clearOrDropList('drop')}>
                    删除清单
                  </button>
                </div>
                <ul className="memory-list">
                  {noteItems.map(item => (
                    <li key={item.id}>
                      <div>
                        <b>条目</b>
                        <span>{item.text}</span>
                      </div>
                      <button className="ghost" disabled={busy} onClick={() => removeNoteItem(item.text)}>
                        划掉
                      </button>
                    </li>
                  ))}
                </ul>
                {!noteItems.length && <div className="empty-memories">清单为空</div>}
              </>
            )}
            {!notesLists.length && !activeList && (
              <div className="empty-memories">暂无清单</div>
            )}
          </section>
        )}

        {section === 'reminders' && (
          <section>
            <h3>提醒</h3>
            <div className="settings-stack-form">
              <label className="settings-field">
                <span>时间</span>
                <input
                  type="datetime-local"
                  value={reminderDraft.executeAt}
                  disabled={busy}
                  onChange={event => setReminderDraft(current => ({
                    ...current,
                    executeAt: event.target.value,
                  }))}
                />
              </label>
              <label className="settings-field">
                <span>内容</span>
                <input
                  value={reminderDraft.reminder}
                  disabled={busy}
                  placeholder="到点提醒我…"
                  onChange={event => setReminderDraft(current => ({
                    ...current,
                    reminder: event.target.value,
                  }))}
                />
              </label>
              <label className="settings-field">
                <span>重复</span>
                <select
                  value={reminderDraft.recurrence}
                  disabled={busy}
                  onChange={event => setReminderDraft(current => ({
                    ...current,
                    recurrence: event.target.value,
                  }))}
                >
                  <option value="once">一次</option>
                  <option value="daily">每天</option>
                  <option value="weekly">每周</option>
                  <option value="weekdays">工作日</option>
                </select>
              </label>
              <button
                className="primary"
                disabled={busy || !reminderDraft.reminder.trim()}
                onClick={createReminder}
              >
                创建提醒
              </button>
            </div>
            <ul className="memory-list">
              {reminders.map(item => (
                <li key={item.id}>
                  <div>
                    <b>{item.kind === 'scheduled_task' ? '定时任务' : '提醒'}</b>
                    <span>
                      {item.objective}
                      {' · '}
                      {item.schedule?.at
                        ? new Date(item.schedule.at).toLocaleString()
                        : '未排程'}
                      {item.schedule?.recurrence && item.schedule.recurrence !== 'once'
                        ? ` · ${item.schedule.recurrence}`
                        : ''}
                    </span>
                  </div>
                  <button className="ghost" disabled={busy} onClick={() => cancelReminder(item.id)}>
                    取消
                  </button>
                </li>
              ))}
            </ul>
            {!reminders.length && <div className="empty-memories">暂无待提醒</div>}
          </section>
        )}

        {section === 'knowledge' && (
          <section>
            <h3>知识库</h3>
            <p className="hint">
              {knowledge?.health?.knowledgeDir || '未配置'}
              {' · '}
              {knowledge?.count ?? 0} 篇
            </p>
            <div className="settings-inline-form">
              <input
                value={knowledgeQuery}
                disabled={busy}
                placeholder="试搜知识库"
                onChange={event => setKnowledgeQuery(event.target.value)}
              />
              <button
                className="primary"
                disabled={busy || !knowledgeQuery.trim()}
                onClick={searchKnowledge}
              >
                搜索
              </button>
              <button className="ghost" disabled={busy} onClick={reindexKnowledge}>
                重建索引
              </button>
            </div>
            {!!knowledgeHits.length && (
              <ul className="memory-list">
                {knowledgeHits.map(hit => (
                  <li key={`${hit.id}:${hit.heading || ''}`}>
                    <div>
                      <b>{hit.title || hit.relativePath || hit.id}</b>
                      <span>{hit.content}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <ul className="memory-list">
              {(knowledge?.sources || []).slice(0, 8).map(source => (
                <li key={`${source.kbId}:${source.id}`}>
                  <div>
                    <b>{source.kbId || 'default'}</b>
                    <span>{source.relativePath || source.title}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {section === 'reader' && (
          <section>
            <h3>朗读</h3>
            <p className="hint">
              {content?.health?.contentDir || '未配置'}
              {' · '}
              进度 {content?.reader?.status || runtime?.reader?.status || 'idle'}
              {typeof content?.reader?.index === 'number' && (
                <> · {content.reader.index}/{content.reader.total}</>
              )}
            </p>
            <div className="row-actions">
              <button className="ghost" disabled={busy} onClick={() => controlReader('pause')}>暂停</button>
              <button className="ghost" disabled={busy} onClick={() => controlReader('resume')}>继续</button>
              <button className="ghost" disabled={busy} onClick={() => controlReader('stop')}>停止</button>
            </div>
            <ul className="memory-list">
              {(content?.contents || []).slice(0, 12).map(item => (
                <li key={item.id}>
                  <div>
                    <b>md</b>
                    <span>{item.relativePath || item.title}</span>
                  </div>
                  <button
                    className="ghost"
                    disabled={busy}
                    onClick={() => controlReader('start_read', { content_id: item.id })}
                  >
                    朗读
                  </button>
                </li>
              ))}
            </ul>
            {!content?.contents?.length && (
              <div className="empty-memories">暂无可读 md</div>
            )}
          </section>
        )}

        {section === 'skills' && (
          <section>
            <h3>Skills / Capabilities</h3>
            <p className="hint">
              工具 {capabilities?.toolCount ?? skills?.tools?.length ?? 0}
              {' · '}
              Skills {skills?.count ?? 0}
              {' · '}
              MCP {skills?.mcp?.toolCount ?? 0}
            </p>
            <h3>Skills</h3>
            <ul className="memory-list">
              {(skills?.skills || []).map(skill => (
                <li key={skill.name}>
                  <div>
                    <b>{skill.name}</b>
                    <span>{skill.description || skill.source || 'skill'}</span>
                  </div>
                </li>
              ))}
            </ul>
            {!skills?.skills?.length && <div className="empty-memories">暂无 Skills</div>}
            <h3>Tools</h3>
            <ul className="memory-list">
              {(capabilities?.tools || skills?.tools || []).map(tool => (
                <li key={`${tool.source || 'tool'}:${tool.name}`}>
                  <div>
                    <b>{tool.name}</b>
                    <span>{tool.source || 'builtin'} · {tool.description || ''}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {error && <p className="settings-error">{error}</p>}
      </div>
      <button className="settings-backdrop" aria-label="关闭设置" onClick={onClose} />
    </div>
  )
}
