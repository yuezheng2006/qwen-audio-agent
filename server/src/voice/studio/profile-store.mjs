import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

const MAX_TAG_LEN = 32
const MAX_TAGS = 16
const DEFAULT_PROFILE_CAPABILITIES = Object.freeze(['speech.synthesize'])

export function invalidTagsError(message = '标签不合法') {
  const error = new Error(message)
  error.code = 'invalid_tags'
  return error
}

export function normalizeTags(input) {
  if (input === undefined || input === null) return []
  let raw
  if (Array.isArray(input)) {
    raw = input
  } else if (typeof input === 'string') {
    raw = input.split(',')
  } else {
    throw invalidTagsError('tags 必须是数组或逗号分隔字符串')
  }
  const tags = []
  const seen = new Set()
  for (const item of raw) {
    const tag = String(item || '').trim().toLowerCase()
    if (!tag) continue
    if (tag.length > MAX_TAG_LEN) {
      throw invalidTagsError(`单个标签最长 ${MAX_TAG_LEN} 字符`)
    }
    if (seen.has(tag)) continue
    seen.add(tag)
    tags.push(tag)
  }
  if (tags.length > MAX_TAGS) {
    throw invalidTagsError(`每个音色最多 ${MAX_TAGS} 个标签`)
  }
  return tags
}

export function normalizeFavorite(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true
  return false
}

function safeTagsFromStored(value) {
  try {
    return normalizeTags(value ?? [])
  } catch {
    return []
  }
}

export function filterGalleryProfiles(profiles, {
  favorite,
  tag,
  q,
} = {}) {
  let rows = Array.isArray(profiles) ? [...profiles] : []
  if (favorite === true || favorite === 1 || favorite === '1' || favorite === 'true') {
    rows = rows.filter(item => Boolean(item.favorite))
  }
  const tagFilter = String(tag || '').trim().toLowerCase()
  if (tagFilter) {
    rows = rows.filter(item => (
      Array.isArray(item.tags) && item.tags.includes(tagFilter)
    ))
  }
  const query = String(q || '').trim().toLowerCase()
  if (query) {
    rows = rows.filter(item => {
      const hay = [
        item.label,
        item.remoteId,
        item.remote_voice_id,
        item.provider,
      ].map(value => String(value || '').toLowerCase()).join(' ')
      return hay.includes(query)
    })
  }
  return rows
}

export function computeTagCounts(profiles = []) {
  const counts = {}
  for (const profile of profiles) {
    const tags = Array.isArray(profile.tags) ? profile.tags : []
    for (const tag of tags) {
      const key = String(tag || '').trim().toLowerCase()
      if (!key) continue
      counts[key] = (counts[key] || 0) + 1
    }
  }
  return counts
}

function safeOwnerFile(ownerId) {
  const raw = String(ownerId || 'default').trim() || 'default'
  return `${raw.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80)}.json`
}

function normalizeProfile(ownerId, profile = {}, { now, isNew }) {
  const ts = now()
  const id = String(profile.id || randomUUID())
  const key = String(ownerId || 'default')
  const favorite = Object.prototype.hasOwnProperty.call(profile, 'favorite')
    ? normalizeFavorite(profile.favorite)
    : false
  const tags = Object.prototype.hasOwnProperty.call(profile, 'tags')
    ? normalizeTags(profile.tags)
    : safeTagsFromStored(profile.tags)
  return {
    label: String(profile.label || ''),
    source: String(profile.source || 'preset'),
    presetId: profile.presetId ?? null,
    sampleRef: profile.sampleRef ?? null,
    provider: String(profile.provider || ''),
    runtime: String(profile.runtime || 'remote'),
    capabilities: Array.isArray(profile.capabilities)
      ? [...new Set(profile.capabilities.map(String).filter(Boolean))]
      : [...DEFAULT_PROFILE_CAPABILITIES],
    remoteId: String(profile.remoteId || ''),
    targetModel: profile.targetModel ?? null,
    status: String(profile.status || 'draft'),
    error: profile.error ?? null,
    providerPayload: profile.providerPayload ?? null,
    confirmedAt: profile.confirmedAt ?? null,
    ...profile,
    favorite,
    tags,
    id,
    ownerId: key,
    createdAt: isNew ? ts : (Number(profile.createdAt) || ts),
    updatedAt: ts,
  }
}

