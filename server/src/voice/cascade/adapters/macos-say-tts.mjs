import { randomUUID } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const defaultRunCommand = promisify(execFile)

/**
 * macOS system speech adapter.
 *
 * This is a local fallback for validating the media pipeline when a neural
 * local TTS sidecar is unavailable. It is deliberately a plugin: the MediaJob
 * and platform layers do not depend on macOS or the `say` command.
 */
export class MacOsSaySynthesizer {
  constructor(cascadeConfig, { onAudio, runCommand = defaultRunCommand } = {}) {
    this.onAudio = onAudio
    this.runCommand = runCommand
    this.voice = cascadeConfig?.tts?.voice || 'Ting-Ting'
    this.sampleRate = Number(cascadeConfig?.tts?.sampleRate) || 24_000
    this.pending = []
    this.aborted = false
  }

  async start() {
    if (process.platform !== 'darwin') {
      throw new Error('macOS system TTS 仅支持 macOS；请安装其他本地 TTS 插件')
    }
  }

  sendText(text) {
    const value = String(text || '').trim()
    if (!this.aborted && value) this.pending.push(value)
  }

  async finish() {
    if (this.aborted) return
    const text = this.pending.splice(0).join('')
    if (!text) return
    const output = join(tmpdir(), `qwaudio-say-${randomUUID()}.aiff`)
    try {
      await this.runCommand('/usr/bin/say', ['-v', this.voice, '-o', output, text])
      const result = await this.runCommand(
        process.env.FFMPEG_BIN || 'ffmpeg',
        ['-hide_banner', '-loglevel', 'error', '-i', output, '-f', 's16le', '-ac', '1', '-ar', String(this.sampleRate), 'pipe:1'],
        { maxBuffer: 16 * 1024 * 1024 },
      )
      const pcm = Buffer.from(result.stdout || '')
      if (!pcm.length) throw new Error('macOS system TTS 没有产生音频')
      if (!this.aborted) this.onAudio?.(pcm)
    } finally {
      await unlink(output).catch(() => {})
    }
  }

  abort() {
    this.aborted = true
    this.pending = []
  }
}

export function createMacOsSaySynthesizer(cascadeConfig, handlers) {
  return new MacOsSaySynthesizer(cascadeConfig, handlers)
}
