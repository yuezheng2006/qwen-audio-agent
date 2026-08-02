import assert from 'node:assert/strict'
import test from 'node:test'
import { SentenceStream } from '../src/voice/cascade/sentence-stream.mjs'

function collect() {
  const sentences = []
  const stream = new SentenceStream({ onSentence: s => sentences.push(s) })
  return { sentences, stream }
}

test('releases complete sentences and holds the tail', () => {
  const { sentences, stream } = collect()
  stream.push('今天天气不错。我们去')
  stream.push('公园吧！剩下的半句')
  assert.deepEqual(sentences, ['今天天气不错。', '我们去公园吧！'])
  assert.equal(stream.finish('stop'), '')
  assert.deepEqual(
    sentences,
    ['今天天气不错。', '我们去公园吧！', '剩下的半句'],
  )
})

test('drops the held tail when the model stops at the token limit', () => {
  const { sentences, stream } = collect()
  stream.push('第一句完整说完了。然后是被截断的半个词比如甚')
  const dropped = stream.finish('length')
  assert.deepEqual(sentences, ['第一句完整说完了。'])
  assert.equal(dropped, '然后是被截断的半个词比如甚')
})

test('keeps an unpunctuated cut-off answer instead of total silence', () => {
  const { sentences, stream } = collect()
  stream.push('从头到尾没有任何标点被截断')
  assert.equal(stream.finish('length'), '')
  assert.deepEqual(sentences, ['从头到尾没有任何标点被截断'])
})

test('first sentence may release at a comma to protect first-audio latency', () => {
  const { sentences, stream } = collect()
  stream.push('好的没问题，我马上帮你处理这件事')
  assert.deepEqual(sentences, ['好的没问题，'])
  stream.finish('stop')
  assert.deepEqual(sentences, ['好的没问题，', '我马上帮你处理这件事'])
})

test('later sentences wait for hard boundaries', () => {
  const { sentences, stream } = collect()
  stream.push('第一句。第二句有逗号，但还没有结束')
  assert.deepEqual(sentences, ['第一句。'])
})
