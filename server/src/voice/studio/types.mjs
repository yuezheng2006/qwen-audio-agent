export const VOICE_PROFILE_STATUSES = [
  'draft',
  'cloning',
  'ready',
  'confirmed',
  'failed',
]

export function serializeProfile(profile) {
  if (!profile) return null
  const {
    remoteId,
    providerPayload: _providerPayload,
    ...rest
  } = profile
  return {
    ...rest,
    remote_voice_id: remoteId ?? null,
  }
}
