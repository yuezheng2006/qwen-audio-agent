import {
  normalizeCapabilities,
  normalizeProviderError,
  providerError,
  requireRemoteId,
  sanitizeDashScopePrefix,
} from './contract.mjs'

const ENDPOINT =
  'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization'
const DEFAULT_TARGET_MODEL = 'qwen-audio-3.0-tts-flash'

const CAPABILITIES = normalizeCapabilities({
  canEnroll: true,
  canImportId: true,
  needsPublicUrl: true,
})

async function readResponsePayload(response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

export function createDashScopeCloneProvider({
  apiKey = '',
  fetchImpl = globalThis.fetch,
  targetModel = DEFAULT_TARGET_MODEL,
  endpoint = ENDPOINT,
} = {}) {
  const configuredTargetModel = String(targetModel || DEFAULT_TARGET_MODEL)

  function normalizeError(error) {
    return normalizeProviderError(error, {
      errorCode: 'enroll_failed',
      userMessage: '音色克隆失败。',
      retryable: error?.status >= 500 || error?.name === 'TypeError',
    })
  }

  return {
    id: 'dashscope',

    capabilities() {
      return { ...CAPABILITIES, sampleHints: { ...CAPABILITIES.sampleHints } }
    },

    async enroll({
      label,
      sample,
      targetModel: requestedTargetModel,
    } = {}) {
      if (!apiKey) {
        throw providerError({
          errorCode: 'provider_unconfigured',
          userMessage: 'DashScope 未配置 API Key。',
        })
      }
      if (typeof fetchImpl !== 'function') {
        throw providerError({
          errorCode: 'provider_unconfigured',
          userMessage: 'DashScope 请求客户端不可用。',
        })
      }

      const model = String(requestedTargetModel || configuredTargetModel)
      const sampleUrl = sample?.kind === 'url' ? String(sample.url || '').trim() : ''
      if (!sampleUrl) {
        throw providerError({
          errorCode: 'sample_url_required',
          userMessage: 'DashScope 音色克隆需要可访问的音频 URL。',
        })
      }

      const body = {
        model: 'voice-enrollment',
        input: {
          action: 'create_voice',
          target_model: model,
          prefix: sanitizeDashScopePrefix(label),
          url: sampleUrl,
        },
      }

      let response
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        })
      } catch (error) {
        throw providerError({
          errorCode: 'enroll_failed',
          userMessage: '音色克隆失败。',
          retryable: true,
          cause: error,
        })
      }

      const payload = await readResponsePayload(response)
      if (!response.ok) {
        const detail = String(payload?.message || payload?.code || '').trim()
        const error = providerError({
          errorCode: 'enroll_failed',
          userMessage: detail
            ? `音色克隆失败：${detail}`
            : '音色克隆失败。',
          retryable: response.status >= 500,
        })
        error.status = response.status
        error.providerPayload = payload
        throw error
      }

      const remoteId = payload?.output?.voice || payload?.output?.voice_id
      if (!remoteId) {
        throw providerError({
          errorCode: 'enroll_failed',
          userMessage: '音色克隆失败。',
          retryable: false,
        })
      }

      return {
        remoteId: String(remoteId),
        targetModel: model,
        providerPayload: payload,
      }
    },

    async importId(input = {}) {
      const { remoteId, targetModel: requestedTargetModel } = input
      return {
        remoteId: requireRemoteId(remoteId),
        ...(Object.prototype.hasOwnProperty.call(input, 'targetModel')
          ? { targetModel: String(requestedTargetModel || '') }
          : {}),
        providerPayload: { imported: true },
      }
    },

    normalizeError,
  }
}

