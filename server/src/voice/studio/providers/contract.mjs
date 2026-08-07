export const DEFAULT_SAMPLE_HINTS = Object.freeze({
  minSec: 3,
  maxSec: 30,
  formats: ['wav', 'mp3', 'm4a'],
})

export function normalizeCapabilities(capabilities = {}) {
  return {
    canEnroll: Boolean(capabilities.canEnroll),
    canImportId: Boolean(capabilities.canImportId),
    needsPublicUrl: Boolean(capabilities.needsPublicUrl),
    sampleHints: {
      ...DEFAULT_SAMPLE_HINTS,
      ...(capabilities.sampleHints || {}),
      formats: Array.isArray(capabilities.sampleHints?.formats)
        ? capabilities.sampleHints.formats.map(String)
        : [...DEFAULT_SAMPLE_HINTS.formats],
    },
  }
}

export function sanitizeLabel(label, fallback = 'voice') {
  const normalized = String(label || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return normalized || fallback
}

export function requireRemoteId(remoteId) {
  const value = String(remoteId || '').trim()
  if (!value) throw new Error('remoteId is required')
  return value
}

export function providerError({
  errorCode = 'enroll_failed',
  userMessage = '音色克隆失败。',
  retryable = false,
  cause,
} = {}) {
  const error = new Error(userMessage, { cause })
  error.code = errorCode
  error.normalized = {
    error_code: errorCode,
    user_message: userMessage,
    retryable: Boolean(retryable),
  }
  return error
}

export function normalizeProviderError(error, fallback = {}) {
  if (error?.normalized) return error.normalized
  return {
    error_code: String(error?.code || fallback.errorCode || 'enroll_failed'),
    user_message: String(
      fallback.userMessage || error?.message || '音色克隆失败。',
    ),
    retryable: Boolean(fallback.retryable),
  }
}

