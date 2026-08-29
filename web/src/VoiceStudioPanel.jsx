import { useCallback, useEffect, useState } from 'react'
import VoiceGallery from './VoiceGallery.jsx'
import {
  VOICE_STUDIO_TILES,
  resolveVoiceStudioView,
} from './voice-studio-launchpad.js'

const TTS_PROVIDERS = ['dashscope', 'voicebox', 'fish', 'listenhub', 'minimax']

async function readJson(response) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload.error || `请求失败（${response.status}）`)
  }
  return payload
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

function qualityTipsFrom(voiceCapabilities) {
  const dash = voiceCapabilities?.providers?.find(item => item.id === 'dashscope')
  const tips = dash?.quality_tips || voiceCapabilities?.providers?.[0]?.quality_tips
  return Array.isArray(tips) ? tips : []
}

function ClonePage({
  open,
  runtime,
  onRuntimeChange,
  onModeSwitching,
}) {
  const [ttsDraft, setTtsDraft] = useState({
    provider: runtime?.cascade?.ttsProvider || 'dashscope',
    model: runtime?.cascade?.tts || '',
    voice: runtime?.cascade?.voice || runtime?.realtimeVoice || '',
  })
  const [voiceCapabilities, setVoiceCapabilities] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refreshCaps = useCallback(async () => {
    const res = await fetch('api/voice/capabilities')
    if (res.status === 503) {
      setVoiceCapabilities(null)
      return
    }
    if (res.ok) {
      setVoiceCapabilities(await res.json().catch(() => null))
    }
  }, [])

  useEffect(() => {
    if (!open) return undefined
    setTtsDraft({
      provider: runtime?.cascade?.ttsProvider || 'dashscope',
      model: runtime?.cascade?.tts || '',
      voice: runtime?.cascade?.voice || runtime?.realtimeVoice || '',
    })
    setError('')
    let cancelled = false
    refreshCaps().catch(err => {
      if (!cancelled) setError(err.message)
    })
    return () => {
      cancelled = true
    }
  }, [
    open,
    runtime?.cascade?.ttsProvider,
    runtime?.cascade?.tts,
    runtime?.cascade?.voice,
    runtime?.realtimeVoice,
    refreshCaps,
  ])

  const applyTts = async () => {
    setBusy(true)
    setError('')
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
    } catch (err) {
      setError(err.message)
    } finally {
      onModeSwitching?.(false)
      setBusy(false)
    }
  }

  const tips = qualityTipsFrom(voiceCapabilities)

  return (
    <div className="voice-studio-body voice-clone-body">
      {error && <p className="settings-error">{error}</p>}

      <div className="voice-clone-callout">
        <strong>语音克隆</strong>
        <p>对助手说「克隆一个音色」，按提示录 5–15 秒即可。</p>
      </div>

      {!!tips.length && (
        <details className="voice-tips-fold">
          <summary>录音建议</summary>
          <ul>
            {tips.map(tip => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="voice-clone-form">
        <p className="voice-clone-form-label">或导入已有 Voice ID</p>
        <label className="voice-field">
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
        <label className="voice-field">
          <span>Model</span>
          <input
            value={ttsDraft.model}
            disabled={busy}
            onChange={event => setTtsDraft(current => ({
              ...current,
              model: event.target.value,
            }))}
            placeholder="qwen-audio-3.0-tts-flash"
            spellCheck={false}
          />
        </label>
        <label className="voice-field">
          <span>Voice ID</span>
          <input
            value={ttsDraft.voice}
            disabled={busy}
            onChange={event => setTtsDraft(current => ({
              ...current,
              voice: event.target.value,
            }))}
            placeholder="粘贴音色 ID"
            spellCheck={false}
          />
        </label>
        <button
          className="voice-primary-btn voice-clone-submit"
          type="button"
          disabled={busy || !String(ttsDraft.voice || '').trim()}
          onClick={applyTts}
        >
          {busy ? '应用中…' : '应用并重启'}
        </button>
      </div>
    </div>
  )
}

function statusLabel(tile) {
  if (tile.status === 'live') return '可用'
  if (tile.status === 'jump') return '设置'
  return '稍后'
}

export default function VoiceStudioPanel({
  open,
  onClose,
  runtime,
  onRuntimeChange,
  onModeSwitching,
  onOpenSettings,
  onOpenReading,
  initialView = 'launchpad',
}) {
  const [view, setView] = useState(() => resolveVoiceStudioView(initialView))

  useEffect(() => {
    if (!open) return
    setView(resolveVoiceStudioView(initialView))
  }, [open, initialView])

  if (!open) return null

  const title = view === 'gallery'
    ? '声音库'
    : view === 'clone'
      ? '克隆'
      : '语音工作室'

  const onTile = (tile) => {
    if (tile.status === 'soon') return
    if (tile.jump === 'reading') {
      onClose?.()
      onOpenReading?.('shelf')
      return
    }
    if (tile.status === 'jump' && tile.jump === 'mode') {
      onClose?.()
      onOpenSettings?.('mode')
      return
    }
    if (tile.view) setView(tile.view)
  }

  return (
    <div className="settings-drawer voice-studio-drawer" role="dialog" aria-label="语音工作室">
      <div className="settings-panel settings-panel-wide voice-studio-panel">
        <header className="voice-studio-header">
          <div className="voice-studio-header-main">
            {view !== 'launchpad' ? (
              <button
                type="button"
                className="voice-text-btn"
                onClick={() => setView('launchpad')}
              >
                ← 返回
              </button>
            ) : (
              <span className="voice-studio-kicker">Voice Studio</span>
            )}
            <h2>{title}</h2>
          </div>
          <button type="button" className="voice-text-btn" onClick={onClose}>
            关闭
          </button>
        </header>

        {view === 'launchpad' && (
          <div className="voice-studio-body">
            <p className="voice-studio-lead">选择能力进入工作区</p>
            <div className="voice-studio-launchpad" role="list">
              {VOICE_STUDIO_TILES.map(tile => (
                <button
                  key={tile.id}
                  type="button"
                  role="listitem"
                  className={[
                    'voice-studio-tile',
                    tile.status,
                  ].filter(Boolean).join(' ')}
                  disabled={tile.status === 'soon'}
                  onClick={() => onTile(tile)}
                >
                  <span className="voice-studio-tile-top">
                    <span className="voice-studio-tile-title">{tile.title}</span>
                    <span className={`voice-studio-tile-status ${tile.status}`}>
                      {statusLabel(tile)}
                    </span>
                  </span>
                  <span className="voice-studio-tile-blurb">{tile.blurb}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {view === 'gallery' && (
          <VoiceGallery
            open={open && view === 'gallery'}
            runtime={runtime}
            onRuntimeChange={onRuntimeChange}
            onModeSwitching={onModeSwitching}
          />
        )}

        {view === 'clone' && (
          <ClonePage
            open={open && view === 'clone'}
            runtime={runtime}
            onRuntimeChange={onRuntimeChange}
            onModeSwitching={onModeSwitching}
          />
        )}
      </div>
    </div>
  )
}
