import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveMemoryProviderKind } from '../src/conversation/memory/resolve.mjs'
import { createOpenVikingMemoryProvider } from '../src/conversation/memory/openviking-provider.mjs'
import { createEvermindMemoryProvider } from '../src/conversation/memory/evermind-provider.mjs'
import { MEMORY_PROVIDER_KINDS } from '../src/conversation/memory/provider.mjs'

test('memory provider kinds include evermind and openviking', () => {
  assert.deepEqual(
    [...MEMORY_PROVIDER_KINDS].sort(),
    ['evermind', 'local', 'mem0', 'openviking'],
  )
  assert.equal(resolveMemoryProviderKind('evermind'), 'evermind')
  assert.equal(resolveMemoryProviderKind('openviking'), 'openviking')
})

test('openviking remembers to markdown and syncs when OV is online', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qwaudio-ov-'))
  const calls = []
  const provider = createOpenVikingMemoryProvider({
    baseUrl: 'http://ov.test',
    memoriesDir: join(dir, 'memories'),
    userProfilePath: join(dir, 'USER.md'),
    identityMode: 'personal',
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method || 'GET' })
      if (String(url).endsWith('/health')) {
        return jsonResponse({ healthy: true })
      }
      if (String(url).endsWith('/sessions') && options.method === 'POST') {
        return jsonResponse({ result: { session_id: 'sess_1' } })
      }
      return jsonResponse({ ok: true })
    },
  })

  const saved = await provider.remember('owner', {
    scope: 'long_term',
    content: '喜欢深夜听峰哥讲故事',
  })
  assert.match(saved.content, /峰哥/)
  assert.ok(calls.some(call => call.url.includes('/health')))
  assert.ok(calls.some(call => call.url.includes('/sessions')))

  const listed = await provider.list('owner', { scope: 'long_term' })
  assert.ok(listed.some(item => item.content.includes('峰哥')))

  const health = await provider.health()
  assert.equal(health.kind, 'openviking')
  assert.equal(health.format, 'markdown')
  assert.equal(health.online, true)
})

test('evermind cloud remember writes markdown even if remote fails', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qwaudio-em-'))
  const provider = createEvermindMemoryProvider({
    mode: 'cloud',
    apiKey: 'test-key',
    baseUrl: 'https://api.evermind.test',
    memoriesDir: join(dir, 'memories'),
    userProfilePath: join(dir, 'USER.md'),
    fetchImpl: async () => {
      throw Object.assign(new Error('HTTP 503'), { status: 503 })
    },
  })
  const saved = await provider.remember('owner-a', {
    scope: 'long_term',
    content: '周末想爬山',
  })
  assert.match(saved.content, /爬山/)
  assert.match(saved.warning || '', /sync failed|EverMind/)
  const listed = await provider.list('owner-a', { scope: 'long_term', query: '爬山' })
  assert.equal(listed.length, 1)
})

test('evermind search merges remote episodes into list results', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qwaudio-em-search-'))
  const provider = createEvermindMemoryProvider({
    mode: 'cloud',
    apiKey: 'test-key',
    baseUrl: 'https://api.evermind.test',
    memoriesDir: join(dir, 'memories'),
    fetchImpl: async (url, options = {}) => {
      if (String(url).includes('/memories/search')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            data: {
              episodes: [{
                id: 'ep1',
                summary: '用户喜欢黑咖啡不加糖',
                atomic_facts: [{ content: '偏好：黑咖啡' }],
              }],
            },
          }),
        }
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true }),
      }
    },
  })
  const listed = await provider.list('owner-b', {
    scope: 'long_term',
    query: '咖啡',
    limit: 10,
  })
  assert.ok(listed.some(item => item.content.includes('黑咖啡')))
  assert.ok(listed.some(item => item.source === 'evermind'))
})

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  }
}
