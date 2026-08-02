import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { CascadeSession } from '../src/voice/cascade/session.mjs'

const SAMPLE_RATE = 16000

const cascadeConfig = {
  stt: { provider: 'fake', model: 'fake-stt', apiKey: 'key' },
  llm: { baseUrl: 'http://fake', model: 'fake-llm', apiKey: 'key', maxTokens: 100 },
  tts: { provider: 'fake', model: 'fake-tts', voice: 'v', apiKey: 'key', sampleRate: 24000 },
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

function frame(ms, amplitude) {
  const samples = Math.round((ms / 1000) * SAMPLE_RATE)
  const buffer = Buffer.alloc(samples * 2)
  for (let i = 0; i < samples; i += 1) {
    buffer.writeInt16LE(i % 2 === 0 ? amplitude : -amplitude, i * 2)
  }
  return buffer
}

class FakeRecognizer {
  constructor({ onPartial } = {}, { finalText = '', failStart = false } = {}) {
    this.onPartial = onPartial
    this.finalText = finalText
    this.failStart = failStart
    this.audio = []
    this.aborted = false
  }

  async start() {
    if (this.failStart) throw new Error('识别服务不可用')
  }

  sendAudio(buffer) {
    this.audio.push(buffer)
  }

  emitPartial(text) {
    this.onPartial?.(text)
  }

  async finish() {
    if (this.finalText instanceof Error) throw this.finalText
    return this.finalText
  }

  abort() {
    this.aborted = true
  }
}

function makeSession({ finalText = '', failStart = false, streamChat } = {}) {
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
        const recognizer = new FakeRecognizer(handlers, { finalText, failStart })
        recognizers.push(recognizer)
        return recognizer
      },
      createSynthesizer: () => synthesizer,
      streamChat: streamChat || (async (_config, { onTextDelta }) => {
        onTextDelta('好的。')
        return { text: '好的。', toolCalls: [], finishReason: 'stop' }
      }),
    },
  })
  return { ws, session, recognizers, synthesizer }
}

function sendAudio(ws, buffer) {
  ws.emit('message', JSON.stringify({
    type: 'input_audio_buffer.append',
    audio: buffer.toString('base64'),
  }))
}

function speak(ws, { voicedMs = 200, silenceMs = 400 } = {}) {
  for (let i = 0; i < voicedMs / 20; i += 1) sendAudio(ws, frame(20, 3000))
  for (let i = 0; i < silenceMs / 20; i += 1) sendAudio(ws, frame(20, 10))
}

async function settle() {
  await new Promise(resolvePromise => setTimeout(resolvePromise, 20))
}

test('a spoken turn flows: speech events, transcript, then a model response', async () => {
  const { ws, session, recognizers, synthesizer } = makeSession({
    finalText: '现在几点了？',
  })
  speak(ws)
  await settle()
  const started = ws.eventsOfType('input_audio_buffer.speech_started')
  assert.equal(started.length, 1)
  const itemId = started[0].item_id
  assert.ok(itemId)
  const stopped = ws.eventsOfType('input_audio_buffer.speech_stopped')
  assert.deepEqual(
    { item_id: stopped[0].item_id, reason: stopped[0].reason },
    { item_id: itemId, reason: undefined },
  )
  assert.equal(ws.eventsOfType('input_audio_buffer.committed')[0].item_id, itemId)
  const completed = ws.eventsOfType('conversation.item.input_audio_transcription.completed')
  assert.equal(completed[0].transcript, '现在几点了？')
  assert.deepEqual(session.history[0], { role: 'user', content: '现在几点了？' })
  assert.equal(ws.eventsOfType('response.created').length, 1)
  assert.equal(ws.eventsOfType('response.done')[0].response.status, 'completed')
  assert.deepEqual(synthesizer.texts, ['好的。'])
  assert.equal(recognizers.length, 1)
})

