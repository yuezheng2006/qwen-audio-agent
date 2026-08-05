/**
 * Cascade TTS plugin catalog (metadata only).
 *
 * Base layers (config / gateway-mode / start scripts) only talk to this
 * registry. Provider-specific env keys, defaults, and labels live here.
 * Synthesizer factories stay in server/src/voice/cascade/adapters/.
 */

const plugins = new Map()
const aliases = new Map()

function trimUrl(value, fallback) {
  return String(value || fallback).replace(/\/+$/, '')
}

export function registerCascadeTtsPlugin(plugin) {
  if (!plugin?.id) throw new Error('cascade TTS plugin requires id')
  plugins.set(plugin.id, plugin)
  aliases.set(plugin.id, plugin.id)
  for (const alias of plugin.aliases || []) {
    aliases.set(String(alias).toLowerCase(), plugin.id)
  }
  return plugin
}

export function resolveCascadeTtsProviderId(raw, { fallback = 'dashscope' } = {}) {
  const key = String(raw || '').trim().toLowerCase()
  if (!key) return fallback
  return aliases.get(key) || key
}

export function getCascadeTtsPlugin(providerId) {
  return plugins.get(providerId) || null
}

export function listCascadeTtsPluginIds() {
  return [...plugins.keys()]
}

export function isPreservedCascadeTtsProvider(providerId) {
  return Boolean(getCascadeTtsPlugin(providerId)?.preserve)
}

export function listCascadeTtsPassthroughEnvKeys() {
  const keys = new Set([
    'CASCADE_TTS_PROVIDER',
    'CASCADE_TTS_MODEL',
    'CASCADE_TTS_VOICE_ID',
    'CASCADE_TTS_VOICE',
    'CASCADE_TTS_API_KEY',
    'CASCADE_TTS_INSTRUCTION',
    'CASCADE_TTS_LATENCY',
  ])
  for (const plugin of plugins.values()) {
    for (const key of plugin.envKeys || []) keys.add(key)
  }
  return [...keys]
}

export function resolveCascadeTtsPluginConfig(env = {}, sharedKey = '') {
  const provider = resolveCascadeTtsProviderId(env.CASCADE_TTS_PROVIDER)
  const plugin = getCascadeTtsPlugin(provider)
  const resolved = plugin?.resolveConfig?.(env, { sharedKey }) || {
    model: env.CASCADE_TTS_MODEL || 'qwen-audio-3.0-tts-flash',
    voice: env.CASCADE_TTS_VOICE_ID || env.CASCADE_TTS_VOICE || 'longanhuan_v3.6',
    apiKey: env.CASCADE_TTS_API_KEY || sharedKey,
  }
  return {
    provider,
    sampleRate: 24000,
    ...resolved,
  }
}

export function cascadeTtsVoiceDisplayName(voiceId = '', { provider } = {}) {
  const id = String(voiceId || '')
  if (!id) return '未配置'
  const providerId = resolveCascadeTtsProviderId(provider, { fallback: '' })
  const plugin = getCascadeTtsPlugin(providerId)
  if (plugin?.displayName) return plugin.displayName(id)
  if (id.includes('fenggetts') || id.includes('fengge')) return '峰哥复刻'
  if (id === 'longanqian') return '龙安茜（系统）'
  if (id === 'longanhuan_v3.6') return '龙安欢（系统）'
  return id.length > 28 ? `${id.slice(0, 12)}…${id.slice(-8)}` : id
}

export function cascadeTtsModeLabel(providerId) {
  const plugin = getCascadeTtsPlugin(providerId)
  return plugin?.cascadeLabel || 'Cascade（VAD→STT→LLM→Qwen-Audio-TTS）'
}

export function resolvePreservedCascadeTtsEnv(providerId, sources = {}) {
  const plugin = getCascadeTtsPlugin(providerId)
  if (!plugin?.preserve) return null
  const env = { ...sources }
  const resolved = plugin.resolveConfig(env, { sharedKey: '' })
  const out = {
    CASCADE_TTS_PROVIDER: providerId,
  }
  if (resolved.model) out.CASCADE_TTS_MODEL = resolved.model
  if (resolved.voice) out.CASCADE_TTS_VOICE_ID = resolved.voice
  return out
}

function shortLabel(prefix, id, head = 8, tail = 6) {
  return id.length > 28
    ? `${prefix} ${id.slice(0, head)}…${id.slice(-tail)}`
    : `${prefix} ${id}`
}

/** Map short Flash/Plus aliases onto hosted Qwen-Audio-3.0-TTS model ids. */
export function normalizeDashScopeTtsModel(raw) {
  const key = String(raw || '').trim().toLowerCase()
  if (!key || key === 'flash') return 'qwen-audio-3.0-tts-flash'
  if (key === 'plus') return 'qwen-audio-3.0-tts-plus'
  if (key === 'qwen-audio-3.0-tts' || key === 'qwen-audio-tts') {
    return 'qwen-audio-3.0-tts-flash'
  }
  return String(raw).trim()
}

