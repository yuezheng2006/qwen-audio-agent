/**
 * Fish Audio TTS adapter (S2.1 / S2 / S1).
 *
 * Default cascade path stays DashScope Qwen-Audio-TTS.
 * Opt in with:
 *   CASCADE_TTS_PROVIDER=fish
 *   FISH_API_KEY=...
 *   CASCADE_TTS_VOICE_ID=<reference_id>   # or FISH_REFERENCE_ID
 *   CASCADE_TTS_MODEL=s2.1-pro-free       # or s2.1-pro / s2-pro / s1
 *
 * Uses HTTP streaming PCM (`format=pcm`) so sentence chunks can start
 * playing before the whole utterance finishes — same shape as the
 * talk-to-fengge Python FishTTS worker.
 */

const DEFAULT_BASE_URL = 'https://api.fish.audio'
const DEFAULT_MODEL = 's2.1-pro-free'
const PUNCT_ONLY = new Set(
  [...'。！？；!?;，,、…~～—-·.\"\'“”‘’（）()[]【】 \t\n'],
)

export function normalizeFishProvider(raw) {
  const key = String(raw || '').trim().toLowerCase()
  if (key === 'fish' || key === 'fishaudio' || key === 'fish-audio') return 'fish'
  return null
}

export function isSpeakableFishText(text) {
  const value = String(text || '').trim()
  if (!value) return false
  return [...value].some(ch => !PUNCT_ONLY.has(ch))
}

function alignEvenPcm(carry, chunk) {
  const data = Buffer.concat([carry, Buffer.from(chunk)])
  if (data.length % 2 === 0) return { pcm: data, carry: Buffer.alloc(0) }
  return { pcm: data.subarray(0, data.length - 1), carry: data.subarray(-1) }
}

export class FishAudioSynthesizer {
  constructor(cascadeConfig, {
    onAudio,
    fetchImpl = globalThis.fetch,
  } = {}) {
    const { tts } = cascadeConfig
    this.onAudio = onAudio
    this.fetchImpl = fetchImpl
    this.aborted = false
    this.started = false
    this.apiKey = String(tts.apiKey || '').trim()
    this.referenceId = String(tts.voice || '').trim()
    this.model = String(tts.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL
    this.sampleRate = Number(tts.sampleRate) || 24000
    this.latency = String(tts.fishLatency || 'balanced').trim() || 'balanced'
    this.baseUrl = String(
      tts.fishBaseUrl || DEFAULT_BASE_URL,
    ).replace(/\/+$/, '')
    this.queue = Promise.resolve()
    this.failure = null
    this.abortController = null
  }

  async start() {
    if (this.aborted) return
    if (!this.apiKey) {
      throw new Error('Fish Audio TTS 需要 FISH_API_KEY 或 CASCADE_TTS_API_KEY')
    }
    if (!this.referenceId) {
      throw new Error(
        'Fish Audio TTS 需要 CASCADE_TTS_VOICE_ID / FISH_REFERENCE_ID（reference_id）',
      )
    }
    this.abortController = new AbortController()
    this.started = true
  }

  sendText(text) {
    const value = String(text || '').trim()
    if (this.aborted || !isSpeakableFishText(value)) return
    // Kick synthesis per sentence so cascade sentence gating keeps TTFB low.
    this.queue = this.queue.then(() => this.#synthesize(value)).catch(error => {
      this.failure = this.failure || error
    })
  }

  async finish({ timeoutMs = 60_000 } = {}) {
    if (this.aborted) return
    const timeout = new Promise((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Fish Audio TTS timed out after ${timeoutMs}ms`)),
        timeoutMs,
      )
      timer.unref?.()
    })
    await Promise.race([this.queue, timeout])
    if (this.failure && !this.aborted) throw this.failure
  }

  abort() {
    this.aborted = true
    this.abortController?.abort()
  }

  async #synthesize(text) {
    if (this.aborted || !isSpeakableFishText(text)) return

    const body = JSON.stringify({
      text,
      reference_id: this.referenceId,
      format: 'pcm',
      sample_rate: this.sampleRate,
      latency: this.latency,
    })
    const response = await this.#fetchWithRetry(`${this.baseUrl}/v1/tts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        model: this.model,
      },
      body,
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(
        `Fish Audio TTS failed (${response.status}): ${detail.slice(0, 200)}`,
      )
    }
    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      const detail = await response.text().catch(() => '')
      throw new Error(`Fish Audio TTS error: ${detail.slice(0, 200)}`)
    }

    if (response.body?.getReader) {
      const reader = response.body.getReader()
      let carry = Buffer.alloc(0)
      let total = 0
      while (!this.aborted) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value?.length) continue
        const aligned = alignEvenPcm(carry, value)
        carry = aligned.carry
        if (!aligned.pcm.length) continue
        total += aligned.pcm.length
        this.onAudio?.(aligned.pcm)
      }
      if (!this.aborted && total === 0) {
        throw new Error('Fish Audio TTS returned empty PCM stream')
      }
      return
    }

    // Fallback for fetch mocks / environments without ReadableStream.
    const buffer = Buffer.from(await response.arrayBuffer())
    if (!this.aborted && buffer.length) {
      const aligned = alignEvenPcm(Buffer.alloc(0), buffer)
      if (aligned.pcm.length) this.onAudio?.(aligned.pcm)
    }
  }

  async #fetchWithRetry(url, options, {
    attempts = 3,
    timeoutMs = 25_000,
  } = {}) {
    let lastError
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (this.aborted) throw lastError || new Error('Fish Audio TTS aborted')
      const controller = new AbortController()
      const onAbort = () => controller.abort()
      this.abortController?.signal?.addEventListener('abort', onAbort, { once: true })
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      timer.unref?.()
      try {
        const response = await this.fetchImpl(url, {
          ...options,
          signal: controller.signal,
        })
        return response
      } catch (error) {
        lastError = error
        const message = String(error?.message || error)
        const retryable = (
          /fetch failed|network|ECONNRESET|ECONNREFUSED|ETIMEDOUT|SSL|abort/i.test(message)
          && attempt < attempts
          && !this.aborted
        )
        if (!retryable) {
          throw new Error(
            message.includes('abort')
              ? `Fish Audio TTS timed out/aborted after ${timeoutMs}ms`
              : `Fish Audio TTS network error: ${message}`,
          )
        }
        await sleep(250 * attempt)
      } finally {
        clearTimeout(timer)
        this.abortController?.signal?.removeEventListener('abort', onAbort)
      }
    }
    throw lastError || new Error('Fish Audio TTS network error')
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function createFishAudioSynthesizer(cascadeConfig, handlers) {
  return new FishAudioSynthesizer(cascadeConfig, handlers)
}
