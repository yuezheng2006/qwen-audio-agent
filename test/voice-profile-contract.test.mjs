import assert from 'node:assert/strict'
import test from 'node:test'
import {
  VOICE_PROFILE_API_VERSION,
  VOICE_PROFILE_OPERATIONS,
  VOICE_PROFILE_STATUSES,
  isVoiceProfileStatus,
  normalizeVoiceProfileStatus,
  voiceProfileContract,
} from 'qwen-audio-agent/voice-profile-contract'

test('voice profile contract exposes a stable lifecycle for plugins and clients', () => {
  assert.equal(VOICE_PROFILE_API_VERSION, '1')
  assert.deepEqual(VOICE_PROFILE_STATUSES, ['draft', 'cloning', 'ready', 'confirmed', 'failed'])
  assert.deepEqual(VOICE_PROFILE_OPERATIONS, ['record', 'trim', 'clone', 'preview', 'select', 'delete'])
  assert.equal(isVoiceProfileStatus('ready'), true)
  assert.equal(normalizeVoiceProfileStatus('unknown'), 'draft')
})

test('voice profile contract hides provider-specific field names behind one view', () => {
  assert.deepEqual(voiceProfileContract({
    id: 'profile-1', label: 'My voice', provider: 'local', status: 'ready',
    remote_voice_id: 'voice-1', capabilities: ['speech.synthesize', 'speech.synthesize'],
    sample_refs: ['/private/sample.wav'],
  }), {
    apiVersion: '1', id: 'profile-1', label: 'My voice', provider: 'local', runtime: 'remote',
    status: 'ready', capabilities: ['speech.synthesize'], sampleRefs: ['/private/sample.wav'],
    targetModel: null, remoteVoiceId: 'voice-1',
  })
})
