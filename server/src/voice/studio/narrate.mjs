/**
 * Long-form narration: sentence-split DashScope TTS → one WAV + alignment ledger.
 * Contract mirrors book-sales-video doubao_tts report (trimmed PCM + fixed join pause).
 */

import { createHash } from 'node:crypto'
import { createSynthesizer as defaultCreateSynthesizer } from '../cascade/adapters/tts.mjs'
import { pcm16ToWav } from './preview.mjs'

export const ALIGNMENT_VERSION = 2
export const DEFAULT_JOIN_PAUSE_MS = 180
export const DEFAULT_MAX_CHUNK_BYTES = 900
export const SENTENCE_ENDINGS = new Set(['。', '！', '？', '!', '?', '；', ';', '\n'])

export function splitNarrationText(text, maxBytes = DEFAULT_MAX_CHUNK_BYTES) {
  const source = String(text || '').replace(/\r\n/g, '\n').trim()
  if (!source) return []
  if (maxBytes < 100) throw new Error('max chunk bytes must be at least 100')

  const sentences = []
  let buffer = ''
  for (const char of source) {
    buffer += char
    if (SENTENCE_ENDINGS.has(char)) {
      const piece = buffer.trim()
      if (piece) sentences.push(piece)
      buffer = ''
    }
  }
  const tail = buffer.trim()
  if (tail) sentences.push(tail)

  const units = []
  for (const sentence of sentences) {
    if (Buffer.byteLength(sentence, 'utf8') <= maxBytes) {
      units.push(sentence)
      continue
    }
    let start = 0
    while (start < sentence.length) {
      let end = start
      let byteCount = 0
      while (end < sentence.length) {
        const charBytes = Buffer.byteLength(sentence[end], 'utf8')
        if (byteCount + charBytes > maxBytes) break
        byteCount += charBytes
        end += 1
      }
      if (end === start) throw new Error('single UTF-8 character exceeds max chunk size')
      const piece = sentence.slice(start, end).trim()
      if (piece) units.push(piece)
      start = end
    }
  }
  return units
}

export function trimPcm16(pcm, { channels = 1, sampleRate = 24000 } = {}) {
  const data = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm)
  if (!data.length) return data
  const frameWidth = channels * 2
  const frameCount = Math.floor(data.length / frameWidth)
  const windowFrames = Math.max(1, Math.floor(sampleRate / 100))
  const threshold = 220

  const windowPeak = (firstFrame) => {
    const start = firstFrame * frameWidth
    const end = Math.min(frameCount, firstFrame + windowFrames) * frameWidth
    let peak = 0
    for (let i = start; i + 1 < end; i += 2) {
      const sample = data.readInt16LE(i)
      const abs = Math.abs(sample)
      if (abs > peak) peak = abs
    }
    return peak
  }

  let first = 0
  while (first < frameCount && windowPeak(first) < threshold) {
    first += windowFrames
  }
  let last = frameCount
  while (last > first && windowPeak(Math.max(first, last - windowFrames)) < threshold) {
    last -= windowFrames
  }
  const pad = Math.floor(sampleRate * 0.045)
  first = Math.max(0, first - pad)
  last = Math.min(frameCount, last + pad)
  return data.subarray(first * frameWidth, last * frameWidth)
}

function silencePcm16(sampleRate, joinPauseMs, channels = 1) {
  const frames = Math.max(0, Math.round(sampleRate * joinPauseMs / 1000))
  return Buffer.alloc(frames * channels * 2)
}

async function synthesizeUnitPcm({
  text,
  apiKey,
  model,
  voice,
  sampleRate,
  dashscopeWsUrl,
  createSynthesizer,
  finishTimeoutMs,
}) {
  const chunks = []
  const synthesizer = createSynthesizer({
    dashscopeWsUrl,
    tts: {
      provider: 'dashscope',
      apiKey,
      model,
      voice,
      sampleRate,
      instruction: undefined,
    },
  }, {
    onAudio(buffer) {
      chunks.push(Buffer.from(buffer))
    },
  })
  await synthesizer.start()
  synthesizer.sendText(text)
  await synthesizer.finish({ timeoutMs: finishTimeoutMs })
  return Buffer.concat(chunks)
}

export function buildNarrationCacheKey({
  text,
  voice,
  model,
  sampleRate,
  joinPauseMs,
  maxChunkBytes,
}) {
  const payload = JSON.stringify({
    alignment_version: ALIGNMENT_VERSION,
    text,
    voice,
    model,
    sampleRate,
    joinPauseMs,
    maxChunkBytes,
    provider: 'qwaudio-dashscope',
  })
  return createHash('sha256').update(payload).digest('hex')
}

/**
 * @returns {Promise<{
 *   wav: Buffer,
 *   sampleRate: number,
 *   segments: object[],
 *   units: string[],
 *   report: object,
 * }>}
 */
