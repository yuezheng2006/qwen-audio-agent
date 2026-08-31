import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createSynthesizer,
  listTtsProviders,
} from '../src/voice/cascade/adapters/tts.mjs'
import { VoiceBoxSynthesizer } from '../src/voice/cascade/adapters/voicebox-tts.mjs'
import { getCascadeTtsPlatformMetadata } from '../../shared/cascade-tts-plugins.mjs'

test('tts registry lists dashscope voicebox fish listenhub minimax', () => {
  assert.deepEqual(
    listTtsProviders().sort(),
    ['dashscope', 'fish', 'listenhub', 'minimax', 'voicebox'],
  )
})

test('tts providers expose platform runtime and data boundary metadata', () => {
  assert.deepEqual(getCascadeTtsPlatformMetadata('voicebox'), {
    platformApiVersion: '0.1',
    platformCapabilities: ['speech.synthesize'],
    runtime: 'local-sidecar',
    dataBoundary: 'local',
  })
  assert.deepEqual(getCascadeTtsPlatformMetadata('fish'), {
    platformApiVersion: '0.1',
    platformCapabilities: ['speech.synthesize'],
    runtime: 'remote',
    dataBoundary: 'remote-explicit',
  })
  assert.equal(getCascadeTtsPlatformMetadata('unknown'), null)
})

test('voicebox synthesizer posts text and emits pcm', async () => {
  const audioChunks = []
  const calls = []
  const synthesizer = new VoiceBoxSynthesizer({
    tts: {
      voice: 'demo',
      sampleRate: 24000,
      voiceboxBaseUrl: 'http://voicebox.test',
    },
  }, {
    onAudio: buffer => audioChunks.push(buffer),
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method || 'GET' })
      if (String(url).endsWith('/health')) {
        return { ok: true, headers: { get: () => '' } }
      }
      return {
        ok: true,
        headers: { get: () => 'application/octet-stream' },
        arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer,
      }
    },
  })
  await synthesizer.start()
  synthesizer.sendText('你好。')
  await synthesizer.finish()
  assert.ok(calls.some(call => call.url.includes('/speak')))
  assert.equal(audioChunks.length, 1)
  assert.equal(audioChunks[0].length, 4)
})

test('createSynthesizer rejects unknown providers', () => {
  assert.throws(() => createSynthesizer({
    tts: { provider: 'cosyvoice' },
  }, {}), /不支持的级联 TTS/)
})
