import { config } from './config.mjs'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
const DESKTOP_APP_ORIGINS = new Set([
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
])

function normalizedOrigin(value) {
  try {
    const url = new URL(value)
    // URL.origin is the literal string "null" for custom schemes such as
    // Tauri's tauri://localhost origin. Preserve the canonical app origin.
    if (url.protocol === 'tauri:') return `${url.protocol}//${url.host}`
    return url.origin
  } catch {
    return ''
  }
}

function parsedHost(value) {
  try {
    const url = new URL(`http://${value}`)
    return {
      host: url.host,
      hostname: url.hostname,
    }
  } catch {
    return null
  }
}

export function isDesktopAppOrigin(value) {
  return DESKTOP_APP_ORIGINS.has(normalizedOrigin(value))
}

function trustedOrigins(allowedOrigins) {
  return allowedOrigins
    .map(normalizedOrigin)
    .filter(Boolean)
    .filter(value => {
      const url = new URL(value)
      return (
        url.protocol === 'https:'
        || (
          url.protocol === 'http:'
          && LOOPBACK_HOSTS.has(url.hostname)
        )
      )
    })
}

export function isAllowedOrigin(
  req,
  { allowedOrigins = config.allowedOrigins } = {},
) {
  try {
    const requestHost = parsedHost(req.headers.host)
    if (!requestHost) return false
    const origin = normalizedOrigin(req.headers.origin)
    const configured = trustedOrigins(allowedOrigins)
    const trustedHost = configured.some(value => (
      new URL(value).host === requestHost.host
    ))

    // CLI and other non-browser clients do not send Origin. They are accepted
    // only through a loopback address or an explicitly trusted reverse proxy.
    // Browsers may also send the literal "null" origin.
    if (!origin) {
      return LOOPBACK_HOSTS.has(requestHost.hostname) || trustedHost
    }

    // Tauri v2 uses tauri://localhost on macOS/Linux and tauri.localhost on
    // platforms that expose the WebView through an http origin. These are
    // local app origins, not network origins; only accept them when the
    // Gateway itself is bound to a literal loopback host.
    if (isDesktopAppOrigin(origin)) {
      return LOOPBACK_HOSTS.has(requestHost.hostname)
    }

    const originUrl = new URL(origin)
    if (configured.includes(origin)) {
      return originUrl.host === requestHost.host
    }

    // Comparing arbitrary Origin and Host values is vulnerable to DNS rebinding.
    // The implicit same-origin path is therefore limited to literal loopback
    // hosts. Public hostnames must be explicitly allowlisted.
    return (
      LOOPBACK_HOSTS.has(requestHost.hostname)
      && LOOPBACK_HOSTS.has(originUrl.hostname)
      && originUrl.host === requestHost.host
    )
  } catch {
    return false
  }
}

export function enforceSameOrigin(req, res, next) {
  // The configured public voice-sample endpoint is fetched server-to-server
  // by a TTS provider, so it has no browser Origin or session cookie. Access
  // remains bounded by the opaque sample token and the read-only route.
  if (req.method === 'GET' && /^\/api\/voice\/samples\/[0-9a-f-]{36}$/i.test(req.path)) {
    return next()
  }
  if (!isAllowedOrigin(req)) {
    res.status(403).json({ error: 'origin not allowed' })
    return
  }
  next()
}
