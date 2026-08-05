/**
 * ListenHub (MarsWave) FlowTTS adapter.
 *
 * Opt in with:
 *   CASCADE_TTS_PROVIDER=listenhub
 *   LISTENHUB_API_KEY=...
 *   CASCADE_TTS_VOICE_ID=<speaker_id>   # or LISTENHUB_SPEAKER_ID
 *   CASCADE_TTS_MODEL=flowtts
 *
 * API often returns MP3 even when pcm is requested; we decode to PCM16@24k
 * via ffmpeg (injectable for tests).
 */

import { spawn } from 'node:child_process'

const DEFAULT_BASE_URL = 'https://api.marswave.ai'
const DEFAULT_MODEL = 'flowtts'
const PUNCT_ONLY = new Set(
  [...'。！？；!?;，,、…~～—-·.\"\'“”‘’（）()[]【】 \t\n'],
)

export function normalizeListenHubProvider(raw) {
  const key = String(raw || '').trim().toLowerCase()
  if (
    key === 'listenhub'
    || key === 'listen-hub'
    || key === 'marswave'
    || key === 'flowtts'
  ) return 'listenhub'
  return null
}

export function isSpeakableListenHubText(text) {
  const value = String(text || '').trim()
  if (!value) return false
  return [...value].some(ch => !PUNCT_ONLY.has(ch))
}

export function decodeMp3ToPcm16(mp3Buffer, sampleRate = 24000, {
  ffmpegPath = 'ffmpeg',
} = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      'pipe:0',
      '-f',
      's16le',
      '-acodec',
      'pcm_s16le',
      '-ac',
      '1',
      '-ar',
      String(sampleRate),
      'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] })
    const chunks = []
    let stderr = ''
    proc.stdout.on('data', chunk => chunks.push(chunk))
    proc.stderr.on('data', chunk => {
      stderr += String(chunk)
    })
    proc.on('error', error => {
      reject(new Error(`ListenHub TTS ffmpeg spawn failed: ${error.message}`))
    })
    proc.on('close', code => {
      if (code !== 0) {
        reject(new Error(
          `ListenHub TTS ffmpeg decode failed (${code}): ${stderr.slice(0, 200)}`,
        ))
        return
      }
      resolve(Buffer.concat(chunks))
    })
    proc.stdin.on('error', () => {
      // stdin may close early when ffmpeg rejects invalid input.
    })
    proc.stdin.end(Buffer.from(mp3Buffer))
  })
}

export class ListenHubSynthesizer {
  constructor(cascadeConfig, {
    onAudio,
    fetchImpl = globalThis.fetch,
    decodeMp3 = decodeMp3ToPcm16,
  } = {}) {
    const { tts } = cascadeConfig
    this.onAudio = onAudio
    this.fetchImpl = fetchImpl
    this.decodeMp3 = decodeMp3
    this.aborted = false
    this.started = false
    this.apiKey = String(tts.apiKey || '').trim()
    this.speakerId = String(tts.voice || '').trim()
    this.model = String(tts.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL
    this.sampleRate = Number(tts.sampleRate) || 24000
    this.baseUrl = String(
      tts.listenhubBaseUrl || DEFAULT_BASE_URL,
    ).replace(/\/+$/, '')
    this.queue = Promise.resolve()
    this.failure = null
    this.abortController = null
  }

  async start() {
    if (this.aborted) return
    if (!this.apiKey) {
      throw new Error('ListenHub TTS 需要 LISTENHUB_API_KEY 或 CASCADE_TTS_API_KEY')
    }
    if (!this.speakerId) {
      throw new Error(
        'ListenHub TTS 需要 CASCADE_TTS_VOICE_ID / LISTENHUB_SPEAKER_ID（speaker_id）',
      )
    }
    this.abortController = new AbortController()
    this.started = true
  }

  sendText(text) {
    const value = String(text || '').trim()
    if (this.aborted || !isSpeakableListenHubText(value)) return
    this.queue = this.queue.then(() => this.#synthesize(value)).catch(error => {
      this.failure = this.failure || error
    })
  }

  async finish({ timeoutMs = 60_000 } = {}) {
    if (this.aborted) return
    const timeout = new Promise((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`ListenHub TTS timed out after ${timeoutMs}ms`)),
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
    if (this.aborted || !isSpeakableListenHubText(text)) return

    const body = JSON.stringify({
      input: text,
      voice: this.speakerId,
      response_format: 'mp3',
      model: this.model,
    })
    const response = await this.#fetchWithRetry(
      `${this.baseUrl}/openapi/v1/tts`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body,
      },
    )

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(
        `ListenHub TTS failed (${response.status}): ${detail.slice(0, 200)}`,
      )
    }
    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      const detail = await response.text().catch(() => '')
      throw new Error(`ListenHub TTS error: ${detail.slice(0, 200)}`)
    }

    const mp3 = Buffer.from(await response.arrayBuffer())
    if (!mp3.length) throw new Error('ListenHub TTS returned empty audio')
    if (this.aborted) return

    const pcm = await this.decodeMp3(mp3, this.sampleRate)
    if (this.aborted) return
    if (!pcm?.length) throw new Error('ListenHub TTS decoded empty PCM')
    // Push in ~50ms frames so barge-in can cut mid-utterance.
    const frameBytes = Math.max(2, Math.floor(this.sampleRate * 0.05) * 2)
    for (let offset = 0; offset < pcm.length && !this.aborted; offset += frameBytes) {
      this.onAudio?.(pcm.subarray(offset, Math.min(offset + frameBytes, pcm.length)))
    }
  }

  async #fetchWithRetry(url, options, {
    attempts = 3,
    timeoutMs = 30_000,
  } = {}) {
    let lastError
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (this.aborted) throw lastError || new Error('ListenHub TTS aborted')
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
              ? `ListenHub TTS timed out/aborted after ${timeoutMs}ms`
              : `ListenHub TTS network error: ${message}`,
          )
        }
        await sleep(250 * attempt)
      } finally {
        clearTimeout(timer)
        this.abortController?.signal?.removeEventListener('abort', onAbort)
      }
    }
    throw lastError || new Error('ListenHub TTS network error')
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function createListenHubSynthesizer(cascadeConfig, handlers) {
  return new ListenHubSynthesizer(cascadeConfig, handlers)
}
