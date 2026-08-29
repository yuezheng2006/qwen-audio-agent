import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerCapabilityRoutes } from '../src/app/capability-routes.mjs'
import { FrontendNotesStore } from '../src/conversation/frontend-notes.mjs'
import { resolveMemoryProvider } from '../src/conversation/memory/resolve.mjs'
import { createLocalKnowledgeProvider } from '../src/knowledge/local-provider.mjs'
import { MarkdownContentStore } from '../src/voice/reader/content-store.mjs'
import { createReaderProgressStore } from '../src/voice/reader/reader-progress.mjs'

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
  const notesStore = new FrontendNotesStore({
    filePath: join(root, 'notes.json'),
  })
  const scheduled = new Map()
  const taskManager = {
    list({ ownerId } = {}) {
      return [...scheduled.values()].filter(task => (
        ownerId === undefined || task.ownerId === ownerId
      ))
    },
    get(id, { ownerId } = {}) {
      const task = scheduled.get(String(id))
      if (!task) return null
      if (ownerId !== undefined && task.ownerId !== ownerId) return null
      return task
    },
    create({ objective, ownerId, sessionId, kind = 'work' }) {
      const task = {
        id: `work_live_${scheduled.size + 1}`,
        status: 'queued',
        kind,
        objective,
        ownerId,
        sessionId: sessionId || 'main',
        createdAt: Date.now(),
      }
      scheduled.set(task.id, task)
      return task
    },
    createScheduled({ objective, ownerId, schedule, type = 'reminder' }) {
      const task = {
        id: `work_test_${scheduled.size + 1}`,
        status: 'scheduled',
        kind: type === 'task' ? 'scheduled_task' : 'reminder',
        objective,
        ownerId,
        schedule: { type: 'at', at: schedule.at, recurrence: schedule.recurrence },
        createdAt: Date.now(),
      }
      scheduled.set(task.id, task)
      return task
    },
    async cancel(id, { ownerId } = {}) {
      const task = this.get(id, { ownerId })
      if (!task || task.status !== 'scheduled') return null
      task.status = 'cancelled'
      return task
    },
  }
  const readerProgressByOwner = new Map([
    ['owner-a', { status: 'paused', index: 2, total: 5 }],
  ])
  const readerSessionsByOwner = new Map()

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
  const routeDeps = {
    memoryStore,
    knowledgeStore,
    contentStore,
    notesStore,
    taskManager,
    readerProgressByOwner,
    readerSessionsByOwner,
    capabilityRegistry,
  }
  setup?.({
    memoryStore,
    knowledgeStore,
    contentStore,
    notesStore,
    taskManager,
    readerSessionsByOwner,
    root,
    routeDeps,
  })
  registerCapabilityRoutes(app, routeDeps)

  const server = createServer(app)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const base = `http://127.0.0.1:${port}`
  try {
    await run({
      base,
      memoryStore,
      knowledgeStore,
      contentStore,
      notesStore,
      taskManager,
      readerSessionsByOwner,
      root,
    })
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

test('content import writes chapters through the ingest seam', async () => {
  await withApp(null, async ({ base, root }) => {
    const sourcePath = join(root, 'import-me.md')
    writeFileSync(sourcePath, '# 第一章\n\n开场有龙息气味。\n\n# 第二章\n\n收场。\n')
    const imported = await request(base, '/api/content/import', {
      method: 'POST',
      body: JSON.stringify({
        sourcePath,
        title: '短篇',
        indexKnowledge: true,
      }),
    })
    assert.equal(imported.status, 200)
    assert.equal(imported.payload.ok, true)
    assert.equal(imported.payload.chapters.length, 2)
    assert.equal(imported.payload.parser, 'plaintext')
    assert.ok(imported.payload.knowledge?.files?.length >= 1)

    const content = await request(base, '/api/content')
    assert.ok(content.payload.contents.some(item => (
      String(item.relativePath || '').includes('短篇')
    )))

    const search = await request(base, '/api/knowledge/search', {
      method: 'POST',
      body: JSON.stringify({ query: '龙息气味' }),
    })
    assert.equal(search.status, 200)
    assert.ok(search.payload.count >= 1)
    assert.match(search.payload.hits[0].content, /龙息/)
  })
})

test('weread routes expose shelf highlights and speak wav', async () => {
  const pcm = Buffer.alloc(2)
  pcm.writeInt16LE(500, 0)
  await withApp(({ routeDeps }) => {
    routeDeps.wereadClient = {
      configured: true,
      skillVersion: '1.0.4',
      async shelf() {
        return {
          total: 2,
          books: [{ bookId: '91', title: '猪' }],
          albums: [],
          recent: [{ bookId: '91', title: '猪' }],
        }
      },
      async highlights(bookId) {
        return {
          book: { bookId, title: '猪', author: '王' },
          chapters: [],
          highlights: [{ id: 'h1', markText: '真理直率无比' }],
        }
      },
      async reviews() {
        return {
          bookId: '91',
          mine: [],
          public: [{ id: 'pub1', source: 'public', content: '公开好评', authorName: '甲', star: 5 }],
          reviews: [{ id: 'pub1', source: 'public', content: '公开好评', authorName: '甲', star: 5 }],
        }
      },
      async notebooks() {
        return {
          books: [{ bookId: '91', title: '猪', noteCount: 19, reviewCount: 0, noteTotal: 19 }],
          totalBookCount: 1,
          totalNoteCount: 19,
        }
      },
    }
    routeDeps.speakWeread = async () => ({
      wav: Buffer.from('RIFFtest'),
      title: '猪',
      count: 1,
      truncated: false,
    })
  }, async ({ base }) => {
    const status = await request(base, '/api/weread/status')
    assert.equal(status.status, 200)
    assert.equal(status.payload.configured, true)

    const shelf = await request(base, '/api/weread/shelf')
    assert.equal(shelf.payload.total, 2)
    assert.equal(shelf.payload.withNotes?.[0]?.noteCount, 19)

    const hl = await request(base, '/api/weread/highlights?bookId=91')
    assert.equal(hl.payload.highlights[0].markText, '真理直率无比')

    const reviews = await request(base, '/api/weread/reviews?bookId=91')
    assert.equal(reviews.payload.public?.[0]?.content, '公开好评')

    const spoken = await fetch(`${base}/api/weread/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookId: '91', mode: 'highlights' }),
    })
    assert.equal(spoken.status, 200)
    assert.match(spoken.headers.get('content-type') || '', /audio\/wav/)
    const bytes = Buffer.from(await spoken.arrayBuffer())
    assert.equal(bytes.slice(0, 4).toString(), 'RIFF')
  })
})

test('content import rejects missing source and missing files', async () => {
  await withApp(null, async ({ base, root }) => {
    const bad = await request(base, '/api/content/import', {
      method: 'POST',
      body: JSON.stringify({ title: 'x' }),
    })
    assert.equal(bad.status, 400)
    assert.match(bad.payload.error, /sourcePath|markdown|url/)

    const missing = await request(base, '/api/content/import', {
      method: 'POST',
      body: JSON.stringify({
        sourcePath: join(root, 'does-not-exist.md'),
      }),
    })
    assert.equal(missing.status, 503)
    assert.match(missing.payload.error, /不存在/)
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
    const id = listed.payload.memories.find(item => (
      item.scope === 'long_term' || item.scope === 'memory'
    ))?.id
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

test('memory write/patch notes reminders and content control', async () => {
  await withApp(({ readerSessionsByOwner }) => {
    readerSessionsByOwner.set('owner-a', {
      listContents: () => [{ id: 'ch1', title: '第一章' }],
      snapshot: () => ({ status: 'reading', index: 1, total: 3 }),
      async start(mode, opts) {
        return { status: mode, index: opts.offset || 0, total: 3 }
      },
      pause: () => ({ status: 'paused', index: 1, total: 3 }),
      async resume() { return { status: 'reading', index: 1, total: 3 } },
      stop: () => ({ status: 'idle', index: 0, total: 3 }),
      async seek(offset) { return { status: 'paused', index: offset, total: 3 } },
    })
  }, async ({ base }) => {
    const created = await request(base, '/api/memory', {
      method: 'POST',
      body: JSON.stringify({ scope: 'rules', content: '以后叫我峰哥' }),
    })
    assert.equal(created.status, 201)
    assert.equal(created.payload.memory.scope, 'user')
    const memoryId = created.payload.memory.id

    const patched = await request(base, `/api/memory/${encodeURIComponent(memoryId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ content: '以后都叫我峰哥' }),
    })
    assert.equal(patched.status, 200)

    const notesAdd = await request(base, '/api/notes', {
      method: 'POST',
      body: JSON.stringify({
        action: 'add',
        list: '购物',
        items: ['牛奶', '面包'],
      }),
    })
    assert.equal(notesAdd.status, 200)
    assert.equal(notesAdd.payload.status, 'ok')

    const notesList = await request(base, '/api/notes')
    assert.equal(notesList.status, 200)
    assert.ok(notesList.payload.lists.some(item => item.list === '购物'))

    const shown = await request(base, `/api/notes/${encodeURIComponent('购物')}`)
    assert.equal(shown.status, 200)
    assert.equal(shown.payload.items.length, 2)

    const when = new Date(Date.now() + 60_000).toISOString()
    const reminder = await request(base, '/api/reminders', {
      method: 'POST',
      body: JSON.stringify({
        execute_at: when,
        reminder: '喝水',
        recurrence: 'once',
      }),
    })
    assert.equal(reminder.status, 201)
    const reminderId = reminder.payload.reminder.id

    const reminders = await request(base, '/api/reminders')
    assert.equal(reminders.status, 200)
    assert.equal(reminders.payload.count, 1)

    const cancelled = await request(base, `/api/reminders/${encodeURIComponent(reminderId)}`, {
      method: 'DELETE',
    })
    assert.equal(cancelled.status, 200)
    assert.equal(cancelled.payload.reminder.status, 'cancelled')

    const paused = await request(base, '/api/content/control', {
      method: 'POST',
      body: JSON.stringify({ action: 'pause' }),
    })
    assert.equal(paused.status, 200)
    assert.equal(paused.payload.progress.status, 'paused')
  })
})

