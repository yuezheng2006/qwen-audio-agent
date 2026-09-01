import { useEffect, useState } from 'react'

const PHASE_LABELS = {
  inspect: '检查媒体',
  extract_audio: '提取音频',
  transcribe_aligned: '转写并对齐',
  translate: '翻译字幕',
  synthesize_segments: '生成配音',
  fit_timing: '适配时间轴',
  remux: '合成视频',
}

function readJson(response) {
  return response.json().catch(() => ({})).then(payload => {
    if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`)
    return payload
  })
}

export default function MediaWorkspacePanel({ open }) {
  const [profiles, setProfiles] = useState([])
  const [file, setFile] = useState(null)
  const [targetLanguage, setTargetLanguage] = useState('zh-CN')
  const [voiceProfileId, setVoiceProfileId] = useState('')
  const [job, setJob] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    fetch('api/voice/profiles', { cache: 'no-store' })
      .then(readJson)
      .then(payload => {
        const items = Array.isArray(payload.profiles) ? payload.profiles : []
        setProfiles(items)
        setVoiceProfileId(current => current || items[0]?.id || '')
      })
      .catch(err => setError(err.message))
  }, [open])

  useEffect(() => {
    if (!job?.id || !['queued', 'running'].includes(job.status)) return undefined
    const timer = setInterval(() => {
      fetch(`api/media/jobs/${encodeURIComponent(job.id)}`, { cache: 'no-store' })
        .then(readJson)
        .then(payload => setJob(payload.job))
        .catch(err => setError(err.message))
    }, 1000)
    return () => clearInterval(timer)
  }, [job?.id, job?.status])

  if (!open) return null

  const submit = async event => {
    event.preventDefault()
    if (!file || !voiceProfileId || busy) return
    setBusy(true)
    setError('')
    setJob(null)
    try {
      const upload = await readJson(await fetch('api/media/assets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Media-Filename': file.name,
        },
        body: file,
      }))
      const result = await readJson(await fetch('api/media/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_ref: upload.source_ref,
          target_language: targetLanguage,
          source_language: 'auto',
          voice_profile_id: voiceProfileId,
        }),
      }))
      setJob(result.job)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="voice-studio-body media-workspace-body">
      <div className="media-workspace-intro">
        <strong>视频配音</strong>
        <p>导入一段视频，选择目标语言和声音，系统会按时间轴完成转写、翻译与配音。</p>
      </div>
      <form className="media-job-form" onSubmit={submit}>
        <label className="media-dropzone">
          <input type="file" accept="video/*,audio/*" onChange={event => setFile(event.target.files?.[0] || null)} />
          <span>{file ? file.name : '选择或拖入视频 / 音频'}</span>
          <small>文件在本机处理；浏览器会先上传到本机 Gateway</small>
        </label>
        <div className="media-job-fields">
          <label className="voice-field"><span>目标语言</span>
            <select value={targetLanguage} onChange={event => setTargetLanguage(event.target.value)}>
              <option value="zh-CN">中文</option><option value="en">English</option><option value="ja">日本語</option>
            </select>
          </label>
          <label className="voice-field"><span>配音声音</span>
            <select value={voiceProfileId} onChange={event => setVoiceProfileId(event.target.value)}>
              {!profiles.length && <option value="">暂无可用声音</option>}
              {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
            </select>
          </label>
        </div>
        <button className="voice-primary-btn" type="submit" disabled={busy || !file || !voiceProfileId}>
          {busy ? '准备任务…' : '开始配音'}
        </button>
      </form>
      {error && <p className="settings-error">{error}</p>}
      {job && <section className="media-job-progress" aria-live="polite">
        <div className="media-job-progress-head"><strong>{job.status === 'completed' ? '配音完成' : job.status === 'failed' ? '配音失败' : '正在处理'}</strong><span>{job.currentPhase ? PHASE_LABELS[job.currentPhase] || job.currentPhase : job.status}</span></div>
        <div className="media-phase-list">
          {(job.phases || []).map(phase => <div key={phase.name} className={`media-phase ${phase.status}`}><i />{PHASE_LABELS[phase.name] || phase.name}<span>{phase.status === 'completed' ? '完成' : phase.status === 'running' ? '进行中' : phase.status === 'failed' ? '失败' : '等待'}</span></div>)}
        </div>
      </section>}
    </div>
  )
}