export async function synthesizeNarration({
  text,
  apiKey,
  model = 'qwen-audio-3.0-tts-flash',
  voice,
  sampleRate = 24000,
  joinPauseMs = DEFAULT_JOIN_PAUSE_MS,
  maxChunkBytes = DEFAULT_MAX_CHUNK_BYTES,
  dashscopeWsUrl = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
  createSynthesizer = defaultCreateSynthesizer,
  finishTimeoutMs = 180_000,
  label = '',
  profileId = null,
  author = '',
  matchType = '',
  fallback = false,
} = {}) {
  const key = String(apiKey || '').trim()
  const remote = String(voice || '').trim()
  const rate = Number(sampleRate) || 24000
  const pauseMs = Math.max(80, Math.min(450, Number(joinPauseMs) || DEFAULT_JOIN_PAUSE_MS))
  const script = String(text || '').trim()
  if (!key || !remote) {
    const error = new Error('narrate 需要有效的 apiKey 与 voice')
    error.code = 'narrate_invalid'
    throw error
  }
  if (!script) {
    const error = new Error('narrate 文本为空')
    error.code = 'narrate_empty'
    throw error
  }

  const units = splitNarrationText(script, maxChunkBytes)
  if (!units.length) {
    const error = new Error('narrate 未能切分出有效句子')
    error.code = 'narrate_empty'
    throw error
  }

  const pcmParts = []
  for (const unit of units) {
    const raw = await synthesizeUnitPcm({
      text: unit,
      apiKey: key,
      model: String(model || 'qwen-audio-3.0-tts-flash').trim() || 'qwen-audio-3.0-tts-flash',
      voice: remote,
      sampleRate: rate,
      dashscopeWsUrl,
      createSynthesizer,
      finishTimeoutMs,
    })
    if (!raw.length) {
      const error = new Error(`TTS 未返回音频：${unit.slice(0, 24)}`)
      error.code = 'narrate_no_audio'
      throw error
    }
    pcmParts.push(trimPcm16(raw, { sampleRate: rate }))
  }

  const silence = silencePcm16(rate, pauseMs)
  const merged = []
  const trimmedFrameCounts = []
  for (let i = 0; i < pcmParts.length; i += 1) {
    const part = pcmParts[i]
    trimmedFrameCounts.push(Math.floor(part.length / 2))
    merged.push(part)
    if (i < pcmParts.length - 1 && silence.length) merged.push(silence)
  }
  const pcm = Buffer.concat(merged)
  const wav = pcm16ToWav(pcm, rate)

  const joinFrames = Math.floor(silence.length / 2)
  let cursorFrames = 0
  const segments = []
  for (let index = 0; index < units.length; index += 1) {
    const frameCount = trimmedFrameCounts[index]
    const startMs = Number(((cursorFrames * 1000) / rate).toFixed(3))
    const endFrame = cursorFrames + frameCount
    const endMs = Number(((endFrame * 1000) / rate).toFixed(3))
    const pauseAfter = index < units.length - 1 ? pauseMs : 0
    segments.push({
      id: `tts-unit-${String(index + 1).padStart(3, '0')}`,
      text: units[index],
      startMs,
      endMs,
      durationMs: Number((((endFrame - cursorFrames) * 1000) / rate).toFixed(3)),
      joinPauseAfterMs: pauseAfter,
      requestIndex: index + 1,
    })
    cursorFrames = endFrame + (index < units.length - 1 ? joinFrames : 0)
  }

  const cacheKey = buildNarrationCacheKey({
    text: script,
    voice: remote,
    model: String(model || ''),
    sampleRate: rate,
    joinPauseMs: pauseMs,
    maxChunkBytes,
  })

  const report = {
    audio_bytes: wav.length,
    cache_key: cacheKey,
    cache_hit: false,
    provider: 'qwaudio-dashscope',
    speaker: remote,
    voice: remote,
    label: label || undefined,
    profile_id: profileId || undefined,
    author: author || undefined,
    match_type: matchType || undefined,
    fallback: Boolean(fallback),
    model: String(model || 'qwen-audio-3.0-tts-flash'),
    sample_rate: rate,
    workflow_invocations: 1,
    provider_request_count: units.length,
    chunk_text_bytes: units.map(unit => Buffer.byteLength(unit, 'utf8')),
    join_pause_ms: pauseMs,
    edge_silence_trimmed: true,
    alignment: {
      version: ALIGNMENT_VERSION,
      method: 'trimmed-pcm-duration-plus-fixed-join-pause',
      unitCount: segments.length,
      sampleRate: rate,
      segments,
    },
  }

  return {
    wav,
    sampleRate: rate,
    segments,
    units,
    report,
  }
}
