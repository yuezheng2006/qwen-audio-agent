function clean(value, fallback = '') {
  return String(value || '').trim() || fallback
}

function normalizeAudioSegment(segment, audioRef, index) {
  const ref = clean(audioRef)
  const startMs = Number(segment?.startMs)
  const endMs = Number(segment?.endMs)
  if (!ref) throw new Error(`synthesis segment ${index + 1} is missing audioRef`)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error(`synthesis segment ${index + 1} has invalid timing`)
  }
  return {
    id: clean(segment?.id, `segment_${index + 1}`),
    speakerId: clean(segment?.speakerId) || null,
    startMs: Math.round(startMs),
    endMs: Math.round(endMs),
    text: clean(segment?.targetText, segment?.text),
    audioRef: ref,
  }
}

export function createSegmentSynthesisAdapter({
  synthesize,
  provider = 'unknown',
} = {}) {
  if (typeof synthesize !== 'function') throw new TypeError('synthesize function is required')
  return {
    async synthesizeSegments({ segments, voiceProfileId, ...options } = {}) {
      const source = Array.isArray(segments) ? segments : []
      const profile = clean(voiceProfileId)
      if (!source.length) throw new TypeError('segments are required')
      if (!profile) throw new TypeError('voiceProfileId is required')
      const outputs = []
      for (const [index, segment] of source.entries()) {
        const result = await synthesize({
          segment: { ...segment },
          text: clean(segment?.targetText, segment?.text),
          voiceProfileId: profile,
          ...options,
        })
        const audioRef = typeof result === 'string' ? result : result?.audioRef
        outputs.push(normalizeAudioSegment(segment, audioRef, index))
      }
      return {
        artifactId: 'synthesized_segments',
        kind: 'speech.synthesis.segments',
        provider,
        voiceProfileId: profile,
        segments: outputs,
      }
    },
  }
}
