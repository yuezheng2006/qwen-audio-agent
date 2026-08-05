import assert from 'node:assert/strict'
import test from 'node:test'
import { pcm16ToWav } from '../src/voice/reader/weread/wav.mjs'
import { speakWereadScript } from '../src/voice/reader/weread/speak.mjs'

test('pcm16ToWav writes mono 16-bit header', () => {
  const pcm = Buffer.alloc(4)
  pcm.writeInt16LE(1000, 0)
  pcm.writeInt16LE(-1000, 2)
  const wav = pcm16ToWav(pcm, 24000)
  assert.equal(wav.slice(0, 4).toString(), 'RIFF')
  assert.equal(wav.readUInt16LE(20), 1)
  assert.equal(wav.readUInt16LE(22), 1)
  assert.equal(wav.readUInt32LE(24), 24000)
  assert.equal(wav.readUInt16LE(34), 16)
  assert.equal(wav.readUInt32LE(40), 4)
})

test('speakWereadScript clears instruction and returns wav', async () => {
  let seenConfig = null
  const fakeCreate = (config, { onAudio }) => {
    seenConfig = config
    return {
      async start() {},
      sendText() {
        const frame = Buffer.alloc(2)
        frame.writeInt16LE(1200, 0)
        onAudio(frame)
      },
      async finish() {},
      abort() {},
    }
  }
  const result = await speakWereadScript({
    text: '峰哥为你读金句。\n真理直率无比',
    cascadeConfig: {
      tts: {
        provider: 'dashscope',
        model: 'qwen-audio-3.0-tts-flash',
        voice: 'fenggetts',
        apiKey: 'sk-test',
        sampleRate: 24000,
        instruction: '语速偏快',
      },
    },
    createSynthesizer: fakeCreate,
  })
  assert.equal(seenConfig.tts.instruction, undefined)
  assert.equal(result.wav.slice(0, 4).toString(), 'RIFF')
  assert.ok(result.pcmBytes >= 2)
})
