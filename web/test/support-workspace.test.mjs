import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SUPPORT_DEMO_EXAMPLES,
  isSupportPath,
  mergeSupportLine,
  supportConnectContext,
  supportLineFromEvent,
} from '../src/support-workspace.js'

test('support path and connect extras', () => {
  assert.equal(isSupportPath('/support'), true)
  assert.equal(isSupportPath('/support/'), true)
  assert.equal(isSupportPath('/'), false)
  assert.deepEqual(supportConnectContext(), {
    workspace: 'support',
    personaId: 'support',
  })
  assert.equal(supportConnectContext('abc').token, 'abc')
  assert.ok(SUPPORT_DEMO_EXAMPLES.some(item => /营业时间/.test(item.label)))
  assert.deepEqual(
    supportLineFromEvent({ type: 'transcript.final', role: 'user', content: '几点关门' }),
    { role: 'user', text: '几点关门', live: false },
  )
  assert.equal(supportLineFromEvent({ type: 'transcript.user', transcript: '旧事件' }), null)
  const streaming = mergeSupportLine(
    [{ role: 'user', text: '几点', live: false }],
    supportLineFromEvent({ type: 'transcript.delta', role: 'assistant', content: '每天' }),
  )
  const done = mergeSupportLine(
    streaming,
    supportLineFromEvent({ type: 'transcript.final', role: 'assistant', content: '每天 9:00–21:00' }),
  )
  assert.equal(done.length, 2)
  assert.equal(done[1].text, '每天 9:00–21:00')
})