registerCascadeTtsPlugin({
  id: 'dashscope',
  aliases: [],
  preserve: false,
  cascadeLabel: 'Cascade（VAD→STT→LLM→Qwen-Audio-TTS）',
  envKeys: ['CASCADE_TTS_INSTRUCTION'],
  resolveConfig(env, { sharedKey }) {
    const instruction = String(env.CASCADE_TTS_INSTRUCTION || '').trim()
    return {
      // Flash = realtime; Plus = higher quality. Inline tags go in text body.
      model: normalizeDashScopeTtsModel(
        env.CASCADE_TTS_MODEL || 'qwen-audio-3.0-tts-flash',
      ),
      voice: (
        env.CASCADE_TTS_VOICE_ID
        || env.CASCADE_TTS_VOICE
        || 'longanhuan_v3.6'
      ),
      apiKey: env.CASCADE_TTS_API_KEY || sharedKey,
      ...(instruction ? { instruction } : {}),
    }
  },
  displayName(id) {
    if (id.includes('fenggetts') || id.includes('fengge')) return '峰哥复刻'
    if (id === 'longanqian') return '龙安茜（系统）'
    if (id === 'longanhuan_v3.6') return '龙安欢（系统）'
    return id.length > 28 ? `${id.slice(0, 12)}…${id.slice(-8)}` : id
  },
})

registerCascadeTtsPlugin({
  id: 'voicebox',
  aliases: [],
  preserve: true,
  cascadeLabel: 'Cascade（VAD→STT→LLM→VoiceBox）',
  envKeys: ['VOICEBOX_BASE_URL'],
  resolveConfig(env, { sharedKey }) {
    return {
      model: env.CASCADE_TTS_MODEL || undefined,
      voice: env.CASCADE_TTS_VOICE_ID || env.CASCADE_TTS_VOICE || '',
      apiKey: env.CASCADE_TTS_API_KEY || sharedKey,
      voiceboxBaseUrl: trimUrl(env.VOICEBOX_BASE_URL, 'http://127.0.0.1:17493'),
    }
  },
  displayName(id) {
    return id.length > 28 ? `VoiceBox ${id.slice(0, 8)}…${id.slice(-6)}` : `VoiceBox ${id}`
  },
})

registerCascadeTtsPlugin({
  id: 'fish',
  aliases: ['fishaudio', 'fish-audio'],
  preserve: true,
  cascadeLabel: 'Cascade（VAD→STT→LLM→Fish Audio S2.1）',
  envKeys: [
    'FISH_API_KEY',
    'FISH_REFERENCE_ID',
    'FISH_TTS_MODEL',
    'FISH_TTS_LATENCY',
    'FISH_API_BASE_URL',
  ],
  resolveConfig(env, { sharedKey }) {
    return {
      model: env.CASCADE_TTS_MODEL || env.FISH_TTS_MODEL || 's2.1-pro-free',
      voice: (
        env.CASCADE_TTS_VOICE_ID
        || env.CASCADE_TTS_VOICE
        || env.FISH_REFERENCE_ID
        || ''
      ),
      apiKey: env.CASCADE_TTS_API_KEY || env.FISH_API_KEY || sharedKey,
      fishBaseUrl: trimUrl(env.FISH_API_BASE_URL, 'https://api.fish.audio'),
      fishLatency: env.FISH_TTS_LATENCY || env.CASCADE_TTS_LATENCY || 'balanced',
    }
  },
  displayName(id) {
    return shortLabel('Fish', id)
  },
})

registerCascadeTtsPlugin({
  id: 'listenhub',
  aliases: ['listen-hub', 'marswave', 'flowtts'],
  preserve: true,
  cascadeLabel: 'Cascade（VAD→STT→LLM→ListenHub）',
  envKeys: [
    'LISTENHUB_API_KEY',
    'LISTENHUB_SPEAKER_ID',
    'LISTENHUB_TTS_MODEL',
    'LISTENHUB_API_BASE_URL',
  ],
  resolveConfig(env, { sharedKey }) {
    return {
      model: env.CASCADE_TTS_MODEL || env.LISTENHUB_TTS_MODEL || 'flowtts',
      voice: (
        env.CASCADE_TTS_VOICE_ID
        || env.CASCADE_TTS_VOICE
        || env.LISTENHUB_SPEAKER_ID
        || ''
      ),
      apiKey: env.CASCADE_TTS_API_KEY || env.LISTENHUB_API_KEY || sharedKey,
      listenhubBaseUrl: trimUrl(
        env.LISTENHUB_API_BASE_URL,
        'https://api.marswave.ai',
      ),
    }
  },
  displayName(id) {
    return shortLabel('ListenHub', id, 10, 6)
  },
})

registerCascadeTtsPlugin({
  id: 'minimax',
  aliases: ['minimaxi'],
  preserve: true,
  cascadeLabel: 'Cascade（VAD→STT→LLM→MiniMax）',
  envKeys: [
    'MINIMAX_API_KEY',
    'MINIMAX_VOICE_ID',
    'MINIMAX_MODEL',
    'MINIMAX_API_BASE_URL',
    'MINIMAX_LANGUAGE_BOOST',
  ],
  resolveConfig(env, { sharedKey }) {
    return {
      model: env.CASCADE_TTS_MODEL || env.MINIMAX_MODEL || 'speech-02-turbo',
      voice: (
        env.CASCADE_TTS_VOICE_ID
        || env.CASCADE_TTS_VOICE
        || env.MINIMAX_VOICE_ID
        || ''
      ),
      apiKey: env.CASCADE_TTS_API_KEY || env.MINIMAX_API_KEY || sharedKey,
      minimaxBaseUrl: trimUrl(
        env.MINIMAX_API_BASE_URL,
        'https://api.minimaxi.com',
      ),
      minimaxLanguageBoost: env.MINIMAX_LANGUAGE_BOOST || 'Chinese',
    }
  },
  displayName(id) {
    return shortLabel('MiniMax', id)
  },
})
