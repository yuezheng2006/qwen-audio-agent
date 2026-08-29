import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createVoiceProfileStore,
  normalizeTags,
  filterGalleryProfiles,
  computeTagCounts,
} from '../src/voice/studio/profile-store.mjs'
import { serializeProfile } from '../src/voice/studio/types.mjs'
import { createVoiceStudioService } from '../src/voice/studio/service.mjs'
import {
  previewCapable,
  DEFAULT_QUALITY_TIPS,
} from '../src/voice/studio/quality-tips.mjs'
import { PREVIEW_TEXT } from '../src/voice/studio/preview.mjs'

test('normalizeTags trims lowercases dedupes and rejects oversize', () => {
  assert.deepEqual(normalizeTags([' Denoise ', 'celebrity', 'denoise']), ['denoise', 'celebrity'])
  assert.deepEqual(normalizeTags('zh, Denoise ,zh'), ['zh', 'denoise'])
  assert.throws(() => normalizeTags(['x'.repeat(33)]), err => err.code === 'invalid_tags')
  assert.throws(
    () => normalizeTags(Array.from({ length: 17 }, (_, i) => `t${i}`)),
    err => err.code === 'invalid_tags',
  )
})

test('store defaults favorite/tags and patch persists without status change', () => {
  const dir = mkdtempSync(join(tmpdir(), 'voice-gallery-'))
  try {
    const store = createVoiceProfileStore({ dir })
    const row = store.upsert('owner', {
      label: '刘震云·北大·降噪',
      provider: 'dashscope',
      remoteId: 'voice-liu',
      status: 'ready',
    })
    assert.equal(row.favorite, false)
    assert.deepEqual(row.tags, [])
    const json = serializeProfile(row)
    assert.equal(json.favorite, false)
    assert.deepEqual(json.tags, [])

    const patched = store.patch('owner', row.id, {
      favorite: true,
      tags: ['Celebrity', 'denoise'],
      label: '刘震云·定稿',
    })
    assert.equal(patched.favorite, true)
    assert.deepEqual(patched.tags, ['celebrity', 'denoise'])
    assert.equal(patched.label, '刘震云·定稿')
    assert.equal(patched.status, 'ready')
    assert.equal(store.get('owner', row.id).favorite, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('list and gallery helpers filter favorite tag and q', () => {
  const dir = mkdtempSync(join(tmpdir(), 'voice-gallery-filter-'))
  try {
    const store = createVoiceProfileStore({ dir })
    store.upsert('owner', {
      id: 'a',
      label: '刘震云·北大·降噪',
      provider: 'dashscope',
      remoteId: 'voice-liu',
      status: 'ready',
      favorite: true,
      tags: ['celebrity', 'denoise'],
    })
    store.upsert('owner', {
      id: 'b',
      label: 'fish-import',
      provider: 'fish',
      remoteId: 'fish-1',
      status: 'ready',
      favorite: false,
      tags: ['import'],
    })
    store.upsert('owner', {
      id: 'c',
      label: 'draft',
      provider: 'dashscope',
      remoteId: 'x',
      status: 'draft',
      favorite: true,
      tags: ['denoise'],
    })

    assert.equal(store.list('owner', { favorite: true }).length, 2)
    assert.equal(store.list('owner', { tag: 'denoise' }).length, 2)
    assert.equal(store.list('owner', { q: 'fish' }).length, 1)
    assert.equal(store.list('owner', { status: 'ready', favorite: true }).length, 1)

    const base = store.list('owner', { status: 'ready' })
    assert.deepEqual(computeTagCounts(base), { celebrity: 1, denoise: 1, import: 1 })
    assert.equal(filterGalleryProfiles(base, { tag: 'celebrity' }).length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('service patch list tag_counts and capabilities', () => {
  const dir = mkdtempSync(join(tmpdir(), 'voice-gallery-svc-'))
  try {
    const store = createVoiceProfileStore({ dir: join(dir, 'profiles') })
    const catalog = { list: () => [], get: () => null, resolveSamplePath: () => null }
    const providers = new Map([
      ['dashscope', {
        id: 'dashscope',
        capabilities: () => ({
          canEnroll: true,
          canImportId: true,
          needsPublicUrl: true,
          sampleHints: { minSec: 3, maxSec: 30, formats: ['wav'] },
        }),
      }],
      ['fish', {
        id: 'fish',
        capabilities: () => ({
          canEnroll: true,
          canImportId: true,
          needsPublicUrl: false,
          sampleHints: { minSec: 5, maxSec: 20, formats: ['mp3'] },
        }),
      }],
    ])
    let restarted = 0
    const service = createVoiceStudioService({
      store,
      catalog,
      providers,
      getActiveCascade: () => ({ provider: 'dashscope', voice: 'v', model: 'm' }),
      persistCascadeTts: async () => {},
      restartGateway: () => { restarted += 1 },
      defaultProvider: 'dashscope',
    })

    const row = store.upsert('owner', {
      label: '刘震云·北大·降噪',
      provider: 'dashscope',
      remoteId: 'voice-liu',
      status: 'ready',
      tags: ['denoise'],
    })
    store.upsert('owner', {
      label: 'other',
      provider: 'fish',
      remoteId: 'f1',
      status: 'ready',
      tags: ['import'],
    })

    const patched = service.patch('owner', row.id, { favorite: true })
    assert.equal(patched.status, 'ok')
    assert.equal(patched.profile.favorite, true)
    assert.equal(restarted, 0)

    const listed = service.list('owner', { favorite: true })
    assert.equal(listed.profiles.length, 1)
    assert.deepEqual(listed.tag_counts, { denoise: 1, import: 1 })

    const bad = service.patch('owner', row.id, { tags: ['x'.repeat(40)] })
    assert.equal(bad.error_code, 'invalid_tags')

    assert.equal(previewCapable('dashscope'), true)
    assert.equal(previewCapable('fish'), false)
    assert.ok(DEFAULT_QUALITY_TIPS.length >= 3)

    const caps = service.capabilities()
    assert.equal(caps.status, 'ok')
    assert.equal(caps.preview_text, PREVIEW_TEXT)
    const dash = caps.providers.find(item => item.id === 'dashscope')
    const fish = caps.providers.find(item => item.id === 'fish')
    assert.equal(dash.can_preview, true)
    assert.ok(dash.quality_tips.length >= 1)
    assert.equal(dash.sample_hints.min_sec, 3)
    assert.equal(fish.can_preview, false)
    assert.equal(fish.preview_reason, 'preview_unsupported')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
