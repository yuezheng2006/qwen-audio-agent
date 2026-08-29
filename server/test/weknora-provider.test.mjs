import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWeknoraKnowledgeProvider } from '../src/knowledge/weknora-provider.mjs'
import { createLocalKnowledgeProvider } from '../src/knowledge/local-provider.mjs'
import { resolveKnowledgeProvider } from '../src/knowledge/resolve.mjs'

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body)
    },
  }
}

test('weknora search maps hits and reports health', async () => {
  const calls = []
  const provider = createWeknoraKnowledgeProvider({
    baseUrl: 'http://weknora.test',
    apiKey: 'scoped-key',
    kbIds: ['kb-demo'],
    fetchImpl: async (url, options) => {
      calls.push({ url, method: options.method, body: options.body })
      if (String(url).endsWith('/health')) {
        return jsonResponse(200, { status: 'ok' })
      }
      return jsonResponse(200, {
        data: {
          hits: [{
            id: 'h1',
            title: '飞书手册',
            snippet: '退款需 48 小时',
            score: 0.91,
            url: 'feishu://doc/1',
          }],
        },
      })
    },
  })

  const hits = await provider.search('退款', { limit: 5 })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].title, '飞书手册')
  assert.match(hits[0].content, /48 小时/)
  assert.equal(hits[0].score, 0.91)
  assert.match(calls[0].url, /knowledge-bases\/kb-demo\/search/)
  assert.match(calls[0].body, /"query":"退款"/)

  const health = await provider.health()
  assert.equal(health.kind, 'weknora')
  assert.equal(health.ok, true)
})

test('weknora health falls through alternate probe paths', async () => {
  const calls = []
  const provider = createWeknoraKnowledgeProvider({
    baseUrl: 'http://weknora.test',
    fetchImpl: async (url) => {
      calls.push(String(url))
      if (String(url).endsWith('/api/v1/health')) {
        return jsonResponse(200, { status: 'ok' })
      }
      return jsonResponse(404, { message: 'missing' })
    },
  })
  const health = await provider.health()
  assert.equal(health.ok, true)
  assert.equal(health.healthPath, 'api/v1/health')
  assert.ok(calls.some(url => url.endsWith('/health')))
  assert.ok(calls.some(url => url.endsWith('/api/health')))
})

test('weknora search fails closed on 401 unless local fallback is on', async () => {
  const provider = createWeknoraKnowledgeProvider({
    baseUrl: 'http://weknora.test',
    apiKey: 'bad',
    fetchImpl: async () => jsonResponse(401, { message: 'unauthorized' }),
  })
  await assert.rejects(() => provider.search('验收'), /unauthorized|401/)

  const root = mkdtempSync(join(tmpdir(), 'qwaudio-weknora-fb-'))
  const knowledgeDir = join(root, 'knowledge')
  mkdirSync(knowledgeDir, { recursive: true })
  writeFileSync(join(knowledgeDir, 'faq.md'), '# FAQ\n\n营业时间 9:00–21:00。\n')
  const fallback = createWeknoraKnowledgeProvider({
    baseUrl: 'http://weknora.test',
    fetchImpl: async () => jsonResponse(401, { message: 'unauthorized' }),
    fallbackLocal: createLocalKnowledgeProvider({ knowledgeDir }),
  })
  const hits = await fallback.search('营业时间')
  assert.ok(hits.some(hit => /9:00/.test(hit.content)))
})

test('weknora resolve kind and timeout surface', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qwaudio-weknora-resolve-'))
  const provider = resolveKnowledgeProvider({
    knowledgeDir: join(root, 'knowledge'),
    weknora: { baseUrl: 'http://127.0.0.1:9', timeoutMs: 20 },
  }, { KNOWLEDGE_PROVIDER: 'weknora' })
  assert.equal(provider.kind, 'weknora')
  const health = await provider.health()
  assert.equal(health.ok, false)
})
