// The small, provider-neutral seam between Agent and Platform modules.
// Keep this file dependency-free so clients and plugins can share it.

export const PLATFORM_CAPABILITY_API_VERSION = '0.1'

export const PLATFORM_CAPABILITIES = Object.freeze([
  'audio.record',
  'audio.play',
  'audio.interrupt',
  'speech.transcribe',
  'speech.synthesize',
  'speech.clone',
  'speech.design',
  'model.catalogue',
  'voice.profile.list',
  'voice.profile.select',
])

const CAPABILITY_SET = new Set(PLATFORM_CAPABILITIES)
const RUNTIMES = new Set(['builtin', 'local-sidecar', 'remote'])
const DATA_BOUNDARIES = new Set(['local', 'local-first', 'remote-explicit'])
const HEALTHCHECK_KINDS = new Set(['http', 'websocket', 'command'])

function clean(value) {
  return String(value || '').trim()
}

function listOfStrings(value, field) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(item => !clean(item))) {
    throw new Error(`${field} 必须是非空字符串数组`)
  }
  return [...new Set(value.map(clean))]
}

export function isPlatformCapability(value) {
  return CAPABILITY_SET.has(clean(value))
}

export function validatePlatformCapabilities(value = []) {
  const capabilities = listOfStrings(value, 'platform capabilities')
  const unknown = capabilities.filter(capability => !CAPABILITY_SET.has(capability))
  if (unknown.length) {
    throw new Error(`不支持的 Platform capability：${unknown.join('、')}`)
  }
  return capabilities
}

export function validatePlatformManifestMetadata(manifest = {}) {
  const capabilities = validatePlatformCapabilities(
    (manifest.capabilities || []).filter(isPlatformCapability),
  )
  const hasMetadata = (
    manifest.runtime !== undefined
    || manifest.dataBoundary !== undefined
    || manifest.healthcheck !== undefined
    || capabilities.length > 0
  )
  if (!hasMetadata) return {}

  const runtime = clean(manifest.runtime) || 'builtin'
  const dataBoundary = clean(manifest.dataBoundary) || 'local'
  if (!RUNTIMES.has(runtime)) {
    throw new Error(`不支持的 Platform runtime：${runtime}`)
  }
  if (!DATA_BOUNDARIES.has(dataBoundary)) {
    throw new Error(`不支持的 Platform dataBoundary：${dataBoundary}`)
  }
  if (runtime === 'remote' && dataBoundary === 'local') {
    throw new Error('remote runtime 不能声明 local dataBoundary')
  }

  let healthcheck = null
  if (manifest.healthcheck !== undefined) {
    if (!manifest.healthcheck || typeof manifest.healthcheck !== 'object') {
      throw new Error('Platform healthcheck 必须是对象')
    }
    const kind = clean(manifest.healthcheck.kind)
    if (!HEALTHCHECK_KINDS.has(kind)) {
      throw new Error(`不支持的 Platform healthcheck：${kind}`)
    }
    const target = clean(manifest.healthcheck.url || manifest.healthcheck.command)
    if (!target) throw new Error('Platform healthcheck 缺少 url 或 command')
    healthcheck = Object.freeze({ kind, [kind === 'command' ? 'command' : 'url']: target })
  }

  return Object.freeze({
    platformApiVersion: PLATFORM_CAPABILITY_API_VERSION,
    platformCapabilities: capabilities,
    runtime,
    dataBoundary,
    ...(healthcheck ? { healthcheck } : {}),
  })
}
