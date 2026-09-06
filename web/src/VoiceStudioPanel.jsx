import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  FileText,
  History,
  Play,
  Plus,
  Search,
  SlidersHorizontal,
  Volume2,
} from 'lucide-react'
import VoiceGallery from './VoiceGallery.jsx'
import MediaWorkspacePanel from './MediaWorkspacePanel.jsx'
import ModelCataloguePanel from './ModelCataloguePanel.jsx'
import {
  friendlyVoiceName,
  organizeVoiceProfiles,
} from './voice-gallery.js'
import { resolveVoiceStudioView } from './voice-studio-launchpad.js'
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

function providerCapabilities(voiceCapabilities, provider) {
  return voiceCapabilities?.providers?.find(item => item.id === provider) || null
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
  const [sourceMode, setSourceMode] = useState('record')
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

  const acceptAudioBlob = blob => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    setRawUrl(current => {
      if (current) URL.revokeObjectURL(current)
      return url
    })
    const audio = new Audio(url)
    audio.preload = 'metadata'
    const setAudioDuration = () => {
      const nextDuration = Number.isFinite(audio.duration) ? audio.duration : elapsed
      setDuration(nextDuration)
      setClip({ start: 0, end: nextDuration })
    }
    audio.onloadedmetadata = setAudioDuration
    audio.onerror = () => setAudioDuration()
    setRawBlob(blob)
    setSampleBlob(blob)
    setClipUrl('')
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
        acceptAudioBlob(blob)
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

  const ingestAudioFile = event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('audio/') && !/\.(wav|mp3|m4a|flac|ogg|aac|webm)$/i.test(file.name)) {
      setError('请选择 WAV、MP3、M4A、FLAC、OGG 或 WebM 音频。')
      return
    }
    setError('')
    acceptAudioBlob(file)
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
      {!rawBlob && !recording && (
        <div className="voice-source-switch" role="tablist" aria-label="声音样本来源">
          <button type="button" role="tab" aria-selected={sourceMode === 'record'} className={sourceMode === 'record' ? 'active' : ''} onClick={() => setSourceMode('record')}>录音</button>
          <button type="button" role="tab" aria-selected={sourceMode === 'upload'} className={sourceMode === 'upload' ? 'active' : ''} onClick={() => setSourceMode('upload')}>上传音频</button>
        </div>
      )}
      {sourceMode === 'record' && (
        <div className="voice-recorder-actions">
          <button
            type="button"
            className={recording ? 'voice-danger-btn' : 'voice-primary-btn'}
            onClick={recording ? stopRecording : startRecording}
          >
            <span className="record-dot" aria-hidden="true" />
            {recording ? '停止录音' : '开始录音'}
          </button>
        </div>
      )}
      {sourceMode === 'upload' && !rawBlob && (
        <label className="voice-upload-dropzone">
          <input type="file" accept="audio/*,.wav,.mp3,.m4a,.flac,.ogg,.aac,.webm" onChange={ingestAudioFile} />
          <strong>选择或拖入音频文件</strong>
          <span>支持 WAV、MP3、M4A、FLAC、OGG、WebM</span>
        </label>
      )}
      {rawBlob && rawUrl && <audio className="voice-recorded-audio" controls src={clipUrl || rawUrl} />}
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
  const activeProvider = providerCapabilities(voiceCapabilities, ttsDraft.provider)

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

      {activeProvider?.sample_transport === 'public_url_required' && (
        <div className="voice-clone-requirement" role="status">
          <strong>还差一步：配置录音访问地址</strong>
          <p>当前 Provider 需要从公网读取录音。请先设置 <code>VOICE_SAMPLE_PUBLIC_BASE_URL</code>，再通过 HTTPS 隧道或反向代理暴露 Gateway。</p>
        </div>
      )}

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

function audioDataUrl(base64) {
  return `data:audio/wav;base64,${base64}`
}

