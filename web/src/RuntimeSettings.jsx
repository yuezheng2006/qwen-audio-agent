import { useCallback, useEffect, useState } from 'react'

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

export default function RuntimeSettings({
  open,
  onClose,
  runtime,
  onRuntimeChange,
  onModeSwitching,
}) {
  const [memories, setMemories] = useState([])
  const [knowledge, setKnowledge] = useState(null)
  const [content, setContent] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [modeDraft, setModeDraft] = useState(runtime?.frontendMode || 'cascade')

  const refreshMemories = useCallback(async () => {
    const payload = await readJson(await fetch('api/memory'))
    setMemories(payload.memories || [])
  }, [])

  const refreshLibraries = useCallback(async () => {
    const [knowledgePayload, contentPayload] = await Promise.all([
      readJson(await fetch('api/knowledge')),
      readJson(await fetch('api/content')),
    ])
    setKnowledge(knowledgePayload)
    setContent(contentPayload)
  }, [])

  useEffect(() => {
    if (!open) return undefined
    setModeDraft(runtime?.frontendMode || 'cascade')
    setError('')
    let cancelled = false
    Promise.all([refreshMemories(), refreshLibraries()]).catch(err => {
      if (!cancelled) setError(err.message)
    })
    return () => {
      cancelled = true
    }
  }, [open, runtime?.frontendMode, refreshMemories, refreshLibraries])

  if (!open) return null

  const switchMode = async () => {
    if (!modeDraft || modeDraft === runtime?.frontendMode) return
    setBusy(true)
    setError('')
    try {
      onModeSwitching?.(true)
      await readJson(await fetch('api/runtime/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: modeDraft }),
      }))
      const deadline = Date.now() + 25000
      let next = null
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 500))
        try {
          const health = await readJson(await fetch('api/health'))
          if (health.frontendMode === modeDraft) {
            next = health
            break
          }
        } catch {
          // gateway restarting
        }
      }
      if (!next) throw new Error('模式切换超时，请稍后刷新页面')
      onRuntimeChange?.(next)
      onClose?.()
    } catch (err) {
      setError(err.message)
    } finally {
      onModeSwitching?.(false)
      setBusy(false)
    }
  }

  const deleteMemory = async (id) => {
    setBusy(true)
    setError('')
    try {
      await readJson(await fetch(`api/memory/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }))
      await refreshMemories()
      onRuntimeChange?.(await readJson(await fetch('api/health')))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const clearLongTerm = async () => {
    if (!window.confirm('确认清空全部长期记忆？档案（profile）不会被删除。')) {
      return
    }
    setBusy(true)
    setError('')
    try {
      await readJson(await fetch('api/memory?confirm=true', { method: 'DELETE' }))
      await refreshMemories()
      onRuntimeChange?.(await readJson(await fetch('api/health')))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-drawer" role="dialog" aria-label="语音设置">
      <div className="settings-panel">
        <header>
          <h2>语音设置</h2>
          <button className="ghost" onClick={onClose} disabled={busy}>关闭</button>
        </header>

        <section>
          <h3>高级：切换前台模式</h3>
          <p>
            Fork 能力：会写入配置并<strong>重启 Gateway</strong>。
            常规用法请保持当前模式；仅本页切换会话引擎见 Header「会话前台引擎」。
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
        </section>

        <section>
          <h3>当前音色</h3>
          <p className="voice-line">
            <b>{runtime?.realtimeVoiceLabel || '未配置'}</b>
            <small>{runtime?.realtimeVoice || ''}</small>
          </p>
          {runtime?.frontendMode === 'cascade' && (
            <p className="hint">
              STT {runtime?.cascade?.stt || '—'}
              {' · '}
              TTS {runtime?.cascade?.ttsProvider || '—'}
              {' / '}
              {runtime?.cascade?.tts || '—'}
            </p>
          )}
        </section>

        <section>
          <h3>知识库（只读）</h3>
          <p>
            本地 <code>.md</code> 资料状态。导入与重建索引请用 CLI
            （如知识目录落盘后由 Gateway 侧重建），此处不可编辑。
          </p>
          <p className="hint">
            {knowledge?.health?.knowledgeDir || '未配置'}
            {' · '}
            {knowledge?.count ?? 0} 篇
            {knowledge?.health?.warning ? ` · ${knowledge.health.warning}` : ''}
          </p>
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
          {!knowledge?.sources?.length && (
            <div className="empty-memories">暂无 md 知识文件</div>
          )}
        </section>

        <section>
          <h3>朗读内容（只读）</h3>
          <p>
            本地 <code>.md</code> 与朗读进度。导入用
            {' '}
            <code>npm run content:import</code>
            ；进度靠语音「读/继续」控制，此处不可编辑。
          </p>
          <p className="hint">
            {content?.health?.contentDir || '未配置'}
            {' · '}
            进度 {content?.reader?.status || runtime?.reader?.status || 'idle'}
            {typeof content?.reader?.index === 'number' && (
              <> · {content.reader.index}/{content.reader.total}</>
            )}
          </p>
          <ul className="memory-list">
            {(content?.contents || []).slice(0, 8).map(item => (
              <li key={item.id}>
                <div>
                  <b>md</b>
                  <span>{item.relativePath || item.title}</span>
                </div>
              </li>
            ))}
          </ul>
          {!content?.contents?.length && (
            <div className="empty-memories">暂无可读 md</div>
          )}
        </section>

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
            {runtime?.frontendMemory?.format
              ? ` · ${runtime.frontendMemory.format}`
              : ''}
            {runtime?.frontendMemory?.online === false ? ' · 远程离线(本地 md)' : ''}
          </p>
          <p>支持 local / openviking / evermind / mem0；写入仍靠对话「记住」。</p>
          {!memories.length && <div className="empty-memories">暂无记忆</div>}
          <ul className="memory-list">
            {memories.map(memory => (
              <li key={memory.id}>
                <div>
                  <b>{memory.scope === 'profile' ? '档案' : '长期'}</b>
                  <span>{memory.content}</span>
                </div>
                {memory.editable !== false && (
                  <button
                    className="ghost"
                    disabled={busy}
                    onClick={() => deleteMemory(memory.id)}
                  >
                    删除
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>

        {error && <p className="settings-error">{error}</p>}
      </div>
      <button className="settings-backdrop" aria-label="关闭设置" onClick={onClose} />
    </div>
  )
}
