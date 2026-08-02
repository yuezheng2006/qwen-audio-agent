import { assertMemoryProvider } from './provider.mjs'

/**
 * Mem0 skeleton. Without API credentials the provider reports unhealthy and
 * all write/recall paths fail with a clear message. Wire the real SDK later.
 */
export function createMem0MemoryProvider({
  apiKey = '',
  host = '',
  orgId = '',
  projectId = '',
} = {}) {
  const configured = Boolean(String(apiKey || '').trim())
  const unavailable = (action) => {
    const error = new Error(
      configured
        ? `mem0 provider is configured but "${action}" is not implemented yet`
        : 'mem0 provider is unavailable (set MEM0_API_KEY)',
    )
    error.code = configured ? 'mem0_not_implemented' : 'mem0_unconfigured'
    throw error
  }

  const provider = {
    kind: 'mem0',
    list() {
      if (!configured) return []
      unavailable('list')
    },
    remember() {
      unavailable('remember')
    },
    replace() {
      unavailable('replace')
    },
    forget() {
      unavailable('forget')
    },
    health() {
      return {
        kind: 'mem0',
        ok: false,
        persistenceEnabled: false,
        configured,
        host: host || null,
        orgId: orgId || null,
        projectId: projectId || null,
        warning: configured
          ? 'mem0 provider skeleton only; wire the SDK before use'
          : 'MEM0_API_KEY is not set',
        owners: 0,
        userProfile: {
          ok: true,
          configured: false,
          warning: null,
        },
      }
    },
  }
  return assertMemoryProvider(provider, 'mem0')
}
