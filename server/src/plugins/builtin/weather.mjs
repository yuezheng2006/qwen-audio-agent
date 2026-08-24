import { createWeatherTool } from '../../capabilities/tools/weather.mjs'
import { definePluginManifest } from '../manifest.mjs'

export const weatherPluginManifest = definePluginManifest({
  id: 'qwaudio.tool.weather',
  version: '1.0.0',
  kind: 'tool',
  label: '天气查询',
  description: '查询当前天气和短时预报。',
  capabilities: ['tool.weather'],
  platforms: ['server'],
  permissions: ['network.open-meteo'],
})

export function createWeatherPlugin({ fetchImpl = globalThis.fetch } = {}) {
  return {
    manifest: weatherPluginManifest,
    async activate({ registerTool }) {
      if (typeof registerTool !== 'function') throw new Error('缺少 registerTool()')
      registerTool(createWeatherTool({ fetchImpl }), { source: weatherPluginManifest.id })
    },
  }
}
