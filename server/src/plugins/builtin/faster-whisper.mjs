export const fasterWhisperPluginManifest = Object.freeze({
  id: 'qwaudio.stt.faster-whisper',
  version: '1.0.0',
  kind: 'stt',
  label: 'faster-whisper 本地识别',
  description: '通过本地 HTTP 服务调用 faster-whisper。',
  capabilities: ['stt.utterance'],
  platforms: ['server', 'macos', 'windows', 'linux'],
  permissions: ['network.loopback'],
})

function pcm16Wav(pcm, sampleRate = 16000, channels = 1) {
  const audio = Buffer.concat([Buffer.from(pcm)])
  const blockAlign = channels * 2
  const byteRate = sampleRate * blockAlign
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + audio.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(audio.length, 40)
  return Buffer.concat([header, audio])
}

function responseText(payload) {
  if (typeof payload === 'string') return payload.trim()
  return String(payload?.text || payload?.transcript || '').trim()
}

export class FasterWhisperRecognizer {
  constructor(cascadeConfig, { onPartial, fetchImpl = globalThis.fetch } = {}) {
    this.config = cascadeConfig
    this.onPartial = onPartial
    this.fetchImpl = fetchImpl
    this.audio = []
    this.controller = null
    this.aborted = false
    this.request = null
  }

  start() {
    const url = String(this.config?.stt?.url || '').trim()
    if (!url) throw new Error('faster-whisper 缺少 CASCADE_STT_URL')
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('faster-whisper 需要可用的 fetch 实现')
    }
    return Promise.resolve()
  }

  sendAudio(buffer) {
    if (this.aborted || !buffer?.length) return
    this.audio.push(Buffer.from(buffer))
  }

  async finish({ timeoutMs = 30000 } = {}) {
    if (this.aborted) return ''
    if (!this.audio.length) return ''
    const stt = this.config.stt
    const url = String(stt.url || '').trim()
    const sampleRate = Number(stt.sampleRate) || 16000
    this.controller = new AbortController()
    const timer = setTimeout(() => this.controller.abort(), timeoutMs)
    timer.unref?.()
    try {
      this.request = this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'audio/wav',
          ...(stt.apiKey ? { authorization: `Bearer ${stt.apiKey}` } : {}),
          ...(stt.model ? { 'x-model': stt.model } : {}),
        },
        body: pcm16Wav(Buffer.concat(this.audio), sampleRate),
        signal: this.controller.signal,
      })
      const response = await this.request
      if (!response.ok) {
        throw new Error(`faster-whisper 服务不可用（HTTP ${response.status}）`)
      }
      const payload = await response.json()
      const text = responseText(payload)
      this.onPartial?.(text)
      return text
    } catch (error) {
      if (this.aborted) return ''
      if (error?.name === 'AbortError') {
        throw new Error('faster-whisper 服务响应超时')
      }
      if (/faster-whisper 服务不可用/.test(String(error?.message || ''))) throw error
      throw new Error(`faster-whisper 服务不可用：${error?.message || error}`)
    } finally {
      clearTimeout(timer)
      this.request = null
      this.controller = null
    }
  }

  abort() {
    this.aborted = true
    this.controller?.abort()
    this.audio = []
  }
}

export function createFasterWhisperRecognizer(cascadeConfig, handlers) {
  return new FasterWhisperRecognizer(cascadeConfig, handlers)
}

export function createFasterWhisperPlugin() {
  return {
    manifest: fasterWhisperPluginManifest,
    activate({ registerSttProvider }) {
      registerSttProvider('faster-whisper', createFasterWhisperRecognizer)
    },
  }
}
