import assert from 'node:assert/strict'
import test from 'node:test'
import { createSynthesizer } from '../src/voice/cascade/adapters/tts.mjs'
import {
  cascadeTestConfig,
  startFakeDashScope,
} from './helpers/fake-dashscope.mjs'

test('streams sentences in and receives audio until the task finishes', async () => {
  const texts = []
  const fake = await startFakeDashScope((action, payload, reply) => {
    if (action === 'run-task') reply.event('task-started')
    if (action === 'continue-task') {
      texts.push(payload.input.text)
      reply.binary(Buffer.from(payload.input.text, 'utf8'))
    }
    if (action === 'finish-task') reply.event('task-finished')
  })
  const audio = []
  const synthesizer = createSynthesizer(cascadeTestConfig(fake.url), {
    onAudio: buffer => audio.push(Buffer.from(buffer)),
  })
  await synthesizer.start()
  synthesizer.sendText('第一句。')
  synthesizer.sendText('第二句。')
  await synthesizer.finish()
  assert.deepEqual(texts, ['第一句。', '第二句。'])
  assert.equal(Buffer.concat(audio).toString('utf8'), '第一句。第二句。')
  await fake.close()
})

test('the requested voice and sample rate reach the provider', async () => {
  let parameters
  const fake = await startFakeDashScope((action, payload, reply) => {
    if (action === 'run-task') {
      parameters = payload.parameters
      reply.event('task-started')
    }
    if (action === 'finish-task') reply.event('task-finished')
  })
  const synthesizer = createSynthesizer(
    cascadeTestConfig(fake.url, { tts: { voice: 'fengge-clone' } }),
    {},
  )
  await synthesizer.start()
  await synthesizer.finish()
  assert.equal(parameters.voice, 'fengge-clone')
  assert.equal(parameters.sample_rate, 24000)
  assert.equal(parameters.format, 'pcm')
  await fake.close()
})

test('dashscope passes natural-language instruction and keeps inline tags in text', async () => {
  let parameters
  let model
  const texts = []
  const fake = await startFakeDashScope((action, payload, reply) => {
    if (action === 'run-task') {
      parameters = payload.parameters
      model = payload.model
      reply.event('task-started')
    }
    if (action === 'continue-task') texts.push(payload.input.text)
    if (action === 'finish-task') reply.event('task-finished')
  })
  const synthesizer = createSynthesizer(
    cascadeTestConfig(fake.url, {
      tts: {
        model: 'qwen-audio-3.0-tts-plus',
        instruction: '慢一点，像讲睡前故事',
      },
    }),
    {},
  )
  await synthesizer.start()
  synthesizer.sendText('[whispers]先别吵醒他。')
  await synthesizer.finish()
  assert.equal(model, 'qwen-audio-3.0-tts-plus')
  assert.equal(parameters.instruction, '慢一点，像讲睡前故事')
  assert.deepEqual(texts, ['[whispers]先别吵醒他。'])
  await fake.close()
})

test('abort silences audio immediately and unblocks finish', async () => {
  let replyRef
  const fake = await startFakeDashScope((action, _payload, reply) => {
    if (action === 'run-task') {
      replyRef = reply
      reply.event('task-started')
    }
  })
  const audio = []
  const synthesizer = createSynthesizer(cascadeTestConfig(fake.url), {
    onAudio: buffer => audio.push(buffer),
  })
  await synthesizer.start()
  synthesizer.sendText('很长的一句话。')
  synthesizer.abort()
  replyRef.event('result-generated', {})
  await synthesizer.finish()
  assert.deepEqual(audio, [])
  await fake.close()
})

test('empty or whitespace text is never sent to the provider', async () => {
  const texts = []
  const fake = await startFakeDashScope((action, payload, reply) => {
    if (action === 'run-task') reply.event('task-started')
    if (action === 'continue-task') texts.push(payload.input.text)
    if (action === 'finish-task') reply.event('task-finished')
  })
  const synthesizer = createSynthesizer(cascadeTestConfig(fake.url), {})
  await synthesizer.start()
  synthesizer.sendText('')
  synthesizer.sendText('   ')
  synthesizer.sendText('实际内容。')
  await synthesizer.finish()
  assert.deepEqual(texts, ['实际内容。'])
  await fake.close()
})

test('a synthesis failure propagates from finish', async () => {
  const fake = await startFakeDashScope((action, _payload, reply) => {
    if (action === 'run-task') reply.event('task-started')
    if (action === 'finish-task') {
      reply.event('task-failed', {}, { error_message: '合成超限' })
    }
  })
  const synthesizer = createSynthesizer(cascadeTestConfig(fake.url), {})
  await synthesizer.start()
  await assert.rejects(() => synthesizer.finish(), /合成超限/)
  await fake.close()
})

test('unknown tts providers fail fast with a clear message', () => {
  assert.throws(
    () => createSynthesizer(
      cascadeTestConfig('ws://x', { tts: { provider: 'nope' } }),
      {},
    ),
    /不支持的级联 TTS 供应商/,
  )
})
