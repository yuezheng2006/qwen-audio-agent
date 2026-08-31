function clean(value, fallback = '') {
  return String(value || '').trim() || fallback
}

export function atempoFilter(tempo) {
  const value = Number(tempo)
  if (!Number.isFinite(value) || value <= 0) throw new RangeError('tempo must be positive')
  const factors = []
  let remaining = value
  while (remaining > 2) {
    factors.push(2)
    remaining /= 2
  }
  while (remaining < 0.5) {
    factors.push(0.5)
    remaining /= 0.5
  }
  factors.push(remaining)
  return factors.map(factor => `atempo=${factor.toFixed(8)}`).join(',')
}

export function createMediaTimingAdapter({
  ffmpegPath = 'ffmpeg',
  runCommand,
} = {}) {
  if (typeof runCommand !== 'function') throw new TypeError('runCommand function is required')
  return {
    async fitSegment({ segment, audioRef, outputRef, audioDurationMs } = {}) {
      const source = clean(audioRef)
      const output = clean(outputRef)
      const startMs = Number(segment?.startMs)
      const endMs = Number(segment?.endMs)
      const duration = Number(audioDurationMs)
      if (!source) throw new TypeError('audioRef is required')
      if (!output) throw new TypeError('outputRef is required')
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        throw new TypeError('segment timing is invalid')
      }
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new TypeError('audioDurationMs must be positive')
      }
      const targetDurationMs = endMs - startMs
      const tempo = duration / targetDurationMs
      await runCommand(ffmpegPath, [
        '-y', '-i', source,
        '-filter:a', atempoFilter(tempo),
        '-t', (targetDurationMs / 1_000).toFixed(6),
        '-c:a', 'pcm_s16le',
        output,
      ])
      return {
        artifactId: `timed_${clean(segment?.id, 'segment')}`,
        kind: 'audio.timed',
        sourceRef: source,
        outputRef: output,
        startMs: Math.round(startMs),
        endMs: Math.round(endMs),
        durationMs: targetDurationMs,
      }
    },
  }
}
