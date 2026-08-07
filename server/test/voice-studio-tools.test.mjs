import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createVoiceStudioTools,
} from '../src/capabilities/tools/voice-studio.mjs'

const fakeService = {
  listPresets: async () => ({
    status: 'ok',
    presets: [{ id: 'calm', label: '沉稳', sample: { path: '/secret.wav' } }],
  }),
  clone: async (ownerId, args) => ({ status: 'ok', ownerId, args }),
  importVoice: async (ownerId, args) => ({ status: 'ok', ownerId, args }),
  confirm: async (ownerId, args) => ({ status: 'ok', ownerId, args }),
  list: async (ownerId, args) => ({ status: 'ok', ownerId, args, profiles: [] }),
  status: async ownerId => ({ status: 'ok', ownerId, confirmed: null }),
}

test('voice tools list presets and clone via service', async () => {
  const tools = createVoiceStudioTools({ service: fakeService })
  const list = tools.find(tool => tool.name === 'voice_list_presets')
  const clone = tools.find(tool => tool.name === 'voice_clone')

  const presets = await list.handler({ query: '沉稳' }, { ownerId: 'o' })
  assert.equal(presets.status, 'ok')
  assert.ok(Array.isArray(presets.presets))
  assert.equal('path' in presets.presets[0], false)
  assert.equal('sample' in presets.presets[0], false)

  const cloned = await clone.handler({
    preset_id: 'calm',
    sample_path: '/tmp/sample.wav',
  }, { ownerId: 'o' })
  assert.equal(cloned.status, 'ok')
  assert.equal(cloned.ownerId, 'o')
  assert.equal(cloned.args.sample_path, '/tmp/sample.wav')
})

test('voice_confirm without owner fails', async () => {
  const tools = createVoiceStudioTools({ service: fakeService })
  const confirm = tools.find(tool => tool.name === 'voice_confirm')
  const out = await confirm.handler({ profile_id: 'x' }, {})

  assert.equal(out.error_code, 'missing_owner')
})

test('voice studio exposes exactly six realtime tools', () => {
  const names = createVoiceStudioTools({ service: fakeService }).map(tool => tool.name)
  assert.deepEqual(names, [
    'voice_list_presets',
    'voice_clone',
    'voice_import',
    'voice_confirm',
    'voice_list',
    'voice_status',
  ])
})

test('voice_clone definition includes local sample_path', () => {
  const clone = createVoiceStudioTools({ service: fakeService })
    .find(tool => tool.name === 'voice_clone')

  assert.ok(clone.definition.function.parameters.properties.sample_path)
})
