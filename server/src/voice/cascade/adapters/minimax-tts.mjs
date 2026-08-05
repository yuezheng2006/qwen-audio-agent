/**
 * MiniMax T2A v2 TTS adapter (SSE hex PCM).
 *
 * Opt in with:
 *   CASCADE_TTS_PROVIDER=minimax
 *   MINIMAX_API_KEY=...
 *   CASCADE_TTS_VOICE_ID=<voice_id>   # or MINIMAX_VOICE_ID
 *   CASCADE_TTS_MODEL=speech-02-turbo
 *
 * Same sentence-gated shape as Fish: each sendText() kicks one SSE request
 * and streams PCM16 chunks through onAudio.
 */

const DEFAULT_BASE_URL = 'https://api.minimaxi.com'
const DEFAULT_MODEL = 'speech-02-turbo'
const PUNCT_ONLY = new Set(
  [...'。！？；!?;，,、…~～—-·.\"\'“”‘’（）()[]【】 \t\n'],
)

export function normalizeMinimaxProvider(raw) {
  const key = String(raw || '').trim().toLowerCase()
  if (key === 'minimax' || key === 'minimaxi') return 'minimax'
  return null
}

export function isSpeakableMinimaxText(text) {
  const value = String(text || '').trim()
  if (!value) return false
  return [...value].some(ch => !PUNCT_ONLY.has(ch))
}

function alignEvenPcm(carry, chunk) {
  const data = Buffer.concat([carry, Buffer.from(chunk)])
  if (data.length % 2 === 0) return { pcm: data, carry: Buffer.alloc(0) }
  return { pcm: data.subarray(0, data.length - 1), carry: data.subarray(-1) }
}

export class MinimaxSynthesizer {
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
    this.voiceId = String(tts.voice || '').trim()
    this.model = String(tts.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL
    this.sampleRate = Number(tts.sampleRate) || 24000
    this.languageBoost = String(tts.minimaxLanguageBoost || 'Chinese').trim() || 'Chinese'
    this.baseUrl = String(
      tts.minimaxBaseUrl || DEFAULT_BASE_URL,
    ).replace(/\/+$/, '')
    this.queue = Promise.resolve()
    this.failure = null
    this.abortController = null
  }

  async start() {
    if (this.aborted) return
    if (!this.apiKey) {
      throw new Error('MiniMax TTS 需要 MINIMAX_API_KEY 或 CASCADE_TTS_API_KEY')
    }
    if (!this.voiceId) {
      throw new Error(
        'MiniMax TTS 需要 CASCADE_TTS_VOICE_ID / MINIMAX_VOICE_ID（voice_id）',
      )
    }
    this.abortController = new AbortController()
    this.started = true
  }

  sendText(text) {
    const value = String(text || '').trim()
    if (this.aborted || !isSpeakableMinimaxText(value)) return
    this.queue = this.queue.then(() => this.#synthesize(value)).catch(error => {
      this.failure = this.failure || error
    })
  }

  async finish({ timeoutMs = 60_000 } = {}) {
    if (this.aborted) return
    const timeout = new Promise((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`MiniMax TTS timed out after ${timeoutMs}ms`)),
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
    if (this.aborted || !isSpeakableMinimaxText(text)) return

    const body = JSON.stringify({
      model: this.model,
      text,
      stream: true,
      stream_options: { exclude_aggregated_audio: true },
      voice_setting: {
        voice_id: this.voiceId,
        speed: 1,
        vol: 1,
        pitch: 0,
      },
      audio_setting: {
        sample_rate: this.sampleRate,
        bitrate: 128000,
        format: 'pcm',
        channel: 1,
      },
      language_boost: this.languageBoost,
    })
    const response = await this.#fetchWithRetry(`${this.baseUrl}/v1/t2a_v2`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body,
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(
        `MiniMax TTS failed (${response.status}): ${detail.slice(0, 200)}`,
      )
    }

    let carry = Buffer.alloc(0)
    let total = 0
    const emitHex = hex => {
      if (!hex || this.aborted) return
      const pcmChunk = Buffer.from(String(hex), 'hex')
      if (!pcmChunk.length) return
      const aligned = alignEvenPcm(carry, pcmChunk)
      carry = aligned.carry
      if (!aligned.pcm.length) return
      total += aligned.pcm.length
      this.onAudio?.(aligned.pcm)
    }

    for await (const event of this.#iterateSse(response)) {
      if (this.aborted) return
      const base = event?.base_resp
      if (base && Number(base.status_code) !== 0) {
        throw new Error(
          `MiniMax TTS error (${base.status_code}): ${base.status_msg || ''}`.trim(),
        )
      }
      const audioHex = event?.data?.audio
      if (audioHex) emitHex(audioHex)
      if (Number(event?.data?.status) === 2) break
    }

    if (!this.aborted && total === 0) {
      throw new Error('MiniMax TTS returned empty PCM stream')
    }
  }

  async *#iterateSse(response) {
    if (response.body?.getReader) {
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (!this.aborted) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        buffer = buffer.replace(/\r\n/g, '\n')
        let idx
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 1)
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (!payload || payload === '[DONE]') continue
          try {
            yield JSON.parse(payload)
          } catch {
            throw new Error(`MiniMax TTS invalid SSE JSON: ${payload.slice(0, 120)}`)
          }
        }
      }
      return
    }

    // Fallback for fetch mocks without ReadableStream.
    const text = await response.text()
    for (const rawLine of text.replace(/\r\n/g, '\n').split('\n')) {
      if (!rawLine.startsWith('data:')) continue
      const payload = rawLine.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      yield JSON.parse(payload)
    }
  }

  async #fetchWithRetry(url, options, {
    attempts = 3,
    timeoutMs = 30_000,
  } = {}) {
    let lastError
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (this.aborted) throw lastError || new Error('MiniMax TTS aborted')
      const controller = new AbortController()
      const onAbort = () => controller.abort()
      this.abortController?.signal?.addEventListener('abort', onAbort, { once: true })
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      timer.unref?.()
      try {
        return await this.fetchImpl(url, {
          ...options,
          signal: controller.signal,
        })
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
              ? `MiniMax TTS timed out/aborted after ${timeoutMs}ms`
              : `MiniMax TTS network error: ${message}`,
          )
        }
        await sleep(250 * attempt)
      } finally {
        clearTimeout(timer)
        this.abortController?.signal?.removeEventListener('abort', onAbort)
      }
    }
    throw lastError || new Error('MiniMax TTS network error')
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function createMinimaxSynthesizer(cascadeConfig, handlers) {
  return new MinimaxSynthesizer(cascadeConfig, handlers)
}
