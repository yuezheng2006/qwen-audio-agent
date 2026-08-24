import assert from 'node:assert/strict'
import test from 'node:test'
import { definePluginManifest, validatePluginManifest } from '../src/plugins/manifest.mjs'
import { createPluginHost } from '../src/plugins/host.mjs'
import { createWeatherPlugin, weatherPluginManifest } from '../src/plugins/builtin/weather.mjs'

test('plugin manifest validates and normalizes metadata', () => {
  const manifest = definePluginManifest({
    id: 'demo.weather', version: '1.0.0', kind: 'tool', displayName: 'Weather',
    capabilities: ['weather', 'weather'], platforms: ['server'],
  })
  assert.deepEqual(manifest.capabilities, ['weather'])
  assert.equal(manifest.label, 'Weather')
  assert.throws(() => validatePluginManifest({
    id: 'Demo Weather', version: '1.0.0', kind: 'tool', label: 'Bad',
  }), /id 无效/)
})

test('plugin host activates, reports, and deactivates plugins', async () => {
  const host = createPluginHost()
  host.register({
    manifest: { id: 'demo.echo', version: '1.0.0', kind: 'tool', label: 'Echo' },
    activate() {}, deactivate() {},
  })
  assert.equal(host.health().activeCount, 0)
  await host.activateAll()
  assert.equal(host.health().activeCount, 1)
  assert.equal(host.list()[0].status, 'active')
  await host.deactivate('demo.echo')
  assert.equal(host.list()[0].status, 'inactive')
})

test('weather is a first-party plugin with a stable manifest', async () => {
  const host = createPluginHost({
    context: {
      registerTool(tool, options = {}) {
        assert.equal(tool.name, 'weather')
        assert.equal(options.source, weatherPluginManifest.id)
      },
    },
  })
  host.register(createWeatherPlugin({ fetchImpl: async () => ({}) }))
  await host.activate('qwaudio.tool.weather')
  assert.equal(host.health().activeCount, 1)
  assert.deepEqual(host.list()[0].capabilities, ['tool.weather'])
})
