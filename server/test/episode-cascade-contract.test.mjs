import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCapabilityRegistry } from '../src/capabilities/registry.mjs'
import { createEpisodeMemoryTools } from '../src/capabilities/tools/episode-memory.mjs'
import {
  getActiveCapabilityRegistry,
  setActiveCapabilityRegistry,
} from '../src/capabilities/active.mjs'
import { createLocalEpisodeStore } from '../src/conversation/episode/local-store.mjs'
import { captureUserTurn } from '../src/conversation/episode/turn-capture.mjs'
import { loadRecalledEpisodes } from '../src/conversation/episode/recall.mjs'
import { buildFrontendInstructions } from '../src/voice/frontend-tools.mjs'
import { cascadeProvider } from '../src/voice/providers/cascade.mjs'
import { getRealtimeTools } from '../src/voice/frontend-tools.mjs'

/**
 * Cascade is a Realtime provider behind the gateway. Episode capture/recall
 * must reach the cascade LLM via session.instructions + capability tools —
 * without editing cascade/session.mjs.
 */
test('cascade buildSession injects recalled episodes into instructions', () => {
  const previous = getActiveCapabilityRegistry()
  setActiveCapabilityRegistry(createCapabilityRegistry())
  try {
    const session = cascadeProvider.buildSession({
      agentContext: {
        recalledEpisodes: [{
          id: 'ep-cascade',
          at: Date.UTC(2026, 7, 5),
          source: 'auto',
          content: '我下周要去上海出差',
        }],
      },
    })
    assert.match(session.instructions, /## Recent Episodes/)
    assert.match(session.instructions, /上海出差/)
    assert.ok(Array.isArray(session.tools))
  } finally {
    setActiveCapabilityRegistry(previous)
  }
})

test('cascade tool list includes episode_correct / episode_forget', () => {
  const dir = mkdtempSync(join(tmpdir(), 'episode-cascade-tools-'))
  const store = createLocalEpisodeStore({ dir })
  const registry = createCapabilityRegistry()
  for (const tool of createEpisodeMemoryTools({ episodeStore: store })) {
    registry.registerTool(tool)
  }
  const previous = getActiveCapabilityRegistry()
  setActiveCapabilityRegistry(registry)
  try {
    const names = getRealtimeTools().map(tool => tool.function?.name || tool.name)
    assert.ok(names.includes('episode_correct'))
    assert.ok(names.includes('episode_forget'))
    const session = cascadeProvider.buildSession({ agentContext: {} })
    const sessionNames = session.tools.map(tool => tool.function?.name)
    assert.ok(sessionNames.includes('episode_correct'))
    assert.ok(sessionNames.includes('episode_forget'))
  } finally {
    setActiveCapabilityRegistry(previous)
    rmSync(dir, { recursive: true, force: true })
  }
})

test('gateway-style capture then recall feeds cascade instructions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'episode-cascade-roundtrip-'))
  const store = createLocalEpisodeStore({ dir })
  const ownerId = 'cascade-owner'
  const previous = getActiveCapabilityRegistry()
  setActiveCapabilityRegistry(createCapabilityRegistry())
  try {
    const captured = captureUserTurn(store, ownerId, '后天下午三点我要见客户')
    assert.ok(captured?.id)
    const recalled = loadRecalledEpisodes(store, ownerId, {
      query: '见客户',
      limit: 5,
    })
    assert.equal(recalled.length, 1)
    const instructions = buildFrontendInstructions({ recalledEpisodes: recalled })
    assert.match(instructions, /## Recent Episodes/)
    assert.match(instructions, /见客户/)
    const session = cascadeProvider.buildSession({
      agentContext: { recalledEpisodes: recalled },
    })
    assert.match(session.instructions, /见客户/)
  } finally {
    setActiveCapabilityRegistry(previous)
    rmSync(dir, { recursive: true, force: true })
  }
})