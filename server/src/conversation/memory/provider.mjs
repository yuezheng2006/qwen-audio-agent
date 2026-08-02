/**
 * MemoryProvider contract.
 *
 * Implementations must mirror ProfiledMemoryStore's public surface so
 * HTTP `/api/memory` and the `user_memory` tool stay provider-agnostic.
 *
 * Methods may be sync or async — callers should `await maybeAwait(...)`.
 *
 *   list(ownerId, { scope, query, limit })
 *   remember(ownerId, { scope, content })
 *   replace(ownerId, { scope, ids, content })
 *   forget(ownerId, { scope, query, all })
 *   health()
 *
 * Kinds:
 *   local       — USER.md + frontend-memory.json
 *   mem0        — Mem0 skeleton
 *   openviking  — OpenViking HTTP + local markdown memories
 *   evermind    — EverOS Cloud/OSS + local markdown memories
 */

export const MEMORY_PROVIDER_KINDS = [
  'local',
  'mem0',
  'openviking',
  'evermind',
]

export function assertMemoryProvider(provider, kind = 'unknown') {
  if (!provider || typeof provider !== 'object') {
    throw new Error(`memory provider "${kind}" is invalid`)
  }
  for (const method of ['list', 'remember', 'replace', 'forget', 'health']) {
    if (typeof provider[method] !== 'function') {
      throw new Error(`memory provider "${kind}" missing ${method}()`)
    }
  }
  return provider
}

export async function maybeAwait(value) {
  return value && typeof value.then === 'function' ? value : value
}