test('streaming partials surface as cumulative transcription deltas', async () => {
  const { ws, recognizers } = makeSession({ finalText: '你好峰哥' })
  for (let i = 0; i < 10; i += 1) sendAudio(ws, frame(20, 3000))
  await settle()
  recognizers[0].emitPartial('你好')
  recognizers[0].emitPartial('你好峰哥')
  const deltas = ws.eventsOfType('conversation.item.input_audio_transcription.delta')
  assert.deepEqual(deltas.map(event => event.text), ['你好', '你好峰哥'])
  const itemId = ws.eventsOfType('input_audio_buffer.speech_started')[0].item_id
  assert.ok(deltas.every(event => event.item_id === itemId))
})

test('preroll audio from before the VAD trigger reaches the recognizer', async () => {
  const { ws, recognizers } = makeSession({ finalText: 'x' })
  // Quiet lead-in that a hard VAD cut would lose (soft speech onset).
  sendAudio(ws, frame(200, 10))
  speak(ws)
  await settle()
  const receivedMs = recognizers[0].audio
    .reduce((total, buffer) => total + (buffer.length / 2 / SAMPLE_RATE) * 1000, 0)
  // 200ms voiced after trigger + up to 400ms preroll; well above voiced-only.
  assert.ok(receivedMs > 200, `expected preroll, got ${receivedMs}ms`)
})

test('an empty transcript invalidates the turn without a response', async () => {
  const { ws } = makeSession({ finalText: '' })
  speak(ws)
  await settle()
  const stopped = ws.eventsOfType('input_audio_buffer.speech_stopped')
  assert.equal(stopped[0].reason, 'turn_invalid')
  assert.equal(ws.eventsOfType('input_audio_buffer.committed').length, 0)
  assert.equal(ws.eventsOfType('response.created').length, 0)
})

test('a failed recognizer invalidates the turn and reports failure', async () => {
  const { ws } = makeSession({ finalText: new Error('识别失败') })
  speak(ws)
  await settle()
  assert.equal(
    ws.eventsOfType('input_audio_buffer.speech_stopped')[0].reason,
    'turn_invalid',
  )
  assert.equal(
    ws.eventsOfType('conversation.item.input_audio_transcription.failed').length,
    1,
  )
  assert.equal(ws.eventsOfType('response.created').length, 0)
})

test('user speech barges in and cancels the active response', async () => {
  let releaseLlm
  const { ws, recognizers, session } = makeSession({
    finalText: '停下别说了',
    streamChat: (_config, { signal, onTextDelta }) => (
      new Promise((resolvePromise, rejectPromise) => {
        onTextDelta('很长的回答。还没说完')
        releaseLlm = resolvePromise
        signal.addEventListener('abort', () => rejectPromise(new Error('aborted')))
      })
    ),
  })
  ws.emit('message', JSON.stringify({ type: 'response.create' }))
  await settle()
  assert.equal(ws.eventsOfType('response.created').length, 1)
  // Expire post-commit hold so this intentional interrupt can confirm.
  session.bargeHoldUntil = 0
  for (let i = 0; i < 10; i += 1) sendAudio(ws, frame(20, 3000))
  await settle()
  assert.equal(ws.eventsOfType('input_audio_buffer.speech_started').length, 1)
  // Soft barge-in waits for a non-backchannel STT partial (≥4 chars).
  recognizers[0].emitPartial('停下别说了')
  // Ending the utterance with a real transcript confirms the interrupt.
  for (let i = 0; i < 20; i += 1) sendAudio(ws, frame(20, 10))
  await settle()
  const done = ws.eventsOfType('response.done')
  assert.equal(done.length, 1)
  assert.equal(done[0].response.status, 'cancelled')
  releaseLlm?.({ text: '', toolCalls: [], finishReason: 'stop' })
})

test('two consecutive turns keep separate item ids and both respond', async () => {
  const { ws } = makeSession({ finalText: '第一句' })
  speak(ws)
  await settle()
  speak(ws)
  await settle()
  const started = ws.eventsOfType('input_audio_buffer.speech_started')
  assert.equal(started.length, 2)
  assert.notEqual(started[0].item_id, started[1].item_id)
  assert.equal(ws.eventsOfType('response.created').length, 2)
})
