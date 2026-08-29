import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

function safePreviewId(profileId) {
  const id = String(profileId || '').trim()
  if (!id) return ''
  return id.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120)
}

export function createPreviewCache({ dir } = {}) {
  if (!dir) throw new Error('preview cache dir is required')
  const previewsDir = join(dir, 'previews')
  mkdirSync(previewsDir, { recursive: true, mode: 0o700 })

  function pathFor(profileId) {
    const id = safePreviewId(profileId)
    if (!id) return null
    return join(previewsDir, `${id}.wav`)
  }

  return {
    previewsDir,
    pathFor,
    has(profileId) {
      const file = pathFor(profileId)
      return Boolean(file && existsSync(file))
    },
    read(profileId) {
      const file = pathFor(profileId)
      if (!file || !existsSync(file)) return null
      return readFileSync(file)
    },
    write(profileId, wav) {
      const file = pathFor(profileId)
      if (!file) {
        const error = new Error('无效的 profile_id')
        error.code = 'preview_invalid'
        throw error
      }
      const data = Buffer.isBuffer(wav) ? wav : Buffer.from(wav)
      writeFileSync(file, data, { mode: 0o600 })
      return file
    },
  }
}

export function withPreviewFlag(profile, previewCache) {
  if (!profile) return profile
  const id = profile.id
  const ready = Boolean(previewCache?.has?.(id))
  return {
    ...profile,
    has_preview: ready,
    preview_url: ready ? `api/voice/profiles/${encodeURIComponent(id)}/preview` : null,
  }
}
