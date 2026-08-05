import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalEpisodeStore } from '../src/conversation/episode/local-store.mjs'
import {
  createEpisodeMemoryTools,
  EPISODE_CORRECT_TOOL_NAME,
  EPISODE_FORGET_TOOL_NAME,
} from '../src/capabilities/tools/episode-memory.mjs'

test('episode tools correct and forget via capability handlers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'episode-tools-'))
  try {
    const store = createLocalEpisodeStore({ dir })
    store.append('owner', { content: '我喜欢蓝色', at: 1 })
    let changed = 0
    const tools = createEpisodeMemoryTools({
      episodeStore: store,
      onChanged: async () => {
        changed += 1
      },
    })
    const correct = tools.find(item => item.name === EPISODE_CORRECT_TOOL_NAME)
    const forget = tools.find(item => item.name === EPISODE_FORGET_TOOL_NAME)

    const updated = await correct.handler(
      { query: '蓝色', content: '我喜欢绿色' },
      { ownerId: 'owner' },
    )
    assert.equal(updated.status, 'ok')
    assert.equal(store.list('owner')[0].content, '我喜欢绿色')

    const removed = await forget.handler(
      { query: '绿色' },
      { ownerId: 'owner' },
    )
    assert.equal(removed.status, 'ok')
    assert.equal(removed.removed, 1)
    assert.equal(store.list('owner').length, 0)
    assert.equal(changed, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
