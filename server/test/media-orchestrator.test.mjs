import assert from 'node:assert/strict'
import test from 'node:test'
import { createMediaOrchestrator } from '../src/media/media-orchestrator.mjs'

test('media orchestrator executes the localizable video pipeline in order', async () => {
  const calls = []
  const events = []
  const result = await createMediaOrchestrator({
    onEvent: event => events.push(event.type),
    adapters: {
      ffmpeg: {
        inspect: async () => ({ artifactId: 'info', format: { duration: '2.4' } }),
        extractAudio: async () => ({ artifactId: 'audio', outputRef: 'audio.wav' }),
      },
      transcription: {
        transcribeAligned: async () => ({ artifactId: 'transcript', language: 'en', segments: [{ id: 's1', startMs: 0, endMs: 1200, text: 'Hello' }] }),
      },
      translation: {
        translateSegments: async input => {
          calls.push('translate')
          return { artifactId: 'translation', segments: [{ ...input.segments[0], targetText: '你好' }] }
        },
      },
      synthesis: {
        synthesizeSegments: async () => ({ artifactId: 'synthesis', segments: [{ id: 's1', startMs: 0, endMs: 1200, targetText: '你好', audioRef: 'dub.wav' }] }),
      },
      timing: {
        fitSegment: async input => ({ artifactId: 'timed_s1', outputRef: input.outputRef, startMs: 0, endMs: 1200 }),
      },
      audioCompose: {
        compose: async input => ({ artifactId: 'timeline', outputRef: input.outputRef }),
      },
      remux: {
        remux: async input => ({ artifactId: 'output', outputRef: input.outputRef }),
      },
    },
  }).execute({
    ownerId: 'owner-1', sourceRef: 'video.mp4', sourceLanguage: 'en',
    targetLanguage: 'zh-CN', voiceProfileId: 'voice-1', outputDir: '/tmp/media-job',
  })
  assert.equal(result.job.status, 'completed')
  assert.equal(result.artifacts.output.artifactId, 'output')
  assert.equal(result.artifacts.audioTimeline.artifactId, 'timeline')
  assert.deepEqual(calls, ['translate'])
  assert.equal(events.at(-1), 'media.phase.completed')
})

test('media orchestrator records the failed phase and exposes a resumable job', async () => {
  let failure
  await assert.rejects(() => createMediaOrchestrator({
    adapters: {
      ffmpeg: { inspect: async () => { throw new Error('ffprobe unavailable') } },
    },
  }).execute({ ownerId: 'owner-1', sourceRef: 'video.mp4', targetLanguage: 'zh' }), error => {
    failure = error
    return error.job.status === 'failed' && error.job.currentPhase === 'inspect'
  })
  assert.equal(failure.job.phases[0].error, 'ffprobe unavailable')
})
