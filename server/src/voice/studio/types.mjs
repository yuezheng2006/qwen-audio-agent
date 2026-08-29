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
    favorite,
    tags,
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
    favorite: Boolean(favorite),
    tags: Array.isArray(tags) ? tags.map(String) : [],
    ...(confirmedAt ? { confirmedAt } : {}),
    remote_voice_id: remoteId ?? null,
  }
}
