import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalEpisodeStore } from '../src/conversation/episode/local-store.mjs'
import { createNoopEpisodeStore } from '../src/conversation/episode/provider.mjs'
import { resolveEpisodeStore } from '../src/conversation/episode/resolve.mjs'

test('local episode store appends, lists, caps, and forgets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'episode-store-'))
  try {
    const store = createLocalEpisodeStore({ dir, maxEntries: 3 })
    store.append('u1', { content: '我喜欢蓝色', at: 1 })
    store.append('u1', { content: '我怕打雷', at: 2 })
    store.append('u1', { content: '周末想爬山', at: 3 })
    store.append('u1', { content: '最近在读三国', at: 4 })
    const listed = store.list('u1', { limit: 10 })
    assert.equal(listed.length, 3)
    assert.equal(listed[0].content, '我怕打雷')
    assert.equal(listed[2].content, '最近在读三国')

    const removed = store.forget('u1', { query: '打雷' })
    assert.equal(removed, 1)
    assert.equal(store.list('u1').length, 2)

    const replaced = store.replace('u1', {
      query: '三国',
      content: '最近在读红楼梦',
    })
    assert.equal(replaced.content, '最近在读红楼梦')
    assert.equal(replaced.source, 'user')
    assert.equal(replaced.confidence, 0.9)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('noop store and EPISODE_MEMORY=0 disable persistence', () => {
  const noop = createNoopEpisodeStore()
  assert.equal(noop.append('u', { content: 'x' }), null)
  assert.deepEqual(noop.list('u'), [])
  assert.equal(noop.health().enabled, false)

  const disabled = resolveEpisodeStore({}, { EPISODE_MEMORY: '0' })
  assert.equal(disabled.health().enabled, false)
})
