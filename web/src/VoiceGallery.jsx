import { useCallback, useEffect, useRef, useState } from 'react'
import {
  friendlyVoiceName,
  organizeVoiceProfiles,
  previewDownloadFilename,
  previewDownloadHref,
  previewUrlFor,
} from './voice-gallery.js'
import { voiceAvatarLabel, voiceAvatarTone } from './voice-preview-player.js'

function canPreviewProvider(provider, voiceCapabilities) {
  if (voiceCapabilities?.providers?.length) {
    const row = voiceCapabilities.providers.find(item => item.id === provider)
    if (row) return Boolean(row.can_preview)
  }
  return provider === 'dashscope'
}

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

function AudioBars({ mode = 'idle' }) {
  return (
    <span className={`voice-audio-bars mode-${mode}`} aria-hidden="true">
      {[0, 1, 2, 3, 4].map(index => (
        <i key={index} style={{ '--i': index }} />
      ))}
    </span>
  )
}

function DownloadIcon() {
  return (
    <svg className="voice-download-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 1.25a.75.75 0 0 1 .75.75v6.19l1.97-1.97a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 1.06-1.06l1.97 1.97V2a.75.75 0 0 1 .75-.75Zm-4.5 11a.75.75 0 0 0 0 1.5h9a.75.75 0 0 0 0-1.5h-9Z"
      />
    </svg>
  )
}

