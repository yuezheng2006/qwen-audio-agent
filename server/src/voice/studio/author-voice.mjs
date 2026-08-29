/**
 * Resolve a book author to a Voice Studio profile (e.g. 刘震云 → 刘震云·北大·降噪).
 * Ranking mirrors web/src/voice-gallery.js so Gallery and book-sales-video stay aligned.
 */

export const CURATED_CELEB_NAMES = ['刘震云', '郭德纲', '罗永浩']

/**
 * Celeb names kept in history / 试稿 only — likeness failed QA, do not prefer as finals.
 * 郭德纲·划船·降噪 rejected 2026-08-11: not recognizable as 郭德纲.
 */
export const DEMOTED_CELEB_NAMES = ['郭德纲']

export function celebNameFromLabel(label) {
  const text = String(label || '').trim()
  return CURATED_CELEB_NAMES.find(name => text === name || text.startsWith(`${name}·`)) || ''
}

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
  if (celebNameFromLabel(label)) score += 40
  if (profile?.status === 'confirmed') score += 10
  if (profile?.status === 'ready') score += 5
  if (profile?.provider === 'dashscope') score += 5
  return score
}

export function friendlyVoiceName(profile) {
  const label = String(profile?.label || '').trim()
  const celeb = celebNameFromLabel(label)
  if (celeb) return celeb
  if (label.includes('·')) return label.split('·')[0] || label
  return label
    || String(profile?.remoteId || profile?.remote_voice_id || '').trim()
    || '未命名音色'
}

function remoteVoiceId(profile) {
  return String(profile?.remoteId || profile?.remote_voice_id || '').trim()
}

function normalizeAuthorToken(author) {
  return String(author || '')
    .trim()
    .replace(/[《》【】\[\]（）()\s]/g, '')
    .replace(/著$/, '')
}

/**
 * Extract candidate person names from an author field like "刘震云" or "刘震云 / 某某译".
 */
export function authorNameCandidates(author) {
  const raw = String(author || '').trim()
  if (!raw) return []
  const parts = raw
    .split(/[/／、,，;；|]/)
    .map(part => normalizeAuthorToken(part))
    .filter(Boolean)
  const out = []
  const seen = new Set()
  for (const part of parts.length ? parts : [normalizeAuthorToken(raw)]) {
    if (!part || seen.has(part)) continue
    seen.add(part)
    out.push(part)
  }
  return out
}

function profileMatchesAuthor(profile, authorToken) {
  const label = String(profile?.label || '').trim()
  if (!label || !authorToken) return false
  if (label === authorToken || label.startsWith(`${authorToken}·`)) return true
  const celeb = celebNameFromLabel(label)
  if (celeb && (authorToken === celeb || authorToken.includes(celeb) || celeb.includes(authorToken))) {
    return true
  }
  // Non-celeb: first segment before ·
  const head = label.includes('·') ? label.split('·')[0] : label
  return head === authorToken
}

function usableProfiles(profiles, { allowDraftCelebs = false } = {}) {
  const rows = Array.isArray(profiles) ? profiles : []
  return rows.filter(profile => {
    if (!remoteVoiceId(profile)) return false
    const status = String(profile?.status || '')
    if (status === 'failed' || status === 'cloning') return false
    if (!allowDraftCelebs && isDraftCelebVoice(profile)) return false
    return true
  })
}

/**
 * @returns {{
 *   match_type: 'author'|'profile_id'|'explicit_voice'|'fallback'|'none',
 *   profile: object|null,
 *   author: string,
 *   candidates: string[],
 *   fallback: boolean,
 *   message: string,
 * }}
 */
