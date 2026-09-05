export function isNativeClient() {
  return Boolean(globalThis.__TAURI_INTERNALS__)
}

export async function readNativeClientInfo() {
  if (!isNativeClient()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke('client_info')
}
