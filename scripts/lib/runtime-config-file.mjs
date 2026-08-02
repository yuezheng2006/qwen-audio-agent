import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { userConfigDirectory } from '../../shared/runtime-environment.mjs'
import { resolveGatewayMode, resolveGatewayModeEnv } from './gateway-mode.mjs'

export function resolveUserConfigPath(env = process.env) {
  if (env.QWAUDIO_CONFIG_DIR) {
    return resolve(env.QWAUDIO_CONFIG_DIR, 'config.env')
  }
  return resolve(userConfigDirectory(env, homedir()), 'config.env')
}

export function upsertEnvFile(filePath, updates) {
  const existing = existsSync(filePath)
    ? readFileSync(filePath, 'utf8')
    : ''
  const lines = existing ? existing.split(/\r?\n/) : []
  const keys = new Set(Object.keys(updates))
  const seen = new Set()
  const next = lines.map(line => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/)
    if (!match) return line
    const key = match[1]
    if (!keys.has(key)) return line
    seen.add(key)
    return `${key}=${updates[key] ?? ''}`
  })
  for (const key of keys) {
    if (!seen.has(key)) next.push(`${key}=${updates[key] ?? ''}`)
  }
  const body = `${next.filter((line, index, arr) => !(
    line === '' && arr[index - 1] === ''
  )).join('\n').replace(/\n*$/, '')}\n`
  writeFileSync(filePath, body, { encoding: 'utf8', mode: 0o600 })
  return filePath
}

export function readEnvFile(filePath) {
  if (!existsSync(filePath)) return {}
  const out = {}
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue
    out[match[1]] = match[2]
  }
  return out
}

function normalizeTtsProvider(raw) {
  const key = String(raw || '').trim().toLowerCase()
  if (key === 'fish' || key === 'fishaudio' || key === 'fish-audio') return 'fish'
  return key
}

/** Alternate cascade TTS backends keep their model/voice across mode flips. */
function isAlternateCascadeTts(provider) {
  return provider === 'fish' || provider === 'voicebox'
}

export function persistGatewayMode(modeOrAlias, {
  configPath = resolveUserConfigPath(),
  env = process.env,
} = {}) {
  const mode = resolveGatewayMode(modeOrAlias)
  const modeEnv = resolveGatewayModeEnv(mode, env)
  const fileEnv = readEnvFile(configPath)
  const updates = {
    QWEN_AUDIO_REALTIME_PROVIDER: modeEnv.QWEN_AUDIO_REALTIME_PROVIDER,
  }
  if (mode === 's2s') {
    updates.QWEN_AUDIO_REALTIME_VOICE = modeEnv.QWEN_AUDIO_REALTIME_VOICE
  } else {
    updates.CASCADE_STT_MODEL = (
      env.CASCADE_STT_MODEL
      || fileEnv.CASCADE_STT_MODEL
      || 'qwen-audio-3.0-asr-flash-streaming'
    )
    const provider = normalizeTtsProvider(
      env.CASCADE_TTS_PROVIDER || fileEnv.CASCADE_TTS_PROVIDER || 'dashscope',
    )
    if (isAlternateCascadeTts(provider)) {
      // Keep Fish / VoiceBox testing setup; do not force Qwen fengge defaults.
      updates.CASCADE_TTS_PROVIDER = provider
      const model = env.CASCADE_TTS_MODEL || fileEnv.CASCADE_TTS_MODEL
        || (provider === 'fish'
          ? (env.FISH_TTS_MODEL || fileEnv.FISH_TTS_MODEL || 's2.1-pro-free')
          : undefined)
      const voice = env.CASCADE_TTS_VOICE_ID
        || fileEnv.CASCADE_TTS_VOICE_ID
        || env.FISH_REFERENCE_ID
        || fileEnv.FISH_REFERENCE_ID
      if (model) updates.CASCADE_TTS_MODEL = model
      if (voice) updates.CASCADE_TTS_VOICE_ID = voice
    } else {
      updates.CASCADE_TTS_PROVIDER = 'dashscope'
      updates.CASCADE_TTS_MODEL = modeEnv.CASCADE_TTS_MODEL
      updates.CASCADE_TTS_VOICE_ID = modeEnv.CASCADE_TTS_VOICE_ID
    }
  }
  upsertEnvFile(configPath, updates)
  return { mode, configPath, updates }
}
