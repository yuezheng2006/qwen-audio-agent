const DANGEROUS = /(?:^|_)(?:shell|exec|bash|cmd|run_terminal|write_file|delete|rm|remove|filesystem_write|sudo)(?:$|_)/i

export function isDangerousMcpTool(name, description = '') {
  const text = `${name} ${description}`
  return DANGEROUS.test(name) || /\b(shell|execute|delete file|overwrite)\b/i.test(text)
}

export function projectMcpToolName(serverName, toolName) {
  const server = String(serverName || 'mcp')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 32)
  const tool = String(toolName || 'tool')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 48)
  return `mcp__${server}__${tool}`
}

export function truncateMcpResult(value, maxChars = 1200) {
  if (value == null) return ''
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars - 1)}…`
}

/**
 * Project MCP listTools entries into CapabilityRegistry tool records.
 */
export function projectMcpTools({
  serverName,
  tools,
  callTool,
  timeoutMs = 8000,
  allowDangerous = false,
}) {
  const projected = []
  for (const tool of tools || []) {
    const originalName = String(tool.name || '').trim()
    if (!originalName) continue
    if (!allowDangerous && isDangerousMcpTool(originalName, tool.description || '')) {
      continue
    }
    const name = projectMcpToolName(serverName, originalName)
    const parameters = tool.inputSchema && typeof tool.inputSchema === 'object'
      ? tool.inputSchema
      : { type: 'object', properties: {}, additionalProperties: true }
    projected.push({
      name,
      source: `mcp:${serverName}`,
      definition: {
        type: 'function',
        function: {
          name,
          description: String(tool.description || `MCP tool ${originalName} from ${serverName}`).slice(0, 400),
          parameters,
        },
      },
      handler: async (args = {}) => {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        try {
          const result = await callTool({
            serverName,
            toolName: originalName,
            arguments: args,
            signal: controller.signal,
          })
          return {
            status: 'ok',
            server: serverName,
            tool: originalName,
            result: truncateMcpResult(result),
          }
        } catch (error) {
          const aborted = error?.name === 'AbortError'
          return {
            status: 'failed',
            error: true,
            error_code: aborted ? 'mcp_timeout' : 'mcp_call_failed',
            user_message: aborted ? '这个外部工具超时了。' : '外部工具调用失败。',
            detail: String(error.message || error).slice(0, 160),
            retryable: true,
          }
        } finally {
          clearTimeout(timer)
        }
      },
    })
  }
  return projected
}
