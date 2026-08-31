import assert from 'node:assert/strict'
import test from 'node:test'
import { createMediaFfmpegAdapter } from '../src/media/media-ffmpeg.mjs'

test('Media FFmpeg adapter inspects media through ffprobe JSON', async () => {
  const calls = []
  const adapter = createMediaFfmpegAdapter({
    runCommand: async (command, args) => {
      calls.push({ command, args })
      return { stdout: JSON.stringify({ format: { duration: '12.5' }, streams: [{ codec_type: 'video' }] }) }
    },
  })
  const info = await adapter.inspect('/tmp/demo.mp4')
  assert.equal(calls[0].command, 'ffprobe')
  assert.ok(calls[0].args.includes('/tmp/demo.mp4'))
  assert.equal(info.artifactId, 'media_info')
  assert.equal(info.format.duration, '12.5')
})

test('Media FFmpeg adapter extracts mono PCM audio with a safe argv', async () => {
  let call
  const adapter = createMediaFfmpegAdapter({
    runCommand: async (command, args) => {
      call = { command, args }
      return { stdout: '' }
    },
  })
  const audio = await adapter.extractAudio('/tmp/input;unsafe.mp4', '/tmp/audio.wav')
  assert.equal(call.command, 'ffmpeg')
  assert.deepEqual(call.args, [
    '-y', '-i', '/tmp/input;unsafe.mp4',
    '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '/tmp/audio.wav',
  ])
  assert.equal(audio.kind, 'audio.extracted')
  assert.equal(audio.channels, 1)
})

test('Media FFmpeg adapter normalizes command failures and validates inputs', async () => {
  const adapter = createMediaFfmpegAdapter({
    runCommand: async () => { throw Object.assign(new Error('no binary'), { stderr: 'not found' }) },
  })
  await assert.rejects(() => adapter.inspect('/tmp/demo.mp4'), /ffprobe failed: not found/)
  await assert.rejects(() => adapter.extractAudio('', '/tmp/audio.wav'), /sourceRef is required/)
  await assert.rejects(() => adapter.extractAudio('/tmp/demo.mp4', '/tmp/audio.wav', { sampleRate: 1 }), /sampleRate/)
})
