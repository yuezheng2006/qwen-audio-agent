import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { CascadeSession } from '../src/voice/cascade/session.mjs'

const cascadeConfig = {
  stt: { provider: 'fake', model: 'qwen3-asr-flash-realtime', apiKey: 'key' },
  llm: { baseUrl: 'http://fake', model: 'fake-llm', apiKey: 'key', maxTokens: 100 },
  tts: {
    provider: 'fake',
    model: 'qwen-audio-3.0-tts-flash',
    voice: 'longanhuan_v3.6',
    apiKey: 'key',
    sampleRate: 24000,
  },
  vad: { threshold: 0.015, minSpeechMs: 100, silenceMs: 300, maxSpeechMs: 12000 },
}

class FakeWs extends EventEmitter {
  constructor() {
    super()
    this.OPEN = 1
    this.readyState = 1
    this.sent = []
  }

  send(raw) {
    this.sent.push(JSON.parse(raw))
  }

  eventsOfType(type) {
    return this.sent.filter(event => event.type === type)
  }
}

async function settle(ms = 20) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

test('late TTS audio after barge-in cancel is not emitted', async () => {
  const ws = new FakeWs()
  let onAudio
  let releaseLlm
  const synthesizer = {
    start: async () => {},
    sendText() {},
    finish: async () => {},
    abort() {},
  }
  const session = new CascadeSession(ws, {
    cascadeConfig,
    adapters: {
      createRecognizer: () => ({
        start: async () => {},
        sendAudio() {},
        finish: async () => 'x',
        abort() {},
      }),
      createSynthesizer: (_config, handlers) => {
        onAudio = handlers.onAudio
        return synthesizer
      },
      streamChat: (_config, { signal, onTextDelta }) => (
        new Promise((resolve, reject) => {
          onTextDelta('很长的一句，还没说完。')
          releaseLlm = resolve
          signal.addEventListener('abort', () => reject(new Error('aborted')))
        })
      ),
    },
  })
  void session

  ws.emit('message', JSON.stringify({ type: 'response.create' }))
  await settle(40)
  assert.equal(ws.eventsOfType('response.created').length, 1)
  // Soft/hard sentence boundaries release text into TTS asynchronously.
  for (let i = 0; i < 20 && typeof onAudio !== 'function'; i += 1) {
    await settle(20)
  }
  assert.ok(typeof onAudio === 'function', 'synthesizer should be started')

  const before = ws.eventsOfType('response.audio.delta').length
  ws.emit('message', JSON.stringify({ type: 'response.cancel' }))
  await settle()
  assert.equal(ws.eventsOfType('response.done')[0].response.status, 'cancelled')

  // Late PCM from the aborted synthesizer must not reach the client.
  onAudio(Buffer.alloc(640, 7))
  await settle()
  assert.equal(ws.eventsOfType('response.audio.delta').length, before)

  releaseLlm?.({ text: '', toolCalls: [], finishReason: 'stop' })
})

test('a new response can emit audio after the cancel discard window clears', async () => {
  const ws = new FakeWs()
  const audioHooks = []
  const session = new CascadeSession(ws, {
    cascadeConfig,
    adapters: {
      createRecognizer: () => ({
        start: async () => {},
        sendAudio() {},
        finish: async () => 'x',
        abort() {},
      }),
      createSynthesizer: (_config, handlers) => {
        audioHooks.push(handlers.onAudio)
        return {
          texts: [],
          start: async () => {},
          sendText(text) {
            this.texts.push(text)
            // Simulate streaming PCM for the current speak turn.
            handlers.onAudio?.(Buffer.alloc(160, 1))
          },
          finish: async () => {},
          abort() {},
        }
      },
      streamChat: async () => ({ text: '', toolCalls: [], finishReason: 'stop' }),
    },
  })
  void session

  ws.emit('message', JSON.stringify({
    type: 'response.create',
    response: { cascade_mode: 'speak', content: '第一句。' },
  }))
  await settle(40)
  assert.ok(audioHooks.length >= 1)
  const lateFromFirst = audioHooks[0]

  ws.emit('message', JSON.stringify({ type: 'response.cancel' }))
  await settle()
  const afterCancel = ws.eventsOfType('response.audio.delta').length
  lateFromFirst(Buffer.alloc(320, 9))
  await settle()
  assert.equal(
    ws.eventsOfType('response.audio.delta').length,
    afterCancel,
    'late audio from cancelled speak must stay dropped',
  )

  const afterCancelDeltas = ws.eventsOfType('response.audio.delta').length
  ws.emit('message', JSON.stringify({
    type: 'response.create',
    response: { cascade_mode: 'speak', content: '第二句。' },
  }))
  await settle(40)
  assert.ok(audioHooks.length >= 2)
  // sendText on the new speak turn streams PCM while the response is live.
  assert.ok(
    ws.eventsOfType('response.audio.delta').length > afterCancelDeltas,
    'new speak turn must be allowed to emit audio again',
  )
})
