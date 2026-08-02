import assert from 'node:assert/strict'
import test from 'node:test'
import { createRecognizer } from '../src/voice/cascade/adapters/stt.mjs'
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
