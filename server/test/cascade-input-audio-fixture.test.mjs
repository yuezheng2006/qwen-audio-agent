import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { CascadeSession } from '../src/voice/cascade/session.mjs'
import { chunkPcm, loadPcm16Wav } from './helpers/pcm-wav.mjs'

const cascadeConfig = {
  stt: { provider: 'fake', model: 'fake-stt', apiKey: 'key' },
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

class FakeRecognizer {
  constructor({ onPartial } = {}, { finalText = '你好' } = {}) {
    this.onPartial = onPartial
    this.finalText = finalText
    this.audio = []
    this.aborted = false
  }

  async start() {}

  sendAudio(buffer) {
    this.audio.push(Buffer.from(buffer))
  }

  async finish() {
    return this.finalText
  }

  abort() {
    this.aborted = true
  }

  receivedMs(sampleRate = 16000) {
    const bytes = this.audio.reduce((sum, buf) => sum + buf.length, 0)
    return (bytes / 2 / sampleRate) * 1000
  }
}

function makeSession({ finalText = '你好', streamChat } = {}) {
  const ws = new FakeWs()
  const recognizers = []
  const synthesizer = {
    texts: [],
    start: async () => {},
    sendText(text) { this.texts.push(text) },
    finish: async () => {},
    abort() { this.aborted = true },
  }
  const session = new CascadeSession(ws, {
    cascadeConfig,
    adapters: {
      createRecognizer: (_config, handlers) => {
        const recognizer = new FakeRecognizer(handlers, { finalText })
        recognizers.push(recognizer)
        return recognizer
      },
      createSynthesizer: () => synthesizer,
      streamChat: streamChat || (async (_config, { onTextDelta }) => {
        onTextDelta('收到。')
        return { text: '收到。', toolCalls: [], finishReason: 'stop' }
      }),
    },
  })
  return { ws, session, recognizers, synthesizer }
}

function feedFixture(ws, name) {
  const { pcm } = loadPcm16Wav(name)
  for (const frame of chunkPcm(pcm, 20)) {
    ws.emit('message', JSON.stringify({
      type: 'input_audio_buffer.append',
      audio: frame.toString('base64'),
    }))
  }
  return pcm.length
}

async function settle(ms = 30) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

test('fixture WAVs are mono 16 kHz PCM16', () => {
  for (const name of [
    'utterance_a.wav',
    'utterance_b.wav',
    'near_silence.wav',
    'soft_onset.wav',
  ]) {
    const { sampleRate, pcm } = loadPcm16Wav(name)
    assert.equal(sampleRate, 16000)
    assert.ok(pcm.length >= 16000 * 0.5 * 2, `${name} too short`)
    assert.equal(pcm.length % 2, 0)
  }
})

test('utterance_a.wav drives a full cascade turn end-to-end', async () => {
  const { ws, session, synthesizer, recognizers } = makeSession({
    finalText: '你好峰哥',
  })
  feedFixture(ws, 'utterance_a.wav')
  await settle()

  assert.equal(ws.eventsOfType('input_audio_buffer.speech_started').length, 1)
  assert.equal(ws.eventsOfType('input_audio_buffer.speech_stopped').length, 1)
  assert.equal(
    ws.eventsOfType('conversation.item.input_audio_transcription.completed')[0]
      .transcript,
    '你好峰哥',
  )
  assert.deepEqual(session.history[0], { role: 'user', content: '你好峰哥' })
  assert.equal(ws.eventsOfType('response.created').length, 1)
  assert.equal(ws.eventsOfType('response.done')[0].response.status, 'completed')
  assert.deepEqual(synthesizer.texts, ['收到。'])
  assert.ok(recognizers[0].receivedMs() > 200)
})

test('near_silence.wav never opens a user turn', async () => {
  const { ws } = makeSession()
  feedFixture(ws, 'near_silence.wav')
  await settle()
  assert.equal(ws.eventsOfType('input_audio_buffer.speech_started').length, 0)
  assert.equal(ws.eventsOfType('response.created').length, 0)
})

test('soft_onset.wav keeps quiet lead-in in the recognizer stream', async () => {
  const { ws, recognizers } = makeSession({ finalText: '开场' })
  feedFixture(ws, 'soft_onset.wav')
  await settle()
  assert.equal(ws.eventsOfType('input_audio_buffer.speech_started').length, 1)
  // Quiet lead-in + speech should exceed the voiced core alone.
  assert.ok(
    recognizers[0].receivedMs() > 300,
    `expected preroll, got ${recognizers[0].receivedMs()}ms`,
  )
})

test('utterance_b.wav barges in and cancels the active reply', async () => {
  let releaseLlm
  const { ws, recognizers, session } = makeSession({
    finalText: '停下别说了',
    streamChat: (_config, { signal, onTextDelta }) => (
      new Promise((resolve, reject) => {
        onTextDelta('还在说……')
        releaseLlm = resolve
        signal.addEventListener('abort', () => reject(new Error('aborted')))
      })
    ),
  })
  ws.emit('message', JSON.stringify({ type: 'response.create' }))
  await settle()
  assert.equal(ws.eventsOfType('response.created').length, 1)
  session.bargeHoldUntil = 0

  feedFixture(ws, 'utterance_b.wav')
  await settle()
  assert.equal(ws.eventsOfType('input_audio_buffer.speech_started').length, 1)
  // Soft barge-in: STT final with ≥4 non-backchannel chars → confirm.
  assert.ok(recognizers.length >= 1)
  assert.equal(ws.eventsOfType('response.done')[0].response.status, 'cancelled')
  releaseLlm?.({ text: '', toolCalls: [], finishReason: 'stop' })
})

test('two fixture utterances produce two distinct transcripts and replies', async () => {
  const texts = ['第一句', '第二句']
  let turn = 0
  const ws = new FakeWs()
  const synthesizer = {
    texts: [],
    start: async () => {},
    sendText(text) { this.texts.push(text) },
    finish: async () => {},
    abort() {},
  }
  const session = new CascadeSession(ws, {
    cascadeConfig,
    adapters: {
      createRecognizer: (_config, handlers) => {
        const finalText = texts[turn] || `turn-${turn}`
        turn += 1
        return new FakeRecognizer(handlers, { finalText })
      },
      createSynthesizer: () => synthesizer,
      streamChat: async (_config, { onTextDelta }) => {
        onTextDelta('好。')
        return { text: '好。', toolCalls: [], finishReason: 'stop' }
      },
    },
  })

  feedFixture(ws, 'utterance_a.wav')
  await settle()
  feedFixture(ws, 'utterance_b.wav')
  await settle()

  const completed = ws.eventsOfType(
    'conversation.item.input_audio_transcription.completed',
  )
  assert.deepEqual(completed.map(event => event.transcript), texts)
  assert.equal(ws.eventsOfType('response.created').length, 2)
  assert.equal(ws.eventsOfType('response.done').length, 2)
  assert.deepEqual(
    session.history.filter(item => item.role === 'user').map(item => item.content),
    texts,
  )
})
