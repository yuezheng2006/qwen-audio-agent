import { synthesizeVoicePreview } from '../voice/studio/preview.mjs'
import {
  createPreviewCache,
  withPreviewFlag,
} from '../voice/studio/preview-cache.mjs'
import { synthesizeNarration } from '../voice/studio/narrate.mjs'
import {
  friendlyVoiceName,
  resolveAuthorVoice,
  serializeVoiceMatch,
} from '../voice/studio/author-voice.mjs'
import {
  computeTagCounts,
  filterGalleryProfiles,
  normalizeFavorite,
} from '../voice/studio/profile-store.mjs'

let previewTail = Promise.resolve()

function unavailable(res) {
  return res.status(503).json({
    error: 'Voice Studio 未启用',
    error_code: 'voice_studio_disabled',
  })
}

function parseTruthyQuery(value) {
  if (value === undefined || value === null || value === '') return undefined
  return normalizeFavorite(value) ? true : false
}

export function previewContentDisposition(profile, { download = false } = {}) {
  const name = friendlyVoiceName(profile).replace(/[\r\n"]/g, '').trim() || 'voice'
  const encoded = encodeURIComponent(`${name}.wav`)
  const kind = download ? 'attachment' : 'inline'
  return `${kind}; filename="preview.wav"; filename*=UTF-8''${encoded}`
}

function listOwnerProfiles(service, ownerId, { status } = {}) {
  const primary = service.list(ownerId, status ? { status } : {})?.profiles || []
  // Smoke imports historically used owner "local"; personal HTTP identity is
  // user_personal — merge so GUI/tools see the same ready voices.
  if (String(ownerId) === 'user_personal') {
    const legacy = service.list('local', status ? { status } : {})?.profiles || []
    const byId = new Map(primary.map(item => [item.id, item]))
    for (const item of legacy) {
      if (!byId.has(item.id)) byId.set(item.id, item)
    }
    return [...byId.values()]
  }
  return primary
}

function findProfile(service, ownerId, profileId) {
  return listOwnerProfiles(service, ownerId).find(item => item.id === profileId) || null
}

async function withPreviewLock(fn) {
  const previous = previewTail
  let release
  previewTail = new Promise(resolve => {
    release = resolve
  })
  await previous.catch(() => {})
  try {
    return await fn()
  } finally {
    release()
  }
}

export function registerVoiceRoutes(app, {
  voiceStudioService,
  getCascadeTts = () => ({}),
  synthesizePreview = synthesizeVoicePreview,
  synthesizeNarrationFn = synthesizeNarration,
  previewCache = null,
  voiceProfileDir = '',
} = {}) {
  const cache = previewCache || (
    voiceProfileDir ? createPreviewCache({ dir: voiceProfileDir }) : null
  )

  app.get('/api/voice/profiles', (req, res) => {
    if (!voiceStudioService) return unavailable(res)
    try {
      const ownerId = req.identity?.ownerId
      const status = req.query.status ? String(req.query.status) : undefined
      const favorite = parseTruthyQuery(req.query.favorite)
      const tag = req.query.tag ? String(req.query.tag) : undefined
      const q = req.query.q ? String(req.query.q) : undefined
      const base = listOwnerProfiles(
        voiceStudioService,
        ownerId,
        status ? { status } : {},
      )
      const tag_counts = computeTagCounts(base)
      const profiles = filterGalleryProfiles(base, {
        ...(favorite ? { favorite: true } : {}),
        tag,
        q,
      }).map(profile => withPreviewFlag(profile, cache))
      const studioStatus = voiceStudioService.status(ownerId)
      res.json({
        status: 'ok',
        profiles,
        active: studioStatus.active || null,
        tag_counts,
      })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  // Cached preview only — UI must not synthesize on click.
  app.get('/api/voice/profiles/:id/preview', (req, res) => {
    if (!voiceStudioService) return unavailable(res)
    if (!cache) {
      return res.status(503).json({
        error: '试听缓存未配置',
        error_code: 'preview_cache_unavailable',
      })
    }
    const ownerId = req.identity?.ownerId
    const profileId = String(req.params.id || '').trim()
    const profile = findProfile(voiceStudioService, ownerId, profileId)
    if (!profile) {
      return res.status(404).json({
        error: '未找到音色 profile',
        error_code: 'profile_not_found',
      })
    }
    const wav = cache.read(profileId)
    if (!wav) {
      return res.status(404).json({
        error: '试听尚未准备，请先预热缓存',
        error_code: 'preview_not_ready',
      })
    }
    res.setHeader('Content-Type', 'audio/wav')
    res.setHeader('Cache-Control', 'private, max-age=86400')
    res.setHeader(
      'Content-Disposition',
      previewContentDisposition(profile, {
        download: parseTruthyQuery(req.query.download) === true,
      }),
    )
    res.send(wav)
  })

  app.patch('/api/voice/profiles/:id', (req, res) => {
    if (!voiceStudioService) return unavailable(res)
    try {
      const ownerId = req.identity?.ownerId
      const profileId = String(req.params.id || '').trim()
      const body = req.body || {}
      let result = voiceStudioService.patch(ownerId, profileId, body)
      if (
        result.error_code === 'profile_not_found'
        && String(ownerId) === 'user_personal'
      ) {
        result = voiceStudioService.patch('local', profileId, body)
      }
      if (result.status !== 'ok') {
        const status = result.error_code === 'profile_not_found'
          ? 404
          : result.error_code === 'invalid_tags' || result.error_code === 'invalid_patch'
            ? 400
            : 400
        return res.status(status).json({
          error: result.user_message || '更新失败',
          error_code: result.error_code,
        })
      }
      res.json(result)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  app.delete('/api/voice/profiles/:id', (req, res) => {
    if (!voiceStudioService) return unavailable(res)
    try {
      const ownerId = req.identity?.ownerId
      const profileId = String(req.params.id || '').trim()
      let result = voiceStudioService.remove(ownerId, profileId)
      if (
        result.error_code === 'profile_not_found'
        && String(ownerId) === 'user_personal'
      ) {
        result = voiceStudioService.remove('local', profileId)
      }
      if (result.status !== 'ok') {
        return res.status(result.error_code === 'profile_not_found' ? 404 : 400).json({
          error: result.user_message || '删除失败',
          error_code: result.error_code,
        })
      }
      res.json(result)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  app.get('/api/voice/capabilities', (req, res) => {
    if (!voiceStudioService) return unavailable(res)
    try {
      if (typeof voiceStudioService.capabilities !== 'function') {
        return res.status(500).json({
          error: 'capabilities 未实现',
          error_code: 'capabilities_unavailable',
        })
      }
      res.json(voiceStudioService.capabilities())
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  app.post('/api/voice/clone', async (req, res) => {
    if (!voiceStudioService) return unavailable(res)
    const sample = String(req.body?.sample_data_url || '').trim()
    if (!sample) {
      return res.status(400).json({
        error: '请先录音并应用裁剪。',
        error_code: 'sample_missing',
      })
    }
    if (sample.length > 7 * 1024 * 1024) {
      return res.status(413).json({
        error: '录音样本不能超过 5 MB。',
        error_code: 'sample_too_large',
      })
    }
    try {
      const result = await voiceStudioService.clone(req.identity?.ownerId, {
        provider: req.body?.provider,
        label: req.body?.label,
        target_model: req.body?.target_model,
        sample_data_url: sample,
      })
      if (result.status !== 'ok') {
        return res.status(result.error_code === 'provider_unconfigured' ? 409 : 400).json({
          error: result.user_message || '音色克隆失败。',
          error_code: result.error_code,
          retryable: result.retryable,
        })
      }
      return res.json(result)
    } catch (error) {
      return res.status(500).json({ error: error.message || '音色克隆失败。' })
    }
  })

  // Warm / rebuild preview cache (write-through). Gallery playback uses GET.
  app.post('/api/voice/preview', async (req, res) => {
    if (!voiceStudioService) return unavailable(res)
    const ownerId = req.identity?.ownerId
    const profileId = String(req.body?.profile_id || '').trim()
    const force = Boolean(req.body?.force)
    if (!profileId) {
      return res.status(400).json({
        error: '缺少 profile_id',
        error_code: 'profile_required',
      })
    }
    const profile = findProfile(voiceStudioService, ownerId, profileId)
    if (!profile) {
      return res.status(404).json({
        error: '未找到音色 profile',
        error_code: 'profile_not_found',
      })
    }
    if (profile.provider !== 'dashscope') {
      return res.status(400).json({
        error: '一期仅支持 DashScope 音色试听',
        error_code: 'preview_unsupported',
      })
    }
    const remote = String(profile.remote_voice_id || '').trim()
    if (!remote) {
      return res.status(400).json({
        error: '音色缺少 remote_voice_id',
        error_code: 'remote_voice_required',
      })
    }
    try {
      const wav = await withPreviewLock(async () => {
        if (!force && cache?.has(profileId)) {
          return cache.read(profileId)
        }
        const tts = getCascadeTts() || {}
        const synthesized = await synthesizePreview({
          apiKey: tts.apiKey,
          model: profile.target_model || tts.model,
          voice: remote,
          sampleRate: tts.sampleRate || 24000,
        })
        cache?.write(profileId, synthesized)
        return synthesized
      })
      res.setHeader('Content-Type', 'audio/wav')
      res.setHeader('Cache-Control', 'private, max-age=86400')
      res.send(wav)
    } catch (error) {
      res.status(500).json({
        error: error.message || '试听失败',
        error_code: error.code || 'preview_failed',
      })
    }
  })

  app.post('/api/voice/narrate', async (req, res) => {
    if (!voiceStudioService) return unavailable(res)
    const ownerId = req.identity?.ownerId
    const text = String(req.body?.text || '').trim()
    if (!text) {
      return res.status(400).json({
        error: '缺少 text',
        error_code: 'text_required',
      })
    }
    const profiles = listOwnerProfiles(voiceStudioService, ownerId)
    const tts = getCascadeTts() || {}
    const match = resolveAuthorVoice({
      author: req.body?.author,
      profiles,
      profileId: req.body?.profile_id,
      voice: req.body?.voice || req.body?.remote_voice_id,
      fallbackVoice: tts.voice || '',
      allowDraftCelebs: Boolean(req.body?.allow_draft_celebs),
    })
    const remote = String(
      match.profile?.remoteId || match.profile?.remote_voice_id || '',
    ).trim()
    if (!match.profile || !remote) {
      return res.status(404).json({
        error: match.message || '无法解析配音音色',
        error_code: 'voice_unresolved',
        voice_match: serializeVoiceMatch(match),
      })
    }
    if (String(match.profile.provider || 'dashscope') !== 'dashscope') {
      return res.status(400).json({
        error: '一期仅支持 DashScope 长文配音',
        error_code: 'narrate_unsupported',
      })
    }
    try {
      const result = await withPreviewLock(async () => synthesizeNarrationFn({
        text,
        apiKey: tts.apiKey,
        model: match.profile.target_model || match.profile.targetModel || tts.model,
        voice: remote,
        sampleRate: tts.sampleRate || 24000,
        joinPauseMs: req.body?.join_pause_ms,
        label: match.profile.label || '',
        profileId: match.profile.id || null,
        author: String(req.body?.author || ''),
        matchType: match.match_type,
        fallback: match.fallback,
      }))
      const accept = String(req.headers.accept || '')
      if (accept.includes('application/json')) {
        return res.json({
          status: 'ok',
          voice_match: serializeVoiceMatch(match),
          report: result.report,
          audio_base64: result.wav.toString('base64'),
        })
      }
      res.setHeader('Content-Type', 'audio/wav')
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('X-Voice-Match', encodeURIComponent(JSON.stringify(serializeVoiceMatch(match))))
      res.send(result.wav)
    } catch (error) {
      res.status(500).json({
        error: error.message || '配音失败',
        error_code: error.code || 'narrate_failed',
      })
    }
  })

  app.post('/api/voice/confirm', async (req, res) => {
    if (!voiceStudioService) return unavailable(res)
    try {
      const ownerId = req.identity?.ownerId
      const profileId = String(req.body?.profile_id || '').trim()
      let result = await voiceStudioService.confirm(ownerId, {
        profile_id: profileId || undefined,
        provider: req.body?.provider,
        remote_voice_id: req.body?.remote_voice_id,
        restart: req.body?.restart,
      })
      // Profile may live under legacy owner "local" — import then confirm.
      if (
        result.error_code === 'profile_not_found'
        && profileId
        && String(ownerId) === 'user_personal'
      ) {
        const legacy = findProfile(voiceStudioService, ownerId, profileId)
        if (legacy?.remote_voice_id && legacy?.provider) {
          const imported = await voiceStudioService.importVoice(ownerId, {
            provider: legacy.provider,
            remote_voice_id: legacy.remote_voice_id,
            label: legacy.label,
            target_model: legacy.target_model,
          })
          if (imported.status === 'ok' && imported.profile?.id) {
            result = await voiceStudioService.confirm(ownerId, {
              profile_id: imported.profile.id,
              restart: req.body?.restart,
            })
          }
        }
      }
      if (result.status !== 'ok') {
        const status = result.error_code === 'mode_conflict' ? 409 : 400
        return res.status(status).json({
          error: result.user_message || '确认失败',
          error_code: result.error_code,
        })
      }
      res.json(result)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  // Platform naming: selecting a ready profile is the public operation;
  // /confirm remains as the backwards-compatible alias used by older UI.
  app.post('/api/voice/profiles/:id/select', async (req, res) => {
    if (!voiceStudioService) return unavailable(res)
    try {
      const result = await voiceStudioService.confirm(req.identity?.ownerId, {
        ...(req.body || {}),
        profile_id: String(req.params.id || '').trim(),
      })
      if (result.status !== 'ok') {
        const status = result.error_code === 'mode_conflict' ? 409 : 400
        return res.status(status).json({
          error: result.user_message || '选择音色失败',
          error_code: result.error_code,
        })
      }
      res.json(result)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })
}