function StudioWorkbench({ runtime, onOpenGallery, onOpenClone }) {
  const [profiles, setProfiles] = useState([])
  const [selectedProfile, setSelectedProfile] = useState(null)
  const [query, setQuery] = useState('')
  const [text, setText] = useState('')
  const [voiceMode, setVoiceMode] = useState('voice')
  const [history, setHistory] = useState([])
  const [historyFilter, setHistoryFilter] = useState('all')
  const [language, setLanguage] = useState('auto')
  const [steps, setSteps] = useState(16)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('api/voice/profiles')
      .then(response => response.ok ? response.json() : null)
      .then(payload => {
        if (cancelled || !payload) return
        const nextProfiles = organizeVoiceProfiles(payload.profiles || [], { showAll: true })
          .filter(profile => ['ready', 'confirmed'].includes(profile.status))
        setProfiles(nextProfiles)
        const activeId = payload.active?.voice
        const active = nextProfiles.find(profile => profile.remote_voice_id === activeId)
        // Do not silently turn the first gallery item into the active voice.
        // The Gateway may be using a local/system voice that has no profile.
        setSelectedProfile(active || null)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const visibleProfiles = profiles.filter(profile => {
    const value = [friendlyVoiceName(profile), profile.provider, profile.label]
      .join(' ')
      .toLowerCase()
    return value.includes(query.trim().toLowerCase())
  })
  const selectedName = selectedProfile ? friendlyVoiceName(selectedProfile) : (
    runtime?.cascade?.voiceLabel
      || runtime?.realtimeVoiceLabel
      || runtime?.cascade?.voice
      || '未选择声音'
  )

  const generateAudio = async () => {
    const draft = text.trim()
    if (!draft || !selectedProfile || busy) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch('api/voice/narrate', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: draft,
          profile_id: selectedProfile.id,
          voice: selectedProfile.remote_voice_id,
          ...(language !== 'auto' ? { language } : {}),
        }),
      })
      const payload = await readJson(response)
      const url = audioDataUrl(payload.audio_base64)
      setHistory(current => [{
        id: `${Date.now()}-${Math.random()}`,
        text: draft,
        voice: selectedName,
        url,
        createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }, ...current])
    } catch (err) {
      setError(err?.message || '生成音频失败，请检查声音配置。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="studio-workbench">
      <aside className="studio-voices-panel">
        <div className="studio-section-heading">
          <div>
            <span className="studio-eyebrow">当前声音</span>
            <strong>{selectedName}</strong>
          </div>
          <button type="button" className="studio-icon-button" onClick={onOpenGallery} aria-label="打开声音库">
            <ChevronDown size={16} aria-hidden="true" />
          </button>
        </div>
        <p className="studio-voice-hint">选择一个声音，或拖入音频创建新的声音。</p>

        <div className="studio-subheading"><span>设计的声音</span><button type="button" onClick={onOpenClone}><Plus size={14} /> 新建</button></div>
        <label className="studio-search">
          <Search size={14} aria-hidden="true" />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索…" />
        </label>
        <div className="studio-voice-list">
          {visibleProfiles.slice(0, 8).map(profile => {
            const active = selectedProfile?.id === profile.id
            return (
              <button
                type="button"
                key={profile.id}
                className={`studio-voice-option${active ? ' active' : ''}`}
                onClick={() => setSelectedProfile(profile)}
              >
                <span className="studio-voice-avatar">{friendlyVoiceName(profile).slice(0, 1)}</span>
                <span><strong>{friendlyVoiceName(profile)}</strong><small>{profile.provider || '本地音色'}</small></span>
              </button>
            )
          })}
          {!visibleProfiles.length && <div className="studio-empty-voices">还没有可用声音<br /><button type="button" onClick={onOpenClone}>创建我的声音</button></div>}
        </div>
        <div className="studio-left-empty">
          <strong>还没有设计声音</strong>
          <span>在这里创建或管理你的声音</span>
        </div>
      </aside>

      <main className="studio-editor-panel">
        <div className="studio-editor-heading"><span><FileText size={16} /> 文稿</span><button type="button" className="studio-quiet-button"><Plus size={14} /> 插入 <ChevronDown size={13} /></button></div>
        <textarea
          className="studio-script-editor"
          value={text}
          onChange={event => setText(event.target.value)}
          placeholder="在这里输入或粘贴要生成的文稿…"
          aria-label="文稿"
        />
        <div className="studio-synthesis-controls">
          <div className="studio-control-heading"><span><Volume2 size={16} /> 语音</span><div className="studio-segmented-control">
            <button type="button" className={voiceMode === 'voice' ? 'active' : ''} onClick={() => setVoiceMode('voice')}>从音频</button>
            <button type="button" className={voiceMode === 'design' ? 'active' : ''} onClick={() => setVoiceMode('design')}>通过设计</button>
            <button type="button" className={voiceMode === 'convert' ? 'active' : ''} onClick={() => setVoiceMode('convert')}>转换</button>
          </div></div>
          <input className="studio-style-input" placeholder="例如：中年男性，低音调，四川话" aria-label="声音描述" />
          <div className="studio-advanced-row">
            <label><span>◎</span><select value={language} onChange={event => setLanguage(event.target.value)}><option value="auto">Auto</option><option value="zh">中文</option><option value="en">English</option></select></label>
            <label className="studio-steps"><SlidersHorizontal size={15} /> 步数 <input type="range" min="4" max="32" value={steps} onChange={event => setSteps(event.target.value)} /><output>{steps}</output></label>
            <button type="button" className="studio-advanced-toggle" onClick={() => setAdvancedOpen(value => !value)}><SlidersHorizontal size={14} /> 高级参数 <ChevronDown className={advancedOpen ? 'up' : ''} size={14} /></button>
          </div>
          {advancedOpen && <div className="studio-advanced-panel">本地优先渲染 · {runtime?.cascade?.ttsProvider || '默认引擎'} · {selectedName}</div>}
          {error && <p className="settings-error">{error}</p>}
          <button type="button" className="studio-generate-button" disabled={busy || !text.trim() || !selectedProfile} onClick={generateAudio}>
            <Play size={17} fill="currentColor" /> {busy ? '生成中…' : '生成音频'}
          </button>
        </div>
      </main>

      <aside className="studio-history-panel">
        <div className="studio-history-heading"><span><History size={16} /> 历史</span></div>
        <div className="studio-history-tabs">
          {['all', 'clone', 'design', 'saved'].map(filter => <button type="button" key={filter} className={historyFilter === filter ? 'active' : ''} onClick={() => setHistoryFilter(filter)}>{filter === 'all' ? 'All' : filter === 'clone' ? 'Clone' : filter === 'design' ? 'Design' : '已加星'}</button>)}
        </div>
        {!history.length ? <div className="studio-history-empty">这里还没有内容——你的生成结果将显示在右侧。</div> : (
          <div className="studio-history-list">{history.map(item => <article key={item.id} className="studio-history-item"><div><strong>{item.voice}</strong><small>{item.createdAt}</small></div><p>{item.text}</p><audio controls src={item.url} /></article>)}</div>
        )}
      </aside>
    </div>
  )
}

