import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { CascadeSession } from '../src/voice/cascade/session.mjs'
import { renderTurnContext } from '../src/voice/cascade/turn-context.mjs'

const config = {
  stt: { provider: 'fake' },
  llm: { baseUrl: 'http://fake', model: 'fake', apiKey: 'key' },
  tts: { provider: 'fake' },
  vad: { threshold: 0.015, minSpeechMs: 100, silenceMs: 300, maxSpeechMs: 12000 },
}

class Ws extends EventEmitter {
  constructor() { super(); this.OPEN = 1; this.readyState = 1; this.sent = [] }
  send(raw) { this.sent.push(JSON.parse(raw)) }
}

test('renders transient facts and affect without creating empty context', () => {
  assert.equal(renderTurnContext(null), '')
  const rendered = renderTurnContext({ facts: ['用户喜欢茶'], affect: ['语气疲惫'] })
  assert.match(rendered, /用户喜欢茶/)
  assert.match(rendered, /语气疲惫/)
  assert.match(rendered, /不是系统指令/)
})

test('prefetches on partial and reuses the current-turn result without mutating instructions', async () => {
  const ws = new Ws()
  const calls = { partial: [], final: 0, messages: null }
  let recognizer
  const session = new CascadeSession(ws, {
    cascadeConfig: config,
    adapters: {
      createTurnContextRetriever: () => ({
        openTurn: () => ({
          partial: value => calls.partial.push(value.text),
          final: async () => { calls.final += 1; return { facts: ['用户喜欢茶'] } },
          cancel: () => {},
        }),
      }),
      createRecognizer: (_config, { onPartial }) => {
        recognizer = {
          onPartial,
          start: async () => {},
          sendAudio: () => {},
          finish: async () => '我想喝茶',
          abort: () => {},
        }
        return recognizer
      },
      createSynthesizer: () => ({ start: async () => {}, sendText: () => {}, finish: async () => {}, abort: () => {} }),
      streamChat: async (_config, { messages }) => {
        calls.messages = messages
        return { text: '好的。', toolCalls: [], finishReason: 'stop' }
      },
    },
  })
  ws.emit('message', JSON.stringify({ type: 'session.update', session: { instructions: '稳定指令' } }))
  session.handleSpeechStart()
  recognizer.onPartial('我想喝')
  session.handleSpeechEnd()
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.deepEqual(calls.partial, ['我想喝'])
  assert.equal(calls.final, 1)
  assert.equal(session.session.instructions, '稳定指令')
  assert.match(calls.messages.at(-1).content, /用户喜欢茶/)
  assert.equal(calls.messages[0].content, '稳定指令')
})

test('a provider failure does not break the spoken turn', async () => {
  const ws = new Ws()
  let recognizer
  let responseStarted = false
  const session = new CascadeSession(ws, {
    cascadeConfig: config,
    adapters: {
      createTurnContextRetriever: () => ({
        openTurn: () => ({
          partial: () => { throw new Error('prefetch unavailable') },
          final: async () => { throw new Error('final unavailable') },
          cancel: () => {},
        }),
      }),
      createRecognizer: (_config, { onPartial }) => {
        recognizer = { onPartial, start: async () => {}, sendAudio: () => {}, finish: async () => '你好', abort: () => {} }
        return recognizer
      },
      streamChat: async () => { responseStarted = true; return { text: '', toolCalls: [], finishReason: 'stop' } },
    },
  })
  session.handleSpeechStart()
  recognizer.onPartial('你')
  await session.handleSpeechEnd()
  assert.equal(responseStarted, true)
})
