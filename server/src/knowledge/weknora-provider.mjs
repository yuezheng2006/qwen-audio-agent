import { assertKnowledgeProvider } from './provider.mjs'
import { createLocalKnowledgeProvider } from './local-provider.mjs'

function asList(value) {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') {
    return value.hits || value.results || value.items || value.data || []
  }
  return []
}

function mapHit(raw, index, kbId) {
  const row = raw && typeof raw === 'object' ? raw : { content: String(raw || '') }
  const content = String(
    row.content || row.text || row.snippet || row.chunk || row.page_content || '',
  )
  const title = String(row.title || row.source_name || row.filename || row.name || 'weknora')
  const source = String(
    row.source || row.url || row.source_id || row.id || row.file_id || `hit_${index + 1}`,
  )
  return {
    id: String(row.id || source || `weknora_${index + 1}`),
    kbId: String(row.kb_id || row.knowledge_base_id || kbId || ''),
    sourceId: source,
    title,
    relativePath: String(row.path || row.relative_path || source),
    heading: String(row.heading || row.section || ''),
    content,
    score: Number(row.score ?? row.rank ?? row.similarity ?? 0),
  }
}

function joinUrl(baseUrl, path) {
  const root = String(baseUrl || '').replace(/\/+$/, '')
  const suffix = String(path || '').replace(/^\/+/, '')
  return `${root}/${suffix}`
}

export function createWeknoraKnowledgeProvider({
  baseUrl,
  apiKey = '',
  kbIds = [],
  timeoutMs = 8000,
  fetchImpl = globalThis.fetch,
  fallbackLocal = null,
} = {}) {
  const ids = (Array.isArray(kbIds) ? kbIds : String(kbIds || '').split(','))
    .map(value => String(value || '').trim())
    .filter(Boolean)

  async function request(path, {
    method = 'GET',
    body,
  } = {}) {
    if (!baseUrl) {
      const error = new Error('WEKNORA_BASE_URL is not configured')
      error.code = 'weknora_unconfigured'
      throw error
    }
    if (typeof fetchImpl !== 'function') {
      const error = new Error('fetch is not available')
      error.code = 'weknora_fetch_unavailable'
      throw error
    }
    const headers = { Accept: 'application/json' }
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const response = await fetchImpl(joinUrl(baseUrl, path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await response.text()
    let payload = {}
    try {
      payload = text ? JSON.parse(text) : {}
    } catch {
      payload = { raw: text }
    }
    if (!response.ok) {
      const error = new Error(
        payload.error || payload.message || `WeKnora HTTP ${response.status}`,
      )
      error.code = response.status === 401 ? 'weknora_unauthorized' : 'weknora_http'
      error.status = response.status
      throw error
    }
    return payload
  }

  async function searchRemote(query, { kbId, limit } = {}) {
    const targetIds = kbId ? [kbId] : (ids.length ? ids : [''])
    const hits = []
    for (const id of targetIds) {
      const path = id
        ? `api/v1/knowledge-bases/${encodeURIComponent(id)}/search`
        : 'api/v1/knowledge-search'
      const payload = await request(path, {
        method: 'POST',
        body: {
          query,
          top_k: limit,
          knowledge_base_ids: id ? [id] : ids,
        },
      })
      const rows = asList(payload.data ?? payload)
      hits.push(...rows.map((row, index) => mapHit(row, hits.length + index, id)))
    }
    return hits
      .filter(hit => hit.content || hit.title)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  const provider = {
    kind: 'weknora',
    async ingest({ kbId } = {}) {
      return {
        sources: [],
        chunks: [],
        kbId: kbId || ids[0] || 'weknora',
        remote: true,
      }
    },
    async search(query, { kbId, limit = 6 } = {}) {
      const needle = String(query || '').trim()
      if (!needle) return []
      const top = Math.min(20, Math.max(1, Number(limit) || 6))
      try {
        return await searchRemote(needle, { kbId, limit: top })
      } catch (error) {
        if (fallbackLocal?.search) {
          return fallbackLocal.search(needle, { kbId, limit: top })
        }
        throw error
      }
    },
    async listSources({ kbId } = {}) {
      if (kbId) return [{ id: kbId, title: kbId, kbId }]
      if (ids.length) {
        return ids.map(id => ({ id, title: id, kbId: id }))
      }
      try {
        const payload = await request('api/v1/knowledge-bases')
        return asList(payload.data ?? payload).map((row, index) => ({
          id: String(row.id || row.kb_id || `kb_${index + 1}`),
          title: String(row.name || row.title || row.id || 'knowledge-base'),
          kbId: String(row.id || row.kb_id || ''),
        }))
      } catch {
        return []
      }
    },
    async health() {
      const started = Date.now()
      if (!baseUrl) {
        return {
          kind: 'weknora',
          ok: false,
          format: 'markdown',
          warning: 'WEKNORA_BASE_URL is empty; management stays in WeKnora UI',
        }
      }
      const paths = ['health', 'api/health', 'api/v1/health']
      let lastError = null
      for (const path of paths) {
        try {
          await request(path)
          return {
            kind: 'weknora',
            ok: true,
            format: 'markdown',
            kbIds: ids,
            healthPath: path,
            latencyMs: Date.now() - started,
            warning: null,
          }
        } catch (error) {
          lastError = error
        }
      }
      return {
        kind: 'weknora',
        ok: false,
        format: 'markdown',
        kbIds: ids,
        latencyMs: Date.now() - started,
        warning: lastError?.message || 'WeKnora health probe failed',
      }
    },
  }

  return assertKnowledgeProvider(provider, 'weknora')
}

export function createWeknoraProviderFromConfig(config = {}, env = process.env) {
  const weknora = config.weknora || {}
  const fallback = weknora.fallbackLocal || ['1', 'true'].includes(
    String(env.WEKNORA_FALLBACK_LOCAL || '').toLowerCase(),
  )
    ? createLocalKnowledgeProvider({
      knowledgeDir: config.knowledgeDir,
      defaultKbId: config.knowledgeDefaultKbId || 'default',
    })
    : null
  return createWeknoraKnowledgeProvider({
    baseUrl: weknora.baseUrl || env.WEKNORA_BASE_URL,
    apiKey: weknora.apiKey || env.WEKNORA_API_KEY,
    kbIds: weknora.kbIds || env.WEKNORA_KB_IDS,
    timeoutMs: weknora.timeoutMs,
    fallbackLocal: fallback,
  })
}
