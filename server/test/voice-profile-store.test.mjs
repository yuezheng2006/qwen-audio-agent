import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createVoiceProfileStore } from '../src/voice/studio/profile-store.mjs'
import { serializeProfile } from '../src/voice/studio/types.mjs'

test('voice profile store upsert list and serialize remote_voice_id', () => {
  const dir = mkdtempSync(join(tmpdir(), 'voice-profiles-'))
  try {
    const store = createVoiceProfileStore({ dir })
    const row = store.upsert('owner', {
      label: '沉稳男声',
      source: 'preset',
      presetId: 'demo-calm-male',
      provider: 'dashscope',
      remoteId: 'voice-abc',
      status: 'ready',
    })
    assert.ok(row.id)
    assert.equal(store.list('owner').length, 1)
    assert.equal(store.get('owner', row.id).remoteId, 'voice-abc')
    const json = serializeProfile(row)
    assert.equal(json.remote_voice_id, 'voice-abc')
    assert.equal('remoteId' in json, false)
    assert.equal(json.runtime, 'remote')
    assert.deepEqual(json.capabilities, ['speech.synthesize'])
    assert.deepEqual(json.sample_refs, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('voice profile store removes one local asset without affecting other profiles', () => {
  const dir = mkdtempSync(join(tmpdir(), 'voice-profiles-delete-'))
  try {
    const store = createVoiceProfileStore({ dir })
    store.upsert('owner', { id: 'keep', label: 'Keep', provider: 'local' })
    store.upsert('owner', { id: 'remove', label: 'Remove', provider: 'local' })
    assert.equal(store.remove('owner', 'remove').id, 'remove')
    assert.equal(store.remove('owner', 'missing'), null)
    assert.deepEqual(store.list('owner').map(item => item.id), ['keep'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
