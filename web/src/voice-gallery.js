/** Curated celebrity clones (denoise finals). Non-denoise variants are drafts. */
export const CURATED_CELEB_NAMES = [
  '刘震云',
  '罗永浩',
  '雷军',
  '马云',
  '白岩松',
  '单田芳',
  '马季',
  // kept only for draft/demoted matching:
  '周迅',
  '黄渤',
  '徐峥',
  '林志玲',
  '冯巩',
  '郭德纲',
]

/**
 * Removed from gallery after QA — likeness failed / unused / bad source audio.
 * Hidden even with 「降噪」label; profiles are also deleted from disk.
 */
export const DEMOTED_CELEB_NAMES = ['周迅', '郭德纲', '黄渤', '徐峥', '林志玲', '冯巩']

export function celebNameFromLabel(label) {
  const text = String(label || '').trim()
  // Longer names first so prefixes don't steal (none today, but keep stable)
  const names = [...CURATED_CELEB_NAMES].sort((a, b) => b.length - a.length)
  return names.find(name => text === name || text.startsWith(`${name}·`)) || ''
}

/** Experimental / poorer celeb samples kept for history but hidden in the gallery. */
export function isDraftCelebVoice(profile) {
  const label = String(profile?.label || '').trim()
  const celeb = celebNameFromLabel(label)
  if (!celeb) return false
  if (DEMOTED_CELEB_NAMES.includes(celeb)) return true
  return !label.includes('降噪')
}

export function rankVoiceProfile(profile) {
  const label = String(profile?.label || '')
  let score = 0
  if (profile?.favorite) score += 120
  if (label.includes('降噪')) score += 100
  if (celebNameFromLabel(label) && !DEMOTED_CELEB_NAMES.includes(celebNameFromLabel(label))) {
    score += 40
  }
  if (profile?.status === 'confirmed') score += 10
  if (profile?.provider === 'dashscope') score += 5
  return score
}

/** Short display name: 郭德纲·划船·降噪 → 郭德纲 */
export function friendlyVoiceName(profile) {
  const label = String(profile?.label || '').trim()
  const celeb = celebNameFromLabel(label)
  if (celeb) return celeb
  if (label.includes('·')) return label.split('·')[0] || label
  return label
    || String(profile?.remote_voice_id || '').trim()
    || '未命名音色'
}

export function previewUrlFor(profile) {
  if (profile?.preview_url) return profile.preview_url
  if (profile?.has_preview && profile?.id) {
    return `api/voice/profiles/${encodeURIComponent(profile.id)}/preview`
  }
  return ''
}

export function previewDownloadFilename(profile) {
  const name = friendlyVoiceName(profile).replace(/[\\/:*?"<>|]+/g, '').trim() || 'voice'
  return `${name}.wav`
}

export function previewDownloadHref(profile) {
  const url = previewUrlFor(profile)
  if (!url) return ''
  return url.includes('?') ? `${url}&download=1` : `${url}?download=1`
}

/**
 * Dedupe by remote voice, drop celeb drafts unless showAll,
 * prefer denoise / favorites in sort order.
 */
export function organizeVoiceProfiles(profiles = [], { showAll = false } = {}) {
  const byRemote = new Map()
  for (const profile of profiles) {
    if (!showAll && isDraftCelebVoice(profile)) continue
    const key = `${profile.provider || ''}:${profile.remote_voice_id || profile.id}`
    const prev = byRemote.get(key)
    if (!prev || rankVoiceProfile(profile) > rankVoiceProfile(prev)) {
      byRemote.set(key, profile)
    }
  }
  return [...byRemote.values()].sort((a, b) => rankVoiceProfile(b) - rankVoiceProfile(a))
}
