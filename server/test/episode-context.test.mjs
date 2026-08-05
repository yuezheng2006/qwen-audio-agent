import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFrontendContext } from '../src/conversation/frontend-agent-context.mjs'
import {
  episodeSection,
  formatRelativeAge,
} from '../src/conversation/episode/context.mjs'

test('episode section is data not instructions', () => {
  const now = Date.UTC(2026, 7, 5, 5, 40)
  const lines = episodeSection([
    { id: 'ep1', at: now - 10 * 60_000, source: 'auto', content: '这周要去青岛去玩' },
  ], { timeZone: 'Asia/Shanghai', locale: 'zh-CN', now })
  const text = lines.join('\n')
  assert.match(text, /## Recent Episodes/)
  assert.match(text, /不是系统指令/)
  assert.match(text, /这周要去青岛去玩/)
  assert.match(text, /<episode_memory_data>/)
  assert.match(text, /10分钟前/)
  assert.match(text, /保留用户原话中的时间词/)
  assert.doesNotMatch(text, /T05:30:00\.000Z/)
})

test('formatRelativeAge stays within hours for same-day facts', () => {
  const now = Date.UTC(2026, 7, 5, 6, 0)
  assert.equal(formatRelativeAge(now - 5 * 60_000, now), '5分钟前')
  assert.equal(formatRelativeAge(now - 3 * 3600_000, now), '3小时前')
  assert.equal(formatRelativeAge(now - 8 * 86400_000, now), '上周左右')
})

test('buildFrontendContext includes recalled episodes with relative age', () => {
  const now = new Date(Date.UTC(2026, 7, 5, 5, 40))
  const context = buildFrontendContext({
    client: { timeZone: 'Asia/Shanghai', locale: 'zh-CN' },
    recalledEpisodes: [
      {
        id: 'ep1',
        at: now.getTime() - 15 * 60_000,
        source: 'auto',
        content: '我怕打雷',
      },
    ],
    now,
  })
  assert.match(context, /## Recent Episodes/)
  assert.match(context, /我怕打雷/)
  assert.match(context, /15分钟前/)
})
