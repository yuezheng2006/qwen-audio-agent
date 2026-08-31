import assert from 'node:assert/strict'
import test from 'node:test'
import { createRecognizer } from '../src/voice/cascade/adapters/stt.mjs'
import {
  createFasterWhisperRecognizer,
  fasterWhisperPluginManifest,
} from '../src/plugins/builtin/faster-whisper.mjs'
import {
  cascadeTestConfig,
  startFakeDashScope,
} from './helpers/fake-dashscope.mjs'

function sentence(text, endTime = null) {
  return { output: { sentence: { text, end_time: endTime } } }
}

test('accumulates partials across finalized sentences', async () => {
  let replyRef
  const fake = await startFakeDashScope((action, _payload, reply) => {
    if (action === 'run-task') {
      replyRef = reply
      reply.event('task-started')
    }
  })
  const partials = []
  const recognizer = createRecognizer(cascadeTestConfig(fake.url), {
    onPartial: text => partials.push(text),
  })
  await recognizer.start()
  replyRef.event('result-generated', sentence('今天'))
  replyRef.event('result-generated', sentence('今天天气不错。', 1200))
  replyRef.event('result-generated', sentence('我们'))
  await new Promise(resolvePromise => setTimeout(resolvePromise, 100))
  assert.deepEqual(partials, ['今天', '今天天气不错。', '今天天气不错。我们'])
  assert.equal(recognizer.transcript(), '今天天气不错。我们')
  recognizer.abort()
  await fake.close()
})

test('finish flushes the task and returns the final transcript', async () => {
  const fake = await startFakeDashScope((action, _payload, reply) => {
    if (action === 'run-task') reply.event('task-started')
    if (action === 'finish-task') {
      reply.event('result-generated', sentence('你好峰哥。', 900))
      reply.event('task-finished')
    }
  })
  const recognizer = createRecognizer(cascadeTestConfig(fake.url), {})
  await recognizer.start()
  recognizer.sendAudio(Buffer.alloc(320))
  const finalText = await recognizer.finish()
  assert.equal(finalText, '你好峰哥。')
  assert.deepEqual(fake.state.binaries, [Buffer.alloc(320)])
  await fake.close()
})

test('an empty utterance finishes with an empty transcript', async () => {
  const fake = await startFakeDashScope((action, _payload, reply) => {
    if (action === 'run-task') reply.event('task-started')
    if (action === 'finish-task') reply.event('task-finished')
  })
  const recognizer = createRecognizer(cascadeTestConfig(fake.url), {})
  await recognizer.start()
  assert.equal(await recognizer.finish(), '')
  await fake.close()
})

test('a failed task rejects finish when nothing was recognized', async () => {
  const fake = await startFakeDashScope((action, _payload, reply) => {
    if (action === 'run-task') reply.event('task-started')
    if (action === 'finish-task') {
      reply.event('task-failed', {}, { error_message: '识别服务不可用' })
    }
  })
  const recognizer = createRecognizer(cascadeTestConfig(fake.url), {})
  await recognizer.start()
  await assert.rejects(() => recognizer.finish(), /识别服务不可用/)
  await fake.close()
})

test('unknown stt providers fail fast with a clear message', () => {
  assert.throws(
    () => createRecognizer(
      cascadeTestConfig('ws://x', { stt: { provider: 'nope' } }),
      {},
    ),
    /不支持的级联 STT 供应商/,
  )
})

test('faster-whisper recognizer sends one WAV utterance to a local endpoint', async () => {
  const requests = []
  const recognizer = createFasterWhisperRecognizer({
    stt: {
      provider: 'faster-whisper',
      url: 'http://127.0.0.1:8000/transcribe',
      model: 'small',
    },
  }, {
    fetchImpl: async (url, options) => {
      requests.push({ url, options })
      return new Response(JSON.stringify({ text: '本地识别结果' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  const partials = []
  const withPartials = createFasterWhisperRecognizer({
    stt: { provider: 'faster-whisper', url: 'http://localhost/transcribe' },
  }, {
    onPartial: text => partials.push(text),
    fetchImpl: async () => new Response(JSON.stringify({ text: '你好' }), { status: 200 }),
  })
  await recognizer.start()
  recognizer.sendAudio(Buffer.from([1, 2, 3, 4]))
  assert.equal(await recognizer.finish(), '本地识别结果')
  assert.equal(requests[0].url, 'http://127.0.0.1:8000/transcribe')
  assert.equal(requests[0].options.headers['content-type'], 'audio/wav')
  assert.equal(Buffer.from(await requests[0].options.body).readUInt32LE(0), 0x46464952)

  await withPartials.start()
  withPartials.sendAudio(Buffer.alloc(320))
  assert.equal(await withPartials.finish(), '你好')
  assert.deepEqual(partials, ['你好'])
})

test('faster-whisper is registered through the STT plugin boundary', async () => {
  assert.deepEqual(fasterWhisperPluginManifest.platformCapabilities, ['speech.transcribe'])
  assert.equal(fasterWhisperPluginManifest.runtime, 'local-sidecar')
  assert.equal(fasterWhisperPluginManifest.dataBoundary, 'local')
  const recognizer = createRecognizer({
    stt: { provider: 'faster-whisper', url: 'http://localhost/transcribe' },
  }, {
    fetchImpl: async () => new Response(JSON.stringify({ text: '插件已接入' }), { status: 200 }),
  })
  recognizer.sendAudio(Buffer.alloc(320))
  assert.equal(await recognizer.finish(), '插件已接入')
})

test('faster-whisper reports a useful error when its local service is unavailable', async () => {
  const recognizer = createFasterWhisperRecognizer({
    stt: { provider: 'faster-whisper', url: 'http://localhost/transcribe' },
  }, {
    fetchImpl: async () => new Response('offline', { status: 503 }),
  })
  recognizer.sendAudio(Buffer.alloc(320))
  await assert.rejects(() => recognizer.finish(), /faster-whisper 服务不可用/)
})
