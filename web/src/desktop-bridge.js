export function isNativeClient() {
  return Boolean(globalThis.__TAURI_INTERNALS__)
}

const DEFAULT_NATIVE_GATEWAY_ORIGIN = 'http://127.0.0.1:3101'

export function nativeGatewayOrigin() {
  if (!isNativeClient()) return ''
  return globalThis.__LINGORA_GATEWAY_ORIGIN__ || DEFAULT_NATIVE_GATEWAY_ORIGIN
}

export function installNativeGatewayTransport() {
  if (!isNativeClient() || globalThis.__LINGORA_FETCH_INSTALLED__) return
  const nativeFetch = globalThis.fetch.bind(globalThis)
  globalThis.__LINGORA_GATEWAY_ORIGIN__ = nativeGatewayOrigin()
  globalThis.fetch = (input, init) => {
    const rawUrl = typeof input === 'string' ? input : input?.url
    if (
      typeof rawUrl !== 'string'
      || /^(?:https?:|wss?:|data:|blob:)/i.test(rawUrl)
      || !/^(?:\/)?api(?:\/|$)/.test(rawUrl)
    ) {
      return nativeFetch(input, init)
    }
    const target = new URL(
      rawUrl.replace(/^\/+/, '/'),
      globalThis.__LINGORA_GATEWAY_ORIGIN__ + '/',
    )
    if (typeof input === 'string') return nativeFetch(target.href, init)
    return nativeFetch(new Request(target.href, input), init)
  }
  globalThis.__LINGORA_FETCH_INSTALLED__ = true
}

export async function readNativeClientInfo() {
  if (!isNativeClient()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke('client_info')
}

export async function readNativeGatewayHealth(baseUrl) {
  if (!isNativeClient()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke('gateway_health', { base_url: baseUrl })
}

export async function startNativeGateway() {
  if (!isNativeClient()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke('gateway_start')
}

export async function stopNativeGateway() {
  if (!isNativeClient()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke('gateway_stop')
}
