import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createVoiceProfileStore } from '../src/voice/studio/profile-store.mjs'
import { createVoiceStudioService } from '../src/voice/studio/service.mjs'

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'voice-studio-'))
  const samplePath = join(dir, 'sample.wav')
  writeFileSync(samplePath, Buffer.from('RIFFdemo'))
  const catalog = {
    list: ({ query } = {}) => [{ id: 'demo', label: '演示', tags: [], durationSec: 8, license: 'demo' }]
      .filter(item => !query || item.label.includes(query)),
    get: id => id === 'demo' ? { id: 'demo', label: '演示', tags: [], durationSec: 8, license: 'demo' } : null,
    resolveSamplePath: id => id === 'demo' ? samplePath : null,
  }
  const store = createVoiceProfileStore({ dir: join(dir, 'profiles') })
  return { dir, samplePath, catalog, store }
}

test('clone preset with mock provider then confirm persists voice', async () => {
  const { dir, catalog, store } = setup()
  const calls = []
  try {
    const provider = {
      id: 'dashscope',
      capabilities: () => ({ canEnroll: true, canImportId: true, needsPublicUrl: false }),
      enroll: async ({ sample }) => {
        assert.equal(sample.kind, 'file')
        return { remoteId: 'v1', providerPayload: { mock: true } }
      },
      importId: async () => ({ remoteId: 'unused' }),
    }
    const service = createVoiceStudioService({
      store,
      catalog,
      providers: new Map([['dashscope', provider]]),
      getActiveCascade: () => ({ provider: 'dashscope', voice: '', model: 'm1' }),
      persistCascadeTts: async options => calls.push(['persist', options]),
      restartGateway: options => calls.push(['restart', options]),
      defaultProvider: 'dashscope',
    })

    const cloned = await service.clone('owner', { preset_id: 'demo', label: '测试音色' })
    assert.equal(cloned.status, 'ok')
    assert.equal(cloned.profile.status, 'ready')
    assert.equal(cloned.profile.remote_voice_id, 'v1')

    const confirmed = await service.confirm('owner', { profile_id: cloned.profile.id })
    assert.equal(confirmed.status, 'ok')
    assert.equal(confirmed.profile.status, 'confirmed')
    assert.deepEqual(calls, [
      ['persist', { provider: 'dashscope', voice: 'v1' }],
      ['restart', undefined],
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('clone listenhub returns enroll_unsupported guidance', async () => {
  const { dir, catalog, store } = setup()
  try {
    const service = createVoiceStudioService({
      store,
      catalog,
      providers: new Map([['listenhub', {
        capabilities: () => ({ canEnroll: false, canImportId: true }),
        enroll: async () => { throw Object.assign(new Error('unsupported'), {
          normalized: {
            error_code: 'enroll_unsupported',
            user_message: '请使用 voice_import 导入已有音色 ID。',
            retryable: false,
          },
        }) },
      }]]),
      getActiveCascade: () => ({ provider: 'dashscope' }),
    })
    const result = await service.clone('owner', { provider: 'listenhub', preset_id: 'demo' })
    assert.equal(result.status, 'failed')
    assert.equal(result.error_code, 'enroll_unsupported')
    assert.match(result.user_message, /voice_import/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('default provider listenhub without explicit provider fails', async () => {
  const { dir, catalog, store } = setup()
  try {
    const service = createVoiceStudioService({
      store,
      catalog,
      providers: new Map([['listenhub', {
        capabilities: () => ({ canEnroll: false, canImportId: true }),
      }]]),
      getActiveCascade: () => ({ provider: 'listenhub' }),
      defaultProvider: 'listenhub',
    })
    const result = await service.clone('owner', { preset_id: 'demo' })
    assert.equal(result.status, 'failed')
    assert.equal(result.error_code, 'provider_required')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('import voice creates a ready profile and confirm can skip restart', async () => {
  const { dir, catalog, store } = setup()
  const persisted = []
  try {
    const service = createVoiceStudioService({
      store,
      catalog,
      providers: new Map([['listenhub', {
        capabilities: () => ({ canEnroll: false, canImportId: true }),
        importId: async ({ remoteId }) => ({ remoteId, providerPayload: { imported: true } }),
      }]]),
      persistCascadeTts: async options => persisted.push(options),
      restartGateway: () => { throw new Error('restart should be skipped') },
    })
    const imported = await service.importVoice('owner', {
      provider: 'listenhub',
      remote_voice_id: 'speaker-1',
      label: '导入音色',
    })
    assert.equal(imported.status, 'ok')
    assert.equal(imported.profile.status, 'ready')
    const confirmed = await service.confirm('owner', {
      profile_id: imported.profile.id,
      restart: false,
    })
    assert.equal(confirmed.status, 'ok')
    assert.equal(confirmed.profile.status, 'confirmed')
    assert.deepEqual(persisted, [{ provider: 'listenhub', voice: 'speaker-1' }])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
