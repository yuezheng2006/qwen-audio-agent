import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import {
  BACKCHANNEL_WINDOW_MS,
  buildInterruptedUserContent,
  createBargeInController,
  isBackchannel,
  looksLikeEcho,
  shouldSuppressInterrupt,
  significantCharCount,
} from '../src/voice/cascade/barge-in.mjs'
import { CascadeSession } from '../src/voice/cascade/session.mjs'

test('backchannel detector recognizes Chinese and English fillers', () => {
  assert.equal(isBackchannel('嗯'), true)
  assert.equal(isBackchannel('好的'), true)
  assert.equal(isBackchannel('yeah'), true)
  assert.equal(isBackchannel('hello hello'), true)
  assert.equal(isBackchannel('你好'), true)
  assert.equal(isBackchannel('继续说天气'), false)
  assert.equal(significantCharCount('嗯'), 1)
  assert.equal(significantCharCount('继续'), 2)
  assert.equal(looksLikeEcho('你好我在', '你好，我在这里。有什么我可以帮你的吗？'), true)
  assert.equal(shouldSuppressInterrupt('继续', { spokenSoFar: '你好' }), true)
  assert.equal(shouldSuppressInterrupt('停下别说了', { spokenSoFar: '你好' }), false)
})

test('controller suppresses backchannel and confirms sustained speech', async () => {
  const confirms = []
  let now = 1_000
  const barge = createBargeInController({
    windowMs: 50,
    now: () => now,
    onConfirm: info => confirms.push(info),
  })
  barge.armSoft()
  barge.notePartial('嗯')
  assert.equal(barge.pending, false)
  assert.deepEqual(barge.decideOnSpeechEnd('嗯'), {
    action: 'suppress',
    text: '嗯',
  })

  barge.armSoft()
  barge.notePartial('停下别说了')
  assert.equal(barge.pending, true)
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.equal(confirms.length, 1)
  assert.equal(confirms[0].reason, 'speech_sustained')
})

test('short non-backchannel at speech end confirms immediately', () => {
  const confirms = []
  const barge = createBargeInController({
    onConfirm: info => confirms.push(info),
  })
  barge.armSoft()
  const decision = barge.decideOnSpeechEnd('停下别说了')
  assert.equal(decision.action, 'confirm')
  assert.equal(confirms[0].reason, 'short_utterance')
})

test('echo of assistant TTS is suppressed', () => {
  const confirms = []
  const barge = createBargeInController({
    getSpokenSoFar: () => '你好，我在这里。有什么我可以帮你的吗？',
    onConfirm: info => confirms.push(info),
  })
  barge.armSoft()
  assert.equal(barge.decideOnSpeechEnd('你好我在这里').action, 'suppress')
  assert.equal(confirms.length, 0)
})

test('post-commit hold suppresses trailing hello', () => {
  const confirms = []
  const barge = createBargeInController({
    isHoldActive: () => true,
    onConfirm: info => confirms.push(info),
  })
  barge.armSoft()
  assert.equal(barge.decideOnSpeechEnd('hello hello').action, 'suppress')
  assert.equal(confirms.length, 0)
})

test('interrupt prompt asks model not to continue prior speech', () => {
  const short = buildInterruptedUserContent('别说了', '这是很长的一段回答……')
  assert.match(short, /不要继续/)
  assert.match(short, /别说了/)
  const longer = buildInterruptedUserContent(
    '你刚才说到一半，改成讲天气吧',
    'A'.repeat(200),
  )
  assert.match(longer, /你当时说到/)
  assert.match(longer, /讲天气/)
})

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
  const samples = Math.round((ms / 1000) * 16000)
  const buffer = Buffer.alloc(samples * 2)
  for (let i = 0; i < samples; i += 1) {
    buffer.writeInt16LE(i % 2 === 0 ? amplitude : -amplitude, i * 2)
  }
  return buffer
}

class FakeRecognizer {
  constructor({ onPartial } = {}, { finalText = '' } = {}) {
    this.onPartial = onPartial
    this.finalText = finalText
  }

  async start() {}
  sendAudio() {}
  emitPartial(text) { this.onPartial?.(text) }
  async finish() { return this.finalText }
  abort() {}
}

function sendAudio(ws, buffer) {
  ws.emit('message', JSON.stringify({
    type: 'input_audio_buffer.append',
    audio: buffer.toString('base64'),
  }))
}

async function settle(ms = 20) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

test('session keeps assistant audio on backchannel 嗯', async () => {
  let releaseLlm
  const recognizers = []
  const ws = new FakeWs()
  const session = new CascadeSession(ws, {
    cascadeConfig,
    adapters: {
      createRecognizer: (_config, handlers) => {
        const recognizer = new FakeRecognizer(handlers, { finalText: '嗯' })
        recognizers.push(recognizer)
        return recognizer
      },
      createSynthesizer: () => ({
        start: async () => {},
        sendText() {},
        finish: async () => {},
        abort() {},
      }),
      streamChat: (_config, { signal, onTextDelta }) => (
        new Promise((resolve, reject) => {
          onTextDelta('很长的回答还没说完。')
          releaseLlm = resolve
          signal.addEventListener('abort', () => reject(new Error('aborted')))
        })
      ),
    },
  })
  ws.emit('message', JSON.stringify({ type: 'response.create' }))
  await settle()
  for (let i = 0; i < 10; i += 1) sendAudio(ws, frame(20, 3000))
  await settle()
  recognizers[0].emitPartial('嗯')
  for (let i = 0; i < 20; i += 1) sendAudio(ws, frame(20, 10))
  await settle()
  assert.equal(ws.eventsOfType('response.done').length, 0)
  assert.equal(
    ws.eventsOfType('input_audio_buffer.speech_stopped')[0].reason,
    'turn_invalid',
  )
  releaseLlm?.({ text: '', toolCalls: [], finishReason: 'stop' })
  session.dispose()
})

test('session cancels after sustained non-backchannel partial', async () => {
  let releaseLlm
  const recognizers = []
  const ws = new FakeWs()
  const session = new CascadeSession(ws, {
    cascadeConfig,
    adapters: {
      createRecognizer: (_config, handlers) => {
        const recognizer = new FakeRecognizer(handlers, { finalText: '停下别说了' })
        recognizers.push(recognizer)
        return recognizer
      },
      createSynthesizer: () => ({
        start: async () => {},
        sendText() {},
        finish: async () => {},
        abort() {},
      }),
      streamChat: (_config, { signal, onTextDelta }) => (
        new Promise((resolve, reject) => {
          onTextDelta('很长的回答还没说完。')
          releaseLlm = resolve
          signal.addEventListener('abort', () => reject(new Error('aborted')))
        })
      ),
    },
  })
  ws.emit('message', JSON.stringify({ type: 'response.create' }))
  await settle()
  session.bargeHoldUntil = 0
  for (let i = 0; i < 10; i += 1) sendAudio(ws, frame(20, 3000))
  await settle()
  recognizers[0].emitPartial('停下别说了')
  await settle(BACKCHANNEL_WINDOW_MS + 40)
  assert.equal(ws.eventsOfType('response.done')[0]?.response.status, 'cancelled')
  for (let i = 0; i < 20; i += 1) sendAudio(ws, frame(20, 10))
  await settle()
  const user = session.history.find(item => item.role === 'user')
  assert.match(user.content, /不要继续|打断/)
  releaseLlm?.({ text: '', toolCalls: [], finishReason: 'stop' })
  session.dispose()
})
