import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PREVIEW_TEXT,
  pcm16ToWav,
  synthesizeVoicePreview,
} from '../src/voice/studio/preview.mjs'

test('pcm16ToWav wraps PCM16 mono with correct header', () => {
  const sampleRate = 24000
  const pcm = Buffer.alloc(4800) // 0.1s
  const wav = pcm16ToWav(pcm, sampleRate)
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE')
  assert.equal(wav.readUInt16LE(20), 1) // PCM
  assert.equal(wav.readUInt16LE(22), 1) // mono
  assert.equal(wav.readUInt32LE(24), sampleRate)
  assert.equal(wav.readUInt16LE(34), 16)
  assert.equal(wav.length, 44 + pcm.length)
})

test('synthesizeVoicePreview collects audio and returns wav', async () => {
  const chunks = [Buffer.from([1, 0, 2, 0]), Buffer.from([3, 0, 4, 0])]
  const createSynthesizer = (_config, { onAudio }) => ({
    async start() {},
    sendText(text) {
      assert.equal(text, PREVIEW_TEXT)
      for (const chunk of chunks) onAudio(chunk)
    },
    async finish() {},
  })
  const wav = await synthesizeVoicePreview({
    apiKey: 'k',
    model: 'qwen-audio-3.0-tts-flash',
    voice: 'voice-x',
    sampleRate: 24000,
    createSynthesizer,
  })
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
  assert.deepEqual(wav.subarray(44), Buffer.concat(chunks))
})

test('synthesizeVoicePreview rejects missing voice or apiKey', async () => {
  await assert.rejects(
    () => synthesizeVoicePreview({
      apiKey: '',
      model: 'm',
      voice: 'v',
      createSynthesizer: () => ({}),
    }),
    /apiKey|voice|preview/i,
  )
})
