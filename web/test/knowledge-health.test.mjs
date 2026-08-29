import assert from 'node:assert/strict'
import test from 'node:test'
import { knowledgeHealthSummary } from '../src/knowledge-health.js'

test('knowledge health lamp distinguishes local and weknora', () => {
  assert.equal(knowledgeHealthSummary(null).ok, false)
  assert.equal(
    knowledgeHealthSummary({ kind: 'local', ok: true, knowledgeDir: '/data/knowledge' }).label,
    '/data/knowledge',
  )
  assert.match(
    knowledgeHealthSummary({ kind: 'weknora', ok: true, kbIds: ['a', 'b'] }).label,
    /WeKnora 已接通/,
  )
  assert.equal(
    knowledgeHealthSummary({ kind: 'weknora', ok: false, warning: 'timeout' }).label,
    'timeout',
  )
  assert.equal(knowledgeHealthSummary({ kind: 'none' }).ok, false)
})
