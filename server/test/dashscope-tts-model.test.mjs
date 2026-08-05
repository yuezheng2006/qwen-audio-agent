import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeDashScopeTtsModel,
  resolveCascadeTtsPluginConfig,
} from '../../shared/cascade-tts-plugins.mjs'

test('normalizes flash/plus aliases to hosted Qwen-Audio-3.0-TTS models', () => {
  assert.equal(normalizeDashScopeTtsModel('flash'), 'qwen-audio-3.0-tts-flash')
  assert.equal(normalizeDashScopeTtsModel('plus'), 'qwen-audio-3.0-tts-plus')
  assert.equal(normalizeDashScopeTtsModel('PLUS'), 'qwen-audio-3.0-tts-plus')
  assert.equal(
    normalizeDashScopeTtsModel('qwen-audio-3.0-tts-flash'),
    'qwen-audio-3.0-tts-flash',
  )
})

test('dashscope plugin resolves instruction and plus model from env', () => {
  const tts = resolveCascadeTtsPluginConfig({
    CASCADE_TTS_PROVIDER: 'dashscope',
    CASCADE_TTS_MODEL: 'plus',
    CASCADE_TTS_VOICE_ID: 'longanhuan_v3.6',
    CASCADE_TTS_INSTRUCTION: '缓慢阅读，像睡前故事一样',
  }, 'key')
  assert.equal(tts.provider, 'dashscope')
  assert.equal(tts.model, 'qwen-audio-3.0-tts-plus')
  assert.equal(tts.instruction, '缓慢阅读，像睡前故事一样')
})
