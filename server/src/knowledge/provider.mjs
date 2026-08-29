/**
 * KnowledgeProvider contract (RAG over a fixed corpus).
 *
 *   ingest({ kbId? }) -> { sources, chunks }
 *   search(query, { kbId?, limit }) -> hits[]
 *   listSources({ kbId? }) -> sources[]
 *   health()
 */

export const KNOWLEDGE_PROVIDER_KINDS = ['local', 'none', 'weknora']

export function assertKnowledgeProvider(provider, kind = 'unknown') {
  if (!provider || typeof provider !== 'object') {
    throw new Error(`knowledge provider "${kind}" is invalid`)
  }
  for (const method of ['ingest', 'search', 'listSources', 'health']) {
    if (typeof provider[method] !== 'function') {
      throw new Error(`knowledge provider "${kind}" missing ${method}()`)
    }
  }
  return provider
}
