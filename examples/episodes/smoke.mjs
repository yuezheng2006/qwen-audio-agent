#!/usr/bin/env node
/**
 * Offline smoke for episode recall (no gateway).
 *
 *   node examples/episodes/smoke.mjs
 *   EPISODE_SMOKE_QUERY=上海 node examples/episodes/smoke.mjs
 *
 * Writes under examples/episodes/local/ (gitignored).
 */
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLocalEpisodeStore } from '../../server/src/conversation/episode/local-store.mjs'
import { loadRecalledEpisodes } from '../../server/src/conversation/episode/recall.mjs'
import { episodeSection } from '../../server/src/conversation/episode/context.mjs'
import { shouldCaptureTurn } from '../../server/src/conversation/episode/turn-capture.mjs'

const root = dirname(fileURLToPath(import.meta.url))
const localDir = join(root, 'local')
const sample = join(root, 'demo.json')
const ownerId = 'demo'
const query = String(process.env.EPISODE_SMOKE_QUERY || '上海出差').trim()

rmSync(localDir, { recursive: true, force: true })
mkdirSync(localDir, { recursive: true, mode: 0o700 })
cpSync(sample, join(localDir, `${ownerId}.json`))

const store = createLocalEpisodeStore({ dir: localDir, maxEntries: 200 })
const noise = '嗯'
const fact = '后天下午三点我要见客户，帮我留个空档。'
console.log('shouldCaptureTurn(noise)=', shouldCaptureTurn(noise))
console.log('shouldCaptureTurn(fact)=', shouldCaptureTurn(fact))
if (shouldCaptureTurn(fact)) {
  store.append(ownerId, {
    role: 'user',
    content: fact,
    source: 'auto',
    confidence: 0.5,
  })
}

const recalled = loadRecalledEpisodes(store, ownerId, {
  query,
  limit: 5,
})
const section = episodeSection(recalled).join('\n\n')
console.log('\n--- recalled ---')
console.log(JSON.stringify(recalled.map(item => ({
  id: item.id,
  content: item.content,
  source: item.source,
})), null, 2))
console.log('\n--- prompt section ---')
console.log(section || '(empty)')
console.log(`\nlocal dir: ${localDir}`)
