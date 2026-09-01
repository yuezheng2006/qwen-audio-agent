import { readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createMediaFfmpegAdapter } from './media-ffmpeg.mjs'
import { createMediaAudioComposeAdapter } from './media-audio-compose.mjs'
import { createMediaRemuxAdapter } from './media-remux.mjs'
import { createMediaTimingAdapter } from './media-timing.mjs'
import { createAlignedTranscriptionAdapter } from './media-transcription.mjs'
import { createSegmentTranslationAdapter } from './media-translation.mjs'
import { createSegmentSynthesisAdapter } from './media-synthesis.mjs'
import { createRecognizer } from '../voice/cascade/adapters/stt.mjs'
import { createSynthesizer } from '../voice/cascade/adapters/tts.mjs'
import { streamChat } from '../voice/cascade/adapters/llm.mjs'

const defaultRunCommand = promisify(execFile)

function clean(value, fallback = '') {
  return String(value || '').trim() || fallback
}

function pcm16ToWav(pcm, sampleRate = 24_000) {
  const data = Buffer.from(pcm)
  const rate = Number(sampleRate) || 24_000
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

function wavPcmDurationMs(wav, fallback = 1_000) {
  if (!Buffer.isBuffer(wav) || wav.length < 44) return fallback
  const rate = wav.readUInt32LE(24)
  const channels = wav.readUInt16LE(22)
  const bits = wav.readUInt16LE(34)
  const dataSize = wav.readUInt32LE(40)
  if (!rate || !channels || !bits) return fallback
  return Math.max(1, Math.round(dataSize / (rate * channels * (bits / 8)) * 1_000))
}

function extractPcm(wav) {
  if (!Buffer.isBuffer(wav) || wav.length <= 44) throw new Error('提取的音频 WAV 无有效 PCM 数据')
  return wav.subarray(44)
}

function parseTranslation(text, count) {
  const value = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const parsed = JSON.parse(value)
  const segments = Array.isArray(parsed) ? parsed : parsed.segments
  if (!Array.isArray(segments) || segments.length !== count) throw new Error('翻译结果分段数量不匹配')
  return segments.map(item => typeof item === 'string' ? item : item.targetText)
}

export function createDefaultMediaRuntime({
  config,
  voiceStudioService,
  runCommand,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!config?.cascade) throw new TypeError('media runtime requires cascade config')
  const cascade = config.cascade
  const commandRunner = runCommand || defaultRunCommand
  const ffmpeg = createMediaFfmpegAdapter({ runCommand: commandRunner })
  const timing = createMediaTimingAdapter({ runCommand: commandRunner })
  const audioCompose = createMediaAudioComposeAdapter({ runCommand: commandRunner })
  const remux = createMediaRemuxAdapter({ runCommand: commandRunner })

  const transcription = createAlignedTranscriptionAdapter({
    provider: cascade.stt.provider,
    transcribe: async ({ audioRef, language }) => {
      const wav = await readFile(audioRef)
      const recognizer = createRecognizer(cascade, { fetchImpl })
      await recognizer.start()
      try {
        recognizer.sendAudio(extractPcm(wav))
        const text = await recognizer.finish()
        const durationMs = wavPcmDurationMs(wav)
        return {
          language: clean(language, 'auto'),
          segments: [{ id: 'segment_1', startMs: 0, endMs: durationMs, text }],
        }
      } finally {
        recognizer.abort()
      }
    },
  })

  const translation = createSegmentTranslationAdapter({
    provider: 'cascade-llm',
    translate: async ({ segments, sourceLanguage, targetLanguage }) => {
      if (sourceLanguage === targetLanguage) return segments.map(segment => segment.text)
      const response = await streamChat(cascade.llm, {
        messages: [
          { role: 'system', content: '你是专业字幕翻译器。只输出 JSON 数组，每个元素是对应输入句子的译文，不要解释。' },
          { role: 'user', content: JSON.stringify({ sourceLanguage, targetLanguage, segments: segments.map(item => item.text) }) },
        ],
      })
      return parseTranslation(response.text, segments.length)
    },
  })

  const synthesis = createSegmentSynthesisAdapter({
    provider: cascade.tts.provider,
    synthesize: async ({ segment, voiceProfileId, outputRef, ownerId = 'local' }) => {
      const profileResult = voiceStudioService?.list(ownerId)
      const profile = profileResult?.profiles?.find(item => item.id === voiceProfileId)
      const voice = clean(profile?.remote_voice_id || profile?.remoteVoiceId)
      if (!voice) throw new Error('所选声音没有可用的远程或本地 voice ID')
      const chunks = []
      const profileConfig = {
        ...cascade,
        tts: {
          ...cascade.tts,
          provider: clean(profile.provider, cascade.tts.provider),
          model: clean(profile.targetModel, cascade.tts.model),
          voice,
        },
      }
      const synthesizer = createSynthesizer(profileConfig, { onAudio: chunk => chunks.push(Buffer.from(chunk)) })
      await synthesizer.start()
      try {
        synthesizer.sendText(segment.targetText || segment.text)
        await synthesizer.finish()
      } finally {
        synthesizer.abort()
      }
      await writeFile(outputRef, pcm16ToWav(Buffer.concat(chunks), cascade.tts.sampleRate))
      return { audioRef: outputRef }
    },
  })

  return { adapters: { ffmpeg, transcription, translation, synthesis, timing, audioCompose, remux } }
}
