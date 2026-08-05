import { join } from 'node:path'
import { createCapabilityRegistry } from './registry.mjs'
import { createWebSearchTool } from './tools/web-search.mjs'
import { createWeatherTool } from './tools/weather.mjs'
import { createEpisodeMemoryTools } from './tools/episode-memory.mjs'
import { loadSkillsFromDir } from './skills/load-skills.mjs'
import {
  buildMcpProjectedTools,
  connectStdioMcpServer,
  loadMcpServerConfigs,
} from './mcp/client-registry.mjs'

export function resolveCapabilitiesPaths(config = {}) {
  const configDirectory = config.configDirectory || ''
  const capabilitiesDir = config.capabilitiesDir
    || (configDirectory ? join(configDirectory, 'capabilities') : '')
  const skillsDir = config.skillsDir
    || (capabilitiesDir ? join(capabilitiesDir, 'skills') : '')
  const mcpDir = config.mcpDir
    || (capabilitiesDir ? join(capabilitiesDir, 'mcp') : '')
  return { capabilitiesDir, skillsDir, mcpDir }
}

/**
 * Build the process-wide capability registry used by realtime TOOLS + handler.
 */
export async function resolveCapabilityRegistry(config = {}, {
  fetchImpl = globalThis.fetch,
  connectMcpServer = null,
  enableMcp = true,
  episodeStore = null,
  onEpisodeChanged = null,
} = {}) {
  const registry = createCapabilityRegistry()
  const { skillsDir, mcpDir } = resolveCapabilitiesPaths(config)

  registry.registerTool(createWebSearchTool({ fetchImpl }))
  registry.registerTool(createWeatherTool({ fetchImpl }))
  for (const tool of createEpisodeMemoryTools({
    episodeStore,
    onChanged: onEpisodeChanged,
  })) {
    registry.registerTool(tool)
  }

  const bundledSkillsDir = config.root
    ? join(config.root, 'config/skills')
    : ''
  const skillsByName = new Map()
  for (const skill of [
    ...loadSkillsFromDir(bundledSkillsDir),
    ...loadSkillsFromDir(skillsDir),
  ]) {
    skillsByName.set(skill.name, skill)
  }
  registry.setSkills([...skillsByName.values()])

  if (enableMcp) {
    const servers = loadMcpServerConfigs({
      mcpServersJson: config.mcpServersJson || '',
      mcpDir,
    })
    if (servers.length) {
      const { tools, health } = await buildMcpProjectedTools({
        servers,
        connectServer: connectMcpServer || connectStdioMcpServer,
        timeoutMs: Number(config.mcpToolTimeoutMs) || 8000,
      })
      for (const tool of tools) {
        registry.registerTool(tool)
      }
      registry.setMcpHealth(health)
    }
  }

  return registry
}
