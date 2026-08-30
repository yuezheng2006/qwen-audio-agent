import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clampClipRange,
  encodeWav,
  formatRecordingTime,
  selectRecorderMimeType,
} from '../src/voice-recorder.js'

test('selectRecorderMimeType chooses the first supported browser format', () => {
  assert.equal(
    selectRecorderMimeType(type => type === 'audio/mp4', ['audio/webm', 'audio/mp4']),
    'audio/mp4',
  )
  assert.equal(selectRecorderMimeType(() => false, ['audio/webm']), '')
})

test('formatRecordingTime keeps a stable mm:ss display', () => {
  assert.equal(formatRecordingTime(0), '0:00')
  assert.equal(formatRecordingTime(65.9), '1:05')
  assert.equal(formatRecordingTime(-1), '0:00')
})

test('clampClipRange keeps the selected segment inside the recording', () => {
  assert.deepEqual(clampClipRange(-2, 9, 7), {
    start: 0,
    end: 7,
    duration: 7,
  })
  assert.deepEqual(clampClipRange(5, 2, 7), {
    start: 5,
    end: 5,
    duration: 0,
  })
})

test('encodeWav emits a clipped PCM16 mono wav', async () => {
  const samples = Float32Array.from([-.5, 0, .5, 1])
  const wav = encodeWav({
    sampleRate: 4,
    duration: 1,
    length: samples.length,
    numberOfChannels: 1,
    getChannelData: () => samples,
  }, .25, .75)
  const bytes = new Uint8Array(await wav.arrayBuffer())
  assert.equal(wav.type, 'audio/wav')
  assert.equal(bytes.length, 48)
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'RIFF')
  assert.equal(String.fromCharCode(...bytes.slice(8, 12)), 'WAVE')
  assert.equal(new DataView(bytes.buffer).getUint32(40, true), 4)
})

