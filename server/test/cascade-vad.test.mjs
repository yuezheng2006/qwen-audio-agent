import assert from 'node:assert/strict'
import test from 'node:test'
import { EnergyVad } from '../src/voice/cascade/vad.mjs'

const SAMPLE_RATE = 16000

function frame(ms, amplitude) {
  const samples = Math.round((ms / 1000) * SAMPLE_RATE)
  const buffer = Buffer.alloc(samples * 2)
  for (let i = 0; i < samples; i += 1) {
    const value = i % 2 === 0 ? amplitude : -amplitude
    buffer.writeInt16LE(value, i * 2)
  }
  return buffer
}

function makeVad(overrides = {}) {
  const events = []
  const vad = new EnergyVad({
    sampleRate: SAMPLE_RATE,
    threshold: 0.015,
    minSpeechMs: 100,
    silenceMs: 300,
    maxSpeechMs: 2000,
    onSpeechStart: () => events.push('start'),
    onSpeechEnd: reason => events.push(`end:${reason}`),
    ...overrides,
  })
  return { vad, events }
}

test('detects speech start after sustained voice and end after silence', () => {
  const { vad, events } = makeVad()
  for (let i = 0; i < 6; i += 1) vad.push(frame(20, 3000))
  assert.deepEqual(events, ['start'])
  for (let i = 0; i < 20; i += 1) vad.push(frame(20, 10))
  assert.deepEqual(events, ['start', 'end:silence'])
})

test('short blips below minSpeechMs never open a turn', () => {
  const { vad, events } = makeVad()
  vad.push(frame(40, 3000))
  for (let i = 0; i < 10; i += 1) vad.push(frame(20, 10))
  assert.deepEqual(events, [])
})

test('endless monologue is force-committed at maxSpeechMs', () => {
  const { vad, events } = makeVad()
  for (let i = 0; i < 120; i += 1) vad.push(frame(20, 3000))
  // Continued speech after the forced commit correctly opens a new turn.
  assert.deepEqual(events, ['start', 'end:max_duration', 'start'])
})

test('maxSpeechMs of zero disables the force commit', () => {
  const { vad, events } = makeVad({ maxSpeechMs: 0 })
  for (let i = 0; i < 300; i += 1) vad.push(frame(20, 3000))
  assert.deepEqual(events, ['start'])
})

test('far-field / low-energy audio does not open a turn at strict defaults', () => {
  const { vad, events } = makeVad({
    threshold: 0.04,
    minSpeechMs: 320,
    silenceMs: 650,
  })
  // RMS ≈ 800/32768 ≈ 0.024，低于 0.04；持续 500ms 也不启轮。
  for (let i = 0; i < 25; i += 1) vad.push(frame(20, 800))
  assert.deepEqual(events, [])
  // 近场够响但短于 minSpeechMs：仍不启轮。
  for (let i = 0; i < 10; i += 1) vad.push(frame(20, 5000))
  assert.deepEqual(events, [])
  // 近场够响且够久：才启轮。
  for (let i = 0; i < 20; i += 1) vad.push(frame(20, 5000))
  assert.deepEqual(events, ['start'])
})
