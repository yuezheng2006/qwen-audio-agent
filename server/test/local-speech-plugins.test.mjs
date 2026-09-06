import assert from 'node:assert/strict'
import test from 'node:test'
import { createSynthesizer } from '../src/voice/cascade/adapters/tts.mjs'
import { createRecognizer } from '../src/voice/cascade/adapters/stt.mjs'

function jsonResponse(payload) {
  return {
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => payload,
    text: async () => '',
  }
}

test('FireRed and Breeze TTS adapters use the local sidecar contract', async () => {
  for (const [provider, baseUrl] of [
    ['firered', 'http://firered.test'],
    ['breeze', 'http://breeze.test'],
  ]) {
    const calls = []
    const audio = []
    const synthesizer = createSynthesizer({
      tts: {
        provider,
        model: 'test-model',
        voice: 'test-voice',
        sampleRate: 24000,
        ...(provider === 'firered'
          ? { fireRedBaseUrl: baseUrl }
          : { breezeBaseUrl: baseUrl }),
      },
    }, {
      onAudio: chunk => audio.push(chunk),
      fetchImpl: async (url, options) => {
        calls.push({ url, options })
        return jsonResponse({ audio_base64: Buffer.from('pcm').toString('base64') })
      },
    })
    await synthesizer.start()
    synthesizer.sendText('你好。')
    await synthesizer.finish()
    assert.equal(calls[0].url, `${baseUrl}/v1/tts`)
    assert.equal(JSON.parse(calls[0].options.body).provider, provider)
    assert.equal(audio[0].toString(), 'pcm')
  }
})

test('FireRed and Hojo ASR adapters send WAV to their local sidecar', async () => {
  for (const provider of ['firered', 'hojo']) {
    const calls = []
    const recognizer = createRecognizer({
      stt: { provider, url: `http://${provider}.test/v1/asr`, model: 'model', sampleRate: 16000 },
    }, {
      onPartial: text => assert.equal(text, '你好世界'),
      fetchImpl: async (url, options) => {
        calls.push({ url, options })
        return jsonResponse({ text: '你好世界' })
      },
    })
    recognizer.start()
    recognizer.sendAudio(Buffer.from([0, 0, 1, 0]))
    assert.equal(await recognizer.finish(), '你好世界')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].options.headers['content-type'], 'audio/wav')
    assert.equal(calls[0].options.headers['x-provider'], provider)
    assert.equal(Buffer.from(calls[0].options.body).toString('ascii', 0, 4), 'RIFF')
  }
})
