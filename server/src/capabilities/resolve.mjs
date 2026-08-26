import { join } from 'node:path'
import { createCapabilityRegistry } from './registry.mjs'
import { createWebSearchTool } from './tools/web-search.mjs'
import { createEpisodeMemoryTools } from './tools/episode-memory.mjs'
import { createVoiceStudioTools } from './tools/voice-studio.mjs'
import { createPluginHost } from '../plugins/host.mjs'
import { registerPluginsFromDirectories } from '../plugins/loader.mjs'
import { createWeatherPlugin } from '../plugins/builtin/weather.mjs'
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
  voiceStudioService = null,
} = {}) {
  const registry = createCapabilityRegistry()
  const { skillsDir, mcpDir } = resolveCapabilitiesPaths(config)

  const pluginHost = createPluginHost({
    grantedPermissions: [
      'network.open-meteo',
      ...(Array.isArray(config.pluginPermissions) ? config.pluginPermissions : []),
    ],
    context: {
      config,
      fetchImpl,
      registerTool: (tool, options = {}) => registry.registerTool({
        ...tool,
        source: options.source || tool.source || 'plugin',
      }),
    },
  })
  pluginHost.register(createWeatherPlugin({ fetchImpl }))
  const pluginDirectories = config.pluginsEnabled === false
    ? []
    : [config.pluginsDir || (config.configDirectory ? join(config.configDirectory, 'plugins') : '')]
  await registerPluginsFromDirectories(pluginHost, pluginDirectories)
  await pluginHost.activateAll()
  registry.setPluginHealth(pluginHost.health())

  registry.registerTool(createWebSearchTool({ fetchImpl }))
  for (const tool of createEpisodeMemoryTools({
    episodeStore,
    onChanged: onEpisodeChanged,
  })) {
    registry.registerTool(tool)
  }
  if (config.voiceStudioEnabled !== false && voiceStudioService) {
    for (const tool of createVoiceStudioTools({ service: voiceStudioService })) {
      registry.registerTool(tool)
    }
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
