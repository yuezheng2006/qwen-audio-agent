import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MinimaxSynthesizer,
  isSpeakableMinimaxText,
  normalizeMinimaxProvider,
} from '../src/voice/cascade/adapters/minimax-tts.mjs'
import { resolveCascadeConfig } from '../src/core/config.mjs'
import { createSynthesizer } from '../src/voice/cascade/adapters/tts.mjs'

test('minimax aliases normalize to minimax provider key', () => {
  assert.equal(normalizeMinimaxProvider('minimax'), 'minimax')
  assert.equal(normalizeMinimaxProvider('minimaxi'), 'minimax')
  assert.equal(normalizeMinimaxProvider('MINIMAX'), 'minimax')
  assert.equal(normalizeMinimaxProvider('fish'), null)
})

test('minimax skips punctuation-only text', () => {
  assert.equal(isSpeakableMinimaxText('你好。'), true)
  assert.equal(isSpeakableMinimaxText('？'), false)
})

test('cascade config wires minimax defaults from MINIMAX_* env', () => {
  const cascade = resolveCascadeConfig({
    CASCADE_TTS_PROVIDER: 'minimaxi',
    MINIMAX_API_KEY: 'mm-key',
    MINIMAX_VOICE_ID: 'fenggeMm01',
    MINIMAX_MODEL: 'speech-02-turbo',
    MINIMAX_LANGUAGE_BOOST: 'Chinese',
  })
  assert.equal(cascade.tts.provider, 'minimax')
  assert.equal(cascade.tts.model, 'speech-02-turbo')
  assert.equal(cascade.tts.voice, 'fenggeMm01')
  assert.equal(cascade.tts.apiKey, 'mm-key')
  assert.equal(cascade.tts.minimaxBaseUrl, 'https://api.minimaxi.com')
  assert.equal(cascade.tts.minimaxLanguageBoost, 'Chinese')
})

test('createSynthesizer resolves minimax alias', () => {
  const synthesizer = createSynthesizer({
    tts: {
      provider: 'minimaxi',
      model: 'speech-02-turbo',
      voice: 'v1',
      apiKey: 'k',
      sampleRate: 24000,
    },
  }, { onAudio() {} })
  assert.equal(synthesizer.constructor.name, 'MinimaxSynthesizer')
})

test('minimax synthesizer streams hex pcm from sse', async () => {
  const audioChunks = []
  const calls = []
  const synthesizer = new MinimaxSynthesizer({
    tts: {
      provider: 'minimax',
      model: 'speech-02-turbo',
      voice: 'fenggeMm01',
      apiKey: 'k',
      sampleRate: 24000,
      minimaxBaseUrl: 'https://api.minimaxi.com',
      minimaxLanguageBoost: 'Chinese',
    },
  }, {
    onAudio: buffer => audioChunks.push(buffer),
    fetchImpl: async (url, options = {}) => {
      calls.push({
        url: String(url),
        headers: options.headers || {},
        body: options.body ? JSON.parse(options.body) : null,
      })
      const sse = [
        'data: {"base_resp":{"status_code":0},"data":{"audio":"01020304","status":1}}',
        'data: {"base_resp":{"status_code":0},"data":{"audio":"0506","status":2}}',
        '',
      ].join('\n')
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'text/event-stream' },
        text: async () => sse,
      }
    },
  })

  await synthesizer.start()
  synthesizer.sendText('你好。')
  synthesizer.sendText('？')
  await synthesizer.finish()

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.minimaxi.com/v1/t2a_v2')
  assert.equal(calls[0].headers.Authorization, 'Bearer k')
  assert.equal(calls[0].body.stream, true)
  assert.equal(calls[0].body.voice_setting.voice_id, 'fenggeMm01')
  assert.equal(calls[0].body.audio_setting.format, 'pcm')
  assert.equal(audioChunks.length, 2)
  assert.deepEqual([...audioChunks[0]], [1, 2, 3, 4])
  assert.deepEqual([...audioChunks[1]], [5, 6])
})
