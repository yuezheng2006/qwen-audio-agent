import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

function clean(value, fallback = '') {
  return String(value || '').replaceAll('\u0000', '').trim() || fallback
}

function requiredPath(value, field) {
  const path = clean(value)
  if (!path) throw new TypeError(`Media ${field} is required`)
  return path
}

function commandError(command, error) {
  const detail = clean(error?.stderr || error?.message, 'unknown error')
  return new Error(`${command} failed: ${detail.slice(0, 500)}`, { cause: error })
}

export function createMediaFfmpegAdapter({
  ffmpegPath = 'ffmpeg',
  ffprobePath = 'ffprobe',
  runCommand = (command, args, options) => execFileAsync(command, args, options),
} = {}) {
  return {
    async inspect(sourceRef) {
      const source = requiredPath(sourceRef, 'sourceRef')
      try {
        const result = await runCommand(ffprobePath, [
          '-v', 'error',
          '-print_format', 'json',
          '-show_format',
          '-show_streams',
          source,
        ])
        let metadata
        try {
          metadata = JSON.parse(result.stdout || '{}')
        } catch (error) {
          throw new Error('ffprobe returned invalid JSON', { cause: error })
        }
        return {
          artifactId: 'media_info',
          kind: 'media.info',
          sourceRef: source,
          format: metadata.format || null,
          streams: Array.isArray(metadata.streams) ? metadata.streams : [],
        }
      } catch (error) {
        throw commandError('ffprobe', error)
      }
    },

    async extractAudio(sourceRef, outputRef, { sampleRate = 16_000 } = {}) {
      const source = requiredPath(sourceRef, 'sourceRef')
      const output = requiredPath(outputRef, 'outputRef')
      const rate = Number(sampleRate)
      if (!Number.isInteger(rate) || rate < 8_000 || rate > 192_000) {
        throw new RangeError('Media sampleRate must be an integer between 8000 and 192000')
      }
      try {
        await runCommand(ffmpegPath, [
          '-y', '-i', source,
          '-vn', '-ac', '1', '-ar', String(rate),
          '-c:a', 'pcm_s16le',
          output,
        ])
        return {
          artifactId: 'source_audio',
          kind: 'audio.extracted',
          sourceRef: source,
          outputRef: output,
          sampleRate: rate,
          channels: 1,
          format: 'wav',
        }
      } catch (error) {
        throw commandError('ffmpeg', error)
      }
    },
  }
}
