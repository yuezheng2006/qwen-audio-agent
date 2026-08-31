import assert from 'node:assert/strict'
import test from 'node:test'
import { atempoFilter, createMediaTimingAdapter } from '../src/media/media-timing.mjs'

test('atempoFilter decomposes values outside FFmpeg safe range', () => {
  assert.equal(atempoFilter(2.5), 'atempo=2.00000000,atempo=1.25000000')
  assert.equal(atempoFilter(0.25), 'atempo=0.50000000,atempo=0.50000000')
  assert.throws(() => atempoFilter(0), /positive/)
})

test('timing adapter fits synthesized audio to the segment window', async () => {
  let call
  const adapter = createMediaTimingAdapter({
    runCommand: async (command, args) => { call = { command, args } },
  })
  const result = await adapter.fitSegment({
    segment: { id: 's1', startMs: 1000, endMs: 2200 },
    audioRef: 'artifact://dubbed/s1.wav',
    outputRef: 'artifact://timed/s1.wav',
    audioDurationMs: 2400,
  })
  assert.equal(call.command, 'ffmpeg')
  assert.deepEqual(call.args, [
    '-y', '-i', 'artifact://dubbed/s1.wav',
    '-filter:a', 'atempo=2.00000000',
    '-t', '1.200000', '-c:a', 'pcm_s16le', 'artifact://timed/s1.wav',
  ])
  assert.equal(result.durationMs, 1200)
})

test('timing adapter rejects missing or invalid media timing inputs', async () => {
  const adapter = createMediaTimingAdapter({ runCommand: async () => {} })
  await assert.rejects(() => adapter.fitSegment({
    segment: { startMs: 0, endMs: 100 }, outputRef: 'x', audioDurationMs: 100,
  }), /audioRef/)
  await assert.rejects(() => adapter.fitSegment({
    segment: { startMs: 0, endMs: 100 }, audioRef: 'x', outputRef: 'y', audioDurationMs: 0,
  }), /audioDurationMs/)
})
