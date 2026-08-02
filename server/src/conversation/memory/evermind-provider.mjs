import { resolve } from 'node:path'
import { UserProfile } from '../user-profile.mjs'
import { assertMemoryProvider } from './provider.mjs'
import { MarkdownMemoryFs } from './md-memory-fs.mjs'
import { httpJson } from './http-json.mjs'

/**
 * EverMind / EverOS memory provider.
 *
 * Modes:
 *   cloud — https://api.evermind.ai  (Bearer EVERMIND_API_KEY)
 *   oss   — self-hosted EverOS       (EVERMIND_BASE_URL, often http://127.0.0.1:… )
 *
 * long_term always mirrors into local Markdown (md-first readable cache).
 * profile stays on local USER.md when identityMode=personal.
 */
export function createEvermindMemoryProvider({
  mode = 'cloud',
  baseUrl = '',
  apiKey = '',
  userIdPrefix = 'qwa',
  memoriesDir,
  userProfilePath = null,
  identityMode = 'personal',
  fetchImpl = globalThis.fetch,
  timeoutMs = 20_000,
} = {}) {
  const kind = String(mode || 'cloud').toLowerCase() === 'oss' ? 'oss' : 'cloud'
  const root = String(
    baseUrl
    || (kind === 'oss' ? 'http://127.0.0.1:8080' : 'https://api.evermind.ai'),
  ).replace(/\/+$/, '')
  const configured = kind === 'oss' || Boolean(String(apiKey || '').trim())
  const md = new MarkdownMemoryFs({
    rootDir: memoriesDir || resolve(process.cwd(), 'data/evermind/memories'),
  })
  const profile = identityMode === 'personal' && userProfilePath
    ? new UserProfile({ filePath: userProfilePath })
    : null

  const authHeaders = apiKey
    ? { Authorization: `Bearer ${apiKey}` }
    : {}

  function remoteUserId(ownerId) {
    return `${userIdPrefix}_${String(ownerId || 'default').replace(/[^\w.-]+/g, '_')}`
  }

  async function everHealth() {
    if (!configured && kind === 'cloud') return false
    try {
      if (kind === 'oss') {
        const data = await httpJson(`${root}/health`, {
          headers: authHeaders,
          timeoutMs: Math.min(timeoutMs, 3000),
          fetchImpl,
        })
        return Boolean(data?.status === 'ok' || data?.ok || data?.healthy)
      }
      // Cloud: cheap authenticated probe via empty search
      await httpJson(`${root}/api/v1/memories/search`, {
        method: 'POST',
        headers: authHeaders,
        timeoutMs: Math.min(timeoutMs, 5000),
        fetchImpl,
        body: {
          query: 'ping',
          filters: { user_id: `${userIdPrefix}_healthcheck` },
          method: 'keyword',
          top_k: 1,
        },
      })
      return true
    } catch (error) {
      // 401/403 means reachable but key wrong — still "configured path"
      if (error.status === 401 || error.status === 403) return false
      return false
    }
  }

  async function everSearch(ownerId, query, limit = 8) {
    const userId = remoteUserId(ownerId)
    if (kind === 'cloud') {
      const data = await httpJson(`${root}/api/v1/memories/search`, {
        method: 'POST',
        headers: authHeaders,
        timeoutMs,
        fetchImpl,
        body: {
          query,
          filters: { user_id: userId },
          method: 'hybrid',
          top_k: limit,
        },
      })
      return flattenCloudSearch(data)
    }
    const data = await httpJson(`${root}/api/v1/memory/search`, {
      method: 'POST',
      headers: authHeaders,
      timeoutMs,
      fetchImpl,
      body: {
        user_id: userId,
        query,
        method: 'hybrid',
        top_k: limit,
      },
    })
    return flattenOssSearch(data)
  }

  async function everAdd(ownerId, content) {
    const userId = remoteUserId(ownerId)
    const now = Date.now()
    const messages = [
      { role: 'user', content: `请记住：${content}`, timestamp: now },
      { role: 'assistant', content: '好的，已记下。', timestamp: now + 1 },
    ]
    if (kind === 'cloud') {
      await httpJson(`${root}/api/v1/memories`, {
        method: 'POST',
        headers: authHeaders,
        timeoutMs,
        fetchImpl,
        body: {
          user_id: userId,
          session_id: `qwa_${now}`,
          messages,
        },
      })
      await httpJson(`${root}/api/v1/memories/flush`, {
        method: 'POST',
        headers: authHeaders,
        timeoutMs,
        fetchImpl,
        body: { user_id: userId, session_id: `qwa_${now}` },
      })
      return
    }
    await httpJson(`${root}/api/v1/memory/add`, {
      method: 'POST',
      headers: authHeaders,
      timeoutMs,
      fetchImpl,
      body: {
        session_id: `qwa_${now}`,
        app_id: 'qwen-audio-agent',
        project_id: 'default',
        messages,
      },
    })
    await httpJson(`${root}/api/v1/memory/flush`, {
      method: 'POST',
      headers: authHeaders,
      timeoutMs,
      fetchImpl,
      body: {
        session_id: `qwa_${now}`,
        app_id: 'qwen-audio-agent',
        project_id: 'default',
      },
    })
  }

  const provider = {
    kind: 'evermind',
    async list(ownerId, { scope = 'all', query = '', limit = 20 } = {}) {
      const profileItems = scope === 'long_term'
        ? []
        : (profile?.list({ query }) || [])
      if (scope === 'profile') return profileItems

      let remote = []
      if (query && configured) {
        try {
          remote = await everSearch(ownerId, query, limit)
        } catch {
          remote = []
        }
      }
      const local = md.list({ query, limit })
      const merged = mergeByContent([...remote, ...local]).slice(0, limit)
      if (scope === 'long_term') return merged
      return [...profileItems, ...merged]
    },

    async remember(ownerId, { scope, content } = {}) {
      if (scope === 'profile') {
        if (!profile) throw new Error('user profile is unavailable')
        return profile.remember(content)
      }
      if (scope !== 'long_term') {
        throw new Error('evermind remember requires profile or long_term')
      }
      const saved = md.remember(content)
      if (!configured) {
        saved.warning = kind === 'cloud'
          ? 'markdown saved; set EVERMIND_API_KEY to sync EverOS Cloud'
          : 'markdown saved; EverMind OSS not configured'
        return saved
      }
      try {
        await everAdd(ownerId, content)
      } catch (error) {
        saved.warning = `markdown saved; EverMind sync failed: ${error.message}`
      }
      return saved
    },

    async replace(ownerId, { scope, ids = [], content } = {}) {
      if (scope === 'profile') {
        if (!profile) throw new Error('user profile is unavailable')
        return profile.replace({ ids, content })
      }
      await this.forget(ownerId, { scope: 'long_term', query: ids[0] || content })
      const memory = await this.remember(ownerId, { scope: 'long_term', content })
      return { replaced: 1, memory }
    },

    async forget(ownerId, { scope = 'all', query = '', all = false } = {}) {
      void ownerId
      let removed = 0
      if (scope !== 'long_term') {
        removed += profile?.forget({ query, all }) || 0
      }
      if (scope !== 'profile') {
        removed += md.forget({ query, all })
      }
      return removed
    },

    async health() {
      const online = configured ? await everHealth() : false
      const localCount = md.list({ limit: 64 }).length
      return {
        kind: 'evermind',
        mode: kind,
        ok: online || localCount >= 0,
        persistenceEnabled: true,
        format: 'markdown',
        configured,
        online,
        baseUrl: root,
        memoriesDir: md.rootDir,
        localCount,
        warning: !configured
          ? (kind === 'cloud'
            ? 'EVERMIND_API_KEY missing; local markdown only'
            : 'EverMind OSS endpoint not healthy; local markdown only')
          : (online ? null : `EverMind unreachable at ${root}; local markdown only`),
        userProfile: profile?.health() || {
          ok: true,
          configured: false,
          warning: null,
        },
      }
    },
  }

  return assertMemoryProvider(provider, 'evermind')
}

