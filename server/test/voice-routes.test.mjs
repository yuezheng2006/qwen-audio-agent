import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerVoiceRoutes, previewContentDisposition } from '../src/app/voice-routes.mjs'
import { createPreviewCache } from '../src/voice/studio/preview-cache.mjs'

async function withServer(setup, run) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.identity = { ownerId: 'owner-a' }
    next()
  })
  setup(app)
  const server = createServer(app)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    await run(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

function mockService(overrides = {}) {
  const profiles = [
    {
      id: 'p1',
      label: '刘震云·北大·降噪',
      provider: 'dashscope',
      remote_voice_id: 'voice-liu',
      target_model: 'qwen-audio-3.0-tts-flash',
      status: 'ready',
      favorite: true,
      tags: ['celebrity', 'denoise'],
    },
    {
      id: 'p2',
      label: 'fish-import',
      provider: 'fish',
      remote_voice_id: 'fish-1',
      status: 'ready',
      favorite: false,
      tags: ['import'],
    },
  ]
  return {
    list(_ownerId, { status } = {}) {
      const rows = profiles.filter(item => !status || item.status === status)
      return {
        status: 'ok',
        profiles: rows,
        tag_counts: { celebrity: 1, denoise: 1, import: 1 },
      }
    },
    patch(_ownerId, id, body) {
      const row = profiles.find(item => item.id === id)
      if (!row) {
        return {
          status: 'failed',
          error: true,
          error_code: 'profile_not_found',
          user_message: '未找到音色 profile。',
        }
      }
      if (Object.prototype.hasOwnProperty.call(body, 'favorite')) {
        row.favorite = Boolean(body.favorite)
      }
      if (Object.prototype.hasOwnProperty.call(body, 'tags')) {
        if (!Array.isArray(body.tags)) {
          return {
            status: 'failed',
            error: true,
            error_code: 'invalid_tags',
            user_message: '标签不合法。',
          }
        }
        row.tags = body.tags
      }
      if (Object.prototype.hasOwnProperty.call(body, 'label')) {
        row.label = String(body.label || '')
      }
      return { status: 'ok', profile: { ...row } }
    },
    capabilities() {
      return {
        status: 'ok',
        preview_text: '大家好，这是音色试听。今天天气不错，我们聊聊生活里的小事。',
        providers: [
          {
            id: 'dashscope',
            can_enroll: true,
            can_import_id: true,
            can_preview: true,
            needs_public_url: true,
            sample_hints: { min_sec: 3, max_sec: 30, formats: ['wav'] },
            quality_tips: ['录 5–15 秒连续自然说话'],
          },
          {
            id: 'fish',
            can_enroll: true,
            can_import_id: true,
            can_preview: false,
            preview_reason: 'preview_unsupported',
            needs_public_url: false,
            sample_hints: { min_sec: 5, max_sec: 20, formats: ['mp3'] },
            quality_tips: ['录 5–15 秒连续自然说话'],
          },
        ],
      }
    },
    status() {
      return {
        status: 'ok',
        active: { provider: 'dashscope', voice: 'voice-liu', model: 'qwen-audio-3.0-tts-flash' },
        confirmed: null,
      }
    },
    async confirm(_ownerId, input) {
      return {
        status: 'ok',
        switching: input.restart === true,
        profile: { id: input.profile_id, remote_voice_id: 'voice-liu' },
        provider: 'dashscope',
        remote_voice_id: 'voice-liu',
      }
    },
    ...overrides,
  }
}

test('GET /api/voice/profiles lists ready profiles and active voice', async () => {
  await withServer(app => {
    registerVoiceRoutes(app, {
      voiceStudioService: mockService(),
      getCascadeTts: () => ({
        provider: 'dashscope',
        apiKey: 'k',
        model: 'qwen-audio-3.0-tts-flash',
        sampleRate: 24000,
      }),
      synthesizePreview: async () => Buffer.from('RIFF'),
    })
  }, async base => {
    const res = await fetch(`${base}/api/voice/profiles`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.status, 'ok')
    assert.equal(body.profiles.length, 2)
    assert.equal(body.active.voice, 'voice-liu')
  })
})

test('preview Content-Disposition names the wav after the friendly voice', () => {
  assert.equal(
    previewContentDisposition({ label: '刘震云·北大·降噪' }, { download: true }),
    `attachment; filename="preview.wav"; filename*=UTF-8''${encodeURIComponent('刘震云.wav')}`,
  )
  assert.match(previewContentDisposition({ label: '雷军' }), /^inline;/)
})

test('POST /api/voice/preview warms cache; GET serves cached wav', async () => {
  const wav = Buffer.alloc(48)
  wav.write('RIFF', 0)
  const dir = mkdtempSync(join(tmpdir(), 'voice-routes-preview-'))
  const previewCache = createPreviewCache({ dir })
  let synthCalls = 0
  try {
    await withServer(app => {
      registerVoiceRoutes(app, {
        voiceStudioService: mockService(),
        previewCache,
        getCascadeTts: () => ({
          provider: 'dashscope',
          apiKey: 'k',
          model: 'qwen-audio-3.0-tts-flash',
          sampleRate: 24000,
        }),
        synthesizePreview: async ({ voice }) => {
          assert.equal(voice, 'voice-liu')
          synthCalls += 1
          return wav
        },
      })
    }, async base => {
      const missing = await fetch(`${base}/api/voice/profiles/p1/preview`)
      assert.equal(missing.status, 404)

      const warm = await fetch(`${base}/api/voice/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: 'p1' }),
      })
      assert.equal(warm.status, 200)
      assert.equal(synthCalls, 1)

      const cached = await fetch(`${base}/api/voice/profiles/p1/preview`)
      assert.equal(cached.status, 200)
      assert.match(cached.headers.get('content-type') || '', /audio\/wav/)
      assert.match(cached.headers.get('content-disposition') || '', /^inline;/)
      const buf = Buffer.from(await cached.arrayBuffer())
      assert.equal(buf.toString('ascii', 0, 4), 'RIFF')

      const downloaded = await fetch(`${base}/api/voice/profiles/p1/preview?download=1`)
      assert.equal(downloaded.status, 200)
      const disposition = downloaded.headers.get('content-disposition') || ''
      assert.match(disposition, /^attachment;/)
      assert.match(disposition, /filename\*=UTF-8''/)
      assert.ok(disposition.includes(encodeURIComponent('刘震云.wav')))

      const again = await fetch(`${base}/api/voice/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: 'p1' }),
      })
      assert.equal(again.status, 200)
      assert.equal(synthCalls, 1, 'cache hit should not re-synthesize')

      const list = await fetch(`${base}/api/voice/profiles`)
      const body = await list.json()
      const p1 = body.profiles.find(item => item.id === 'p1')
      assert.equal(p1.has_preview, true)
      assert.equal(p1.preview_url, 'api/voice/profiles/p1/preview')
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('POST /api/voice/preview rejects non-dashscope', async () => {
  await withServer(app => {
    registerVoiceRoutes(app, {
      voiceStudioService: mockService(),
      getCascadeTts: () => ({ apiKey: 'k', model: 'm', sampleRate: 24000 }),
      synthesizePreview: async () => Buffer.from('RIFF'),
    })
  }, async base => {
    const res = await fetch(`${base}/api/voice/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile_id: 'p2' }),
    })
    assert.equal(res.status, 400)
    const body = await res.json()
    assert.equal(body.error_code, 'preview_unsupported')
  })
})

test('POST /api/voice/confirm delegates to service', async () => {
  await withServer(app => {
    registerVoiceRoutes(app, {
      voiceStudioService: mockService(),
      getCascadeTts: () => ({ apiKey: 'k', model: 'm' }),
      synthesizePreview: async () => Buffer.from('RIFF'),
    })
  }, async base => {
    const res = await fetch(`${base}/api/voice/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile_id: 'p1' }),
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.status, 'ok')
    assert.equal(body.switching, false)
  })
})

test('routes return 503 when voice studio disabled', async () => {
  await withServer(app => {
    registerVoiceRoutes(app, {
      voiceStudioService: null,
      getCascadeTts: () => ({}),
      synthesizePreview: async () => Buffer.from('RIFF'),
    })
  }, async base => {
    const res = await fetch(`${base}/api/voice/profiles`)
    assert.equal(res.status, 503)
  })
})

test('GET /api/voice/profiles supports gallery filters and tag_counts', async () => {
  await withServer(app => {
    registerVoiceRoutes(app, {
      voiceStudioService: mockService(),
      getCascadeTts: () => ({ apiKey: 'k', model: 'm' }),
      synthesizePreview: async () => Buffer.from('RIFF'),
    })
  }, async base => {
    const fav = await fetch(`${base}/api/voice/profiles?favorite=1`)
    assert.equal(fav.status, 200)
    const favBody = await fav.json()
    assert.equal(favBody.profiles.length, 1)
    assert.equal(favBody.profiles[0].id, 'p1')
    assert.equal(favBody.tag_counts.denoise, 1)

    const tagged = await fetch(`${base}/api/voice/profiles?tag=import`)
    const taggedBody = await tagged.json()
    assert.equal(taggedBody.profiles.length, 1)
    assert.equal(taggedBody.profiles[0].id, 'p2')

    const q = await fetch(`${base}/api/voice/profiles?q=刘震云`)
    const qBody = await q.json()
    assert.equal(qBody.profiles.length, 1)
  })
})

test('PATCH /api/voice/profiles/:id updates favorite without restart', async () => {
  let restarted = 0
  await withServer(app => {
    registerVoiceRoutes(app, {
      voiceStudioService: mockService({
        patch(ownerId, id, body) {
          assert.equal(ownerId, 'owner-a')
          assert.equal(id, 'p1')
          assert.equal(body.favorite, true)
          return {
            status: 'ok',
            profile: {
              id: 'p1',
              favorite: true,
              tags: ['celebrity', 'denoise'],
              label: '刘震云·北大·降噪',
              provider: 'dashscope',
              remote_voice_id: 'voice-liu',
              status: 'ready',
            },
          }
        },
        confirm: async () => {
          restarted += 1
          return { status: 'ok' }
        },
      }),
      getCascadeTts: () => ({ apiKey: 'k', model: 'm' }),
      synthesizePreview: async () => Buffer.from('RIFF'),
    })
  }, async base => {
    const res = await fetch(`${base}/api/voice/profiles/p1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite: true }),
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.status, 'ok')
    assert.equal(body.profile.favorite, true)
    assert.equal(restarted, 0)
  })
})

test('GET /api/voice/capabilities returns provider preview matrix', async () => {
  await withServer(app => {
    registerVoiceRoutes(app, {
      voiceStudioService: mockService(),
      getCascadeTts: () => ({ apiKey: 'k', model: 'm' }),
      synthesizePreview: async () => Buffer.from('RIFF'),
    })
  }, async base => {
    const res = await fetch(`${base}/api/voice/capabilities`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.status, 'ok')
    const dash = body.providers.find(item => item.id === 'dashscope')
    assert.equal(dash.can_preview, true)
    assert.ok(Array.isArray(dash.quality_tips) && dash.quality_tips.length >= 1)
  })
})

test('POST /api/voice/narrate resolves author and returns json report', async () => {
  const wav = Buffer.alloc(48)
  wav.write('RIFF', 0)
  await withServer(app => {
    registerVoiceRoutes(app, {
      voiceStudioService: mockService(),
      getCascadeTts: () => ({
        provider: 'dashscope',
        apiKey: 'k',
        model: 'qwen-audio-3.0-tts-flash',
        sampleRate: 24000,
        voice: 'fallback-voice',
      }),
      synthesizePreview: async () => Buffer.from('RIFF'),
      synthesizeNarrationFn: async ({ voice, author, matchType }) => {
        assert.equal(voice, 'voice-liu')
        assert.equal(author, '刘震云')
        assert.equal(matchType, 'author')
        return {
          wav,
          sampleRate: 24000,
          segments: [],
          units: ['今天分享的是。'],
          report: {
            provider: 'qwaudio-dashscope',
            speaker: voice,
            alignment: { version: 2, segments: [] },
          },
        }
      },
    })
  }, async base => {
    const res = await fetch(`${base}/api/voice/narrate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        text: '今天分享的是。',
        author: '刘震云',
      }),
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.status, 'ok')
    assert.equal(body.voice_match.friendly_name, '刘震云')
    assert.equal(body.voice_match.remote_voice_id, 'voice-liu')
    assert.equal(body.report.provider, 'qwaudio-dashscope')
    assert.ok(body.audio_base64)
  })
})
