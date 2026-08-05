/**
 * EpisodeStore contract — plot/event memory orthogonal to MemoryProvider.
 *
 *   append(ownerId, episode)
 *   list(ownerId, { limit })
 *   search(ownerId, { query, limit })
 *   replace(ownerId, { id, content } | { query, content })
 *   forget(ownerId, { id, query, lastN, all })
 *   health()
 */

export function assertEpisodeStore(store, kind = 'unknown') {
  if (!store || typeof store !== 'object') {
    throw new Error(`episode store "${kind}" is invalid`)
  }
  for (const method of ['append', 'list', 'search', 'replace', 'forget', 'health']) {
    if (typeof store[method] !== 'function') {
      throw new Error(`episode store "${kind}" missing ${method}()`)
    }
  }
  return store
}

export async function maybeAwait(value) {
  return value && typeof value.then === 'function' ? value : value
}

export function createNoopEpisodeStore() {
  return {
    append() {
      return null
    },
    list() {
      return []
    },
    search() {
      return []
    },
    replace() {
      return null
    },
    forget() {
      return 0
    },
    health() {
      return {
        ok: true,
        enabled: false,
        kind: 'noop',
        count: 0,
        maxEntries: 0,
        dir: null,
      }
    },
  }
}
