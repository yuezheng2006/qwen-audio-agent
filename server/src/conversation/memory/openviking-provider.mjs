import { resolve } from 'node:path'
import { UserProfile } from '../user-profile.mjs'
import { assertMemoryProvider } from './provider.mjs'
import { MarkdownMemoryFs } from './md-memory-fs.mjs'
import { httpJson } from './http-json.mjs'

/**
 * OpenViking-backed memory.
 *
 * - long_term: Markdown files under memoriesDir (md-first readable store)
 *   + optional HTTP sync to local/remote OpenViking (`/api/v1/search/find`,
 *     session add/commit) when OPENVIKING_URL is healthy
 * - profile: still local USER.md when configured
 */
export function createOpenVikingMemoryProvider({
  baseUrl = 'http://127.0.0.1:1933',
  apiKey = '',
  account = 'default',
  user = 'default',
  memoriesDir,
  userProfilePath = null,
  identityMode = 'personal',
  fetchImpl = globalThis.fetch,
  timeoutMs = 15_000,
} = {}) {
  const root = String(baseUrl || '').replace(/\/+$/, '')
  const md = new MarkdownMemoryFs({
    rootDir: memoriesDir || resolve(process.cwd(), 'data/openviking/memories'),
  })
  const profile = identityMode === 'personal' && userProfilePath
    ? new UserProfile({ filePath: userProfilePath })
    : null

  const headers = apiKey ? { 'X-API-Key': apiKey } : {}

  async function ovHealth() {
    try {
      const data = await httpJson(`${root}/health`, {
        headers,
        timeoutMs: Math.min(timeoutMs, 3000),
        fetchImpl,
      })
      return Boolean(data?.healthy || data?.status === 'ok' || data?.ok)
    } catch {
      return false
    }
  }

  async function ovSearch(query, limit = 8) {
    if (!query) return []
    try {
      const data = await httpJson(`${root}/api/v1/search/find`, {
        method: 'POST',
        headers,
        timeoutMs,
        fetchImpl,
        body: {
          query,
          account,
          user,
          top_k: limit,
        },
      })
      const result = data?.result ?? data
      const rows = Array.isArray(result)
        ? result
        : (result?.results || result?.memories || [])
      return rows.map((item, index) => normalizeOvHit(item, index))
    } catch {
      return []
    }
  }

  async function ovRemember(content) {
    // Best-effort: create session → add user message → commit extraction
    const created = await httpJson(`${root}/api/v1/sessions`, {
      method: 'POST',
      headers,
      timeoutMs,
      fetchImpl,
      body: { account, user, label: 'qwen-audio-agent' },
    })
    const result = created?.result ?? created
    const sessionId = result?.session_id || result?.id
    if (!sessionId) throw new Error('OpenViking session_id missing')
    await httpJson(`${root}/api/v1/sessions/${sessionId}/messages/batch`, {
      method: 'POST',
      headers,
      timeoutMs,
      fetchImpl,
      body: {
        messages: [{ role: 'user', content: `请记住：${content}` }],
      },
    })
    await httpJson(`${root}/api/v1/sessions/${sessionId}/commit`, {
      method: 'POST',
      headers,
      timeoutMs,
      fetchImpl,
    })
  }

  const provider = {
    kind: 'openviking',
    async list(ownerId, { scope = 'all', query = '', limit = 20 } = {}) {
      void ownerId
      const profileItems = scope === 'long_term'
        ? []
        : (profile?.list({ query }) || [])
      if (scope === 'profile') return profileItems

      let remote = []
      if (query && await ovHealth()) {
        remote = await ovSearch(query, limit)
      }
      const local = md.list({ query, limit })
      const merged = mergeByContent([...remote, ...local]).slice(0, limit)
      if (scope === 'long_term') return merged
      return [...profileItems, ...merged]
    },

    async remember(ownerId, { scope, content } = {}) {
      void ownerId
      if (scope === 'profile') {
        if (!profile) throw new Error('user profile is unavailable')
        return profile.remember(content)
      }
      if (scope !== 'long_term') {
        throw new Error('openviking remember requires profile or long_term')
      }
      const saved = md.remember(content)
      if (await ovHealth()) {
        try {
          await ovRemember(content)
        } catch (error) {
          saved.warning = `markdown saved; OpenViking sync failed: ${error.message}`
        }
      } else {
        saved.warning = 'markdown saved; OpenViking offline'
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
      const online = await ovHealth()
      const localCount = md.list({ limit: 64 }).length
      return {
        kind: 'openviking',
        ok: online || localCount >= 0,
        persistenceEnabled: true,
        format: 'markdown',
        online,
        baseUrl: root,
        account,
        user,
        memoriesDir: md.rootDir,
        localCount,
        warning: online
          ? null
          : `OpenViking offline at ${root}; using local markdown memories`,
        userProfile: profile?.health() || {
          ok: true,
          configured: false,
          warning: null,
        },
      }
    },
  }

  return assertMemoryProvider(provider, 'openviking')
}

function normalizeOvHit(item, index) {
  const content = String(
    item?.content
    || item?.text
    || item?.abstract
    || item?.overview
    || item?.memory
    || '',
  ).trim()
  const uri = String(item?.uri || item?.id || `ov_${index}`)
  const id = `ov_${createShortId(uri + content)}`
  return {
    id,
    scope: 'long_term',
    content,
    updated_at: Number(item?.updated_at) || Date.now(),
    editable: false,
    source: 'openviking',
    uri,
  }
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
