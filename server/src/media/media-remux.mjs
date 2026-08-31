function clean(value, fallback = '') {
  return String(value || '').trim() || fallback
}

export function createMediaRemuxAdapter({
  ffmpegPath = 'ffmpeg',
  runCommand,
} = {}) {
  if (typeof runCommand !== 'function') throw new TypeError('runCommand function is required')
  return {
    async remux({ videoRef, audioRef, outputRef, durationMs } = {}) {
      const video = clean(videoRef)
      const audio = clean(audioRef)
      const output = clean(outputRef)
      if (!video) throw new TypeError('videoRef is required')
      if (!audio) throw new TypeError('audioRef is required')
      if (!output) throw new TypeError('outputRef is required')
      const args = [
        '-y', '-i', video, '-i', audio,
        '-map', '0:v:0', '-map', '1:a:0',
        '-c:v', 'copy', '-c:a', 'aac',
        ...(Number.isFinite(Number(durationMs)) && Number(durationMs) > 0
          ? ['-t', (Number(durationMs) / 1_000).toFixed(6)]
          : ['-shortest']),
        output,
      ]
      await runCommand(ffmpegPath, args)
      return {
        artifactId: 'dubbed_video',
        kind: 'video.remuxed',
        videoRef: video,
        audioRef: audio,
        outputRef: output,
        ...(Number.isFinite(Number(durationMs)) && Number(durationMs) > 0
          ? { durationMs: Number(durationMs) }
          : {}),
      }
    },
  }
}
