import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ToolCallHandler } from '../src/voice/tools/tool-call-handler.mjs'
import {
  CONTENT_CONTROL_TOOL_NAME,
  KNOWLEDGE_SEARCH_TOOL_NAME,
  USER_MEMORY_TOOL_NAME,
} from '../src/voice/realtime-provider.mjs'
import { resolveMemoryProvider } from '../src/conversation/memory/resolve.mjs'
import { createLocalKnowledgeProvider } from '../src/knowledge/local-provider.mjs'
import { MarkdownContentStore } from '../src/voice/reader/content-store.mjs'
import { ReaderSession } from '../src/voice/reader/reader-session.mjs'

function createHandler(overrides = {}) {
  const outputs = []
  const root = mkdtempSync(join(tmpdir(), 'qwaudio-tools-'))
  const memoryStore = overrides.memoryStore || resolveMemoryProvider({
    frontendMemoryPath: join(root, 'frontend-memory.json'),
    userProfilePath: join(root, 'USER.md'),
    identityMode: 'personal',
  }, { MEMORY_PROVIDER: 'local' })

  const knowledgeDir = join(root, 'knowledge')
  mkdirSync(knowledgeDir)
  writeFileSync(join(knowledgeDir, 'faq.md'), '# FAQ\n\n级联模式默认使用峰哥复刻音色。\n')
  const knowledgeStore = overrides.knowledgeStore || createLocalKnowledgeProvider({
    knowledgeDir,
  })

  const contentDir = join(root, 'content')
  mkdirSync(contentDir)
  writeFileSync(join(contentDir, 'story.md'), '第一句。第二句。第三句。')
  const contentStore = new MarkdownContentStore({ contentDir })
  const spoken = []
  const readerSession = overrides.readerSession || new ReaderSession({
    contentStore,
    getFrontend: () => ({
      speak: async text => { spoken.push(text) },
      cancel: () => {},
    }),
    gapMs: 0,
    chunkOptions: { maxChars: 10, minChars: 2 },
  })

  const knowledgeHits = []
  const handler = new ToolCallHandler({
    taskManager: {
      create() { throw new Error('unused') },
      list() { return [] },
      get() { return null },
    },
    ownerId: 'owner-a',
    sessionId: 'sess-a',
    transcripts: {
      transcript: async () => '忘掉这个',
    },
    getFrontend: () => ({
      sendFunctionOutput: async (callId, output) => {
        outputs.push({ callId, output })
      },
      speak: async text => spoken.push(text),
      cancel: () => {},
    }),
    getTurnId: () => 'turn-1',
    getTurnGeneration: () => 1,
    memoryStore,
    knowledgeStore,
    readerSession,
    onKnowledgeHits: hits => knowledgeHits.push(...hits),
    coordinator: {},
  })

  return { handler, outputs, spoken, knowledgeHits, memoryStore, readerSession }
}

test('knowledge_search tool returns markdown hits and notifies context', async () => {
  const { handler, outputs, knowledgeHits } = createHandler()
  await handler.handle({
    call_id: 'call_ks_1',
    name: KNOWLEDGE_SEARCH_TOOL_NAME,
    arguments: JSON.stringify({ query: '峰哥复刻' }),
  }, { turnId: 'turn-1', turnGeneration: 1 })

  assert.equal(outputs.length, 1)
  assert.equal(outputs[0].output.status, 'ok')
  assert.ok(outputs[0].output.count >= 1)
  assert.equal(outputs[0].output.format, 'markdown')
  assert.ok(knowledgeHits.length >= 1)
})

test('knowledge_search rejects empty query and reports not_found', async () => {
  const { handler, outputs } = createHandler()
  await handler.handle({
    call_id: 'call_ks_empty',
    name: KNOWLEDGE_SEARCH_TOOL_NAME,
    arguments: JSON.stringify({ query: '   ' }),
  }, { turnId: 'turn-1', turnGeneration: 1 })
  assert.equal(outputs.at(-1).output.error_code, 'missing_query')

  await handler.handle({
    call_id: 'call_ks_miss',
    name: KNOWLEDGE_SEARCH_TOOL_NAME,
    arguments: JSON.stringify({ query: '完全不存在的冷门词xyzzy' }),
  }, { turnId: 'turn-1', turnGeneration: 1 })
  assert.equal(outputs.at(-1).output.status, 'not_found')
  assert.equal(outputs.at(-1).output.count, 0)
})

