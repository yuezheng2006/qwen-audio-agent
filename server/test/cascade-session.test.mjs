import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { CascadeSession } from '../src/voice/cascade/session.mjs'

const cascadeConfig = {
  stt: { provider: 'fake', model: 'fake-stt', apiKey: 'key' },
  llm: { baseUrl: 'http://fake', model: 'fake-llm', apiKey: 'key', maxTokens: 100 },
  tts: { provider: 'fake', model: 'fake-tts', voice: 'fake-voice', apiKey: 'key', sampleRate: 24000 },
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

function fakeSynthesizer() {
  const calls = { text: [], aborted: false }
  return {
    calls,
    start: async () => {},
    sendText: text => calls.text.push(text),
    finish: async () => {},
    abort: () => { calls.aborted = true },
  }
}

function makeSession({ streamChat, synthesizer = fakeSynthesizer() } = {}) {
  const ws = new FakeWs()
  const session = new CascadeSession(ws, {
    cascadeConfig,
    adapters: {
      createRecognizer: () => {
        throw new Error('recognizer not expected in this test')
      },
      createSynthesizer: () => synthesizer,
      streamChat: streamChat || (async () => ({
        text: '',
        toolCalls: [],
        finishReason: 'stop',
      })),
    },
  })
  return { ws, session, synthesizer }
}

function receive(ws, event) {
  ws.emit('message', JSON.stringify(event))
}

async function settle() {
  await new Promise(resolve => setTimeout(resolve, 10))
}

test('handshake: session.created then session.updated on update', () => {
  const { ws } = makeSession()
  assert.equal(ws.sent[0].type, 'session.created')
  receive(ws, {
    type: 'session.update',
    session: { instructions: '你是助理', tools: [] },
  })
  const updated = ws.eventsOfType('session.updated')
  assert.equal(updated.length, 1)
  assert.equal(updated[0].session.instructions, '你是助理')
})

test('conversation.item.create is confirmed and recorded in history', async () => {
  const { ws, session } = makeSession()
  receive(ws, {
    type: 'conversation.item.create',
    item: {
      id: 'item_1',
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: '你好' }],
    },
  })
  assert.equal(ws.eventsOfType('conversation.item.created').length, 1)
  assert.deepEqual(session.history, [{ role: 'user', content: '你好' }])
})

test('response.create streams sentences to TTS and finishes the response', async () => {
  const synthesizer = fakeSynthesizer()
  const { ws } = makeSession({
    synthesizer,
    streamChat: async (_config, { onTextDelta }) => {
      onTextDelta('第一句。第二')
      onTextDelta('句。')
      return { text: '第一句。第二句。', toolCalls: [], finishReason: 'stop' }
    },
  })
  receive(ws, { type: 'session.update', session: { instructions: 'x', tools: [] } })
  receive(ws, { type: 'response.create' })
  await settle()
  assert.equal(ws.eventsOfType('response.created').length, 1)
  assert.deepEqual(synthesizer.calls.text, ['第一句。', '第二句。'])
  const transcriptDone = ws.eventsOfType('response.audio_transcript.done')
  assert.equal(transcriptDone[0].transcript, '第一句。第二句。')
  const done = ws.eventsOfType('response.done')
  assert.equal(done.length, 1)
  assert.equal(done[0].response.status, 'completed')
})

test('tool calls surface as function_call_arguments.done', async () => {
  const { ws, session } = makeSession({
    streamChat: async () => ({
      text: '',
      toolCalls: [{
        id: 'call_1',
        name: 'spawn_thinking',
        arguments: '{"objective":"帮用户做事"}',
      }],
      finishReason: 'tool_calls',
    }),
  })
  receive(ws, {
    type: 'session.update',
    session: { instructions: 'x', tools: [{ type: 'function', function: { name: 'spawn_thinking' } }] },
  })
  receive(ws, { type: 'response.create' })
  await settle()
  const calls = ws.eventsOfType('response.function_call_arguments.done')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'spawn_thinking')
  assert.equal(calls[0].call_id, 'call_1')
  assert.equal(session.history.at(-1).tool_calls[0].id, 'call_1')
  assert.equal(ws.eventsOfType('response.done')[0].response.status, 'completed')
})

test('function_call_output continues the turn as a tool message', () => {
  const { ws, session } = makeSession()
  receive(ws, {
    type: 'conversation.item.create',
    item: { type: 'function_call_output', call_id: 'call_1', output: '{"status":"accepted"}' },
  })
  assert.deepEqual(session.history.at(-1), {
    role: 'tool',
    tool_call_id: 'call_1',
    content: '{"status":"accepted"}',
  })
})

test('cascade speak responses bypass the LLM and feed TTS directly', async () => {
  const synthesizer = fakeSynthesizer()
  const { ws } = makeSession({
    synthesizer,
    streamChat: async () => {
      throw new Error('LLM must not run for speak responses')
    },
  })
  receive(ws, {
    type: 'response.create',
    response: { cascade_mode: 'speak', content: '任务已经完成了。' },
  })
  await settle()
  assert.deepEqual(synthesizer.calls.text, ['任务已经完成了。'])
  assert.equal(ws.eventsOfType('response.done')[0].response.status, 'completed')
})

test('response.cancel aborts the active response with cancelled status', async () => {
  const synthesizer = fakeSynthesizer()
  let releaseLlm
  const { ws } = makeSession({
    synthesizer,
    streamChat: (_config, { signal, onTextDelta }) => (
      new Promise((resolvePromise, rejectPromise) => {
        onTextDelta('这句话正在被朗读。后面还有')
        releaseLlm = resolvePromise
        signal.addEventListener('abort', () => {
          rejectPromise(new Error('aborted'))
        })
      })
    ),
  })
  receive(ws, { type: 'response.create' })
  await settle()
  receive(ws, { type: 'response.cancel' })
  await settle()
  assert.equal(synthesizer.calls.aborted, true)
  const done = ws.eventsOfType('response.done')
  assert.equal(done.length, 1)
  assert.equal(done[0].response.status, 'cancelled')
  releaseLlm?.({ text: '', toolCalls: [], finishReason: 'stop' })
  await settle()
  assert.equal(ws.eventsOfType('response.done').length, 1)
})

test('text-only responses use response.text events and skip TTS', async () => {
  const { ws } = makeSession({
    streamChat: async (_config, { onTextDelta }) => {
      onTextDelta('纯文本回答。')
      return { text: '纯文本回答。', toolCalls: [], finishReason: 'stop' }
    },
  })
  receive(ws, {
    type: 'response.create',
    response: { modalities: ['text'] },
  })
  await settle()
  assert.equal(ws.eventsOfType('response.text.done')[0].text, '纯文本回答。')
  assert.equal(ws.eventsOfType('response.audio.delta').length, 0)
})
