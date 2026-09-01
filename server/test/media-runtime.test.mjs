import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import test from 'node:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDefaultMediaRuntime } from '../src/media/media-runtime.mjs'

const config = {
  cascade: {
    stt: { provider: 'local-test', sampleRate: 16_000 },
    llm: { model: 'local-test', baseUrl: 'http://local.test', apiKey: 'test', maxTokens: 100 },
    tts: { provider: 'local-test', model: 'local-test', voice: 'default', sampleRate: 24_000 },
  },
}

test('default media runtime keeps STT, translation, and TTS replaceable', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'qwaudio-runtime-'))
  const sampleWav = Buffer.alloc(44 + 3_200)
  sampleWav.writeUInt32LE(16_000, 24)
  sampleWav.writeUInt16LE(1, 22)
  sampleWav.writeUInt16LE(16, 34)
  sampleWav.writeUInt32LE(3_200, 40)
  const source = join(outputDir, 'source.wav')
  const output = join(outputDir, 'synth-1.wav')
  const runtime = createDefaultMediaRuntime({
    config,
    voiceStudioService: { list: () => ({ profiles: [{ id: 'voice-1', provider: 'local-test', targetModel: 'local-test', remote_voice_id: 'local' }] }) },
    createRecognizerImpl: () => ({
      start: async () => {}, sendAudio: () => {}, finish: async () => 'hello', abort: () => {},
    }),
    streamChatImpl: async () => ({ text: '["你好"]' }),
    createSynthesizerImpl: (_config, { onAudio }) => ({
      start: async () => {}, sendText: () => onAudio(Buffer.alloc(1_600)), finish: async () => {}, abort: () => {},
    }),
  })
  await import('node:fs/promises').then(fs => fs.writeFile(source, sampleWav))
  const transcript = await runtime.adapters.transcription.transcribeAligned({ audioRef: source, language: 'en' })
  assert.equal(transcript.segments[0].text, 'hello')
  const translation = await runtime.adapters.translation.translateSegments({ segments: transcript.segments, sourceLanguage: 'en', targetLanguage: 'zh-CN' })
  assert.equal(translation.segments[0].targetText, '你好')
  const synthesis = await runtime.adapters.synthesis.synthesizeSegments({ segments: translation.segments, voiceProfileId: 'voice-1', ownerId: 'local', outputDir })
  assert.equal(synthesis.segments[0].audioRef, output)
  assert.equal((await readFile(output)).subarray(0, 4).toString(), 'RIFF')
})
