import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FishAudioSynthesizer,
  isSpeakableFishText,
  normalizeFishProvider,
} from '../src/voice/cascade/adapters/fish-tts.mjs'
import {
  createSynthesizer,
  listTtsProviders,
} from '../src/voice/cascade/adapters/tts.mjs'
import { resolveCascadeConfig } from '../src/core/config.mjs'

test('fish aliases normalize to fish provider key', () => {
  assert.equal(normalizeFishProvider('fish'), 'fish')
  assert.equal(normalizeFishProvider('fishaudio'), 'fish')
  assert.equal(normalizeFishProvider('fish-audio'), 'fish')
  assert.equal(normalizeFishProvider('FISH'), 'fish')
  assert.equal(normalizeFishProvider('dashscope'), null)
})

test('fish skips punctuation-only text that would synthesize garbage', () => {
  assert.equal(isSpeakableFishText('你好。'), true)
  assert.equal(isSpeakableFishText('？'), false)
  assert.equal(isSpeakableFishText('   '), false)
})

test('cascade config wires fish s2.1 defaults from FISH_* env', () => {
  const cascade = resolveCascadeConfig({
    CASCADE_TTS_PROVIDER: 'fish-audio',
    FISH_API_KEY: 'fish-key',
    FISH_REFERENCE_ID: 'ref-fengge-001',
    FISH_TTS_MODEL: 's2.1-pro',
    FISH_TTS_LATENCY: 'balanced',
  })
  assert.equal(cascade.tts.provider, 'fish')
  assert.equal(cascade.tts.model, 's2.1-pro')
  assert.equal(cascade.tts.voice, 'ref-fengge-001')
  assert.equal(cascade.tts.apiKey, 'fish-key')
  assert.equal(cascade.tts.fishBaseUrl, 'https://api.fish.audio')
  assert.equal(cascade.tts.fishLatency, 'balanced')
})

test('tts registry lists fish alongside dashscope and voicebox', () => {
  assert.deepEqual(
    listTtsProviders().sort(),
    ['dashscope', 'fish', 'listenhub', 'minimax', 'voicebox'],
  )
})

test('fish synthesizer streams pcm chunks with s2.1 model header', async () => {
  const audioChunks = []
  const calls = []
  const synthesizer = new FishAudioSynthesizer({
    tts: {
      provider: 'fish',
      model: 's2.1-pro-free',
      voice: 'voice-ref-1',
      apiKey: 'k',
      sampleRate: 24000,
      fishBaseUrl: 'https://api.fish.audio',
      fishLatency: 'balanced',
    },
  }, {
    onAudio: buffer => audioChunks.push(buffer),
    fetchImpl: async (url, options = {}) => {
      calls.push({
        url: String(url),
        method: options.method || 'GET',
        headers: options.headers || {},
        body: options.body ? JSON.parse(options.body) : null,
      })
      const chunks = [
        Uint8Array.from([1, 2, 3, 4]),
        Uint8Array.from([5, 6]),
      ]
      let index = 0
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/octet-stream' },
        body: {
          getReader() {
            return {
              async read() {
                if (index >= chunks.length) return { done: true, value: undefined }
                const value = chunks[index]
                index += 1
                return { done: false, value }
              },
            }
          },
        },
      }
    },
  })

  await synthesizer.start()
  synthesizer.sendText('你好。')
  synthesizer.sendText('？') // punct-only ignored
  await synthesizer.finish()

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.fish.audio/v1/tts')
  assert.equal(calls[0].headers.Authorization, 'Bearer k')
  assert.equal(calls[0].headers.model, 's2.1-pro-free')
  assert.equal(calls[0].body.format, 'pcm')
  assert.equal(calls[0].body.reference_id, 'voice-ref-1')
  assert.equal(calls[0].body.text, '你好。')
  assert.equal(audioChunks.length, 2)
  assert.deepEqual([...audioChunks[0]], [1, 2, 3, 4])
  assert.deepEqual([...audioChunks[1]], [5, 6])
})

test('fish synthesizer retries transient fetch failures', async () => {
  const audioChunks = []
  let attempts = 0
  const synthesizer = new FishAudioSynthesizer({
    tts: {
      provider: 'fish',
      model: 's2.1-pro-free',
      voice: 'voice-ref-1',
      apiKey: 'k',
      sampleRate: 24000,
      fishBaseUrl: 'https://api.fish.audio',
    },
  }, {
    onAudio: buffer => audioChunks.push(buffer),
    fetchImpl: async () => {
      attempts += 1
      if (attempts < 2) throw new Error('fetch failed')
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/octet-stream' },
        arrayBuffer: async () => Uint8Array.from([9, 8, 7, 6]).buffer,
      }
    },
  })
  await synthesizer.start()
  synthesizer.sendText('重试。')
  await synthesizer.finish()
  assert.equal(attempts, 2)
  assert.equal(audioChunks.length, 1)
  assert.deepEqual([...audioChunks[0]], [9, 8, 7, 6])
})

test('createSynthesizer accepts fish aliases', () => {
  const synth = createSynthesizer({
    tts: {
      provider: 'fishaudio',
      model: 's2.1-pro-free',
      voice: 'x',
      apiKey: 'k',
      sampleRate: 24000,
      fishBaseUrl: 'https://api.fish.audio',
    },
  }, { onAudio() {} })
  assert.ok(synth instanceof FishAudioSynthesizer)
})

test('fish synthesizer fails closed without api key or reference id', async () => {
  const missingKey = new FishAudioSynthesizer({
    tts: { voice: 'ref', apiKey: '', sampleRate: 24000 },
  }, { onAudio() {} })
  await assert.rejects(() => missingKey.start(), /FISH_API_KEY/)

  const missingVoice = new FishAudioSynthesizer({
    tts: { voice: '', apiKey: 'k', sampleRate: 24000 },
  }, { onAudio() {} })
  await assert.rejects(() => missingVoice.start(), /reference_id|VOICE/)
})
