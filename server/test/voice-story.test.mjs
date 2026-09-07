import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeStoryNarrations, synthesizeStory, STORY_ALIGNMENT_VERSION } from '../src/voice/studio/story.mjs'
import { pcm16ToWav } from '../src/voice/studio/preview.mjs'

function result({ speaker, value, frames = 2400 }) {
  const pcm = Buffer.alloc(frames * 2, value)
  return {
    wav: pcm16ToWav(pcm, 24000),
    speaker,
    segments: [{ id: 'tts-unit-001', text: `${speaker}说话`, startMs: 0, endMs: 100 }],
    report: { provider_request_count: 1 },
  }
}

test('mergeStoryNarrations creates one timeline with speaker labels', () => {
  const merged = mergeStoryNarrations([result({ speaker: '旁白', value: 20 }), result({ speaker: '角色 A', value: 40 })], { joinPauseMs: 100 })
  assert.equal(merged.wav.toString('ascii', 0, 4), 'RIFF')
  assert.equal(merged.report.provider, 'qwaudio-story')
  assert.equal(merged.report.alignment.version, STORY_ALIGNMENT_VERSION)
  assert.equal(merged.report.speaker_count, 2)
  assert.equal(merged.segments.length, 2)
  assert.equal(merged.segments[0].speaker, '旁白')
  assert.ok(merged.segments[1].startMs > merged.segments[0].endMs)
})

test('synthesizeStory calls the narration seam once per segment', async () => {
  const calls = []
  const output = await synthesizeStory({
    apiKey: 'test',
    segments: [
      { speaker: '旁白', text: '开场。', voice: 'voice-a' },
      { speaker: '角色 A', text: '你好。', voice: 'voice-b' },
    ],
    synthesizeNarration: async input => {
      calls.push(input)
      return result({ speaker: input.speaker, value: 30 })
    },
  })
  assert.deepEqual(calls.map(call => [call.text, call.voice]), [['开场。', 'voice-a'], ['你好。', 'voice-b']])
  assert.equal(output.report.speaker_count, 2)
})

test('synthesizeStory rejects incomplete segments', async () => {
  await assert.rejects(() => synthesizeStory({ segments: [{ text: '缺少音色' }] }), /文本和音色/)
})
