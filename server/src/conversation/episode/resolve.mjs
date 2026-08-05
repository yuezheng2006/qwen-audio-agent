import { resolve } from 'node:path'
import { homedir } from 'node:os'
import {
  assertEpisodeStore,
  createNoopEpisodeStore,
} from './provider.mjs'
import { createLocalEpisodeStore } from './local-store.mjs'
import { DEFAULT_EPISODE_PROMPT_LIMIT } from './recall.mjs'

function truthyEnv(value, fallback = true) {
  if (value == null || value === '') return fallback
  const normalized = String(value).trim().toLowerCase()
  if (['0', 'false', 'off', 'no'].includes(normalized)) return false
  if (['1', 'true', 'on', 'yes'].includes(normalized)) return true
  return fallback
}

export function resolveEpisodeConfig(env = process.env, {
  configDirectory = '',
} = {}) {
  const enabled = truthyEnv(env.EPISODE_MEMORY, true)
  const dir = env.EPISODE_DIR
    ? resolve(env.EPISODE_DIR)
    : resolve(
      configDirectory || resolve(homedir(), '.config/qwaudio'),
      'episodes',
    )
  const promptLimit = Math.min(
    20,
    Math.max(0, Number(env.EPISODE_PROMPT_LIMIT) || DEFAULT_EPISODE_PROMPT_LIMIT),
  )
  const maxEntries = Math.min(
    2000,
    Math.max(10, Number(env.EPISODE_MAX_ENTRIES) || 200),
  )
  return { enabled, dir, promptLimit, maxEntries }
}

export function resolveEpisodeStore(config = {}, env = process.env) {
  const resolved = resolveEpisodeConfig(env, {
    configDirectory: config.configDirectory || '',
  })
  const enabled = config.episodeMemoryEnabled != null
    ? Boolean(config.episodeMemoryEnabled)
    : resolved.enabled
  if (!enabled) {
    return assertEpisodeStore(createNoopEpisodeStore(), 'noop')
  }
  return createLocalEpisodeStore({
    dir: config.episodeDir || resolved.dir,
    maxEntries: config.episodeMaxEntries || resolved.maxEntries,
  })
}
