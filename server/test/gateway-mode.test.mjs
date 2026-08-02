import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FENGGE_QWEN_TTS_VOICE,
  describeGatewayMode,
  resolveGatewayMode,
  resolveGatewayModeEnv,
  voiceDisplayName,
} from '../../scripts/lib/gateway-mode.mjs'

test('resolves aliases for the two frontend modes', () => {
  assert.equal(resolveGatewayMode('s2s'), 's2s')
  assert.equal(resolveGatewayMode('dashscope'), 's2s')
  assert.equal(resolveGatewayMode('cascade'), 'cascade')
  assert.equal(resolveGatewayMode('CASCADE'), 'cascade')
})

test('empty mode resolves to cascade (personal default)', () => {
  assert.equal(resolveGatewayMode(''), 'cascade')
  assert.equal(resolveGatewayMode(undefined), 'cascade')
})

test('rejects unknown modes', () => {
  assert.throws(() => resolveGatewayMode('cosyvoice'), /未知前台模式/)
})

test('s2s mode uses DashScope Realtime + system voice longanqian', () => {
  const env = resolveGatewayModeEnv('s2s')
  assert.equal(env.QWEN_AUDIO_REALTIME_PROVIDER, 'dashscope')
  assert.equal(env.QWEN_AUDIO_REALTIME_VOICE, 'longanqian')
  // Cascade keys stay unset so leftover CosyVoice IDs are not required.
  assert.equal(env.CASCADE_TTS_MODEL, undefined)
  assert.equal(env.CASCADE_TTS_VOICE_ID, undefined)
})

test('cascade mode uses Qwen-Audio-TTS with the fengge clone by default', () => {
  const env = resolveGatewayModeEnv('cascade', { CASCADE_TTS_PROVIDER: 'dashscope' })
  assert.equal(env.QWEN_AUDIO_REALTIME_PROVIDER, 'cascade')
  assert.equal(env.CASCADE_TTS_PROVIDER, 'dashscope')
  assert.equal(env.CASCADE_TTS_MODEL, 'qwen-audio-3.0-tts-flash')
  assert.equal(env.CASCADE_TTS_VOICE_ID, FENGGE_QWEN_TTS_VOICE)
  // Do not force a Realtime clone voice onto S2S when flipping back.
  assert.equal(env.QWEN_AUDIO_REALTIME_VOICE, undefined)
})

test('cascade voice can be overridden without changing the model default', () => {
  const env = resolveGatewayModeEnv('cascade', {
    CASCADE_TTS_PROVIDER: 'dashscope',
    CASCADE_TTS_VOICE_ID: 'longanhuan_v3.6',
  })
  assert.equal(env.CASCADE_TTS_VOICE_ID, 'longanhuan_v3.6')
  assert.equal(env.CASCADE_TTS_MODEL, 'qwen-audio-3.0-tts-flash')
})

test('cascade fish provider keeps s2.1 model and reference id', () => {
  const env = resolveGatewayModeEnv('cascade', {
    CASCADE_TTS_PROVIDER: 'fish',
    CASCADE_TTS_MODEL: 's2.1-pro-free',
    CASCADE_TTS_VOICE_ID: '5337b76e9a7348e9a1d0c68fff02254c',
  })
  assert.equal(env.CASCADE_TTS_PROVIDER, 'fish')
  assert.equal(env.CASCADE_TTS_MODEL, 's2.1-pro-free')
  assert.equal(env.CASCADE_TTS_VOICE_ID, '5337b76e9a7348e9a1d0c68fff02254c')
  assert.notEqual(env.CASCADE_TTS_MODEL, 'qwen-audio-3.0-tts-flash')
})

test('voiceDisplayName recognizes fengge clone and system voices', () => {
  assert.equal(voiceDisplayName(FENGGE_QWEN_TTS_VOICE), '峰哥复刻')
  assert.equal(voiceDisplayName('longanqian'), '龙安茜（系统）')
  assert.equal(voiceDisplayName('longanhuan_v3.6'), '龙安欢（系统）')
  assert.equal(voiceDisplayName(''), '未配置')
  assert.equal(
    voiceDisplayName('9a9cf47702da476aa4629e2506d4a857', { provider: 'fish' }),
    'Fish 9a9cf477…d4a857',
  )
})

test('describeGatewayMode summarizes cascade and s2s defaults', () => {
  const cascade = describeGatewayMode('cascade')
  assert.equal(cascade.mode, 'cascade')
  assert.equal(cascade.provider, 'cascade')
  assert.equal(cascade.voice, FENGGE_QWEN_TTS_VOICE)

  const s2s = describeGatewayMode('dashscope')
  assert.equal(s2s.mode, 's2s')
  assert.equal(s2s.provider, 'dashscope')
  assert.equal(s2s.voice, 'longanqian')
})
