import { McpWebSearchProvider } from './mcp.mjs'
import { BingWebSearchProvider } from './bing.mjs'
import { So360WebSearchProvider } from './so360.mjs'

export function createWebSearchProvider(config, options = {}) {
  const provider = String(config?.webSearchProvider || 'none').toLowerCase()
  if (provider === 'none') return null
  if (provider === 'bing') {
    return new BingWebSearchProvider(options)
  }
  // `ddgs` was the historical default before the lightweight fallback
  // provider moved to 360. Keep the old config key loadable so an existing
  // installation does not fail during Gateway bootstrap.
  if (provider === 'so360' || provider === 'ddgs') {
    return new So360WebSearchProvider(options)
  }
  if (provider === 'mcp' || provider === 'bailian') {
    return new McpWebSearchProvider({
      url: config.webSearchMcpUrl,
      token: config.webSearchMcpToken,
      toolName: config.webSearchMcpTool,
      ...(provider === 'bailian'
        ? {
            key: 'bailian-mcp',
            label: 'Bailian Web Search MCP',
            requiresToken: true,
          }
        : {}),
      ...options,
    })
  }
  throw new Error(`不支持的 Web Search Provider：${provider}`)
}
