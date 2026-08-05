// Dual frontend paths for talk-to-fengge / qwen-audio-agent:
//
//   s2s      → DashScope Qwen-Audio-Realtime, system voice longanqian
//              (low latency; no custom clone)
//   cascade  → default product mode: 峰哥人格 + 峰哥记忆 + 峰哥音色
//              (VAD→STT→LLM→Qwen-Audio-TTS fengge clone)
//
// TTS supplier details stay in shared/cascade-tts-plugins.mjs.

import {
  cascadeTtsModeLabel,
  cascadeTtsVoiceDisplayName,
  resolveCascadeTtsProviderId,
  resolvePreservedCascadeTtsEnv,
} from '../../shared/cascade-tts-plugins.mjs'

export const FENGGE_QWEN_TTS_VOICE = (
  'qwen-audio-3.0-tts-flash-fenggetts-761e21428f3845c391d63b1288e3dca8'
)

const MODE_ALIASES = {
  s2s: 's2s',
  dashscope: 's2s',
  realtime: 's2s',
  cascade: 'cascade',
}

export function resolveGatewayMode(raw) {
  const key = String(raw ?? '').trim().toLowerCase()
  // Empty / omitted → cascade (likeness-first personal default).
  if (!key) return 'cascade'
  const mode = MODE_ALIASES[key]
  if (!mode) {
    throw new Error(
      `未知前台模式：${raw}。可用：cascade（默认）或 s2s（dashscope）`,
    )
  }
  return mode
}

export function voiceDisplayName(voiceId = '', { provider } = {}) {
  const id = String(voiceId || '')
  if (!id) return '未配置'
  if (!provider && (
    id === FENGGE_QWEN_TTS_VOICE
    || id.includes('fenggetts')
    || id.includes('fengge')
  )) {
    return '峰哥复刻'
  }
  return cascadeTtsVoiceDisplayName(id, { provider })
}

export function resolveGatewayModeEnv(modeOrAlias, overrides = {}) {
  const mode = resolveGatewayMode(modeOrAlias)
  if (mode === 's2s') {
    return {
      QWEN_AUDIO_REALTIME_PROVIDER: 'dashscope',
      QWEN_AUDIO_REALTIME_VOICE: 'longanqian',
    }
  }
  const provider = resolveCascadeTtsProviderId(
    overrides.CASCADE_TTS_PROVIDER || process.env.CASCADE_TTS_PROVIDER,
  )
  const preserved = resolvePreservedCascadeTtsEnv(provider, {
    ...process.env,
    ...overrides,
  })
  if (preserved) {
    return {
      QWEN_AUDIO_REALTIME_PROVIDER: 'cascade',
      ...preserved,
    }
  }
  const voice = (
    overrides.CASCADE_TTS_VOICE_ID
    || process.env.CASCADE_TTS_VOICE_ID
    || FENGGE_QWEN_TTS_VOICE
  )
  return {
    QWEN_AUDIO_REALTIME_PROVIDER: 'cascade',
    CASCADE_TTS_PROVIDER: 'dashscope',
    CASCADE_TTS_MODEL: 'qwen-audio-3.0-tts-flash',
    CASCADE_TTS_VOICE_ID: voice,
  }
}

export function describeGatewayMode(modeOrAlias, overrides = {}) {
  const mode = resolveGatewayMode(modeOrAlias)
  if (mode === 's2s') {
    return {
      mode,
      label: 'S2S（Qwen-Audio-Realtime）',
      voice: 'longanqian',
      provider: 'dashscope',
    }
  }
  const env = resolveGatewayModeEnv(mode, overrides)
  const ttsProvider = env.CASCADE_TTS_PROVIDER || 'dashscope'
  return {
    mode,
    label: cascadeTtsModeLabel(ttsProvider),
    voice: env.CASCADE_TTS_VOICE_ID,
    provider: 'cascade',
    ttsProvider,
  }
}
