import assert from 'node:assert/strict'
import test from 'node:test'
import { CancelScope } from '../src/voice/cascade/cancel-scope.mjs'

test('cancel advances the generation and marks older gens stale', () => {
  const scope = new CancelScope()
  const gen0 = scope.generation
  scope.cancel()
  assert.notEqual(scope.generation, gen0)
  assert.equal(scope.isStale(gen0), true)
  assert.equal(scope.isStale(scope.generation), false)
  assert.equal(scope.discarding, true)
})

test('responseDone clears the discard window for the cancelled generation', () => {
  const scope = new CancelScope()
  const gen0 = scope.generation
  scope.cancel()
  const gen1 = scope.generation
  scope.responseDone(gen0)
  assert.equal(scope.discarding, false)
  assert.equal(scope.isStale(gen0), true)
  assert.equal(scope.isStale(gen1), false)
})

test('shouldEmit drops stale generations and any packet while discarding', () => {
  const scope = new CancelScope()
  const gen0 = scope.capture()
  assert.equal(scope.shouldEmit(gen0), true)
  scope.cancel()
  assert.equal(scope.shouldEmit(gen0), false)
  // Even the current gen is suppressed until responseDone / newResponse.
  assert.equal(scope.shouldEmit(scope.generation), false)
  scope.newResponse()
  const gen1 = scope.capture()
  assert.equal(scope.shouldEmit(gen1), true)
  assert.equal(scope.shouldEmit(gen0), false)
})

test('newResponse clears discarding without requiring responseDone', () => {
  const scope = new CancelScope()
  scope.cancel()
  assert.equal(scope.discarding, true)
  scope.newResponse()
  assert.equal(scope.discarding, false)
  assert.equal(scope.shouldEmit(scope.generation), true)
})
