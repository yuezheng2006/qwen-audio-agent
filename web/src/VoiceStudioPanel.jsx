import { useCallback, useEffect, useRef, useState } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import VoiceGallery from './VoiceGallery.jsx'
import MediaWorkspacePanel from './MediaWorkspacePanel.jsx'
import ModelCataloguePanel from './ModelCataloguePanel.jsx'
import {
  VOICE_STUDIO_TILES,
  resolveVoiceStudioView,
} from './voice-studio-launchpad.js'
import {
  blobToDataUrl,
  clampClipRange,
  encodeWav,
  formatRecordingTime,
  selectRecorderMimeType,
} from './voice-recorder.js'

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

function RecordingClipEditor({ onSampleReady }) {
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [duration, setDuration] = useState(0)
  const [clip, setClip] = useState({ start: 0, end: 0 })
  const [rawUrl, setRawUrl] = useState('')
  const [clipUrl, setClipUrl] = useState('')
  const [rawBlob, setRawBlob] = useState(null)
  const [sampleBlob, setSampleBlob] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const recorderRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)

  useEffect(() => () => {
    clearInterval(timerRef.current)
    streamRef.current?.getTracks().forEach(track => track.stop())
    if (rawUrl) URL.revokeObjectURL(rawUrl)
    if (clipUrl) URL.revokeObjectURL(clipUrl)
  }, [rawUrl, clipUrl])

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
  }

  const startRecording = async () => {
    setError('')
    if (!globalThis.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
      setError('当前浏览器不支持录音，请使用最新版 Chrome、Safari 或 Edge。')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = selectRecorderMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []
      streamRef.current = stream
      recorderRef.current = recorder
      recorder.ondataavailable = event => {
        if (event.data.size) chunksRef.current.push(event.data)
      }
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        const url = URL.createObjectURL(blob)
        setRawUrl(current => {
          if (current) URL.revokeObjectURL(current)
          return url
        })
        const audio = new Audio(url)
        audio.onloadedmetadata = () => {
          const nextDuration = Number.isFinite(audio.duration) ? audio.duration : elapsed
          setDuration(nextDuration)
          setClip({ start: 0, end: nextDuration })
        }
        setRawBlob(blob)
        setSampleBlob(blob)
        setClipUrl('')
        setRecording(false)
        stopTracks()
      }
      recorder.start(250)
      setElapsed(0)
      setRecording(true)
      clearInterval(timerRef.current)
      timerRef.current = setInterval(() => setElapsed(value => value + 1), 1000)
    } catch (err) {
      stopTracks()
      setError(err?.name === 'NotAllowedError'
        ? '录音权限被拒绝，请在浏览器设置中允许麦克风。'
        : '无法开始录音，请检查麦克风设备。')
    }
  }

  const stopRecording = () => {
    clearInterval(timerRef.current)
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }

  const setClipValue = (key, value) => {
    const next = clampClipRange(
      key === 'start' ? value : clip.start,
      key === 'end' ? value : clip.end,
      duration,
    )
    setClip(next)
  }

  const previewClip = async () => {
    if (!rawBlob || !duration) return
    setBusy(true)
    setError('')
    try {
      const AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext
      if (!AudioContextCtor) throw new Error('audio_context_unavailable')
      const context = new AudioContextCtor()
      const buffer = await context.decodeAudioData(await rawBlob.arrayBuffer())
      const wav = encodeWav(buffer, clip.start, clip.end)
      await context.close()
      const url = URL.createObjectURL(wav)
      setClipUrl(current => {
        if (current) URL.revokeObjectURL(current)
        return url
      })
      setSampleBlob(wav)
      onSampleReady?.(wav, clip)
    } catch {
      setError('录音格式无法解析，请重新录制。')
    } finally {
      setBusy(false)
    }
  }

  const downloadClip = () => {
    if (!sampleBlob) return
    const link = document.createElement('a')
    link.href = clipUrl || URL.createObjectURL(sampleBlob)
    link.download = 'qwen-audio-voice-sample.wav'
    link.click()
    if (!clipUrl) URL.revokeObjectURL(link.href)
  }

  return (
    <section className="voice-recorder" aria-label="录制声音样本">
      <div className="voice-recorder-heading">
        <div>
          <strong>录一段你的声音</strong>
          <p>建议 5–15 秒，安静环境下自然说话。</p>
        </div>
        <span className={recording ? 'recording-indicator live' : 'recording-indicator'}>
          {recording ? `录音中 ${formatRecordingTime(elapsed)}` : duration ? `样本 ${formatRecordingTime(duration)}` : '未录音'}
        </span>
      </div>
      <div className="voice-recorder-actions">
        <button
          type="button"
          className={recording ? 'voice-danger-btn' : 'voice-primary-btn'}
          onClick={recording ? stopRecording : startRecording}
        >
          <span className="record-dot" aria-hidden="true" />
          {recording ? '停止录音' : '开始录音'}
        </button>
        {rawUrl && <audio controls src={clipUrl || rawUrl} />}
      </div>
      {duration > 0 && !recording && (
        <div className="voice-clip-editor">
          <div className="voice-clip-track" aria-hidden="true">
            <span style={{ left: `${(clip.start / duration) * 100}%`, right: `${100 - (clip.end / duration) * 100}%` }} />
          </div>
          <label>
            起点 <input type="range" min="0" max={duration} step="0.01" value={clip.start} onChange={event => setClipValue('start', event.target.value)} />
            <output>{clip.start.toFixed(1)}s</output>
          </label>
          <label>
            终点 <input type="range" min="0" max={duration} step="0.01" value={clip.end} onChange={event => setClipValue('end', event.target.value)} />
            <output>{clip.end.toFixed(1)}s</output>
          </label>
          <div className="voice-clip-actions">
            <button type="button" className="voice-secondary-btn" disabled={busy || clip.end <= clip.start} onClick={previewClip}>
              {busy ? '处理中…' : '应用裁剪并试听'}
            </button>
            <button type="button" className="voice-text-btn" disabled={!sampleBlob} onClick={downloadClip}>下载 WAV</button>
          </div>
        </div>
      )}
      {error && <p className="settings-error">{error}</p>}
    </section>
  )
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
  const [sampleBlob, setSampleBlob] = useState(null)
  const [sampleReady, setSampleReady] = useState(false)
  const [label, setLabel] = useState('我的声音')

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

  const run = async operation => {
    setBusy(true)
    setError('')
    try {
      await operation()
    } catch (err) {
      setError(err?.message || '操作失败，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  const cloneRecordedVoice = async () => {
    if (!sampleBlob) return
    await run(async () => {
      const sample = await blobToDataUrl(sampleBlob)
      const result = await readJson(await fetch('api/voice/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: ttsDraft.provider,
          label,
          target_model: ttsDraft.model,
          sample_data_url: sample,
        }),
      }))
      setSampleReady(false)
      if (result.profile) setError(`音色已创建：${result.profile.label || label}，请到声音库确认并启用。`)
      await refreshCaps()
    })
  }

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

      <RecordingClipEditor onSampleReady={(blob) => {
        setSampleBlob(blob)
        setSampleReady(true)
      }} />

      <div className="voice-clone-form voice-recorded-clone-form">
        <p className="voice-clone-form-label">用裁剪后的录音提取音色</p>
        <label className="voice-field">
          <span>名称</span>
          <input value={label} disabled={busy} onChange={event => setLabel(event.target.value)} />
        </label>
        <button
          className="voice-primary-btn voice-clone-submit"
          type="button"
          disabled={busy || !sampleReady || !sampleBlob}
          onClick={cloneRecordedVoice}
        >
          {busy ? '提取中…' : '开始提取音色'}
        </button>
      </div>

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
  if (tile.status === 'live') return '打开'
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
      : view === 'dub'
        ? '视频配音'
        : view === 'catalogue'
          ? '模型目录'
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
    if (tile.status === 'jump' && tile.jump === 'catalogue') {
      setView('catalogue')
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

        <Tabs.Root
          className="voice-studio-tabs"
          value={view}
          onValueChange={setView}
        >
          <Tabs.List aria-label="语音工作室工作区">
            <Tabs.Trigger value="launchpad">工作室</Tabs.Trigger>
            <Tabs.Trigger value="gallery">声音库</Tabs.Trigger>
            <Tabs.Trigger value="clone">克隆</Tabs.Trigger>
            <Tabs.Trigger value="dub">配音</Tabs.Trigger>
            <Tabs.Trigger value="catalogue">模型</Tabs.Trigger>
          </Tabs.List>
        </Tabs.Root>

        {view === 'launchpad' && (
          <div className="voice-studio-body">
            <p className="voice-studio-lead">你想用声音做什么？</p>
            <p className="voice-studio-sublead">从一个简单任务开始，随时可以返回继续聊天。</p>
            <div className="voice-studio-launchpad" role="list">
              {VOICE_STUDIO_TILES.filter(tile => tile.status !== 'soon').map(tile => (
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
        {view === 'dub' && <MediaWorkspacePanel open={open && view === 'dub'} />}
        {view === 'catalogue' && <ModelCataloguePanel />}
      </div>
    </div>
  )
}
