import {
  normalizeCapabilities,
  normalizeProviderError,
  providerError,
  requireRemoteId,
} from './contract.mjs'

const CAPABILITIES = normalizeCapabilities({
  canEnroll: false,
  canImportId: true,
  needsPublicUrl: true,
})

export function createMinimaxCloneProvider() {
  return {
    id: 'minimax',

    capabilities() {
      return { ...CAPABILITIES, sampleHints: { ...CAPABILITIES.sampleHints } }
    },

    async enroll() {
      throw providerError({
        errorCode: 'enroll_unsupported',
        userMessage: 'enroll_unsupported: MiniMax 不支持当前音色克隆，请导入已有音色 ID。',
      })
    },

    async importId({ remoteId, targetModel } = {}) {
      return {
        remoteId: requireRemoteId(remoteId),
        ...(targetModel ? { targetModel: String(targetModel) } : {}),
        providerPayload: { imported: true },
      }
    },

    normalizeError(error) {
      return normalizeProviderError(error, {
        errorCode: 'enroll_failed',
        userMessage: 'MiniMax 音色操作失败。',
      })
    },
  }
}
