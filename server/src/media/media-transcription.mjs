function clean(value, fallback = '') {
  return String(value || '').trim() || fallback
}

function normalizeSegment(segment, index) {
  const text = clean(segment?.text)
  const startValue = segment?.startMs ?? segment?.start_ms ?? segment?.start
  const endValue = segment?.endMs ?? segment?.end_ms ?? segment?.end
  const startIsMs = segment?.startMs !== undefined || segment?.start_ms !== undefined
  const endIsMs = segment?.endMs !== undefined || segment?.end_ms !== undefined
  const startMs = Number(startValue) * (startIsMs ? 1 : 1_000)
  const endMs = Number(endValue) * (endIsMs ? 1 : 1_000)
  if (!text) throw new Error(`transcription segment ${index + 1} is missing text`)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error(`transcription segment ${index + 1} has invalid timing`)
  }
  return {
    id: clean(segment?.id, `segment_${index + 1}`),
    speakerId: clean(segment?.speakerId ?? segment?.speaker_id) || null,
    startMs: Math.round(startMs),
    endMs: Math.round(endMs),
    text,
    language: clean(segment?.language) || null,
  }
}

export function createAlignedTranscriptionAdapter({
  transcribe,
  provider = 'unknown',
} = {}) {
  if (typeof transcribe !== 'function') throw new TypeError('transcribe function is required')
  return {
    async transcribeAligned({ audioRef, language = 'auto', ...options } = {}) {
      const source = clean(audioRef)
      if (!source) throw new TypeError('audioRef is required')
      const result = await transcribe({ audioRef: source, language, ...options })
      const segments = (Array.isArray(result) ? result : result?.segments || [])
        .map(normalizeSegment)
      if (!segments.length) throw new Error('transcription returned no timed segments')
      return {
        artifactId: 'transcript_aligned',
        kind: 'speech.transcript.aligned',
        provider,
        language: clean(result?.language, language),
        segments,
      }
    },
  }
}

export { normalizeSegment as normalizeTranscriptionSegment }
