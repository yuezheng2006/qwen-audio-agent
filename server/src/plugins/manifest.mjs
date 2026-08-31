import { validatePlatformManifestMetadata } from '../../../shared/platform-capabilities.mjs'

export const PLUGIN_API_VERSION = '1'

const PLUGIN_KINDS = new Set([
  'agent', 'voice', 'stt', 'tts', 'memory', 'knowledge', 'reader',
  'tool', 'skill', 'persona', 'client-extension',
])
const PLUGIN_ID = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$/

function clean(value) {
  return String(value || '').trim()
}

function listOfStrings(value, field) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(item => !clean(item))) {
    throw new Error(`插件 ${field} 必须是非空字符串数组`)
  }
  return [...new Set(value.map(clean))]
}

export function validatePluginManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('插件 Manifest 必须是对象')
  }
  const id = clean(manifest.id)
  const version = clean(manifest.version)
  const apiVersion = clean(manifest.apiVersion || PLUGIN_API_VERSION)
  const kind = clean(manifest.kind)
  const label = clean(manifest.label || manifest.displayName)
  if (!PLUGIN_ID.test(id)) throw new Error(`插件 id 无效：${id || '(empty)'}`)
  if (!version) throw new Error(`插件 ${id} 缺少 version`)
  if (apiVersion !== PLUGIN_API_VERSION) {
    throw new Error(`插件 ${id} 使用了不支持的 API 版本：${apiVersion}`)
  }
  if (!PLUGIN_KINDS.has(kind)) throw new Error(`插件 ${id} kind 无效：${kind}`)
  if (!label) throw new Error(`插件 ${id} 缺少 label`)
  return Object.freeze({
    id, version, apiVersion, kind, label,
    description: clean(manifest.description),
    capabilities: listOfStrings(manifest.capabilities, 'capabilities'),
    platforms: listOfStrings(manifest.platforms, 'platforms'),
    permissions: listOfStrings(manifest.permissions, 'permissions'),
    ...validatePlatformManifestMetadata(manifest),
  })
}

export function definePluginManifest(manifest) {
  return validatePluginManifest(manifest)
}
