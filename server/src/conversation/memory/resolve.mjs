import { resolve } from 'node:path'
import { createLocalMemoryProvider } from './local-provider.mjs'
import { createMem0MemoryProvider } from './mem0-provider.mjs'
import { createOpenVikingMemoryProvider } from './openviking-provider.mjs'
import { createEvermindMemoryProvider } from './evermind-provider.mjs'
import { MEMORY_PROVIDER_KINDS, assertMemoryProvider } from './provider.mjs'

export function resolveMemoryProviderKind(raw = process.env.MEMORY_PROVIDER) {
  const kind = String(raw || 'local').trim().toLowerCase() || 'local'
  if (!MEMORY_PROVIDER_KINDS.includes(kind)) {
    throw new Error(
      `unsupported MEMORY_PROVIDER=${raw}; use ${MEMORY_PROVIDER_KINDS.join('|')}`,
    )
  }
  return kind
}

export function resolveMemoryProvider(config = {}, env = process.env) {
  const kind = resolveMemoryProviderKind(env.MEMORY_PROVIDER ?? config.memoryProvider)
  const configDirectory = config.configDirectory
    || env.QWAUDIO_CONFIG_DIR
    || ''

  if (kind === 'mem0') {
    return assertMemoryProvider(createMem0MemoryProvider({
      apiKey: env.MEM0_API_KEY || config.mem0?.apiKey || '',
      host: env.MEM0_HOST || config.mem0?.host || '',
      orgId: env.MEM0_ORG_ID || config.mem0?.orgId || '',
      projectId: env.MEM0_PROJECT_ID || config.mem0?.projectId || '',
    }), 'mem0')
  }

  if (kind === 'openviking') {
    const memoriesDir = env.OPENVIKING_MEMORIES_DIR
      || config.openviking?.memoriesDir
      || (configDirectory
        ? resolve(configDirectory, 'memories/openviking')
        : resolve(process.cwd(), 'data/openviking/memories'))
    return assertMemoryProvider(createOpenVikingMemoryProvider({
      baseUrl: env.OPENVIKING_URL || config.openviking?.baseUrl || 'http://127.0.0.1:1933',
      apiKey: env.OPENVIKING_API_KEY || config.openviking?.apiKey || '',
      account: env.OPENVIKING_ACCOUNT || config.openviking?.account || 'default',
      user: env.OPENVIKING_USER || config.openviking?.user || 'default',
      memoriesDir,
      userProfilePath: config.userProfilePath,
      identityMode: config.identityMode,
    }), 'openviking')
  }

  if (kind === 'evermind') {
    const memoriesDir = env.EVERMIND_MEMORIES_DIR
      || config.evermind?.memoriesDir
      || (configDirectory
        ? resolve(configDirectory, 'memories/evermind')
        : resolve(process.cwd(), 'data/evermind/memories'))
    return assertMemoryProvider(createEvermindMemoryProvider({
      mode: env.EVERMIND_MODE || config.evermind?.mode || 'cloud',
      baseUrl: env.EVERMIND_BASE_URL || config.evermind?.baseUrl || '',
      apiKey: env.EVERMIND_API_KEY || env.EVEROS_API_KEY || config.evermind?.apiKey || '',
      userIdPrefix: env.EVERMIND_USER_PREFIX || config.evermind?.userIdPrefix || 'qwa',
      memoriesDir,
      userProfilePath: config.userProfilePath,
      identityMode: config.identityMode,
    }), 'evermind')
  }

  return assertMemoryProvider(createLocalMemoryProvider({
    frontendMemoryPath: config.frontendMemoryPath,
    userProfilePath: config.userProfilePath,
    identityMode: config.identityMode,
    maxOwners: config.maxFrontendMemoryOwners,
    ownerTtlMs: config.frontendMemoryOwnerTtlMs,
  }), 'local')
}
