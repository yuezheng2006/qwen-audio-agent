/**
 * Tiny JSON HTTP helper for memory backends (Node 22+ fetch).
 */

export async function httpJson(url, {
  method = 'GET',
  headers = {},
  body,
  timeoutMs = 15_000,
  fetchImpl = globalThis.fetch,
} = {}) {
  const response = await fetchImpl(url, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await response.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { raw: text }
    }
  }
  if (!response.ok) {
    const detail = typeof data === 'object'
      ? (data.error || data.message || text.slice(0, 200))
      : String(data || response.status)
    const error = new Error(`HTTP ${response.status}: ${detail}`)
    error.status = response.status
    error.data = data
    throw error
  }
  return data
}

export async function httpOk(url, options = {}) {
  try {
    await httpJson(url, { ...options, method: options.method || 'GET' })
    return true
  } catch {
    return false
  }
}
