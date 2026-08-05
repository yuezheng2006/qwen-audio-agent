import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ListenHubSynthesizer,
  isSpeakableListenHubText,
  normalizeListenHubProvider,
} from '../src/voice/cascade/adapters/listenhub-tts.mjs'
import { resolveCascadeConfig } from '../src/core/config.mjs'
import { createSynthesizer } from '../src/voice/cascade/adapters/tts.mjs'

test('listenhub aliases normalize to listenhub provider key', () => {
  assert.equal(normalizeListenHubProvider('listenhub'), 'listenhub')
  assert.equal(normalizeListenHubProvider('marswave'), 'listenhub')
  assert.equal(normalizeListenHubProvider('flowtts'), 'listenhub')
  assert.equal(normalizeListenHubProvider('fish'), null)
})

test('listenhub skips punctuation-only text', () => {
  assert.equal(isSpeakableListenHubText('你好。'), true)
  assert.equal(isSpeakableListenHubText('，'), false)
})

test('cascade config wires listenhub defaults from LISTENHUB_* env', () => {
  const cascade = resolveCascadeConfig({
    CASCADE_TTS_PROVIDER: 'marswave',
    LISTENHUB_API_KEY: 'lh-key',
    LISTENHUB_SPEAKER_ID: 'voice-clone-abc',
    LISTENHUB_TTS_MODEL: 'flowtts',
  })
  assert.equal(cascade.tts.provider, 'listenhub')
  assert.equal(cascade.tts.model, 'flowtts')
  assert.equal(cascade.tts.voice, 'voice-clone-abc')
  assert.equal(cascade.tts.apiKey, 'lh-key')
  assert.equal(cascade.tts.listenhubBaseUrl, 'https://api.marswave.ai')
})

test('createSynthesizer resolves listenhub alias', () => {
  const synthesizer = createSynthesizer({
    tts: {
      provider: 'flowtts',
      model: 'flowtts',
      voice: 'voice-clone-1',
      apiKey: 'k',
      sampleRate: 24000,
    },
  }, { onAudio() {} })
  assert.equal(synthesizer.constructor.name, 'ListenHubSynthesizer')
})

test('listenhub synthesizer posts mp3 and emits decoded pcm frames', async () => {
  const audioChunks = []
  const calls = []
  const synthesizer = new ListenHubSynthesizer({
    tts: {
      provider: 'listenhub',
      model: 'flowtts',
      voice: 'voice-clone-1',
      apiKey: 'k',
      sampleRate: 24000,
      listenhubBaseUrl: 'https://api.marswave.ai',
    },
  }, {
    onAudio: buffer => audioChunks.push(buffer),
    decodeMp3: async () => Buffer.from([1, 2, 3, 4, 5, 6]),
    fetchImpl: async (url, options = {}) => {
      calls.push({
        url: String(url),
        headers: options.headers || {},
        body: options.body ? JSON.parse(options.body) : null,
      })
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'audio/mpeg' },
        arrayBuffer: async () => Uint8Array.from([0xff, 0xfb]).buffer,
      }
    },
  })

  await synthesizer.start()
  synthesizer.sendText('你好。')
  synthesizer.sendText('？')
  await synthesizer.finish()

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.marswave.ai/openapi/v1/tts')
  assert.equal(calls[0].headers.Authorization, 'Bearer k')
  assert.equal(calls[0].body.voice, 'voice-clone-1')
  assert.equal(calls[0].body.response_format, 'mp3')
  assert.equal(calls[0].body.model, 'flowtts')
  assert.ok(audioChunks.length >= 1)
  assert.deepEqual(
    Buffer.concat(audioChunks),
    Buffer.from([1, 2, 3, 4, 5, 6]),
  )
})