export function createVoiceProfileStore({
  dir,
  now = () => Date.now(),
} = {}) {
  if (!dir) throw new Error('voice profile store dir is required')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const cache = new Map()

  function pathFor(ownerId) {
    return join(dir, safeOwnerFile(ownerId))
  }

  function load(ownerId) {
    const key = String(ownerId || 'default')
    if (cache.has(key)) return cache.get(key)
    const file = pathFor(key)
    let profiles = []
    if (existsSync(file)) {
      try {
        const payload = JSON.parse(readFileSync(file, 'utf8'))
        profiles = Array.isArray(payload.profiles) ? payload.profiles : []
      } catch {
        profiles = []
      }
    }
    // Hydrate defaults for older rows without mutating disk until next write.
    profiles = profiles.map(item => ({
      ...item,
      favorite: normalizeFavorite(item?.favorite),
      tags: safeTagsFromStored(item?.tags),
    }))
    cache.set(key, profiles)
    return profiles
  }

  function save(ownerId, profiles) {
    const key = String(ownerId || 'default')
    cache.set(key, profiles)
    writeFileSync(
      pathFor(key),
      `${JSON.stringify({ version: 1, profiles }, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    )
    return profiles
  }

  return {
    upsert(ownerId, profile = {}) {
      const profiles = load(ownerId)
      const id = profile.id ? String(profile.id) : null
      const index = id ? profiles.findIndex(item => item.id === id) : -1
      const row = normalizeProfile(
        ownerId,
        index >= 0 ? { ...profiles[index], ...profile } : profile,
        { now, isNew: index < 0 },
      )
      if (index >= 0) {
        profiles[index] = row
      } else {
        profiles.push(row)
      }
      save(ownerId, profiles)
      return row
    },

    patch(ownerId, id, patch = {}) {
      const profiles = load(ownerId)
      const index = profiles.findIndex(item => item.id === String(id))
      if (index < 0) return null
      const current = profiles[index]
      const next = { ...current }
      if (Object.prototype.hasOwnProperty.call(patch, 'favorite')) {
        next.favorite = normalizeFavorite(patch.favorite)
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'tags')) {
        next.tags = normalizeTags(patch.tags)
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'label')) {
        next.label = String(patch.label || '').trim()
      }
      next.updatedAt = now()
      profiles[index] = next
      save(ownerId, profiles)
      return next
    },

    remove(ownerId, id) {
      const profiles = load(ownerId)
      const index = profiles.findIndex(item => item.id === String(id))
      if (index < 0) return null
      const [removed] = profiles.splice(index, 1)
      save(ownerId, profiles)
      return removed
    },

    get(ownerId, id) {
      const needle = String(id || '')
      if (!needle) return null
      return load(ownerId).find(item => item.id === needle) ?? null
    },

    list(ownerId, { status, favorite, tag, q } = {}) {
      const profiles = load(ownerId)
      const filter = String(status || '').trim()
      const base = filter
        ? profiles.filter(item => item.status === filter)
        : [...profiles]
      return filterGalleryProfiles(base, { favorite, tag, q })
    },

    updateStatus(ownerId, id, patch = {}) {
      const profiles = load(ownerId)
      const index = profiles.findIndex(item => item.id === String(id))
      if (index < 0) return null
      const row = {
        ...profiles[index],
        ...patch,
        status: String(patch.status ?? profiles[index].status),
        favorite: Object.prototype.hasOwnProperty.call(patch, 'favorite')
          ? normalizeFavorite(patch.favorite)
          : normalizeFavorite(profiles[index].favorite),
        tags: Object.prototype.hasOwnProperty.call(patch, 'tags')
          ? normalizeTags(patch.tags)
          : safeTagsFromStored(profiles[index].tags),
        updatedAt: now(),
      }
      profiles[index] = row
      save(ownerId, profiles)
      return row
    },
  }
}
