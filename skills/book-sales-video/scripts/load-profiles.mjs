/**
 * Load Voice Studio profiles from ~/.config/qwaudio/voice-profiles (or VOICE_PROFILE_DIR).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function defaultVoiceProfileDir() {
  return process.env.VOICE_PROFILE_DIR
    || join(homedir(), '.config', 'qwaudio', 'voice-profiles')
}

export function loadAllProfiles(dir = defaultVoiceProfileDir()) {
  const root = String(dir || '').trim()
  if (!root || !existsSync(root)) return []
  const byId = new Map()
  let entries = []
  try {
    entries = readdirSync(root)
  } catch {
    return []
  }
  for (const name of entries) {
    if (!name.endsWith('.json')) continue
    const file = join(root, name)
    try {
      const payload = JSON.parse(readFileSync(file, 'utf8'))
      const rows = Array.isArray(payload.profiles) ? payload.profiles : []
      for (const row of rows) {
        if (!row?.id) continue
        if (!byId.has(row.id)) byId.set(row.id, row)
      }
    } catch {
      // skip corrupt owner files
    }
  }
  return [...byId.values()]
}

export function resolveDashScopeApiKey() {
  return String(
    process.env.CASCADE_TTS_API_KEY
    || process.env.DASHSCOPE_API_KEY
    || process.env.QWEN_AUDIO_REALTIME_API_KEY
    || '',
  ).trim()
}

export function resolveFallbackVoice() {
  return String(
    process.env.BOOK_SALES_FALLBACK_VOICE
    || process.env.CASCADE_TTS_VOICE
    || '',
  ).trim()
}

export function resolveTtsModel(profile) {
  return String(
    profile?.targetModel
    || profile?.target_model
    || process.env.CASCADE_TTS_MODEL
    || 'qwen-audio-3.0-tts-flash',
  ).trim() || 'qwen-audio-3.0-tts-flash'
}