export default function VoiceGallery({
  open = true,
  runtime,
  onRuntimeChange,
  onModeSwitching,
}) {
  const [voiceProfiles, setVoiceProfiles] = useState([])
  const [activeVoice, setActiveVoice] = useState(null)
  const [voiceStudioAvailable, setVoiceStudioAvailable] = useState(true)
  const [voiceCapabilities, setVoiceCapabilities] = useState(null)
  const [galleryQuery, setGalleryQuery] = useState('')
  const [galleryShowAll, setGalleryShowAll] = useState(false)
  const [previewingId, setPreviewingId] = useState('')
  const [previewPhase, setPreviewPhase] = useState('idle') // idle | playing
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const audioRef = useRef(null)
  const playTokenRef = useRef(0)
  const playWaitRef = useRef(null)

  const clearAudio = useCallback(() => {
    const audio = audioRef.current
    if (audio) {
      audio.onended = null
      audio.onerror = null
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    audioRef.current = null
    const waiter = playWaitRef.current
    playWaitRef.current = null
    waiter?.resolve()
  }, [])

  const stopPreview = useCallback(() => {
    playTokenRef.current += 1
    clearAudio()
    setPreviewingId('')
    setPreviewPhase('idle')
  }, [clearAudio])

  const refreshVoiceProfiles = useCallback(async () => {
    const [profilesRes, capsRes] = await Promise.all([
      fetch('api/voice/profiles'),
      fetch('api/voice/capabilities'),
    ])
    if (profilesRes.status === 503) {
      setVoiceStudioAvailable(false)
      setVoiceProfiles([])
      setActiveVoice(null)
      setVoiceCapabilities(null)
      return
    }
    const payload = await readJson(profilesRes)
    setVoiceStudioAvailable(true)
    const profiles = (payload.profiles || []).filter(item => (
      ['ready', 'confirmed'].includes(item.status)
    ))
    setVoiceProfiles(profiles)
    setActiveVoice(payload.active || null)
    if (capsRes.status === 503) {
      setVoiceCapabilities(null)
    } else if (capsRes.ok) {
      setVoiceCapabilities(await capsRes.json().catch(() => null))
    }
  }, [])

  useEffect(() => {
    if (!open) return undefined
    setError('')
    let cancelled = false
    refreshVoiceProfiles().catch(err => {
      if (!cancelled) setError(err.message)
    })
    return () => {
      cancelled = true
    }
  }, [open, refreshVoiceProfiles])

  useEffect(() => {
    if (!open) stopPreview()
  }, [open, stopPreview])

  useEffect(() => () => stopPreview(), [stopPreview])

  if (!open) return null

  const visibleVoiceProfiles = (() => {
    const query = galleryQuery.trim().toLowerCase()
    const organized = organizeVoiceProfiles(voiceProfiles, { showAll: galleryShowAll })
    if (!query) return organized
    return organized.filter(profile => {
      const hay = [
        friendlyVoiceName(profile),
        profile.label,
        profile.provider,
        ...(Array.isArray(profile.tags) ? profile.tags : []),
      ].join(' ').toLowerCase()
      return hay.includes(query)
    })
  })()

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

  const playCachedPreview = async (profile) => {
    const url = previewUrlFor(profile)
    if (!url) {
      throw new Error('试听尚未准备')
    }
    const token = ++playTokenRef.current
    clearAudio()
    setPreviewingId(profile.id)
    setPreviewPhase('playing')
    setError('')

    const audio = new Audio(url)
    audioRef.current = audio

    await new Promise((resolve, reject) => {
      const settle = (fn) => {
        if (playWaitRef.current?.token === token) playWaitRef.current = null
        fn()
      }
      playWaitRef.current = {
        token,
        resolve: () => settle(resolve),
        reject: (err) => settle(() => reject(err)),
      }
      audio.onended = () => {
        if (token !== playTokenRef.current) {
          settle(resolve)
          return
        }
        audioRef.current = null
        setPreviewPhase('idle')
        setPreviewingId('')
        settle(resolve)
      }
      audio.onerror = () => {
        if (token !== playTokenRef.current) {
          settle(resolve)
          return
        }
        stopPreview()
        settle(() => reject(new Error('试听播放失败')))
      }
      audio.play().catch(err => {
        if (token !== playTokenRef.current) {
          settle(resolve)
          return
        }
        stopPreview()
        settle(() => reject(err))
      })
    })
  }

  const previewVoice = async (profile) => {
    if (previewingId === profile.id && previewPhase === 'playing') {
      stopPreview()
      return
    }
    try {
      await playCachedPreview(profile)
    } catch (err) {
      setError(err.message)
    }
  }

  const confirmVoice = async (profile) => {
    const name = friendlyVoiceName(profile)
    await run(async () => {
      stopPreview()
      onModeSwitching?.(true)
      try {
        await readJson(await fetch('api/voice/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profile_id: profile.id, restart: false }),
        }))
        // Optimistic header update — don't wait on a full Gateway respawn.
        onRuntimeChange?.({
          ...(runtime || {}),
          frontendMode: 'cascade',
          realtimeVoice: profile.remote_voice_id,
          realtimeVoiceLabel: name,
          cascade: {
            ...(runtime?.cascade || {}),
            tts: profile.target_model || runtime?.cascade?.tts,
            ttsProvider: profile.provider || runtime?.cascade?.ttsProvider || 'dashscope',
            voice: profile.remote_voice_id,
            voiceLabel: name,
          },
        })
        const next = await waitForHealth(health => (
          health.frontendMode === 'cascade'
          && health.cascade?.voice === profile.remote_voice_id
        ), { timeoutMs: 8000 })
        onRuntimeChange?.(next)
        await refreshVoiceProfiles()
      } finally {
        onModeSwitching?.(false)
      }
    })
  }

  const deleteVoice = async profile => {
    const name = friendlyVoiceName(profile)
    if (!globalThis.confirm?.(`删除音色“${name}”？此操作只删除本机 Profile，不会撤销远端 provider 的 Voice ID。`)) return
    await run(async () => {
      const response = await fetch(`api/voice/profiles/${encodeURIComponent(profile.id)}`, {
        method: 'DELETE',
      })
      await readJson(response)
      if (previewingId === profile.id) stopPreview()
      await refreshVoiceProfiles()
    })
  }

  const currentName = (() => {
    const voiceId = activeVoice?.voice || runtime?.cascade?.voice
    const matched = organizeVoiceProfiles(voiceProfiles, { showAll: true })
      .find(item => item.remote_voice_id === voiceId)
    if (matched) return friendlyVoiceName(matched)
    return runtime?.cascade?.voiceLabel
      || runtime?.realtimeVoiceLabel
      || '未命名音色'
  })()

  return (
    <div className="voice-studio-body voice-gallery">
      {error && <p className="settings-error">{error}</p>}

      {runtime?.frontendMode !== 'cascade' ? (
        <p className="voice-studio-note">当前非 cascade 模式，请先到引擎设置切换为级联。</p>
      ) : (
        <>
          <div className="voice-active-bar">
            <div>
              <span>当前</span>
              <strong>{currentName}</strong>
            </div>
            {voiceStudioAvailable && (
              <button
                type="button"
                className="voice-text-btn"
                disabled={busy}
                onClick={() => run(refreshVoiceProfiles)}
              >
                刷新
              </button>
            )}
          </div>

          {!voiceStudioAvailable ? (
            <p className="voice-studio-note">Voice Studio 未启用，请到「克隆」导入 Voice ID。</p>
          ) : (
            <>
              <div className="voice-gallery-toolbar">
                <label className="voice-gallery-search-wrap">
                  <span className="voice-gallery-search-icon" aria-hidden="true">⌕</span>
                  <input
                    className="voice-gallery-search"
                    value={galleryQuery}
                    disabled={busy}
                    placeholder="搜索音色"
                    onChange={event => setGalleryQuery(event.target.value)}
                  />
                </label>
                <label className="voice-toggle">
                  <input
                    type="checkbox"
                    checked={galleryShowAll}
                    disabled={busy}
                    onChange={event => setGalleryShowAll(event.target.checked)}
                  />
                  试稿
                </label>
              </div>

              <div className="voice-row-list" role="list">
                {!visibleVoiceProfiles.length && (
                  <p className="voice-studio-note">
                    {galleryQuery.trim()
                      ? '没有匹配的音色。'
                      : galleryShowAll
                        ? '还没有克隆音色。可到「克隆」导入，或语音说「克隆一个音色」。'
                        : '暂无定稿音色。打开「试稿」可看历史样本。'}
                  </p>
                )}
                {visibleVoiceProfiles.map(profile => {
                  const isActive = activeVoice?.voice
                    && profile.remote_voice_id === activeVoice.voice
                    && profile.provider === (activeVoice.provider || profile.provider)
                  const canPreview = canPreviewProvider(profile.provider, voiceCapabilities)
                    && Boolean(previewUrlFor(profile))
                  const name = friendlyVoiceName(profile)
                  const isPlaying = previewingId === profile.id && previewPhase === 'playing'
                  const avatarTone = voiceAvatarTone(name)
                  return (
                    <article
                      key={profile.id}
                      className={[
                        'voice-row',
                        isActive ? 'active' : '',
                        isPlaying ? 'previewing' : '',
                      ].filter(Boolean).join(' ')}
                      role="listitem"
                      aria-current={isActive ? 'true' : undefined}
                      onClick={() => {
                        if (busy || isActive) return
                        confirmVoice(profile)
                      }}
                    >
                      <div
                        className="voice-avatar"
                        aria-hidden="true"
                        style={{
                          '--avatar-from': avatarTone.from,
                          '--avatar-to': avatarTone.to,
                        }}
                      >
                        {voiceAvatarLabel(name)}
                      </div>
                      <div className="voice-row-main">
                        <div className="voice-row-name">
                          <span>{name}</span>
                          {isActive && <em>使用中</em>}
                        </div>
                        <div className="voice-row-meta">
                          {canPreview ? '可试听 · 可下载' : '试听未准备'}
                        </div>
                      </div>
                      <div className="voice-row-actions">
                        <button
                          type="button"
                          className={[
                            'voice-icon-btn',
                            'voice-play-btn',
                            isPlaying ? 'active' : '',
                          ].filter(Boolean).join(' ')}
                          disabled={busy || !canPreview}
                          aria-label={isPlaying ? '停止试听' : `试听 ${name}`}
                          title={canPreview ? (isPlaying ? '停止' : '试听') : '试听未准备'}
                          onClick={event => {
                            event.stopPropagation()
                            previewVoice(profile)
                          }}
                        >
                          {isPlaying ? (
                            <AudioBars mode="playing" />
                          ) : (
                            <span className="voice-play-icon" aria-hidden="true" />
                          )}
                        </button>
                        {canPreview ? (
                          <a
                            className="voice-icon-btn"
                            href={previewDownloadHref(profile)}
                            download={previewDownloadFilename(profile)}
                            aria-label={`下载 ${name} 试听`}
                            title="下载试听"
                            onClick={event => event.stopPropagation()}
                          >
                            <DownloadIcon />
                          </a>
                        ) : (
                          <button
                            type="button"
                            className="voice-icon-btn"
                            disabled
                            aria-label={`${name} 试听未准备，无法下载`}
                            title="试听未准备"
                            onClick={event => event.stopPropagation()}
                          >
                            <DownloadIcon />
                          </button>
                        )}
                        <button
                          type="button"
                          className={`voice-primary-btn ${isActive ? 'selected' : ''}`}
                          disabled={busy || isActive}
                          onClick={event => {
                            event.stopPropagation()
                            confirmVoice(profile)
                          }}
                        >
                          {isActive ? '已选' : '选用'}
                        </button>
                        <button
                          type="button"
                          className="voice-icon-btn voice-delete-btn"
                          disabled={busy || isActive}
                          aria-label={`删除 ${name}`}
                          title={isActive ? '当前使用中的音色不能删除' : '删除音色'}
                          onClick={event => {
                            event.stopPropagation()
                            deleteVoice(profile)
                          }}
                        >
                          ×
                        </button>
                      </div>
                    </article>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
