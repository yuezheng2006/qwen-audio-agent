function clean(value, fallback = '') {
  return String(value || '').trim() || fallback
}

export function createMediaAudioComposeAdapter({
  ffmpegPath = 'ffmpeg',
  runCommand,
} = {}) {
  if (typeof runCommand !== 'function') throw new TypeError('runCommand function is required')

  return {
    async compose({ segments = [], outputRef, durationMs } = {}) {
      const output = clean(outputRef)
      if (!output) throw new TypeError('outputRef is required')
      if (!Array.isArray(segments) || segments.length === 0) {
        throw new TypeError('segments must contain at least one audio segment')
      }

      const inputs = []
      const filters = []
      const labels = []
      for (const [index, segment] of segments.entries()) {
        const audioRef = clean(segment?.outputRef || segment?.audioRef)
        const startMs = Number(segment?.startMs)
        if (!audioRef) throw new TypeError(`segments[${index}].audioRef is required`)
        if (!Number.isFinite(startMs) || startMs < 0) {
          throw new TypeError(`segments[${index}].startMs is invalid`)
        }
        inputs.push('-i', audioRef)
        const label = `seg${index}`
        filters.push(`[${index}:a]adelay=${Math.round(startMs)}|${Math.round(startMs)},apad[${label}]`)
        labels.push(`[${label}]`)
      }
      const mix = `${labels.join('')}amix=inputs=${segments.length}:duration=longest:dropout_transition=0`
      const filterComplex = `${filters.join(';')};${mix}${Number.isFinite(Number(durationMs)) && Number(durationMs) > 0 ? `,atrim=duration=${(Number(durationMs) / 1_000).toFixed(6)}` : ''}[aout]`
      await runCommand(ffmpegPath, [
        '-y', ...inputs,
        '-filter_complex', filterComplex,
        '-map', '[aout]',
        '-c:a', 'pcm_s16le',
        output,
      ])
      return {
        artifactId: 'dubbed_audio',
        kind: 'audio.timeline',
        outputRef: output,
        durationMs: Number.isFinite(Number(durationMs)) && Number(durationMs) > 0
          ? Number(durationMs)
          : Math.max(...segments.map(segment => Number(segment.endMs) || 0)),
      }
    },
  }
}