test('content_control can list start pause and resume reading', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qwaudio-tools-read-'))
  const contentDir = join(root, 'content')
  mkdirSync(contentDir)
  writeFileSync(join(contentDir, 'story.md'), '第一句。第二句。第三句。第四句。')
  const contentStore = new MarkdownContentStore({ contentDir })
  const spoken = []
  let release
  const gate = new Promise(resolve => { release = resolve })
  const readerSession = new ReaderSession({
    contentStore,
    getFrontend: () => ({
      speak: async (text) => {
        spoken.push(text)
        if (spoken.length === 1) await gate
      },
      cancel: () => {},
    }),
    gapMs: 0,
    chunkOptions: { maxChars: 8, minChars: 2 },
  })
  const { handler, outputs } = createHandler({ readerSession })

  await handler.handle({
    call_id: 'call_list',
    name: CONTENT_CONTROL_TOOL_NAME,
    arguments: JSON.stringify({ action: 'list' }),
  }, { turnId: 'turn-1', turnGeneration: 1 })
  assert.equal(outputs.at(-1).output.status, 'ok')
  assert.ok(outputs.at(-1).output.contents.some(item => item.title === 'story'))

  await handler.handle({
    call_id: 'call_read',
    name: CONTENT_CONTROL_TOOL_NAME,
    arguments: JSON.stringify({ action: 'start_read', content_id: 'story' }),
  }, { turnId: 'turn-1', turnGeneration: 1 })
  assert.equal(outputs.at(-1).output.status, 'ok')
  assert.equal(outputs.at(-1).output.progress.status, 'reading')

  for (let i = 0; i < 40 && spoken.length < 1; i += 1) {
    await new Promise(r => setTimeout(r, 10))
  }
  assert.ok(spoken.length >= 1)

  await handler.handle({
    call_id: 'call_pause',
    name: CONTENT_CONTROL_TOOL_NAME,
    arguments: JSON.stringify({ action: 'pause' }),
  }, { turnId: 'turn-1', turnGeneration: 1 })
  assert.equal(readerSession.snapshot().status, 'paused')
  release()

  await handler.handle({
    call_id: 'call_status',
    name: CONTENT_CONTROL_TOOL_NAME,
    arguments: JSON.stringify({ action: 'status' }),
  }, { turnId: 'turn-1', turnGeneration: 1 })
  assert.equal(outputs.at(-1).output.progress.status, 'paused')
})

test('content_control can seek stop and start_explain', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qwaudio-tools-seek-'))
  const contentDir = join(root, 'content')
  mkdirSync(contentDir)
  writeFileSync(join(contentDir, 'story.md'), '第一句。第二句。第三句。第四句。第五句。')
  const contentStore = new MarkdownContentStore({ contentDir })
  const spoken = []
  let release
  const gate = new Promise(resolve => { release = resolve })
  const readerSession = new ReaderSession({
    contentStore,
    getFrontend: () => ({
      speak: async (text) => {
        spoken.push(text)
        if (spoken.length === 1) await gate
      },
      cancel: () => {},
    }),
    gapMs: 0,
    chunkOptions: { maxChars: 8, minChars: 2 },
  })
  const { handler, outputs } = createHandler({ readerSession })

  await handler.handle({
    call_id: 'call_explain',
    name: CONTENT_CONTROL_TOOL_NAME,
    arguments: JSON.stringify({ action: 'start_explain', content_id: 'story', offset: 1 }),
  }, { turnId: 'turn-1', turnGeneration: 1 })
  assert.equal(outputs.at(-1).output.status, 'ok')
  assert.equal(outputs.at(-1).output.progress.status, 'explaining')

  for (let i = 0; i < 40 && spoken.length < 1; i += 1) {
    await new Promise(r => setTimeout(r, 10))
  }
  assert.ok(spoken.length >= 1)
  assert.match(spoken[0], /^这一段的意思是：/)

  await handler.handle({
    call_id: 'call_seek',
    name: CONTENT_CONTROL_TOOL_NAME,
    arguments: JSON.stringify({ action: 'seek', offset: 2 }),
  }, { turnId: 'turn-1', turnGeneration: 1 })
  assert.equal(outputs.at(-1).output.status, 'ok')
  assert.equal(readerSession.snapshot().index, 2)
  assert.equal(readerSession.snapshot().status, 'explaining')

  await handler.handle({
    call_id: 'call_stop',
    name: CONTENT_CONTROL_TOOL_NAME,
    arguments: JSON.stringify({ action: 'stop' }),
  }, { turnId: 'turn-1', turnGeneration: 1 })
  assert.equal(outputs.at(-1).output.status, 'ok')
  assert.equal(readerSession.snapshot().status, 'stopped')
  release()
})

test('user_memory remember/recall works through async-capable provider', async () => {
  const { handler, outputs, memoryStore } = createHandler()
  await handler.handle({
    call_id: 'call_mem_1',
    name: USER_MEMORY_TOOL_NAME,
    arguments: JSON.stringify({
      action: 'remember',
      scope: 'long_term',
      content: '喜欢峰哥讲创业故事',
    }),
  }, { turnId: 'turn-1', turnGeneration: 1 })
  assert.equal(outputs.at(-1).output.status, 'remembered')

  await handler.handle({
    call_id: 'call_mem_2',
    name: USER_MEMORY_TOOL_NAME,
    arguments: JSON.stringify({
      action: 'recall',
      scope: 'long_term',
      query: '峰哥',
    }),
  }, { turnId: 'turn-1', turnGeneration: 1 })
  assert.equal(outputs.at(-1).output.status, 'ok')
  assert.ok(outputs.at(-1).output.count >= 1)

  const listed = memoryStore.list('owner-a', { scope: 'long_term', query: '峰哥' })
  const memories = listed?.then ? await listed : listed
  assert.ok(memories.length >= 1)
})
