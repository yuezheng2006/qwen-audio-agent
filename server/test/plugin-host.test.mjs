import assert from 'node:assert/strict'
import test from 'node:test'
import { definePluginManifest, validatePluginManifest } from '../src/plugins/manifest.mjs'
import { createPluginHost } from '../src/plugins/host.mjs'
import { loadPluginsFromDirectories, registerPluginsFromDirectories } from '../src/plugins/loader.mjs'
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

test('platform plugin metadata validates without changing legacy manifests', () => {
  const legacy = definePluginManifest({
    id: 'demo.legacy', version: '1.0.0', kind: 'tool', label: 'Legacy',
  })
  assert.equal(legacy.platformApiVersion, undefined)
  const platform = definePluginManifest({
    id: 'demo.stt', version: '1.0.0', kind: 'stt', label: 'Local STT',
    capabilities: ['speech.transcribe'],
    platforms: ['macos'],
    runtime: 'local-sidecar',
    dataBoundary: 'local',
    healthcheck: { kind: 'http', url: 'http://127.0.0.1:8000/health' },
  })
  assert.equal(platform.platformApiVersion, '0.1')
  assert.deepEqual(platform.platformCapabilities, ['speech.transcribe'])
  assert.equal(platform.healthcheck.kind, 'http')
  assert.throws(() => definePluginManifest({
    id: 'demo.remote', version: '1.0.0', kind: 'tts', label: 'Remote',
    capabilities: ['speech.synthesize'], runtime: 'remote', dataBoundary: 'local',
  }), /不能声明 local dataBoundary/)
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

test('a failed plugin is isolated from other plugin activation', async () => {
  const host = createPluginHost()
  host.register({
    manifest: { id: 'demo.failed', version: '1.0.0', kind: 'tool', label: 'Failed' },
    activate() { throw new Error('broken') },
  })
  host.register({
    manifest: { id: 'demo.healthy', version: '1.0.0', kind: 'tool', label: 'Healthy' },
    activate() {},
  })
  await host.activateAll()
  assert.equal(host.list().find(plugin => plugin.id === 'demo.failed').status, 'failed')
  assert.equal(host.list().find(plugin => plugin.id === 'demo.healthy').status, 'active')
  assert.equal(host.health().failedCount, 1)
})

test('plugin permissions are checked before activation', async () => {
  let activated = false
  const host = createPluginHost({ grantedPermissions: ['network.loopback'] })
  host.register({
    manifest: {
      id: 'demo.network', version: '1.0.0', kind: 'tool', label: 'Network',
      permissions: ['network.internet'],
    },
    activate() { activated = true },
  })
  await host.activateAll()
  assert.equal(activated, false)
  assert.equal(host.list()[0].status, 'failed')
  assert.match(host.list()[0].error || '', /缺少授权权限/)
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

test('plugin loader discovers sorted modules and supports named exports', async () => {
  const imported = new Map([
    ['file:///plugins/a.mjs', {
      manifest: { id: 'demo.a', version: '1.0.0', kind: 'tool', label: 'A' },
      activate() {},
    }],
    ['file:///plugins/b.js', {
      default: {
        manifest: { id: 'demo.b', version: '1.0.0', kind: 'tool', label: 'B' },
        activate() {},
      },
    }],
  ])
  const result = await loadPluginsFromDirectories(['/plugins'], {
    readdirImpl: async () => [
      { name: 'b.js', isFile: () => true },
      { name: 'a.mjs', isFile: () => true },
      { name: 'README.md', isFile: () => true },
    ],
    importImpl: async specifier => imported.get(specifier),
  })
  assert.deepEqual(result.loaded.map(item => item.plugin.manifest.id), ['demo.a', 'demo.b'])
  assert.deepEqual(result.failures, [])
})

test('plugin loader isolates import and registration failures', async () => {
  const host = createPluginHost()
  const result = await registerPluginsFromDirectories(host, ['/plugins'], {
    readdirImpl: async () => [
      { name: 'good.mjs', isFile: () => true },
      { name: 'bad.mjs', isFile: () => true },
    ],
    importImpl: async specifier => {
      if (specifier.endsWith('/bad.mjs')) throw new Error('broken module')
      return {
        default: {
          manifest: { id: 'demo.good', version: '1.0.0', kind: 'tool', label: 'Good' },
          activate() {},
        },
      }
    },
  })
  assert.equal(result.loaded.length, 1)
  assert.equal(result.failures.length, 1)
  await host.activateAll()
  assert.equal(host.list()[0].status, 'active')
  assert.equal(host.health().failedCount, 1)
  assert.equal(host.health().loadFailures[0].error, 'broken module')
})
