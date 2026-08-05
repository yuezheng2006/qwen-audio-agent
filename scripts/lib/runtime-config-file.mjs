import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import {
  resolveCascadeTtsProviderId,
  resolvePreservedCascadeTtsEnv,
} from '../../shared/cascade-tts-plugins.mjs'
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
    const provider = resolveCascadeTtsProviderId(
      env.CASCADE_TTS_PROVIDER || fileEnv.CASCADE_TTS_PROVIDER || 'dashscope',
    )
    const preserved = resolvePreservedCascadeTtsEnv(provider, {
      ...fileEnv,
      ...env,
    })
    if (preserved) {
      Object.assign(updates, preserved)
    } else {
      updates.CASCADE_TTS_PROVIDER = 'dashscope'
      updates.CASCADE_TTS_MODEL = modeEnv.CASCADE_TTS_MODEL
      updates.CASCADE_TTS_VOICE_ID = modeEnv.CASCADE_TTS_VOICE_ID
    }
  }
  upsertEnvFile(configPath, updates)
  return { mode, configPath, updates }
}
