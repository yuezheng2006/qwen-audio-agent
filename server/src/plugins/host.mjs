import { PLUGIN_API_VERSION, validatePluginManifest } from './manifest.mjs'

function pluginError(id, message) {
  return new Error(`插件 ${id || '(unknown)'} ${message}`)
}

export class PluginHost {
  constructor({ context = {}, logger = null } = {}) {
    this.context = context
    this.logger = logger
    this.plugins = new Map()
    this.states = new Map()
  }

  register(plugin) {
    const manifest = validatePluginManifest(plugin?.manifest)
    if (typeof plugin.activate !== 'function') {
      throw pluginError(manifest.id, '缺少 activate()')
    }
    if (this.plugins.has(manifest.id)) throw pluginError(manifest.id, '已经注册')
    this.plugins.set(manifest.id, Object.freeze({ ...plugin, manifest }))
    this.states.set(manifest.id, { status: 'registered', error: null })
    return this
  }

  has(id) {
    return this.plugins.has(String(id || '').trim())
  }

  async activate(id) {
    const pluginId = String(id || '').trim()
    const plugin = this.plugins.get(pluginId)
    if (!plugin) throw pluginError(pluginId, '未注册')
    const state = this.states.get(pluginId)
    if (state.status === 'active') return state
    try {
      await plugin.activate({
        ...this.context,
        plugin: plugin.manifest,
        apiVersion: PLUGIN_API_VERSION,
      })
      state.status = 'active'
      state.error = null
      this.logger?.info?.('plugin.active', { plugin: pluginId })
    } catch (error) {
      state.status = 'failed'
      state.error = String(error?.message || error)
      this.logger?.error?.('plugin.activate_failed', { plugin: pluginId, error })
      throw pluginError(pluginId, `激活失败：${state.error}`)
    }
    return state
  }

  async activateAll() {
    const results = []
    for (const id of this.plugins.keys()) results.push(await this.activate(id))
    return results
  }

  async deactivate(id) {
    const pluginId = String(id || '').trim()
    const plugin = this.plugins.get(pluginId)
    if (!plugin) throw pluginError(pluginId, '未注册')
    const state = this.states.get(pluginId)
    if (state.status !== 'active') return state
    if (typeof plugin.deactivate === 'function') {
      await plugin.deactivate({
        ...this.context,
        plugin: plugin.manifest,
        apiVersion: PLUGIN_API_VERSION,
      })
    }
    state.status = 'inactive'
    return state
  }

  list() {
    return [...this.plugins.values()].map(plugin => ({
      ...plugin.manifest,
      status: this.states.get(plugin.manifest.id)?.status || 'unknown',
    }))
  }

  health() {
    const plugins = this.list()
    return {
      apiVersion: PLUGIN_API_VERSION,
      plugins,
      pluginCount: plugins.length,
      activeCount: plugins.filter(plugin => plugin.status === 'active').length,
      failedCount: plugins.filter(plugin => plugin.status === 'failed').length,
    }
  }
}

export function createPluginHost(options) {
  return new PluginHost(options)
}
