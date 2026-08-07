import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createDashScopeCloneProvider,
} from '../src/voice/studio/providers/dashscope.mjs'
import {
  createListenHubCloneProvider,
} from '../src/voice/studio/providers/listenhub.mjs'
import { requireRemoteId } from '../src/voice/studio/providers/contract.mjs'

test('listenhub cannot enroll but can import id', async () => {
  const p = createListenHubCloneProvider()

  assert.equal(p.id, 'listenhub')
  assert.equal(p.capabilities().canEnroll, false)
  assert.equal(p.capabilities().canImportId, true)
  await assert.rejects(
    () => p.enroll({ label: 'x', sample: { kind: 'url', url: 'https://x' } }),
    /enroll_unsupported|cannot enroll/i,
  )
  const imported = await p.importId({ label: 'x', remoteId: 'speaker-1' })
  assert.equal(imported.remoteId, 'speaker-1')
})

test('dashscope enroll posts customization and returns remoteId', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({
      url,
      headers: init.headers,
      body: JSON.parse(init.body),
    })
    return {
      ok: true,
      status: 200,
      json: async () => ({ output: { voice: 'fenggetts-demo-001' } }),
    }
  }
  const p = createDashScopeCloneProvider({
    apiKey: 'sk-test',
    fetchImpl,
    targetModel: 'qwen-audio-3.0-tts-flash',
  })

  const out = await p.enroll({
    label: 'demo',
    sample: { kind: 'url', url: 'https://example.com/a.wav' },
  })

  assert.equal(out.remoteId, 'fenggetts-demo-001')
  assert.equal(out.targetModel, 'qwen-audio-3.0-tts-flash')
  assert.equal(calls.length, 1)
  assert.ok(String(calls[0].url).includes('customization'))
  assert.equal(calls[0].headers.authorization, 'Bearer sk-test')
  assert.deepEqual(calls[0].body, {
    model: 'voice-enrollment',
    input: {
      action: 'create_voice',
      target_model: 'qwen-audio-3.0-tts-flash',
      prefix: 'demo',
      url: 'https://example.com/a.wav',
    },
  })
})

test('dashscope importId validates and echoes remoteId', async () => {
  const p = createDashScopeCloneProvider({ apiKey: 'sk-test' })

  assert.deepEqual(
    await p.importId({
      label: 'demo',
      remoteId: 'voice-123',
      targetModel: 'custom-model',
    }),
    {
      remoteId: 'voice-123',
      targetModel: 'custom-model',
      providerPayload: { imported: true },
    },
  )
  await assert.rejects(
    () => p.importId({ label: 'demo', remoteId: ' ' }),
    /remoteId|required/i,
  )
})

test('requireRemoteId preserves opaque whitespace after validation', () => {
  const remoteId = '  voice id with spaces  '

  assert.equal(requireRemoteId(remoteId), remoteId)
})

test('dashscope importId omits targetModel when caller does not provide it', async () => {
  const p = createDashScopeCloneProvider({
    apiKey: 'sk-test',
    targetModel: 'configured-model',
  })

  assert.deepEqual(
    await p.importId({ label: 'demo', remoteId: 'voice-123' }),
    {
      remoteId: 'voice-123',
      providerPayload: { imported: true },
    },
  )
})

test('dashscope normalizes HTTP errors as retryable enrollment failures', async () => {
  const p = createDashScopeCloneProvider({
    apiKey: 'sk-test',
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      json: async () => ({ code: 'ServiceUnavailable' }),
    }),
  })

  await assert.rejects(
    () => p.enroll({
      label: 'demo',
      sample: { kind: 'url', url: 'https://example.com/a.wav' },
    }),
    error => {
      assert.deepEqual(error.normalized, {
        error_code: 'enroll_failed',
        user_message: '音色克隆失败。',
        retryable: true,
      })
      return true
    },
  )
})
