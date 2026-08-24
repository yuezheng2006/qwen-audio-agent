/**
 * Open capability registry: sync realtime tools + skills + MCP projections.
 */

export class CapabilityRegistry {
  constructor() {
    this.tools = new Map()
    this.skills = []
    this.mcp = {
      servers: [],
      toolCount: 0,
    }
    this.plugins = {
      apiVersion: null,
      plugins: [],
      pluginCount: 0,
      activeCount: 0,
      failedCount: 0,
    }
  }

  registerTool({
    name,
    definition,
    handler,
    source = 'builtin',
  }) {
    const key = String(name || '').trim()
    if (!key) throw new Error('capability tool name is required')
    if (!definition?.function?.name) {
      throw new Error(`capability tool "${key}" missing OpenAI function definition`)
    }
    if (typeof handler !== 'function') {
      throw new Error(`capability tool "${key}" missing handler`)
    }
    this.tools.set(key, { name: key, definition, handler, source })
    return this
  }

  has(name) {
    return this.tools.has(String(name || '').trim())
  }

  listRealtimeTools() {
    return [...this.tools.values()].map(entry => entry.definition)
  }

  listToolMeta() {
    return [...this.tools.values()].map(entry => ({
      name: entry.name,
      source: entry.source,
      description: entry.definition.function?.description || '',
    }))
  }

  async dispatch(name, args = {}, context = {}) {
    const entry = this.tools.get(String(name || '').trim())
    if (!entry) {
      return {
        status: 'failed',
        error: true,
        error_code: 'unsupported_tool',
        user_message: '当前无法执行这个操作。',
      }
    }
    return entry.handler(args, context)
  }

  setSkills(skills = []) {
    this.skills = Array.isArray(skills) ? skills : []
    return this
  }

  skillsPrompt({ maxSkills = 8, maxChars = 2400 } = {}) {
    const enabled = this.skills
      .filter(skill => skill.enabled !== false)
      .slice(0, maxSkills)
    if (!enabled.length) return ''
    const blocks = []
    let used = 0
    for (const skill of enabled) {
      const body = String(skill.body || '').trim()
      const header = `- ${skill.name}: ${skill.description || ''}`.trim()
      const chunk = body
        ? `${header}\n${body}`
        : header
      if (used + chunk.length + 2 > maxChars) break
      blocks.push(chunk)
      used += chunk.length + 2
    }
    if (!blocks.length) return ''
    return [
      '<skills>',
      '以下是已启用的语音前台技能。按需遵循，不要朗读技能名或元数据。',
      ...blocks,
      '</skills>',
    ].join('\n')
  }

  setMcpHealth(health = {}) {
    this.mcp = {
      servers: Array.isArray(health.servers) ? health.servers : [],
      toolCount: Number(health.toolCount) || 0,
    }
    return this
  }

  setPluginHealth(health = {}) {
    this.plugins = {
      apiVersion: health.apiVersion || null,
      plugins: Array.isArray(health.plugins) ? health.plugins : [],
      pluginCount: Number(health.pluginCount) || 0,
      activeCount: Number(health.activeCount) || 0,
      failedCount: Number(health.failedCount) || 0,
    }
    return this
  }

  health() {
    return {
      tools: this.listToolMeta(),
      toolCount: this.tools.size,
      skills: this.skills.map(skill => ({
        name: skill.name,
        description: skill.description || '',
        enabled: skill.enabled !== false,
      })),
      skillCount: this.skills.length,
      mcp: this.mcp,
      plugins: this.plugins,
    }
  }
}

export function createCapabilityRegistry() {
  return new CapabilityRegistry()
}
