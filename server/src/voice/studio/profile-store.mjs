import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

function safeOwnerFile(ownerId) {
  const raw = String(ownerId || 'default').trim() || 'default'
  return `${raw.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80)}.json`
}

function normalizeProfile(ownerId, profile = {}, { now, isNew }) {
  const ts = now()
  const id = String(profile.id || randomUUID())
  const key = String(ownerId || 'default')
  return {
    label: String(profile.label || ''),
    source: String(profile.source || 'preset'),
    presetId: profile.presetId ?? null,
    sampleRef: profile.sampleRef ?? null,
    provider: String(profile.provider || ''),
    remoteId: String(profile.remoteId || ''),
    targetModel: profile.targetModel ?? null,
    status: String(profile.status || 'draft'),
    error: profile.error ?? null,
    providerPayload: profile.providerPayload ?? null,
    confirmedAt: profile.confirmedAt ?? null,
    ...profile,
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

    get(ownerId, id) {
      const needle = String(id || '')
      if (!needle) return null
      return load(ownerId).find(item => item.id === needle) ?? null
    },

    list(ownerId, { status } = {}) {
      const profiles = load(ownerId)
      const filter = String(status || '').trim()
      if (!filter) return [...profiles]
      return profiles.filter(item => item.status === filter)
    },

    updateStatus(ownerId, id, patch = {}) {
      const profiles = load(ownerId)
      const index = profiles.findIndex(item => item.id === String(id))
      if (index < 0) return null
      const row = {
        ...profiles[index],
        ...patch,
        status: String(patch.status ?? profiles[index].status),
        updatedAt: now(),
      }
      profiles[index] = row
      save(ownerId, profiles)
      return row
    },
  }
}
