import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerCapabilityRoutes } from '../src/app/capability-routes.mjs'
import { resolveMemoryProvider } from '../src/conversation/memory/resolve.mjs'
import { createLocalKnowledgeProvider } from '../src/knowledge/local-provider.mjs'
import { MarkdownContentStore } from '../src/voice/reader/content-store.mjs'

async function withApp(setup, run) {
  const root = mkdtempSync(join(tmpdir(), 'qwaudio-cap-'))
  const memoryStore = resolveMemoryProvider({
    frontendMemoryPath: join(root, 'frontend-memory.json'),
    userProfilePath: join(root, 'USER.md'),
    identityMode: 'personal',
  }, { MEMORY_PROVIDER: 'local' })
  const knowledgeDir = join(root, 'knowledge')
  mkdirSync(knowledgeDir)
  writeFileSync(join(knowledgeDir, 'faq.md'), '# FAQ\n\n默认音色是峰哥复刻。\n')
  const knowledgeStore = createLocalKnowledgeProvider({ knowledgeDir })
  const contentDir = join(root, 'content')
  mkdirSync(contentDir)
  writeFileSync(join(contentDir, 'ch1.md'), '# 第一章\n\n夜色渐浓。\n')
  const contentStore = new MarkdownContentStore({ contentDir })
  const readerProgressByOwner = new Map([
    ['owner-a', { status: 'paused', index: 2, total: 5 }],
  ])

  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.identity = { ownerId: 'owner-a' }
    next()
  })
  const capabilityRegistry = {
    health: () => ({
      tools: [{ name: 'web_search', source: 'capability', description: 'search' }],
      toolCount: 1,
      skills: [{ name: 'concise-voice', description: 'short', enabled: true }],
      skillCount: 1,
      mcp: { servers: [], toolCount: 0 },
    }),
  }
  registerCapabilityRoutes(app, {
    memoryStore,
    knowledgeStore,
    contentStore,
    readerProgressByOwner,
    capabilityRegistry,
  })
  setup?.({ memoryStore, knowledgeStore, contentStore, root })

  const server = createServer(app)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const base = `http://127.0.0.1:${port}`
  try {
    await run({ base, memoryStore })
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

async function request(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const payload = await response.json().catch(() => ({}))
  return { status: response.status, payload }
}

test('knowledge search and reindex expose markdown corpus', async () => {
  await withApp(null, async ({ base }) => {
    const reindex = await request(base, '/api/knowledge/reindex', {
      method: 'POST',
      body: '{}',
    })
    assert.equal(reindex.status, 200)
    assert.equal(reindex.payload.format, 'markdown')
    assert.ok(reindex.payload.sources >= 1)

    const listed = await request(base, '/api/knowledge')
    assert.equal(listed.status, 200)
    assert.ok(listed.payload.count >= 1)

    const search = await request(base, '/api/knowledge/search', {
      method: 'POST',
      body: JSON.stringify({ query: '峰哥复刻' }),
    })
    assert.equal(search.status, 200)
    assert.ok(search.payload.count >= 1)
    assert.match(search.payload.hits[0].content, /峰哥/)
  })
})

test('memory list/delete and content reader progress work', async () => {
  await withApp(async ({ memoryStore }) => {
    memoryStore.remember('owner-a', {
      scope: 'long_term',
      content: '喜欢晚上听故事',
    })
  }, async ({ base }) => {
    const listed = await request(base, '/api/memory')
    assert.equal(listed.status, 200)
    assert.ok(listed.payload.count >= 1)
    const id = listed.payload.memories.find(item => item.scope === 'long_term')?.id
    assert.ok(id)

    const cleared = await request(base, '/api/memory', { method: 'DELETE' })
    assert.equal(cleared.status, 400)

    const deleted = await request(base, `/api/memory/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    assert.equal(deleted.status, 200)

    const content = await request(base, '/api/content')
    assert.equal(content.status, 200)
    assert.equal(content.payload.health.format, 'markdown')
    assert.ok(content.payload.count >= 1)
    assert.equal(content.payload.reader.status, 'paused')
    assert.equal(content.payload.reader.index, 2)

    const skills = await request(base, '/api/skills')
    assert.equal(skills.status, 200)
    assert.equal(skills.payload.count, 1)
    assert.equal(skills.payload.skills[0].name, 'concise-voice')
    assert.ok(skills.payload.tools.some(tool => tool.name === 'web_search'))

    const capabilities = await request(base, '/api/capabilities')
    assert.equal(capabilities.status, 200)
    assert.equal(capabilities.payload.toolCount, 1)
  })
})
