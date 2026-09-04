import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PLUGIN_API_VERSION,
  definePluginManifest,
  validatePluginManifest,
} from 'qwen-audio-agent/plugin-sdk'

test('exports the small stable third-party plugin SDK contract', () => {
  assert.equal(PLUGIN_API_VERSION, '1')
  assert.equal(typeof definePluginManifest, 'function')
  assert.equal(typeof validatePluginManifest, 'function')
  assert.equal(definePluginManifest({
    id: 'example.sdk',
    version: '1.0.0',
    kind: 'tool',
    label: 'SDK example',
  }).apiVersion, '1')
})