function flattenCloudSearch(data) {
  const payload = data?.data || data?.result || data || {}
  const episodes = payload.episodes || []
  const profiles = payload.profiles || []
  const hits = []
  for (const episode of episodes) {
    const content = String(
      episode.episode || episode.summary || episode.content || '',
    ).trim()
    if (!content) continue
    hits.push({
      id: `em_${episode.id || createShortId(content)}`,
      scope: 'long_term',
      content,
      updated_at: Number(episode.timestamp) || Date.now(),
      editable: false,
      source: 'evermind',
      memory_type: 'episodic_memory',
    })
    for (const fact of episode.atomic_facts || []) {
      const factText = String(fact.content || fact || '').trim()
      if (!factText) continue
      hits.push({
        id: `em_fact_${createShortId(factText)}`,
        scope: 'long_term',
        content: factText,
        updated_at: Date.now(),
        editable: false,
        source: 'evermind',
        memory_type: 'eventlog',
      })
    }
  }
  for (const row of profiles) {
    const profileData = row.profile_data || row.profile || row
    const content = typeof profileData === 'string'
      ? profileData
      : JSON.stringify(profileData)
    if (!content || content === '{}') continue
    hits.push({
      id: `em_profile_${createShortId(content)}`,
      scope: 'long_term',
      content: `profile: ${content}`,
      updated_at: Date.now(),
      editable: false,
      source: 'evermind',
      memory_type: 'profile',
    })
  }
  return hits
}

function flattenOssSearch(data) {
  const payload = data?.data || data?.result || data || {}
  const rows = payload.memories || payload.results || payload.items || []
  if (Array.isArray(rows)) {
    return rows.map((item, index) => ({
      id: `em_${item.id || createShortId(item.content || index)}`,
      scope: 'long_term',
      content: String(item.content || item.text || item.summary || '').trim(),
      updated_at: Number(item.updated_at || item.timestamp) || Date.now(),
      editable: false,
      source: 'evermind',
    })).filter(item => item.content)
  }
  return flattenCloudSearch(data)
}

function createShortId(value) {
  let hash = 0
  const text = String(value || '')
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash).toString(16).padStart(8, '0').slice(0, 12)
}

function mergeByContent(items) {
  const seen = new Set()
  const out = []
  for (const item of items) {
    const key = String(item.content || '').trim().toLocaleLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}