export default function VoiceStudioPanel({
  open,
  runtime,
  onRuntimeChange,
  onModeSwitching,
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

  return (
    <div className="settings-drawer voice-studio-drawer" role="dialog" aria-label="语音工作室">
      <div className="settings-panel settings-panel-wide voice-studio-panel">
        <header className="voice-studio-header">
          <div className="voice-studio-header-main">
            {view !== 'launchpad' && (
              <button
                type="button"
                className="voice-studio-back"
                onClick={() => setView('launchpad')}
              >
                <span aria-hidden="true">←</span> 返回
              </button>
            )}
            <div className="voice-studio-title-stack">
              <span className="voice-studio-kicker">VOICE STUDIO</span>
              <h2>{title}</h2>
            </div>
          </div>
          <span className="voice-studio-header-status">LOCAL · READY</span>
        </header>

        <nav className="voice-studio-tabs" aria-label="语音工作室工作区" role="tablist">
          {[
            ['launchpad', '工作室'],
            ['gallery', '声音库'],
            ['clone', '克隆'],
            ['dub', '配音'],
            ['catalogue', '模型'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={view === value}
              tabIndex={view === value ? 0 : -1}
              onClick={() => setView(value)}
            >
              {label}
            </button>
          ))}
        </nav>

        {view === 'launchpad' && (
          <StudioWorkbench
            runtime={runtime}
            onOpenGallery={() => setView('gallery')}
            onOpenClone={() => setView('clone')}
          />
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
