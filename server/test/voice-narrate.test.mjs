import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ALIGNMENT_VERSION,
  DEFAULT_JOIN_PAUSE_MS,
  splitNarrationText,
  synthesizeNarration,
  trimPcm16,
} from '../src/voice/studio/narrate.mjs'

test('splitNarrationText splits on sentence endings', () => {
  const units = splitNarrationText('今天分享的是。这本书很有意思！你觉得呢？尾句')
  assert.deepEqual(units, [
    '今天分享的是。',
    '这本书很有意思！',
    '你觉得呢？',
    '尾句',
  ])
})

test('trimPcm16 keeps non-silent middle', () => {
  const sampleRate = 24000
  const silent = Buffer.alloc(sampleRate * 2) // 1s silence
  const tone = Buffer.alloc(4800)
  for (let i = 0; i < tone.length; i += 2) tone.writeInt16LE(1200, i)
  const pcm = Buffer.concat([silent, tone, silent])
  const trimmed = trimPcm16(pcm, { sampleRate })
  assert.ok(trimmed.length < pcm.length)
  assert.ok(trimmed.length >= tone.length)
})

test('synthesizeNarration builds monotonic alignment with join pauses', async () => {
  const sampleRate = 24000
  const framesPerUnit = 2400 // 100ms
  const createSynthesizer = (_config, { onAudio }) => ({
    async start() {},
    sendText() {
      const pcm = Buffer.alloc(framesPerUnit * 2)
      for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(800, i)
      onAudio(pcm)
    },
    async finish() {},
  })

  const { wav, report, segments } = await synthesizeNarration({
    text: '第一句。第二句。',
    apiKey: 'k',
    voice: 'voice-x',
    sampleRate,
    joinPauseMs: DEFAULT_JOIN_PAUSE_MS,
    createSynthesizer,
    label: '测试',
    author: '刘震云',
    matchType: 'author',
  })

  assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
  assert.equal(report.provider, 'qwaudio-dashscope')
  assert.equal(report.alignment.version, ALIGNMENT_VERSION)
  assert.equal(segments.length, 2)
  assert.equal(segments[0].startMs, 0)
  assert.ok(segments[0].endMs > 0)
  assert.equal(segments[0].joinPauseAfterMs, DEFAULT_JOIN_PAUSE_MS)
  assert.ok(segments[1].startMs >= segments[0].endMs)
  assert.equal(segments[1].joinPauseAfterMs, 0)
  assert.equal(report.author, '刘震云')
  assert.equal(report.match_type, 'author')
})

test('synthesizeNarration rejects empty text', async () => {
  await assert.rejects(
    () => synthesizeNarration({
      text: '   ',
      apiKey: 'k',
      voice: 'v',
      createSynthesizer: () => ({}),
    }),
    /空/,
  )
})
