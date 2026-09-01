/**
 * VoiceBox TTS adapter seam.
 * Default cascade path stays DashScope; set CASCADE_TTS_PROVIDER=voicebox
 * and run a local VoiceBox (`VOICEBOX_BASE_URL`, default http://127.0.0.1:17493).
 *
 * VoiceBox speak APIs vary by version; this adapter posts JSON text and
 * expects raw PCM16 (or base64 PCM) back. Failures surface clearly so the
 * gateway can fall back or report unhealthy TTS.
 */

export class VoiceBoxSynthesizer {
  constructor(cascadeConfig, { onAudio, fetchImpl = globalThis.fetch } = {}) {
    const { tts } = cascadeConfig
    this.onAudio = onAudio
    this.fetchImpl = fetchImpl
    this.aborted = false
    this.baseUrl = String(
      tts.voiceboxBaseUrl
      || process.env.VOICEBOX_BASE_URL
      || 'http://127.0.0.1:17493',
    ).replace(/\/+$/, '')
    this.voice = tts.voice
    this.sampleRate = tts.sampleRate || 24000
    this.pending = []
    this.started = false
  }

  async start() {
    if (this.aborted) return
    // Soft health probe — do not fail start on probe errors; speak will.
    try {
      await this.fetchImpl(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(1500),
      })
    } catch {
      // VoiceBox may not expose /health; speak still attempted.
    }
    this.started = true
  }

  sendText(text) {
    const value = String(text || '').trim()
    if (this.aborted || !value) return
    this.pending.push(value)
  }

  async finish() {
    if (this.aborted) return
    const text = this.pending.splice(0).join('')
    if (!text) return
    const response = await this.fetchImpl(`${this.baseUrl}/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        profile: this.voice,
        sample_rate: this.sampleRate,
        format: 'pcm',
      }),
      signal: AbortSignal.timeout(120_000),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(
        `VoiceBox /speak failed (${response.status}): ${detail.slice(0, 200)}`,
      )
    }
    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      const payload = await response.json()
      const b64 = payload.audio || payload.pcm || payload.data
      if (b64) {
        const buffer = Buffer.from(b64, 'base64')
        if (!this.aborted) this.onAudio?.(buffer)
        return
      }
      const generationId = String(payload.id || '').trim()
      if (!generationId) throw new Error('VoiceBox JSON response missing audio or generation id')
      const completed = await this.waitForGeneration(generationId)
      if (completed.status !== 'completed') {
        throw new Error(`VoiceBox generation failed: ${completed.error || completed.status}`)
      }
      const audioResponse = await this.fetchImpl(`${this.baseUrl}/audio/${encodeURIComponent(generationId)}`, {
        signal: AbortSignal.timeout(120_000),
      })
      if (!audioResponse.ok) throw new Error(`VoiceBox audio download failed (${audioResponse.status})`)
      const buffer = Buffer.from(await audioResponse.arrayBuffer())
      if (!this.aborted) this.onAudio?.(buffer)
      return
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    if (!this.aborted && buffer.length) this.onAudio?.(buffer)
  }

  async waitForGeneration(generationId, { timeoutMs = 120_000 } = {}) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const response = await this.fetchImpl(`${this.baseUrl}/history/${encodeURIComponent(generationId)}`, {
        signal: AbortSignal.timeout(5_000),
      })
      if (response.ok) {
        const payload = await response.json()
        if (['completed', 'failed', 'cancelled'].includes(payload.status)) return payload
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    throw new Error('VoiceBox generation timed out')
  }

  abort() {
    this.aborted = true
    this.pending = []
  }
}

export function createVoiceBoxSynthesizer(cascadeConfig, handlers) {
  return new VoiceBoxSynthesizer(cascadeConfig, handlers)
}
