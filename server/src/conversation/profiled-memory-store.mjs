import { ALL_SCOPE, canonicalScope } from '../core/memory-scopes.mjs'

const SCOPES = new Set(['user', 'memory', ALL_SCOPE])

function normalizeScope(value, fallback = 'all') {
  const scope = canonicalScope(String(value || fallback))
  if (!SCOPES.has(scope)) throw new Error(`unsupported memory scope: ${scope}`)
  return scope
}

export class ProfiledMemoryStore {
  constructor({ memoryStore, userProfile = null } = {}) {
    this.memoryStore = memoryStore
    this.userProfile = userProfile
  }

  list(ownerId, options = {}) {
    const limit = Math.min(20, Math.max(1, Number(options.limit) || 20))
    const scope = normalizeScope(options.scope)
    const profile = scope === 'memory'
      ? []
      : this.userProfile?.list({ query: options.query }) || []
    const longTerm = scope === 'user'
      ? []
      : this.memoryStore?.list(ownerId, {
          query: options.query,
          limit,
        }) || []
    return [...profile, ...longTerm].slice(0, limit)
  }

  remember(ownerId, { scope, content } = {}) {
    const target = normalizeScope(scope, 'long_term')
    if (target === ALL_SCOPE) throw new Error('remember requires a concrete memory scope')
    if (target === 'user') {
      if (!this.userProfile) throw new Error('user profile is unavailable')
      return this.userProfile.remember(content)
    }
    if (!this.memoryStore) throw new Error('long-term memory is unavailable')
    return this.memoryStore.remember(ownerId, content)
  }

  replace(ownerId, { scope, ids, content } = {}) {
    const target = normalizeScope(scope)
    if (target === ALL_SCOPE) throw new Error('replace requires a concrete memory scope')
    if (target === 'user') {
      if (!this.userProfile) throw new Error('user profile is unavailable')
      return this.userProfile.replace({ ids, content })
    }
    if (!this.memoryStore) throw new Error('long-term memory is unavailable')
    return this.memoryStore.replace(ownerId, { ids, content })
  }

  forget(ownerId, { scope, query, all = false } = {}) {
    const target = normalizeScope(scope)
    let removed = 0
    if (target !== 'memory') {
      removed += this.userProfile?.forget({ query, all }) || 0
    }
    if (target !== 'user') {
      removed += this.memoryStore?.forget(ownerId, { query, all }) || 0
    }
    return removed
  }

  health() {
    return {
      ...(this.memoryStore?.health() || {
        ok: true,
        persistenceEnabled: false,
        warning: null,
        owners: 0,
      }),
      userProfile: this.userProfile?.health() || {
        ok: true,
        configured: false,
        warning: null,
      },
    }
  }
}