export function resolveAuthorVoice({
  author = '',
  profiles = [],
  profileId = '',
  voice = '',
  fallbackVoice = '',
  fallbackProfile = null,
  allowDraftCelebs = false,
} = {}) {
  const list = usableProfiles(profiles, { allowDraftCelebs })
  const explicitId = String(profileId || '').trim()
  if (explicitId) {
    const hit = list.find(item => item.id === explicitId)
      || (Array.isArray(profiles) ? profiles.find(item => item.id === explicitId) : null)
    if (hit && remoteVoiceId(hit)) {
      return {
        match_type: 'profile_id',
        profile: hit,
        author: String(author || '').trim(),
        candidates: authorNameCandidates(author),
        fallback: false,
        message: `使用指定音色 ${friendlyVoiceName(hit)}（${hit.label || hit.id}）`,
      }
    }
  }

  const explicitVoice = String(voice || '').trim()
  if (explicitVoice) {
    const hit = list.find(item => remoteVoiceId(item) === explicitVoice)
    if (hit) {
      return {
        match_type: 'explicit_voice',
        profile: hit,
        author: String(author || '').trim(),
        candidates: authorNameCandidates(author),
        fallback: false,
        message: `使用指定 Voice ID 对应音色 ${friendlyVoiceName(hit)}`,
      }
    }
    return {
      match_type: 'explicit_voice',
      profile: {
        id: null,
        label: explicitVoice,
        provider: 'dashscope',
        remoteId: explicitVoice,
        remote_voice_id: explicitVoice,
        status: 'ready',
      },
      author: String(author || '').trim(),
      candidates: authorNameCandidates(author),
      fallback: false,
      message: `使用指定 Voice ID ${explicitVoice}`,
    }
  }

  const candidates = authorNameCandidates(author)
  for (const token of candidates) {
    const matches = list.filter(item => profileMatchesAuthor(item, token))
    if (!matches.length) continue
    matches.sort((a, b) => rankVoiceProfile(b) - rankVoiceProfile(a))
    const best = matches[0]
    return {
      match_type: 'author',
      profile: best,
      author: String(author || '').trim(),
      candidates,
      fallback: false,
      message: `作者「${token}」匹配音色 ${friendlyVoiceName(best)}（${best.label}）`,
    }
  }

  const fbProfile = fallbackProfile && remoteVoiceId(fallbackProfile)
    ? fallbackProfile
    : null
  const fbVoice = String(fallbackVoice || '').trim()
  if (fbProfile) {
    return {
      match_type: 'fallback',
      profile: fbProfile,
      author: String(author || '').trim(),
      candidates,
      fallback: true,
      message: candidates.length
        ? `未找到作者「${candidates.join('/')}」对应音色，回退到 ${friendlyVoiceName(fbProfile)}`
        : `未提供可匹配作者，回退到 ${friendlyVoiceName(fbProfile)}`,
    }
  }
  if (fbVoice) {
    return {
      match_type: 'fallback',
      profile: {
        id: null,
        label: fbVoice,
        provider: 'dashscope',
        remoteId: fbVoice,
        remote_voice_id: fbVoice,
        status: 'ready',
      },
      author: String(author || '').trim(),
      candidates,
      fallback: true,
      message: candidates.length
        ? `未找到作者「${candidates.join('/')}」对应音色，回退到 Voice ID ${fbVoice}`
        : `未提供可匹配作者，回退到 Voice ID ${fbVoice}`,
    }
  }

  return {
    match_type: 'none',
    profile: null,
    author: String(author || '').trim(),
    candidates,
    fallback: true,
    message: candidates.length
      ? `未找到作者「${candidates.join('/')}」对应音色，且未配置回退音色`
      : '未提供作者，且未配置回退音色',
  }
}

export function serializeVoiceMatch(result) {
  const profile = result?.profile || null
  const remote = profile ? remoteVoiceId(profile) : ''
  return {
    match_type: result?.match_type || 'none',
    fallback: Boolean(result?.fallback),
    author: result?.author || '',
    candidates: Array.isArray(result?.candidates) ? result.candidates : [],
    message: result?.message || '',
    profile_id: profile?.id || null,
    label: profile?.label || null,
    friendly_name: profile ? friendlyVoiceName(profile) : null,
    provider: profile?.provider || null,
    remote_voice_id: remote || null,
    target_model: profile?.targetModel || profile?.target_model || null,
    status: profile?.status || null,
  }
}
