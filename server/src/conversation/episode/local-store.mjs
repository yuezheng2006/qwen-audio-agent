import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { assertEpisodeStore } from './provider.mjs'
import { normalizeEpisodeContent } from './turn-capture.mjs'

export const DEFAULT_MAX_ENTRIES = 200

function safeOwnerFile(ownerId) {
  const raw = String(ownerId || 'default').trim() || 'default'
  return `${raw.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80)}.json`
}

function matchesQuery(episode, query) {
  const needle = String(query || '').trim().toLowerCase()
  if (!needle) return false
  return String(episode.content || '').toLowerCase().includes(needle)
    || String(episode.id || '').toLowerCase() === needle
}

export function createLocalEpisodeStore({
  dir,
  maxEntries = DEFAULT_MAX_ENTRIES,
  now = () => Date.now(),
} = {}) {
  if (!dir) throw new Error('episode store dir is required')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const cap = Math.max(1, Number(maxEntries) || DEFAULT_MAX_ENTRIES)
  const cache = new Map()

  function pathFor(ownerId) {
    return join(dir, safeOwnerFile(ownerId))
  }

  function load(ownerId) {
    const key = String(ownerId || 'default')
    if (cache.has(key)) return cache.get(key)
    const file = pathFor(key)
    let entries = []
    if (existsSync(file)) {
      try {
        const payload = JSON.parse(readFileSync(file, 'utf8'))
        entries = Array.isArray(payload.episodes) ? payload.episodes : []
      } catch {
        entries = []
      }
    }
    cache.set(key, entries)
    return entries
  }

  function save(ownerId, entries) {
    const key = String(ownerId || 'default')
    const trimmed = entries.slice(-cap)
    cache.set(key, trimmed)
    writeFileSync(
      pathFor(key),
      `${JSON.stringify({ version: 1, episodes: trimmed }, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    )
    return trimmed
  }

  const store = {
    append(ownerId, episode = {}) {
      const content = normalizeEpisodeContent(episode.content)
      if (!content) return null
      const entries = load(ownerId)
      const row = {
        id: String(episode.id || randomUUID()),
        at: Number(episode.at) || now(),
        role: String(episode.role || 'user'),
        content,
        source: String(episode.source || 'auto'),
        confidence: Number.isFinite(Number(episode.confidence))
          ? Number(episode.confidence)
          : 0.5,
        ttlDays: Number.isFinite(Number(episode.ttlDays))
          ? Number(episode.ttlDays)
          : 90,
      }
      // Dedup exact same content within last 3 entries.
      if (entries.slice(-3).some(item => item.content === row.content)) {
        return entries[entries.length - 1]
      }
      entries.push(row)
      save(ownerId, entries)
      return row
    },

    list(ownerId, { limit = 50 } = {}) {
      const capped = Math.min(cap, Math.max(1, Number(limit) || 50))
      return load(ownerId).slice(-capped)
    },

    search(ownerId, { query = '', limit = 20 } = {}) {
      const capped = Math.min(cap, Math.max(1, Number(limit) || 20))
      const entries = load(ownerId)
      if (!String(query || '').trim()) return entries.slice(-capped)
      return entries.filter(item => matchesQuery(item, query)).slice(-capped)
    },

    replace(ownerId, { id, query, content } = {}) {
      const nextContent = normalizeEpisodeContent(content)
      if (!nextContent) return null
      const entries = load(ownerId)
      let index = -1
      if (id) {
        index = entries.findIndex(item => item.id === String(id))
      } else if (query) {
        for (let i = entries.length - 1; i >= 0; i -= 1) {
          if (matchesQuery(entries[i], query)) {
            index = i
            break
          }
        }
      }
      if (index < 0) return null
      entries[index] = {
        ...entries[index],
        content: nextContent,
        source: 'user',
        confidence: 0.9,
        at: now(),
      }
      save(ownerId, entries)
      return entries[index]
    },

    forget(ownerId, {
      id,
      query,
      lastN,
      all = false,
    } = {}) {
      const entries = load(ownerId)
      if (!entries.length) return 0
      if (all) {
        save(ownerId, [])
        return entries.length
      }
      let next = entries
      if (id) {
        next = entries.filter(item => item.id !== String(id))
      } else if (query) {
        next = entries.filter(item => !matchesQuery(item, query))
      } else if (lastN) {
        const n = Math.max(0, Number(lastN) || 0)
        next = n ? entries.slice(0, Math.max(0, entries.length - n)) : entries
      } else {
        return 0
      }
      const removed = entries.length - next.length
      if (removed) save(ownerId, next)
      return removed
    },

    health() {
      let count = 0
      for (const entries of cache.values()) count += entries.length
      return {
        ok: true,
        enabled: true,
        kind: 'local',
        count,
        maxEntries: cap,
        dir,
      }
    },
  }

  return assertEpisodeStore(store, 'local')
}
