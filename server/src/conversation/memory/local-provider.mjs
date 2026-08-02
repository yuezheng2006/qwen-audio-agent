import { FrontendMemoryStore } from '../frontend-memory.mjs'
import { ProfiledMemoryStore } from '../profiled-memory-store.mjs'
import { UserProfile } from '../user-profile.mjs'
import { assertMemoryProvider } from './provider.mjs'

/**
 * Default local provider: USER.md profile + frontend-memory.json long_term.
 * Profile is already markdown-first; long_term keeps the existing store.
 */
export function createLocalMemoryProvider({
  frontendMemoryPath,
  userProfilePath = null,
  identityMode = 'personal',
  maxOwners = 1000,
  ownerTtlMs = 0,
} = {}) {
  const memoryStore = new FrontendMemoryStore({
    filePath: frontendMemoryPath,
    maxOwners,
    ownerTtlMs,
  })
  const provider = new ProfiledMemoryStore({
    memoryStore,
    userProfile: identityMode === 'personal' && userProfilePath
      ? new UserProfile({ filePath: userProfilePath })
      : null,
  })
  const wrapped = {
    kind: 'local',
    list: (...args) => provider.list(...args),
    remember: (...args) => provider.remember(...args),
    replace: (...args) => provider.replace(...args),
    forget: (...args) => provider.forget(...args),
    health: () => ({
      kind: 'local',
      ...provider.health(),
    }),
  }
  return assertMemoryProvider(wrapped, 'local')
}
