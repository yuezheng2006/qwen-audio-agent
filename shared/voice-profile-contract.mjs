// Stable product contract for voice assets. Providers implement the work;
// clients depend only on this lifecycle and operation vocabulary.

export const VOICE_PROFILE_API_VERSION = '1'

export const VOICE_PROFILE_STATUSES = Object.freeze([
  'draft',
  'cloning',
  'ready',
  'confirmed',
  'failed',
])

export const VOICE_PROFILE_OPERATIONS = Object.freeze([
  'record',
  'trim',
  'clone',
  'preview',
  'select',
  'delete',
])

const STATUS_SET = new Set(VOICE_PROFILE_STATUSES)

export function isVoiceProfileStatus(value) {
  return STATUS_SET.has(String(value || '').trim())
}

export function normalizeVoiceProfileStatus(value, fallback = 'draft') {
  const status = String(value || '').trim()
  return isVoiceProfileStatus(status) ? status : fallback
}

export function voiceProfileContract(profile = {}) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new Error('voice profile must be an object')
  }
  return Object.freeze({
    apiVersion: VOICE_PROFILE_API_VERSION,
    id: String(profile.id || '').trim(),
    label: String(profile.label || '').trim(),
    provider: String(profile.provider || '').trim(),
    runtime: String(profile.runtime || 'remote').trim(),
    status: normalizeVoiceProfileStatus(profile.status),
    capabilities: Object.freeze(Array.isArray(profile.capabilities)
      ? [...new Set(profile.capabilities.map(String).filter(Boolean))]
      : ['speech.synthesize']),
    sampleRefs: Object.freeze(Array.isArray(profile.sample_refs)
      ? profile.sample_refs.map(String)
      : []),
    targetModel: profile.targetModel ?? null,
    remoteVoiceId: profile.remote_voice_id ?? profile.remoteId ?? null,
  })
}
