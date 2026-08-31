import assert from 'node:assert/strict'
import test from 'node:test'
import { createSegmentSynthesisAdapter } from '../src/media/media-synthesis.mjs'

const segments = [
  { id: 's1', speakerId: 'speaker_1', startMs: 0, endMs: 1200, targetText: '你好' },
  { id: 's2', speakerId: 'speaker_1', startMs: 1400, endMs: 2400, targetText: '大家好' },
]

test('segment synthesis sends each text with the selected voice profile', async () => {
  const calls = []
  const adapter = createSegmentSynthesisAdapter({
    provider: 'voicebox',
    synthesize: async input => {
      calls.push(input)
      return { audioRef: `artifact://audio/${input.segment.id}.wav` }
    },
  })
  const result = await adapter.synthesizeSegments({ segments, voiceProfileId: 'voice_personal' })
  assert.deepEqual(calls.map(call => [call.text, call.voiceProfileId]), [
    ['你好', 'voice_personal'], ['大家好', 'voice_personal'],
  ])
  assert.equal(result.provider, 'voicebox')
  assert.equal(result.segments[1].audioRef, 'artifact://audio/s2.wav')
  assert.equal(result.segments[1].endMs, 2400)
})

test('segment synthesis validates profile, audio refs, and timing', async () => {
  const adapter = createSegmentSynthesisAdapter({ synthesize: async () => null })
  await assert.rejects(() => adapter.synthesizeSegments({ segments }), /voiceProfileId/)
  await assert.rejects(() => adapter.synthesizeSegments({
    segments, voiceProfileId: 'voice_1',
  }), /missing audioRef/)
  await assert.rejects(() => createSegmentSynthesisAdapter({
    synthesize: async () => 'audio://ok',
  }).synthesizeSegments({
    segments: [{ startMs: 5, endMs: 5, text: 'bad' }], voiceProfileId: 'voice_1',
  }), /invalid timing/)
})
