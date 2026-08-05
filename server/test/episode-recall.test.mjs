import assert from 'node:assert/strict'
import test from 'node:test'
import { selectEpisodesForPrompt } from '../src/conversation/episode/recall.mjs'

test('prefers keyword overlap and recency', () => {
  const now = Date.UTC(2026, 7, 5)
  const day = 24 * 60 * 60 * 1000
  const selected = selectEpisodesForPrompt([
    { id: '1', content: '我喜欢蓝色', at: now - 10 * day, confidence: 0.5 },
    { id: '2', content: '我怕打雷', at: now - 2 * day, confidence: 0.5 },
    { id: '3', content: '周末想爬山', at: now - 1 * day, confidence: 0.5 },
  ], { query: '打雷怎么办', limit: 2, now })

  assert.equal(selected[0].id, '2')
  assert.ok(selected.some(item => item.id === '2'))
})

test('without query returns newest memorable first', () => {
  const now = 1_000_000
  const selected = selectEpisodesForPrompt([
    { id: 'a', content: '上周想去爬山', at: now - 1000, source: 'auto', confidence: 0.5 },
    { id: 'b', content: '周末想去青岛玩', at: now - 10, source: 'auto', confidence: 0.5 },
  ], { limit: 1, now })
  assert.equal(selected[0].id, 'b')
})

test('without query ambient chatter cannot crowd out facts', () => {
  const now = Date.UTC(2026, 7, 5)
  const selected = selectEpisodesForPrompt([
    {
      id: 'fact',
      content: '这周要去青岛去玩。',
      at: now - 60_000,
      source: 'auto',
      confidence: 0.5,
    },
    {
      id: 'noise1',
      content: '你基本上就是啊。',
      at: now - 10_000,
      source: 'auto',
      confidence: 0.5,
    },
    {
      id: 'noise2',
      content: '就像固件是走的那个啥，是吧？',
      at: now - 5_000,
      source: 'auto',
      confidence: 0.5,
    },
    {
      id: 'q',
      content: '我这周要去哪？',
      at: now - 1_000,
      source: 'auto',
      confidence: 0.5,
    },
  ], { limit: 2, now })

  assert.ok(selected.some(item => item.id === 'fact'))
  assert.equal(selected.some(item => item.id === 'noise1'), false)
  assert.equal(selected.some(item => item.id === 'q'), false)
})
