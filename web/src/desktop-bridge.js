export function isNativeClient() {
  return Boolean(globalThis.__TAURI_INTERNALS__)
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
