import { createSampleResolver } from './sample-resolver.mjs'
import { createAsrService } from './asr.mjs'
import { normalizeProviderError } from './providers/contract.mjs'
import {
  computeTagCounts,
  filterGalleryProfiles,
} from './profile-store.mjs'
import {
  previewCapable,
  qualityTipsFor,
  sampleHintsToSnake,
} from './quality-tips.mjs'
import { PREVIEW_TEXT } from './preview.mjs'
import { serializeProfile } from './types.mjs'

function failure(errorCode, userMessage, retryable = false) {
  return { status: 'failed', error: true, error_code: errorCode, user_message: userMessage, retryable }
}

function providerFrom(providers, id) {
  return providers instanceof Map ? providers.get(id) : providers?.[id]
}

function hasRemoteId(remoteId) {
  return typeof remoteId === 'string' ? remoteId.trim().length > 0 : Boolean(remoteId)
}

const DEFAULT_CASCADE_MODELS = Object.freeze({
  fish: 's2.1-pro-free',
  minimax: 'speech-02-turbo',
  listenhub: 'flowtts',
  dashscope: 'qwen-audio-3.0-tts-flash',
})

function displayLabel(label, fallback = 'voice') {
  const value = String(label || '').trim()
  return value || fallback
}

export function createVoiceStudioService({
  store,
  catalog,
  providers,
  presetsDir,
  getActiveCascade = () => ({}),
  isCascadeMode = true,
  persistCascadeTts = async () => {},
  restartGateway = () => {},
  defaultProvider,
  sampleResolver = createSampleResolver({ catalog, presetsDir }),
  asr = createAsrService(),
} = {}) {
  if (!store) throw new Error('voice profile store is required')
  if (!catalog) throw new Error('preset catalog is required')

  function activeCascade() {
    try {
      return getActiveCascade() || {}
    } catch {
      return {}
    }
  }

  function selectProvider(requested) {
    const explicit = String(requested || '').trim()
    if (explicit) return { id: explicit, explicit: true }
    const active = String(activeCascade().provider || defaultProvider || '').trim()
    if (active === 'listenhub') return { error: failure('provider_required', '当前音色供应商不支持克隆，请显式选择支持 enroll 的 provider。') }
    return { id: active, explicit: false }
  }

  function providerFailure(error, provider) {
    const normalized = provider?.normalizeError
      ? provider.normalizeError(error)
      : normalizeProviderError(error)
    return failure(
      normalized.error_code,
      normalized.user_message,
      normalized.retryable,
    )
  }

  async function clone(ownerId, input = {}) {
    const selected = selectProvider(input.provider)
    if (selected.error) return selected.error
    const provider = providerFrom(providers, selected.id)
    if (!provider) return failure('provider_required', `未找到 provider：${selected.id || '未指定'}。`)
    const capabilities = provider.capabilities?.() || {}
    if (!capabilities.canEnroll) {
      return failure(
        'enroll_unsupported',
        `${selected.id} 不支持音色克隆，请使用 voice_import 导入已有音色 ID。`,
      )
    }

    let sample
    try {
      sample = sampleResolver.resolve(input, capabilities)
    } catch (error) {
      const normalized = error.normalized || normalizeProviderError(error)
      return failure(normalized.error_code, normalized.user_message, normalized.retryable)
    }

    let profile = store.upsert(ownerId, {
      label: displayLabel(input.label, input.preset_id || 'voice'),
      source: input.preset_id ? 'preset' : (input.sample_url ? 'url' : 'upload'),
      presetId: input.preset_id ?? null,
      sampleRef: sample.sourcePath
        ? { kind: 'file', path: sample.sourcePath }
        : sample.kind === 'url'
        ? { kind: 'url', url: sample.url }
        : { kind: 'file', path: sample.path },
      provider: selected.id,
      targetModel: input.target_model ?? null,
      status: 'draft',
    })
    profile = store.updateStatus(ownerId, profile.id, { status: 'cloning' })
    try {
      const result = await provider.enroll({
        label: profile.label,
        sample,
        ...(input.target_model ? { targetModel: input.target_model } : {}),
      })
      if (!hasRemoteId(result?.remoteId)) {
        const normalized = {
          error_code: 'missing_remote_id',
          user_message: 'provider 未返回有效的 remote voice ID。',
          retryable: false,
        }
        store.updateStatus(ownerId, profile.id, { status: 'failed', error: normalized })
        return failure(normalized.error_code, normalized.user_message, normalized.retryable)
      }
      profile = store.updateStatus(ownerId, profile.id, {
        status: 'ready',
        remoteId: result.remoteId,
        targetModel: result.targetModel ?? profile.targetModel,
        providerPayload: result.providerPayload ?? null,
        error: null,
      })
      return { status: 'ok', profile: serializeProfile(profile) }
    } catch (error) {
      const normalized = provider?.normalizeError
        ? provider.normalizeError(error)
        : normalizeProviderError(error)
      profile = store.updateStatus(ownerId, profile.id, {
        status: 'failed',
        error: normalized,
      })
      return failure(normalized.error_code, normalized.user_message, normalized.retryable)
    }
  }

  async function importVoice(ownerId, input = {}) {
    const id = String(input.provider || '').trim()
    if (!id) return failure('provider_required', '导入音色必须指定 provider。')
    const provider = providerFrom(providers, id)
    if (!provider) return failure('provider_required', `未找到 provider：${id}。`)
    if (!provider.capabilities?.().canImportId) {
      return failure('import_unsupported', `${id} 不支持导入已有音色 ID。`)
    }
    let profile = store.upsert(ownerId, {
      label: displayLabel(input.label, input.remote_voice_id || 'voice'),
      source: 'import_id',
      provider: id,
      targetModel: input.target_model ?? null,
      status: 'draft',
    })
    try {
      const result = await provider.importId({
        label: profile.label,
        remoteId: input.remote_voice_id,
        ...(input.target_model ? { targetModel: input.target_model } : {}),
      })
      if (!hasRemoteId(result?.remoteId)) {
        const normalized = {
          error_code: 'missing_remote_id',
          user_message: 'provider 未返回有效的 remote voice ID。',
          retryable: false,
        }
        store.updateStatus(ownerId, profile.id, { status: 'failed', error: normalized })
        return failure(normalized.error_code, normalized.user_message, normalized.retryable)
      }
      profile = store.updateStatus(ownerId, profile.id, {
        status: 'ready',
        remoteId: result.remoteId,
        targetModel: result.targetModel ?? profile.targetModel,
        providerPayload: result.providerPayload ?? null,
        error: null,
      })
      return { status: 'ok', profile: serializeProfile(profile) }
    } catch (error) {
      const normalized = provider?.normalizeError
        ? provider.normalizeError(error)
        : normalizeProviderError(error, { errorCode: 'import_failed', userMessage: '导入音色失败。' })
      store.updateStatus(ownerId, profile.id, { status: 'failed', error: normalized })
      return failure(normalized.error_code, normalized.user_message, normalized.retryable)
    }
  }

  return {
    listPresets({ query } = {}) {
      return { status: 'ok', presets: catalog.list({ query }) }
    },

    clone,
    importVoice,

    async transcribe(ownerId, input = {}) {
      return asr.transcribe({
        ownerId,
        source: input.source,
        language: input.language,
        provider: input.provider || 'auto',
      })
    },

    async confirm(ownerId, input = {}) {
      if (!isCascadeMode) {
        return failure('mode_conflict', '仅 cascade 模式可确认音色生效。')
      }
      let profile = input.profile_id ? store.get(ownerId, input.profile_id) : null
      if (input.profile_id && !profile) {
        return failure('profile_not_found', '未找到要确认的音色 profile。')
      }
      if (!profile) {
        const provider = String(input.provider || '').trim()
        const remoteId = String(input.remote_voice_id || '').trim()
        if (!provider || !remoteId) {
          return failure('profile_not_found', '未找到匹配 provider 和 remote_voice_id 的音色 profile。')
        }
        profile = store.list(ownerId).find(item => (
          ['ready', 'confirmed'].includes(item.status)
          && item.provider === provider
          && item.remoteId === remoteId
        )) || null
      }
      if (!profile) return failure('profile_not_found', '未找到匹配的音色 profile。')
      if (!['ready', 'confirmed'].includes(profile.status)) {
        return failure('profile_not_ready', '音色尚未准备完成，不能确认生效。')
      }
      const provider = profile.provider
      const remoteId = profile.remoteId
      if (!hasRemoteId(remoteId)) return failure('remote_voice_required', '确认音色需要 remote_voice_id。')
      try {
        const currentProvider = String(activeCascade().provider || '').trim()
        const model = profile.targetModel || (
          currentProvider && currentProvider !== provider
            ? DEFAULT_CASCADE_MODELS[provider]
            : undefined
        )
        await persistCascadeTts({
          provider,
          ...(model ? { model } : {}),
          voice: remoteId,
          // Switching voice also switches speaking persona (Role block).
          voiceLabel: displayLabel(profile.label, remoteId),
        })
        // Prefer live apply (persistCascadeTts may hot-patch config). Full
        // process restart is opt-in — desktop embedded Gateway ignores
        // scripts/start-gateway.mjs and would otherwise keep the old voice.
        const shouldRestart = input.restart === true
        if (shouldRestart) restartGateway()
        const updated = profile
          ? store.updateStatus(ownerId, profile.id, {
            status: 'confirmed',
            confirmedAt: Date.now(),
            remoteId,
          })
          : null
        return {
          status: 'ok',
          switching: shouldRestart,
          profile: serializeProfile(updated),
          provider,
          remote_voice_id: remoteId,
        }
      } catch (error) {
        return providerFailure(error)
      }
    },

    list(ownerId, { status, favorite, tag, q } = {}) {
      const statusFilter = String(status || '').trim()
      const base = store.list(ownerId, statusFilter ? { status: statusFilter } : {})
      const tag_counts = computeTagCounts(base)
      const profiles = filterGalleryProfiles(base, { favorite, tag, q }).map(serializeProfile)
      return { status: 'ok', profiles, tag_counts }
    },

    patch(ownerId, id, patch = {}) {
      const profileId = String(id || '').trim()
      if (!profileId) return failure('profile_not_found', '未找到音色 profile。')
      const hasFavorite = Object.prototype.hasOwnProperty.call(patch, 'favorite')
      const hasTags = Object.prototype.hasOwnProperty.call(patch, 'tags')
      const hasLabel = Object.prototype.hasOwnProperty.call(patch, 'label')
      if (!hasFavorite && !hasTags && !hasLabel) {
        return failure('invalid_patch', '至少提供 favorite、tags 或 label。')
      }
      try {
        const row = store.patch(ownerId, profileId, {
          ...(hasFavorite ? { favorite: patch.favorite } : {}),
          ...(hasTags ? { tags: patch.tags } : {}),
          ...(hasLabel ? { label: patch.label } : {}),
        })
        if (!row) return failure('profile_not_found', '未找到音色 profile。')
        return { status: 'ok', profile: serializeProfile(row) }
      } catch (error) {
        if (error?.code === 'invalid_tags') {
          return failure('invalid_tags', error.message || '标签不合法。')
        }
        throw error
      }
    },

    capabilities() {
      const entries = providers instanceof Map
        ? [...providers.entries()]
        : Object.entries(providers || {})
      const list = entries.map(([id, provider]) => {
        const caps = provider?.capabilities?.() || {}
        const canPreview = previewCapable(id)
        return {
          id: String(id),
          can_enroll: Boolean(caps.canEnroll),
          can_import_id: Boolean(caps.canImportId),
          can_preview: canPreview,
          needs_public_url: Boolean(caps.needsPublicUrl),
          sample_hints: sampleHintsToSnake(caps.sampleHints || {}),
          quality_tips: qualityTipsFor(id),
          ...(canPreview ? {} : { preview_reason: 'preview_unsupported' }),
        }
      })
      return {
        status: 'ok',
        providers: list,
        preview_text: PREVIEW_TEXT,
      }
    },

    status(ownerId) {
      const profiles = store.list(ownerId)
      const confirmed = profiles
        .filter(item => item.status === 'confirmed')
        .sort((a, b) => Number(b.confirmedAt || 0) - Number(a.confirmedAt || 0))[0] || null
      const active = activeCascade()
      return {
        status: 'ok',
        active: {
          provider: active.provider ?? null,
          voice: active.voice ?? null,
          model: active.model ?? null,
        },
        confirmed: confirmed ? serializeProfile(confirmed) : null,
      }
    },
  }
}
