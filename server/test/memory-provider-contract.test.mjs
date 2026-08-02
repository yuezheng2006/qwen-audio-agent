import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MEMORY_PROVIDER_KINDS,
  assertMemoryProvider,
  maybeAwait,
} from '../src/conversation/memory/provider.mjs'

test('assertMemoryProvider requires the public memory surface', () => {
  assert.throws(() => assertMemoryProvider(null, 'x'), /invalid/)
  assert.throws(
    () => assertMemoryProvider({ list() {} }, 'x'),
    /missing remember/,
  )
  const provider = {
    list() { return [] },
    remember() { return null },
    replace() { return null },
    forget() { return 0 },
    health() { return { ok: true } },
  }
  assert.equal(assertMemoryProvider(provider, 'local'), provider)
  assert.ok(MEMORY_PROVIDER_KINDS.includes('openviking'))
  assert.ok(MEMORY_PROVIDER_KINDS.includes('evermind'))
})

test('maybeAwait accepts sync values and promises', async () => {
  assert.equal(await maybeAwait(7), 7)
  assert.equal(await maybeAwait(Promise.resolve('ok')), 'ok')
})
