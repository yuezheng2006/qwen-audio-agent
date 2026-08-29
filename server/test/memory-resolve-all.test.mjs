import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  resolveMemoryProvider,
  resolveMemoryProviderKind,
} from '../src/conversation/memory/resolve.mjs'
import { resolveKnowledgeProvider } from '../src/knowledge/resolve.mjs'
import { MarkdownMemoryFs } from '../src/conversation/memory/md-memory-fs.mjs'
import { resolveCascadeConfig } from '../src/core/config.mjs'

test('resolveMemoryProvider wires openviking and evermind kinds', () => {
  const root = mkdtempSync(join(tmpdir(), 'qwaudio-resolve-'))
  const ov = resolveMemoryProvider({
    configDirectory: root,
    userProfilePath: join(root, 'USER.md'),
    identityMode: 'personal',
  }, {
    MEMORY_PROVIDER: 'openviking',
    OPENVIKING_URL: 'http://127.0.0.1:1933',
    OPENVIKING_MEMORIES_DIR: join(root, 'ov-mem'),
  })
  assert.equal(ov.kind, 'openviking')

  const em = resolveMemoryProvider({
    configDirectory: root,
    userProfilePath: join(root, 'USER.md'),
    identityMode: 'personal',
  }, {
    MEMORY_PROVIDER: 'evermind',
    EVERMIND_MODE: 'cloud',
    EVERMIND_API_KEY: '',
    EVERMIND_MEMORIES_DIR: join(root, 'em-mem'),
  })
  assert.equal(em.kind, 'evermind')
  assert.throws(() => resolveMemoryProviderKind('redis'), /unsupported MEMORY_PROVIDER/)
})

test('markdown memory fs remember forget and query', () => {
  const root = mkdtempSync(join(tmpdir(), 'qwaudio-mdmem-'))
  const fs = new MarkdownMemoryFs({ rootDir: join(root, 'memories') })
  const saved = fs.remember('周末想去爬山')
  assert.match(saved.id, /^mem_/)
  assert.equal(fs.list({ query: '爬山' }).length, 1)
  assert.equal(fs.forget({ query: saved.id }), 1)
  assert.equal(fs.list().length, 0)
})

test('knowledge resolve supports local and none', () => {
  const root = mkdtempSync(join(tmpdir(), 'qwaudio-kb-resolve-'))
  const local = resolveKnowledgeProvider({
    knowledgeDir: join(root, 'knowledge'),
  }, { KNOWLEDGE_PROVIDER: 'local' })
  assert.equal(local.kind, 'local')
  assert.equal(local.health().format, 'markdown')

  const none = resolveKnowledgeProvider({}, { KNOWLEDGE_PROVIDER: 'none' })
  assert.equal(none.kind, 'none')
  assert.deepEqual(none.search('anything'), [])

  const weknora = resolveKnowledgeProvider({
    knowledgeDir: join(root, 'knowledge'),
    weknora: { baseUrl: 'http://127.0.0.1:8080' },
  }, { KNOWLEDGE_PROVIDER: 'weknora' })
  assert.equal(weknora.kind, 'weknora')
})

test('cascade config exposes voicebox base url and provider', () => {
  const cascade = resolveCascadeConfig({
    DASHSCOPE_API_KEY: 'k',
    CASCADE_TTS_PROVIDER: 'voicebox',
    VOICEBOX_BASE_URL: 'http://127.0.0.1:17493/',
  })
  assert.equal(cascade.tts.provider, 'voicebox')
  assert.equal(cascade.tts.voiceboxBaseUrl, 'http://127.0.0.1:17493')
})
