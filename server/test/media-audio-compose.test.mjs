import assert from 'node:assert/strict'
import test from 'node:test'
import { createMediaAudioComposeAdapter } from '../src/media/media-audio-compose.mjs'

test('audio compose builds a delayed timeline with safe argv', async () => {
  let command
  const adapter = createMediaAudioComposeAdapter({
    runCommand: async (...args) => { command = args },
  })
  const result = await adapter.compose({
    segments: [
      { outputRef: 'first.wav', startMs: 0, endMs: 900 },
      { outputRef: 'second.wav', startMs: 1_000, endMs: 1_800 },
    ],
    outputRef: 'timeline.wav',
    durationMs: 1_800,
  })
  assert.equal(result.outputRef, 'timeline.wav')
  assert.equal(command[0], 'ffmpeg')
  const argv = command[1]
  assert.ok(argv.includes('first.wav'))
  assert.ok(argv.includes('second.wav'))
  assert.ok(argv.join(' ').includes('adelay=1000|1000'))
  assert.ok(argv.join(' ').includes('amix=inputs=2'))
})
