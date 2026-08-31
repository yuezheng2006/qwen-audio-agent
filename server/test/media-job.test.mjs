import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createMediaJob,
  isMediaJobPhase,
  isMediaJobPhaseStatus,
  isMediaJobStatus,
} from '../src/media/media-job.mjs'

function createTestJob(options = {}) {
  let clock = 100
  return createMediaJob({
    ownerId: 'owner-1',
    sourceRef: 'artifact://uploads/demo.mp4',
    targetLanguage: 'zh-CN',
    now: () => ++clock,
    ...options,
  })
}

test('MediaJob advances phases and collects artifact references', () => {
  const job = createTestJob({ phases: ['inspect', 'translate', 'remux'] })
  assert.equal(job.snapshot().status, 'queued')
  job.startPhase('inspect')
  job.completePhase('inspect', { artifactIds: ['media-info'] })
  job.startPhase('translate')
  job.completePhase('translate', { artifactIds: ['segments-zh'] })
  job.startPhase('remux')
  const done = job.completePhase('remux', { artifactIds: ['dubbed-video'] })
  assert.equal(done.status, 'completed')
  assert.deepEqual(done.artifacts, ['media-info', 'segments-zh', 'dubbed-video'])
  assert.equal(done.currentPhase, null)
})

test('MediaJob supports skipping optional phases and resuming failed phases', () => {
  const job = createTestJob({ phases: ['inspect', 'lipsync'] })
  job.startPhase('inspect')
  job.completePhase('inspect')
  job.skipPhase('lipsync')
  assert.equal(job.snapshot().status, 'completed')

  const retry = createTestJob({ phases: ['inspect'] })
  retry.startPhase('inspect')
  retry.failPhase('inspect', 'ffmpeg unavailable')
  assert.equal(retry.canResume(), true)
  retry.startPhase('inspect')
  assert.equal(retry.snapshot().status, 'running')
})

test('MediaJob validates identity, phases, and public status vocabulary', () => {
  assert.throws(() => createMediaJob({ sourceRef: 'x', targetLanguage: 'zh' }), /ownerId/)
  assert.throws(() => createTestJob({ phases: ['unknown'] }), /Unsupported MediaJob phases/)
  assert.equal(isMediaJobPhase('translate'), true)
  assert.equal(isMediaJobStatus('paused'), true)
  assert.equal(isMediaJobPhaseStatus('running'), true)
})
