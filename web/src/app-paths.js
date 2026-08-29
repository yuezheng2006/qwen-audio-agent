/** Root-absolute API path. Deep routes like /support must not resolve `api/` relatively. */
export function apiUrl(path = '') {
  const suffix = String(path || '').replace(/^\/+/, '').replace(/^api\//, '')
  return `/api/${suffix}`
}

export function realtimeSocketUrl(
  sessionId,
  location = globalThis.location,
  extras = {},
) {
  const protocol = location?.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = location?.host || '127.0.0.1'
  const params = new URLSearchParams()
  params.set('sessionId', sessionId || '')
  const workspace = String(extras?.workspace || '').trim()
  if (workspace) params.set('workspace', workspace)
  return `${protocol}//${host}${apiUrl('realtime')}?${params}`
}

export function resolvePageUrl(href, pageUrl) {
  return new URL(String(href || ''), pageUrl).href
}

export function pageAssetUrls(html, pageUrl) {
  const hrefs = []
  const source = String(html || '')
  for (const match of source.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const href = match[1]
    if (/\.(js|css)(\?|$)/.test(href) || href.startsWith('/assets/') || href.startsWith('./assets/')) {
      hrefs.push(resolvePageUrl(href, pageUrl))
    }
  }
  return [...new Set(hrefs)]
}
