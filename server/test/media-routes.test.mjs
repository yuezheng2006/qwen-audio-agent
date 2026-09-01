import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import test from 'node:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerMediaRoutes } from '../src/app/media-routes.mjs'

function fakeApp() {
  const routes = new Map()
  return {
    routes,
    post(path, handler) { routes.set(`POST ${path}`, handler) },
    get(path, handler) { routes.set(`GET ${path}`, handler) },
  }
}

function response() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this },
  }
}

test('media routes upload a local asset and reject jobs without an orchestrator', async () => {
  const app = fakeApp()
  const directory = await mkdtemp(join(tmpdir(), 'qwaudio-media-'))
  registerMediaRoutes(app, { mediaDirectory: directory })
  const uploadResponse = response()
  await app.routes.get('POST /api/media/assets')({
    headers: { 'x-media-filename': 'clip.wav' },
    body: Buffer.from('RIFF-test'),
  }, uploadResponse)
  assert.equal(uploadResponse.statusCode, 201)
  assert.equal(await readFile(uploadResponse.payload.source_ref, 'utf8'), 'RIFF-test')

  const jobResponse = response()
  await app.routes.get('POST /api/media/jobs')({ body: {} }, jobResponse)
  assert.equal(jobResponse.statusCode, 503)
  assert.equal(jobResponse.payload.error_code, 'media_orchestrator_unavailable')
})

test('media routes create and expose asynchronous job snapshots', async () => {
  const app = fakeApp()
  let resolveJob
  const done = new Promise(resolve => { resolveJob = resolve })
  registerMediaRoutes(app, {
    mediaDirectory: await mkdtemp(join(tmpdir(), 'qwaudio-media-')),
    mediaOrchestrator: {
      execute: async input => {
        input.onEvent?.({ type: 'media.phase.started', job: { id: input.jobId, status: 'running' } })
        resolveJob()
        return { job: { id: input.jobId, status: 'completed' } }
      },
    },
  })
  const createResponse = response()
  await app.routes.get('POST /api/media/jobs')({
    identity: { ownerId: 'local' },
    body: { source_ref: '/tmp/clip.wav', target_language: 'zh-CN', voice_profile_id: 'voice-1' },
  }, createResponse)
  assert.equal(createResponse.statusCode, 202)
  const jobId = createResponse.payload.job.id
  await done
  await new Promise(resolve => setImmediate(resolve))
  const getResponse = response()
  await app.routes.get('GET /api/media/jobs/:id')({ params: { id: jobId } }, getResponse)
  assert.equal(getResponse.payload.job.status, 'completed')
})
