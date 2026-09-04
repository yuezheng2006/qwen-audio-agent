import assert from 'node:assert/strict'
import test from 'node:test'
import {
  VOICE_WORKFLOW_API_VERSION,
  VOICE_WORKFLOWS,
  defineVoiceWorkflow,
  voiceWorkflow,
} from 'qwen-audio-agent/voice-workflows'

test('voice workflow catalog keeps product jobs separate from engines', () => {
  assert.equal(VOICE_WORKFLOW_API_VERSION, '1')
  assert.equal(voiceWorkflow('voice-clone').capabilities.includes('speech.clone'), true)
  assert.equal(voiceWorkflow('voice-clone').view, 'clone')
  assert.equal(VOICE_WORKFLOWS.some(item => item.id === 'model-catalogue'), true)
})

test('workflow definitions validate stable metadata', () => {
  const workflow = defineVoiceWorkflow({
    id: 'custom-reader', title: 'Custom Reader', description: 'Read text', status: 'live',
    capabilities: ['speech.synthesize', 'speech.synthesize'],
  })
  assert.deepEqual(workflow.capabilities, ['speech.synthesize'])
  assert.throws(() => defineVoiceWorkflow({
    id: 'Bad ID', title: 'Bad', description: 'Bad', status: 'live',
  }), /id is invalid/)
})
