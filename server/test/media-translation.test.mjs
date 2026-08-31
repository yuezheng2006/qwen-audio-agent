import assert from 'node:assert/strict'
import test from 'node:test'
import { createSegmentTranslationAdapter } from '../src/media/media-translation.mjs'

const segments = [
  { id: 's1', speakerId: 'speaker_1', startMs: 0, endMs: 1200, text: 'Hello' },
  { id: 's2', speakerId: 'speaker_1', startMs: 1400, endMs: 2400, text: 'Everyone' },
]

test('translation adapter preserves segment identity, timing, and speaker', async () => {
  let request
  const adapter = createSegmentTranslationAdapter({
    provider: 'local-demo',
    translate: async value => {
      request = value
      return { sourceLanguage: 'en', segments: ['你好', '大家好'] }
    },
  })
  const result = await adapter.translateSegments({
    segments,
    sourceLanguage: 'en',
    targetLanguage: 'zh-CN',
  })
  assert.equal(request.segments[0].text, 'Hello')
  assert.equal(result.provider, 'local-demo')
  assert.deepEqual(result.segments[1], {
    id: 's2', speakerId: 'speaker_1', startMs: 1400, endMs: 2400,
    sourceText: 'Everyone', targetText: '大家好',
  })
})

test('translation adapter accepts object segments and rejects mismatched results', async () => {
  const adapter = createSegmentTranslationAdapter({
    translate: async () => ({ segments: [{ targetText: '你好' }, { targetText: '大家好' }] }),
  })
  const result = await adapter.translateSegments({ segments, targetLanguage: 'zh' })
  assert.equal(result.segments[0].targetText, '你好')
  await assert.rejects(() => createSegmentTranslationAdapter({
    translate: async () => ['only one'],
  }).translateSegments({ segments, targetLanguage: 'zh' }), /segment count/)
})
