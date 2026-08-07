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
    id,
    label,
    source,
    presetId,
    provider,
    remoteId,
    targetModel,
    status,
    error,
    createdAt,
    updatedAt,
    confirmedAt,
  } = profile
  return {
    id,
    label,
    source,
    presetId: presetId ?? null,
    provider,
    targetModel: targetModel ?? null,
    status,
    error: error ?? null,
    createdAt,
    updatedAt,
    ...(confirmedAt ? { confirmedAt } : {}),
    remote_voice_id: remoteId ?? null,
  }
}