test('content control requires active reader session', async () => {
  await withApp(null, async ({ base }) => {
    const result = await request(base, '/api/content/control', {
      method: 'POST',
      body: JSON.stringify({ action: 'pause' }),
    })
    assert.equal(result.status, 409)
    assert.match(result.payload.error, /语音会话/)
  })
})

test('content books import speak and support session', async () => {
  await withApp(({ routeDeps, root }) => {
    routeDeps.supportInboundToken = 'secret'
    routeDeps.readerProgressStore = createReaderProgressStore({
      filePath: join(root, 'progress.json'),
    })
    routeDeps.speakScript = async () => ({ wav: Buffer.from('RIFFtest') })
  }, async ({ base }) => {
    const imported = await request(base, '/api/content/import', {
      method: 'POST',
      body: JSON.stringify({
        title: '夜话',
        markdown: '# 第一章 开端\n\n天黑了。风很大。\n\n# 第二章 远行\n\n他走了。\n',
      }),
    })
    assert.equal(imported.status, 200)
    assert.equal(imported.payload.ok, true)
    assert.ok(imported.payload.chapters.length >= 2)

    const books = await request(base, '/api/content/books')
    assert.equal(books.status, 200)
    assert.ok(books.payload.books.some(book => book.title === '夜话'))

    const chapterId = books.payload.books.find(book => book.title === '夜话').chapters[0].id
    const spoken = await fetch(`${base}/api/content/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content_id: chapterId }),
    })
    assert.equal(spoken.status, 200)
    assert.match(spoken.headers.get('content-type') || '', /audio\/wav/)

    const saved = await request(base, '/api/content/progress', {
      method: 'PUT',
      body: JSON.stringify({ contentId: chapterId, index: 1, total: 4, title: '开端' }),
    })
    assert.equal(saved.status, 200)
    assert.equal(saved.payload.cursor.index, 1)

    const denied = await request(base, '/api/support/session?token=nope')
    assert.equal(denied.status, 401)
    const session = await request(base, '/api/support/session?token=secret')
    assert.equal(session.status, 200)
    assert.equal(session.payload.workspace, 'support')

    const escalated = await request(base, '/api/support/escalate', {
      method: 'POST',
      body: JSON.stringify({ token: 'secret', objective: '查订单 123' }),
    })
    assert.equal(escalated.status, 201)
    assert.match(escalated.payload.task.objective, /客服升级/)
  })
})
