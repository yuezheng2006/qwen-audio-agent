import assert from 'node:assert/strict'
import test from 'node:test'
import { createAlignedTranscriptionAdapter } from '../src/media/media-transcription.mjs'

test('aligned transcription adapter normalizes timed segments', async () => {
  let input
  const adapter = createAlignedTranscriptionAdapter({
    provider: 'whisperx',
    transcribe: async value => {
      input = value
      return {
        language: 'en',
        segments: [{ start: 0.25, end: 1.76, text: 'Hello', speaker_id: 'speaker_1' }],
      }
    },
  })
  const result = await adapter.transcribeAligned({ audioRef: 'artifact://audio.wav' })
  assert.deepEqual(input, { audioRef: 'artifact://audio.wav', language: 'auto' })
  assert.equal(result.provider, 'whisperx')
  assert.deepEqual(result.segments[0], {
    id: 'segment_1', speakerId: 'speaker_1', startMs: 250, endMs: 1760,
    text: 'Hello', language: null,
  })
})

test('aligned transcription adapter accepts direct segment arrays and rejects bad timing', async () => {
  const adapter = createAlignedTranscriptionAdapter({
    transcribe: async () => [{ start_ms: 0, end_ms: 800, text: '你好' }],
  })
  assert.equal((await adapter.transcribeAligned({ audioRef: 'audio://1', language: 'zh' })).language, 'zh')
  await assert.rejects(() => createAlignedTranscriptionAdapter({
    transcribe: async () => ({ segments: [{ start: 1, end: 1, text: 'bad' }] }),
  }).transcribeAligned({ audioRef: 'audio://1' }), /invalid timing/)
})
