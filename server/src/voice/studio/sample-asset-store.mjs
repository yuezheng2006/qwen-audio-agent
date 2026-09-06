import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

const AUDIO_TYPES = new Map([
  ['audio/wav', { extension: 'wav' }],
  ['audio/x-wav', { extension: 'wav' }],
  ['audio/webm', { extension: 'webm' }],
  ['audio/mp4', { extension: 'm4a' }],
  ['audio/mpeg', { extension: 'mp3' }],
  ['audio/ogg', { extension: 'ogg' }],
])

function parseAudioDataUrl(value) {
  const match = String(value || '').trim().match(
    /^data:(audio\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i,
  )
  if (!match) return null
  const mime = match[1].toLowerCase()
  const type = AUDIO_TYPES.get(mime)
  if (!type) return null
  return {
    mime,
    extension: type.extension,
    bytes: Buffer.from(match[2], 'base64'),
  }
}

function normalizedBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

export function createSampleAssetStore({
  directory,
  publicBaseUrl = '',
  maxBytes = 10 * 1024 * 1024,
} = {}) {
  const dir = String(directory || '').trim()
  const baseUrl = normalizedBaseUrl(publicBaseUrl)
  if (!dir) throw new Error('sample asset directory is required')
  mkdirSync(dir, { recursive: true, mode: 0o700 })

  function materialize(dataUrl) {
    const parsed = parseAudioDataUrl(dataUrl)
    if (!parsed) {
      const error = new Error('录音样本必须是受支持的 base64 音频。')
      error.normalized = {
        error_code: 'sample_invalid',
        user_message: error.message,
        retryable: false,
      }
      throw error
    }
    if (parsed.bytes.length > maxBytes) {
      const error = new Error('录音样本不能超过 10 MB。')
      error.normalized = {
        error_code: 'sample_too_large',
        user_message: error.message,
        retryable: false,
      }
      throw error
    }
    if (!baseUrl) {
      const error = new Error('当前 provider 需要公网可访问的音频地址，请配置 VOICE_SAMPLE_PUBLIC_BASE_URL。')
      error.normalized = {
        error_code: 'sample_public_url_required',
        user_message: error.message,
        retryable: false,
      }
      throw error
    }
    const token = randomUUID()
    const filename = `${token}.${parsed.extension}`
    const path = join(dir, filename)
    writeFileSync(path, parsed.bytes, { mode: 0o600 })
    return {
      token,
      path,
      mime: parsed.mime,
      publicUrl: `${baseUrl}/api/voice/samples/${token}`,
    }
  }

  function read(token) {
    const normalized = String(token || '').trim()
    if (!/^[0-9a-f-]{36}$/i.test(normalized)) return null
    for (const [mime, { extension }] of AUDIO_TYPES.entries()) {
      const path = join(dir, `${normalized}.${extension}`)
      if (existsSync(path)) return { path, mime, bytes: readFileSync(path) }
    }
    return null
  }

  return {
    enabled: Boolean(baseUrl),
    materialize,
    read,
  }
}
