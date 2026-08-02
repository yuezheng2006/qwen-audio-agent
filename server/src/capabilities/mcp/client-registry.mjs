import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectMcpTools } from './project-tools.mjs'

function parseServersJson(raw) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed
    if (Array.isArray(parsed.servers)) return parsed.servers
    return []
  } catch {
    return []
  }
}

export function loadMcpServerConfigs({
  mcpServersJson = '',
  mcpDir = '',
} = {}) {
  const fromEnv = parseServersJson(mcpServersJson)
  const fromDir = []
  if (mcpDir && existsSync(mcpDir)) {
    for (const name of readdirSync(mcpDir)) {
      if (!name.endsWith('.json')) continue
      try {
        const payload = JSON.parse(readFileSync(join(mcpDir, name), 'utf8'))
        const server = payload.server || payload
        if (server?.name && (server.command || server.url || server.transport)) {
          fromDir.push(server)
        }
      } catch {
        // skip bad files
      }
    }
  }
  const merged = new Map()
  for (const server of [...fromEnv, ...fromDir]) {
    const name = String(server.name || '').trim()
    if (!name) continue
    merged.set(name, {
      name,
      transport: server.transport || (server.url ? 'http' : 'stdio'),
      command: server.command || '',
      args: Array.isArray(server.args) ? server.args : [],
      url: server.url || '',
      env: server.env && typeof server.env === 'object' ? server.env : {},
      allowDangerous: Boolean(server.allowDangerous),
      whitelist: Array.isArray(server.whitelist) ? server.whitelist : null,
      enabled: server.enabled !== false,
    })
  }
  return [...merged.values()].filter(server => server.enabled)
}

/**
 * Connect whitelist MCP servers and project safe tools.
 * `connectServer` is injectable for tests / real SDK wiring.
 */
export async function buildMcpProjectedTools({
  servers = [],
  connectServer,
  timeoutMs = 8000,
} = {}) {
  const healthServers = []
  const projected = []
  if (typeof connectServer !== 'function') {
    return {
      tools: [],
      health: { servers: [], toolCount: 0 },
    }
  }

  for (const server of servers) {
    const entry = {
      name: server.name,
      status: 'disconnected',
      toolCount: 0,
      error: '',
    }
    try {
      const client = await connectServer(server)
      let tools = await client.listTools()
      if (server.whitelist) {
        const allow = new Set(server.whitelist)
        tools = tools.filter(tool => allow.has(tool.name))
      }
      const mapped = projectMcpTools({
        serverName: server.name,
        tools,
        allowDangerous: server.allowDangerous,
        timeoutMs,
        callTool: async ({ toolName, arguments: args, signal }) => (
          client.callTool(toolName, args, { signal })
        ),
      })
      projected.push(...mapped)
      entry.status = 'ok'
      entry.toolCount = mapped.length
    } catch (error) {
      entry.status = 'error'
      entry.error = String(error.message || error).slice(0, 200)
    }
    healthServers.push(entry)
  }

  return {
    tools: projected,
    health: {
      servers: healthServers,
      toolCount: projected.length,
    },
  }
}

/**
 * Optional real stdio connector using @modelcontextprotocol/sdk.
 * Lazy-imported so unit tests need not boot MCP.
 */
export async function connectStdioMcpServer(server) {
  if (!server.command) {
    throw new Error(`MCP server ${server.name} missing command`)
  }
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { StdioClientTransport } = await import(
    '@modelcontextprotocol/sdk/client/stdio.js'
  )
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args || [],
    env: { ...process.env, ...(server.env || {}) },
  })
  const client = new Client({ name: 'qwen-audio-agent', version: '1.0.0' })
  await client.connect(transport)
  return {
    async listTools() {
      const result = await client.listTools()
      return result.tools || []
    },
    async callTool(name, args) {
      const result = await client.callTool({
        name,
        arguments: args || {},
      })
      if (Array.isArray(result.content)) {
        return result.content
          .map(part => (part.type === 'text' ? part.text : JSON.stringify(part)))
          .join('\n')
      }
      return result
    },
    async close() {
      await client.close()
    },
  }
}
