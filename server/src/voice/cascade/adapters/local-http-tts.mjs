/**
 * Provider-neutral local TTS sidecar adapter.
 *
 * FireRedTTS2 and Breeze-TTS-2 are local Python/MLX runtimes rather than
 * Node libraries. The Gateway talks to a tiny localhost sidecar contract so
 * model installation stays outside the agent process and remains portable.
 * The response may be raw PCM/WAV or JSON with base64 audio.
 */

function pcmFromWav(buffer) {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF') return buffer
  let offset = 12
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    if (id === 'data') return buffer.subarray(offset + 8, offset + 8 + size)
    offset += 8 + size + (size % 2)
  }
  return buffer
}

function decodeJsonAudio(payload) {
  const value = payload?.audio_base64
    || payload?.audio
    || payload?.pcm
    || payload?.data
  if (typeof value !== 'string' || !value.trim()) return null
  return pcmFromWav(Buffer.from(value, 'base64'))
}

export class LocalHttpTtsSynthesizer {
  constructor(cascadeConfig, {
    onAudio,
    fetchImpl = globalThis.fetch,
    provider = 'local-tts',
    baseUrlKey = 'localTtsBaseUrl',
    defaultBaseUrl = 'http://127.0.0.1:8787',
  } = {}) {
    const tts = cascadeConfig?.tts || {}
    this.onAudio = onAudio
    this.fetchImpl = fetchImpl
    this.provider = provider
    this.baseUrl = String(tts[baseUrlKey] || defaultBaseUrl).replace(/\/+$/, '')
    this.endpoint = `${this.baseUrl}/v1/tts`
    this.voice = String(tts.voice || '').trim()
    this.model = String(tts.model || '').trim()
    this.instruction = String(tts.instruction || '').trim()
    this.sampleRate = Number(tts.sampleRate) || 24000
    this.pending = []
    this.aborted = false
  }

  async start() {
    if (this.aborted) return
    if (typeof this.fetchImpl !== 'function') {
      throw new Error(`${this.provider} TTS 需要可用的 fetch 实现`)
    }
  }

  sendText(text) {
    const value = String(text || '').trim()
    if (!this.aborted && value) this.pending.push(value)
  }

  async finish({ timeoutMs = 120000 } = {}) {
    if (this.aborted) return
    const text = this.pending.splice(0).join('')
    if (!text) return
    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: this.provider,
        model: this.model,
        voice: this.voice,
        text,
        instruction: this.instruction,
        sample_rate: this.sampleRate,
        format: 'pcm_s16le',
        stream: false,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`${this.provider} TTS sidecar failed (${response.status}): ${detail.slice(0, 200)}`)
    }
    const contentType = response.headers.get('content-type') || ''
    const audio = contentType.includes('json')
      ? decodeJsonAudio(await response.json())
      : pcmFromWav(Buffer.from(await response.arrayBuffer()))
    if (!audio?.length) throw new Error(`${this.provider} TTS sidecar returned empty audio`)
    if (!this.aborted) this.onAudio?.(audio)
  }

  abort() {
    this.aborted = true
    this.pending = []
  }
}

export function createLocalHttpTtsSynthesizer(cascadeConfig, handlers, options) {
  return new LocalHttpTtsSynthesizer(cascadeConfig, { ...handlers, ...options })
}
