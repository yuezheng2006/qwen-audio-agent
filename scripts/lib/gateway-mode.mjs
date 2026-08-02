// Dual frontend paths for talk-to-fengge / qwen-audio-agent:
//
//   s2s      → DashScope Qwen-Audio-Realtime, system voice longanqian
//              (low latency; no custom clone)
//   cascade  → local VAD→STT→LLM→Qwen-Audio-TTS, fengge Qwen TTS clone
//              (likeness; CosyVoice is intentionally not used)

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
  const ttsProvider = String(provider || '').toLowerCase()
  if (
    ttsProvider === 'fish'
    || ttsProvider === 'fishaudio'
    || ttsProvider === 'fish-audio'
  ) {
    return id.length > 28
      ? `Fish ${id.slice(0, 8)}…${id.slice(-6)}`
      : `Fish ${id}`
  }
  if (id === FENGGE_QWEN_TTS_VOICE || id.includes('fenggetts') || id.includes('fengge')) {
    return '峰哥复刻'
  }
  if (id === 'longanqian') return '龙安茜（系统）'
  if (id === 'longanhuan_v3.6') return '龙安欢（系统）'
  return id.length > 28 ? `${id.slice(0, 12)}…${id.slice(-8)}` : id
}

function normalizeCascadeTtsProvider(raw) {
  const key = String(raw || '').trim().toLowerCase()
  if (key === 'fish' || key === 'fishaudio' || key === 'fish-audio') return 'fish'
  return key || 'dashscope'
}

export function resolveGatewayModeEnv(modeOrAlias, overrides = {}) {
  const mode = resolveGatewayMode(modeOrAlias)
  if (mode === 's2s') {
    return {
      QWEN_AUDIO_REALTIME_PROVIDER: 'dashscope',
      QWEN_AUDIO_REALTIME_VOICE: 'longanqian',
    }
  }
  const provider = normalizeCascadeTtsProvider(
    overrides.CASCADE_TTS_PROVIDER || process.env.CASCADE_TTS_PROVIDER,
  )
  // Fish / VoiceBox testing setups keep their own model + voice ids.
  if (provider === 'fish' || provider === 'voicebox') {
    const out = {
      QWEN_AUDIO_REALTIME_PROVIDER: 'cascade',
      CASCADE_TTS_PROVIDER: provider,
    }
    const model = overrides.CASCADE_TTS_MODEL || process.env.CASCADE_TTS_MODEL
      || (provider === 'fish'
        ? (overrides.FISH_TTS_MODEL || process.env.FISH_TTS_MODEL || 's2.1-pro-free')
        : undefined)
    const voice = overrides.CASCADE_TTS_VOICE_ID
      || process.env.CASCADE_TTS_VOICE_ID
      || overrides.FISH_REFERENCE_ID
      || process.env.FISH_REFERENCE_ID
    if (model) out.CASCADE_TTS_MODEL = model
    if (voice) out.CASCADE_TTS_VOICE_ID = voice
    return out
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
  const label = ttsProvider === 'fish'
    ? 'Cascade（VAD→STT→LLM→Fish Audio S2.1）'
    : ttsProvider === 'voicebox'
      ? 'Cascade（VAD→STT→LLM→VoiceBox）'
      : 'Cascade（VAD→STT→LLM→Qwen-Audio-TTS）'
  return {
    mode,
    label,
    voice: env.CASCADE_TTS_VOICE_ID,
    provider: 'cascade',
    ttsProvider,
  }
}
