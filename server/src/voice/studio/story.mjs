/**
 * Multi-speaker story orchestration.
 *
 * This module owns workflow composition only. Provider details remain in the
 * existing narration/TTS adapter seam so the same contract can be reused by
 * DashScope, Fish, FireRed and local plugins when they expose synthesis.
 */

import { synthesizeNarration as defaultSynthesizeNarration } from './narrate.mjs'
import { pcm16ToWav } from './preview.mjs'

export const STORY_ALIGNMENT_VERSION = 1
export const DEFAULT_STORY_JOIN_PAUSE_MS = 260

function readWavPcm16(wav) {
  const data = Buffer.isBuffer(wav) ? wav : Buffer.from(wav || [])
  if (data.length < 44 || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('story 需要有效的 WAV 音频')
  }
  let offset = 12
  let sampleRate = 0
  let channels = 0
  let bitsPerSample = 0
  let pcm = null
  while (offset + 8 <= data.length) {
    const id = data.toString('ascii', offset, offset + 4)
    const size = data.readUInt32LE(offset + 4)
    const bodyStart = offset + 8
    const bodyEnd = Math.min(data.length, bodyStart + size)
    if (id === 'fmt ' && bodyEnd - bodyStart >= 16) {
      const format = data.readUInt16LE(bodyStart)
      channels = data.readUInt16LE(bodyStart + 2)
      sampleRate = data.readUInt32LE(bodyStart + 4)
      bitsPerSample = data.readUInt16LE(bodyStart + 14)
      if (format !== 1) throw new Error('story 仅支持 PCM WAV')
    } else if (id === 'data') {
      pcm = data.subarray(bodyStart, bodyEnd)
    }
    offset = bodyStart + size + (size % 2)
  }
  if (!pcm?.length || !sampleRate || channels !== 1 || bitsPerSample !== 16) {
    throw new Error('story 仅支持单声道 16-bit PCM WAV')
  }
  return { pcm, sampleRate }
}

function silencePcm16(sampleRate, pauseMs) {
  return Buffer.alloc(Math.max(0, Math.round(sampleRate * pauseMs / 1000)) * 2)
}

/**
 * Merge per-speaker narration results and translate their local alignment into
 * one story timeline.
 */
export function mergeStoryNarrations(results, {
  joinPauseMs = DEFAULT_STORY_JOIN_PAUSE_MS,
} = {}) {
  if (!Array.isArray(results) || !results.length) {
    throw new Error('story 至少需要一个段落')
  }
  const pauseMs = Math.max(0, Math.min(1500, Number(joinPauseMs) || DEFAULT_STORY_JOIN_PAUSE_MS))
  const first = readWavPcm16(results[0].wav)
  const parts = []
  const segments = []
  let cursorFrames = 0
  let providerRequestCount = 0

  results.forEach((result, index) => {
    const current = readWavPcm16(result.wav)
    if (current.sampleRate !== first.sampleRate) {
      throw new Error('story 各段音频采样率必须一致')
    }
    const offsetMs = Number(((cursorFrames * 1000) / first.sampleRate).toFixed(3))
    const localSegments = Array.isArray(result.segments) ? result.segments : []
    for (const segment of localSegments) {
      segments.push({
        ...segment,
        id: `story-${String(index + 1).padStart(3, '0')}-${segment.id || 'segment'}`,
        speaker: result.speaker || result.label || `角色 ${index + 1}`,
        startMs: Number((Number(segment.startMs || 0) + offsetMs).toFixed(3)),
        endMs: Number((Number(segment.endMs || 0) + offsetMs).toFixed(3)),
      })
    }
    parts.push(current.pcm)
    cursorFrames += Math.floor(current.pcm.length / 2)
    providerRequestCount += Number(result.report?.provider_request_count || 0)
    if (index < results.length - 1) {
      const pause = silencePcm16(first.sampleRate, pauseMs)
      parts.push(pause)
      cursorFrames += Math.floor(pause.length / 2)
    }
  })

  const pcm = Buffer.concat(parts)
  return {
    wav: pcm16ToWav(pcm, first.sampleRate),
    sampleRate: first.sampleRate,
    segments,
    report: {
      provider: 'qwaudio-story',
      sample_rate: first.sampleRate,
      speaker_count: results.length,
      provider_request_count: providerRequestCount,
      join_pause_ms: pauseMs,
      alignment: {
        version: STORY_ALIGNMENT_VERSION,
        segments,
      },
    },
  }
}

/**
 * Run the workflow through the injected narration seam.
 */
export async function synthesizeStory({
  segments,
  joinPauseMs = DEFAULT_STORY_JOIN_PAUSE_MS,
  synthesizeNarration = defaultSynthesizeNarration,
  ...defaults
} = {}) {
  if (!Array.isArray(segments) || !segments.length) {
    throw new Error('story 至少需要一个段落')
  }
  const results = []
  for (const segment of segments) {
    const text = String(segment?.text || '').trim()
    const voice = String(segment?.voice || '').trim()
    if (!text || !voice) throw new Error('story 段落必须包含文本和音色')
    const result = await synthesizeNarration({
      ...defaults,
      ...segment,
      text,
      voice,
    })
    results.push({
      ...result,
      speaker: segment.speaker || segment.label || '',
      label: segment.label || '',
    })
  }
  return mergeStoryNarrations(results, { joinPauseMs })
}
