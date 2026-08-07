import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createVoiceProfileStore } from '../src/voice/studio/profile-store.mjs'
import { createSampleResolver } from '../src/voice/studio/sample-resolver.mjs'
import { createVoiceStudioService } from '../src/voice/studio/service.mjs'
import { serializeProfile } from '../src/voice/studio/types.mjs'

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
    assert.equal(cloned.profile.label, '测试音色')

    const confirmed = await service.confirm('owner', { profile_id: cloned.profile.id })
    assert.equal(confirmed.status, 'ok')
    assert.equal(confirmed.profile.status, 'confirmed')
    assert.equal(confirmed.switching, false)
    assert.deepEqual(calls, [
      ['persist', { provider: 'dashscope', voice: 'v1', voiceLabel: '测试音色' }],
    ])

    const confirmedRestart = await service.confirm('owner', {
      profile_id: cloned.profile.id,
      restart: true,
    })
    assert.equal(confirmedRestart.switching, true)
    assert.deepEqual(calls.at(-1), ['restart', undefined])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('service default resolver accepts a real file under the configured presets directory', async () => {
  const dir = mkdtempSync(join(process.cwd(), '.voice-presets-'))
  const presetsDir = join(dir, 'presets')
  const samplePath = join(presetsDir, 'samples', 'demo.wav')
  mkdirSync(join(presetsDir, 'samples'), { recursive: true })
  writeFileSync(samplePath, Buffer.from('RIFFdemo'))
  const catalog = {
    list: () => [],
    resolveSamplePath: id => id === 'demo' ? samplePath : null,
  }
  const store = createVoiceProfileStore({ dir: join(dir, 'profiles') })
  try {
    const service = createVoiceStudioService({
      store,
      catalog,
      presetsDir,
      providers: new Map([['mock', {
        capabilities: () => ({ canEnroll: true, needsPublicUrl: false }),
        enroll: async ({ sample }) => {
          assert.deepEqual(sample, { kind: 'file', path: samplePath })
          return { remoteId: 'preset-voice' }
        },
      }]]),
    })
    const result = await service.clone('owner', { provider: 'mock', preset_id: 'demo' })
    assert.equal(result.status, 'ok')
    assert.equal(result.profile.remote_voice_id, 'preset-voice')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('serializeProfile omits sample paths, owner internals, and provider payload', () => {
  const serialized = serializeProfile({
    id: 'profile-1',
    ownerId: '/private/owner',
    label: '中文音色',
    source: 'preset',
    presetId: 'demo',
    sampleRef: { kind: 'file', path: '/private/preset.wav' },
    provider: 'dashscope',
    remoteId: 'voice-1',
    providerPayload: { secret: 'opaque' },
    status: 'ready',
  })
  assert.equal(serialized.label, '中文音色')
  assert.equal(serialized.remote_voice_id, 'voice-1')
  assert.equal('sampleRef' in serialized, false)
  assert.equal('ownerId' in serialized, false)
  assert.equal('providerPayload' in serialized, false)
  assert.equal(serialized.runtime, 'remote')
  assert.deepEqual(serialized.capabilities, ['speech.synthesize'])
  assert.deepEqual(serialized.sample_refs, [])
  assert.equal(JSON.stringify(serialized).includes('/private/'), false)
})

test('confirm returns mode_conflict without persisting or restarting outside cascade mode', async () => {
  const { dir, catalog, store } = setup()
  let persistCalls = 0
  let restartCalls = 0
  try {
    const profile = store.upsert('owner', {
      provider: 'dashscope',
      remoteId: 'voice-1',
      status: 'ready',
      label: '音色',
    })
    const service = createVoiceStudioService({
      store,
      catalog,
      providers: new Map(),
      isCascadeMode: false,
      persistCascadeTts: async () => { persistCalls += 1 },
      restartGateway: () => { restartCalls += 1 },
    })
    const result = await service.confirm('owner', { profile_id: profile.id })
    assert.equal(result.error_code, 'mode_conflict')
    assert.equal(persistCalls, 0)
    assert.equal(restartCalls, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('confirm resets the model when switching providers without a profile target model', async () => {
  const { dir, catalog, store } = setup()
  const persisted = []
  try {
    const profile = store.upsert('owner', {
      provider: 'fish',
      remoteId: 'ref-1',
      status: 'ready',
      label: 'Fish 音色',
    })
    const service = createVoiceStudioService({
      store,
      catalog,
      providers: new Map(),
      getActiveCascade: () => ({ provider: 'dashscope' }),
      persistCascadeTts: async options => persisted.push(options),
    })
    await service.confirm('owner', { profile_id: profile.id, restart: false })
    assert.deepEqual(persisted, [{
      provider: 'fish',
      model: 's2.1-pro-free',
      voice: 'ref-1',
      voiceLabel: 'Fish 音色',
    }])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('service default resolver accepts a real file under the configured presets directory', async () => {
  const dir = mkdtempSync(join(process.cwd(), '.voice-presets-'))
  const presetsDir = join(dir, 'presets')
  const samplePath = join(presetsDir, 'samples', 'demo.wav')
  mkdirSync(join(presetsDir, 'samples'), { recursive: true })
  writeFileSync(samplePath, Buffer.from('RIFFdemo'))
  const catalog = {
    list: () => [],
    resolveSamplePath: id => id === 'demo' ? samplePath : null,
  }
  const store = createVoiceProfileStore({ dir: join(dir, 'profiles') })
  try {
    const service = createVoiceStudioService({
      store,
      catalog,
      presetsDir,
      providers: new Map([['mock', {
        capabilities: () => ({ canEnroll: true, needsPublicUrl: false }),
        enroll: async ({ sample }) => {
          assert.deepEqual(sample, { kind: 'file', path: samplePath })
          return { remoteId: 'preset-voice' }
        },
      }]]),
    })
    const result = await service.clone('owner', { provider: 'mock', preset_id: 'demo' })
    assert.equal(result.status, 'ok')
    assert.equal(result.profile.remote_voice_id, 'preset-voice')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('serializeProfile omits sample paths, owner internals, and provider payload', () => {
  const serialized = serializeProfile({
    id: 'profile-1',
    ownerId: '/private/owner',
    label: '中文音色',
    source: 'preset',
    presetId: 'demo',
    sampleRef: { kind: 'file', path: '/private/preset.wav' },
    provider: 'dashscope',
    remoteId: 'voice-1',
    providerPayload: { secret: 'opaque' },
    status: 'ready',
  })
  assert.equal(serialized.label, '中文音色')
  assert.equal(serialized.remote_voice_id, 'voice-1')
  assert.equal('sampleRef' in serialized, false)
  assert.equal('ownerId' in serialized, false)
  assert.equal('providerPayload' in serialized, false)
  assert.equal(JSON.stringify(serialized).includes('/private/'), false)
})

test('confirm returns mode_conflict without persisting or restarting outside cascade mode', async () => {
  const { dir, catalog, store } = setup()
  let persistCalls = 0
  let restartCalls = 0
  try {
    const profile = store.upsert('owner', {
      provider: 'dashscope',
      remoteId: 'voice-1',
      status: 'ready',
      label: '音色',
    })
    const service = createVoiceStudioService({
      store,
      catalog,
      providers: new Map(),
      isCascadeMode: false,
      persistCascadeTts: async () => { persistCalls += 1 },
      restartGateway: () => { restartCalls += 1 },
    })
    const result = await service.confirm('owner', { profile_id: profile.id })
    assert.equal(result.error_code, 'mode_conflict')
    assert.equal(persistCalls, 0)
    assert.equal(restartCalls, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('confirm resets the model when switching providers without a profile target model', async () => {
  const { dir, catalog, store } = setup()
  const persisted = []
  try {
    const profile = store.upsert('owner', {
      provider: 'fish',
      remoteId: 'ref-1',
      status: 'ready',
      label: 'Fish 音色',
    })
    const service = createVoiceStudioService({
      store,
      catalog,
      providers: new Map(),
      getActiveCascade: () => ({ provider: 'dashscope' }),
      persistCascadeTts: async options => persisted.push(options),
    })
    await service.confirm('owner', { profile_id: profile.id, restart: false })
    assert.deepEqual(persisted, [{
      provider: 'fish',
      model: 's2.1-pro-free',
      voice: 'ref-1',
    }])
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
    assert.deepEqual(persisted, [{
      provider: 'listenhub',
      voice: 'speaker-1',
      voiceLabel: '导入音色',
    }])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('clone rejects an empty remote id returned by provider', async () => {
  const { dir, catalog, store } = setup()
  try {
    const service = createVoiceStudioService({
      store,
      catalog,
      providers: new Map([['mock', {
        capabilities: () => ({ canEnroll: true }),
        enroll: async () => ({ remoteId: '  ' }),
      }]]),
    })
    const result = await service.clone('owner', { provider: 'mock', preset_id: 'demo' })
    assert.equal(result.status, 'failed')
    assert.equal(result.error_code, 'missing_remote_id')
    assert.equal(store.list('owner')[0].status, 'failed')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('importVoice rejects an empty remote id returned by provider', async () => {
  const { dir, catalog, store } = setup()
  try {
    const service = createVoiceStudioService({
      store,
      catalog,
      providers: new Map([['mock', {
        capabilities: () => ({ canImportId: true }),
        importId: async () => ({ remoteId: '' }),
      }]]),
    })
    const result = await service.importVoice('owner', {
      provider: 'mock',
      remote_voice_id: 'requested',
    })
    assert.equal(result.status, 'failed')
    assert.equal(result.error_code, 'missing_remote_id')
    assert.equal(store.list('owner')[0].status, 'failed')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('confirm resolves a ready profile by provider and remote voice id', async () => {
  const { dir, catalog, store } = setup()
  const persisted = []
  try {
    const profile = store.upsert('owner', {
      provider: 'mock',
      remoteId: 'voice-1',
      status: 'ready',
      label: 'voice',
    })
    const service = createVoiceStudioService({
      store,
      catalog,
      providers: new Map(),
      persistCascadeTts: async options => persisted.push(options),
    })
    const result = await service.confirm('owner', {
      provider: 'mock',
      remote_voice_id: 'voice-1',
      restart: false,
    })
    assert.equal(result.status, 'ok')
    assert.equal(result.profile.id, profile.id)
    assert.deepEqual(persisted, [{
      provider: 'mock',
      voice: 'voice-1',
      voiceLabel: 'voice',
    }])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('confirm fails without a matching profile and never persists', async () => {
  const { dir, catalog, store } = setup()
  let persistCalls = 0
  try {
    const service = createVoiceStudioService({
      store,
      catalog,
      providers: new Map(),
      persistCascadeTts: async () => { persistCalls += 1 },
    })
    const result = await service.confirm('owner', {
      provider: 'mock',
      remote_voice_id: 'missing',
      restart: false,
    })
    assert.equal(result.status, 'failed')
    assert.equal(result.error_code, 'profile_not_found')
    assert.equal(persistCalls, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('audio_transcribe returns asr_unavailable when no backend', async () => {
  const { dir, catalog, store } = setup()
  try {
    const service = createVoiceStudioService({
      store,
      catalog,
      providers: new Map(),
    })
    const out = await service.transcribe('owner', {
      source: { kind: 'url', url: 'https://example.com/a.wav' },
      language: 'zh',
      provider: 'auto',
    })
    assert.equal(out.error_code, 'asr_unavailable')
    assert.equal(out.status, 'failed')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('sample resolver rejects symlink paths escaping an allowed root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'voice-sample-'))
  const outside = mkdtempSync(join(tmpdir(), 'voice-outside-'))
  try {
    const outsidePath = join(outside, 'sample.wav')
    const linkPath = join(dir, 'sample.wav')
    writeFileSync(outsidePath, Buffer.from('RIFFoutside'))
    symlinkSync(outsidePath, linkPath)
    const resolver = createSampleResolver({
      presetsDir: dir,
      tmpRoot: dir,
      catalog: { resolveSamplePath: () => linkPath },
    })
    assert.throws(
      () => resolver.resolve({ preset_id: 'escape' }),
      error => error.normalized?.error_code === 'sample_missing',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})
