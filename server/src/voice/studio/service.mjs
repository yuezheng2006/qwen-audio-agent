import { createSampleResolver } from './sample-resolver.mjs'
import { normalizeProviderError, sanitizeLabel } from './providers/contract.mjs'
import { serializeProfile } from './types.mjs'

function failure(errorCode, userMessage, retryable = false) {
  return { status: 'failed', error: true, error_code: errorCode, user_message: userMessage, retryable }
}

function providerFrom(providers, id) {
  return providers instanceof Map ? providers.get(id) : providers?.[id]
}

export function createVoiceStudioService({
  store,
  catalog,
  providers,
  getActiveCascade = () => ({}),
  persistCascadeTts = async () => {},
  restartGateway = () => {},
  defaultProvider,
  sampleResolver = createSampleResolver({ catalog }),
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
      label: sanitizeLabel(input.label, input.preset_id || 'voice'),
      source: input.preset_id ? 'preset' : (input.sample_url ? 'url' : 'upload'),
      presetId: input.preset_id ?? null,
      sampleRef: sample.kind === 'url'
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
      label: sanitizeLabel(input.label, input.remote_voice_id || 'voice'),
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

    async confirm(ownerId, input = {}) {
      const profile = input.profile_id ? store.get(ownerId, input.profile_id) : null
      const provider = String(input.provider || profile?.provider || '').trim()
      const remoteId = input.remote_voice_id || profile?.remoteId
      if (!profile && !provider) return failure('profile_not_found', '未找到要确认的音色 profile。')
      if (profile && !['ready', 'confirmed'].includes(profile.status)) {
        return failure('profile_not_ready', '音色尚未准备完成，不能确认生效。')
      }
      if (!remoteId) return failure('remote_voice_required', '确认音色需要 remote_voice_id。')
      try {
        await persistCascadeTts({
          provider: provider || profile.provider,
          ...(input.target_model || profile?.targetModel
            ? { model: input.target_model || profile.targetModel }
            : {}),
          voice: remoteId,
        })
        if (input.restart !== false) restartGateway()
        const updated = profile
          ? store.updateStatus(ownerId, profile.id, {
            status: 'confirmed',
            confirmedAt: Date.now(),
            remoteId,
          })
          : null
        return {
          status: 'ok',
          switching: input.restart !== false,
          profile: updated ? serializeProfile(updated) : null,
          provider: provider || profile.provider,
          remote_voice_id: remoteId,
        }
      } catch (error) {
        return providerFailure(error)
      }
    },

    list(ownerId, { status } = {}) {
      return { status: 'ok', profiles: store.list(ownerId, { status }).map(serializeProfile) }
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
