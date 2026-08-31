import assert from 'node:assert/strict'
import test from 'node:test'
import { createMediaRemuxAdapter } from '../src/media/media-remux.mjs'

test('remux adapter maps original video and synthesized audio safely', async () => {
  let call
  const adapter = createMediaRemuxAdapter({
    runCommand: async (command, args) => { call = { command, args } },
  })
  const result = await adapter.remux({
    videoRef: '/tmp/input;unsafe.mp4',
    audioRef: '/tmp/dub.wav',
    outputRef: '/tmp/output.mp4',
    durationMs: 12_500,
  })
  assert.equal(call.command, 'ffmpeg')
  assert.deepEqual(call.args, [
    '-y', '-i', '/tmp/input;unsafe.mp4', '-i', '/tmp/dub.wav',
    '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac',
    '-t', '12.500000', '/tmp/output.mp4',
  ])
  assert.equal(result.kind, 'video.remuxed')
})

test('remux adapter uses shortest when no duration is supplied', async () => {
  let args
  const adapter = createMediaRemuxAdapter({ runCommand: async (_command, value) => { args = value } })
  await adapter.remux({ videoRef: 'video.mp4', audioRef: 'audio.wav', outputRef: 'out.mp4' })
  assert.equal(args.at(-1), 'out.mp4')
  assert.equal(args.at(-2), '-shortest')
})
