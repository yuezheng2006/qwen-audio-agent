import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveCascadeConfig } from '../src/core/config.mjs'

test('cascade defaults use Bailian services with the shared DashScope key', () => {
  const cascade = resolveCascadeConfig({ DASHSCOPE_API_KEY: 'shared-key' })
  assert.equal(cascade.stt.provider, 'dashscope')
  assert.equal(cascade.stt.model, 'qwen-audio-3.0-asr-flash-streaming')
  assert.equal(cascade.stt.apiKey, 'shared-key')
  assert.equal(cascade.llm.baseUrl, 'https://dashscope.aliyuncs.com/compatible-mode/v1')
  assert.equal(cascade.llm.model, 'qwen-flash')
  assert.equal(cascade.llm.apiKey, 'shared-key')
  assert.equal(cascade.tts.provider, 'dashscope')
  assert.equal(cascade.tts.model, 'qwen-audio-3.0-tts-flash')
  assert.equal(cascade.tts.voice, 'longanhuan_v3.6')
  assert.equal(cascade.tts.apiKey, 'shared-key')
  // The Gateway protocol fixes downstream audio at 24 kHz PCM16.
  assert.equal(cascade.tts.sampleRate, 24000)
})

test('each cascade stage accepts its own key, model and provider override', () => {
  const cascade = resolveCascadeConfig({
    DASHSCOPE_API_KEY: 'shared-key',
    CASCADE_STT_PROVIDER: 'Custom',
    CASCADE_STT_MODEL: 'other-stt',
    CASCADE_STT_API_KEY: 'stt-key',
    CASCADE_LLM_BASE_URL: 'https://llm.example.com/v1/',
    CASCADE_LLM_MODEL: 'other-llm',
    CASCADE_LLM_API_KEY: 'llm-key',
    CASCADE_LLM_MAX_TOKENS: '800',
    CASCADE_TTS_PROVIDER: 'custom',
    CASCADE_TTS_MODEL: 'other-tts',
    CASCADE_TTS_VOICE_ID: 'my-cloned-voice',
    CASCADE_TTS_API_KEY: 'tts-key',
  })
  assert.equal(cascade.stt.provider, 'custom')
  assert.equal(cascade.stt.model, 'other-stt')
  assert.equal(cascade.stt.apiKey, 'stt-key')
  assert.equal(cascade.llm.baseUrl, 'https://llm.example.com/v1')
  assert.equal(cascade.llm.model, 'other-llm')
  assert.equal(cascade.llm.apiKey, 'llm-key')
  assert.equal(cascade.llm.maxTokens, 800)
  assert.equal(cascade.tts.provider, 'custom')
  assert.equal(cascade.tts.model, 'other-tts')
  assert.equal(cascade.tts.voice, 'my-cloned-voice')
  assert.equal(cascade.tts.apiKey, 'tts-key')
})

test('voice swap only needs CASCADE_TTS_VOICE_ID', () => {
  const cascade = resolveCascadeConfig({
    DASHSCOPE_API_KEY: 'shared-key',
    CASCADE_TTS_VOICE_ID: 'qwen-audio-3.0-tts-flash-fenggetts-x',
  })
  assert.equal(cascade.tts.voice, 'qwen-audio-3.0-tts-flash-fenggetts-x')
  assert.equal(cascade.tts.provider, 'dashscope')
  assert.equal(cascade.tts.model, 'qwen-audio-3.0-tts-flash')
})

test('legacy CASCADE_TTS_VOICE is honoured when the ID form is absent', () => {
  const cascade = resolveCascadeConfig({ CASCADE_TTS_VOICE: 'legacy-voice' })
  assert.equal(cascade.tts.voice, 'legacy-voice')
})

test('the realtime override key also feeds cascade stages', () => {
  const cascade = resolveCascadeConfig({
    QWEN_AUDIO_REALTIME_API_KEY: 'realtime-key',
  })
  assert.equal(cascade.stt.apiKey, 'realtime-key')
  assert.equal(cascade.llm.apiKey, 'realtime-key')
  assert.equal(cascade.tts.apiKey, 'realtime-key')
})

test('vad settings are numeric, clamped and default sensibly', () => {
  const defaults = resolveCascadeConfig({})
  assert.equal(defaults.vad.threshold, 0.04)
  assert.equal(defaults.vad.minSpeechMs, 320)
  assert.equal(defaults.vad.silenceMs, 650)
  assert.equal(defaults.vad.maxSpeechMs, 12000)
  const custom = resolveCascadeConfig({
    CASCADE_VAD_THRESHOLD: '0.03',
    CASCADE_VAD_MIN_SPEECH_MS: '120',
    CASCADE_VAD_SILENCE_MS: '90',
    CASCADE_VAD_MAX_SPEECH_MS: 'not-a-number',
  })
  assert.equal(custom.vad.threshold, 0.03)
  assert.equal(custom.vad.minSpeechMs, 120)
  // Below the safe floor: clamp instead of accepting a hair-trigger commit.
  assert.equal(custom.vad.silenceMs, 200)
  assert.equal(custom.vad.maxSpeechMs, 12000)
})

test('cascade service binds loopback with an ephemeral port by default', () => {
  const cascade = resolveCascadeConfig({})
  assert.equal(cascade.host, '127.0.0.1')
  assert.equal(cascade.port, 0)
  assert.equal(
    resolveCascadeConfig({ CASCADE_PORT: '3202' }).port,
    3202,
  )
})
