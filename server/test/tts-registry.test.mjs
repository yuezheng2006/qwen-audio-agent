import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createSynthesizer,
  listTtsProviders,
} from '../src/voice/cascade/adapters/tts.mjs'
import { VoiceBoxSynthesizer } from '../src/voice/cascade/adapters/voicebox-tts.mjs'
import { MacOsSaySynthesizer } from '../src/voice/cascade/adapters/macos-say-tts.mjs'
import { getCascadeTtsPlatformMetadata } from '../../shared/cascade-tts-plugins.mjs'

test('tts registry lists dashscope voicebox fish listenhub minimax', () => {
  assert.deepEqual(
    listTtsProviders().sort(),
    ['dashscope', 'fish', 'listenhub', 'macos-say', 'minimax', 'voicebox'],
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

test('macOS system TTS adapter converts generated AIFF to PCM through injected commands', async () => {
  const calls = []
  const chunks = []
  const synthesizer = new MacOsSaySynthesizer({ tts: { voice: 'Ting-Ting', sampleRate: 24000 } }, {
    onAudio: chunk => chunks.push(chunk),
    runCommand: async (command, args) => {
      calls.push({ command, args })
      if (command === '/usr/bin/say') return { stdout: '' }
      return { stdout: Buffer.from([1, 2, 3, 4]) }
    },
  })
  await synthesizer.start()
  synthesizer.sendText('你好。')
  await synthesizer.finish()
  assert.equal(calls[0].command, '/usr/bin/say')
  assert.equal(calls[1].args.at(-1), 'pipe:1')
  assert.deepEqual(chunks, [Buffer.from([1, 2, 3, 4])])
})

test('voicebox synthesizer follows asynchronous generation to audio', async () => {
  const chunks = []
  let historyCalls = 0
  const synthesizer = new VoiceBoxSynthesizer({
    tts: { voice: 'profile-1', sampleRate: 24000, voiceboxBaseUrl: 'http://voicebox.test' },
  }, {
    onAudio: buffer => chunks.push(buffer),
    fetchImpl: async (url, options = {}) => {
      const value = String(url)
      if (value.endsWith('/health')) return { ok: true, headers: { get: () => '' } }
      if (value.endsWith('/speak')) return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ id: 'generation-1', status: 'generating' }),
      }
      if (value.includes('/history/')) {
        historyCalls += 1
        return { ok: true, json: async () => ({ status: historyCalls > 1 ? 'completed' : 'generating' }) }
      }
      if (value.includes('/audio/')) return {
        ok: true,
        arrayBuffer: async () => Uint8Array.from([5, 6, 7]).buffer,
      }
      throw new Error(`unexpected request: ${value} ${options.method || 'GET'}`)
    },
  })
  await synthesizer.start()
  synthesizer.sendText('你好。')
  await synthesizer.finish()
  assert.equal(historyCalls, 2)
  assert.deepEqual([...chunks[0]], [5, 6, 7])
})

test('createSynthesizer rejects unknown providers', () => {
  assert.throws(() => createSynthesizer({
    tts: { provider: 'cosyvoice' },
  }, {}), /不支持的级联 TTS/)
})
