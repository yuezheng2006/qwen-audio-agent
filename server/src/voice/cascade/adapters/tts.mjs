import {
  resolveCascadeTtsProviderId,
} from '../../../../../shared/cascade-tts-plugins.mjs'
import { DashScopeTask } from './dashscope-ws.mjs'
import { createFishAudioSynthesizer } from './fish-tts.mjs'
import { createListenHubSynthesizer } from './listenhub-tts.mjs'
import { createMinimaxSynthesizer } from './minimax-tts.mjs'
import { createVoiceBoxSynthesizer } from './voicebox-tts.mjs'

// Streaming TTS adapter contract: one synthesizer per response.
//
//   const synthesizer = createSynthesizer(config, {
//     onAudio(pcmBuffer),     // PCM16 at config.tts.sampleRate
//   })
//   await synthesizer.start()
//   synthesizer.sendText('第一句。')
//   await synthesizer.finish()  // resolves when all audio has arrived
//   synthesizer.abort()         // barge-in: stop immediately
//
// Supplier metadata (env/defaults/labels) lives in shared/cascade-tts-plugins.mjs.
// This file only maps plugin id → synthesizer factory (the upload/access seam).

class DashScopeSynthesizer {
  constructor(cascadeConfig, { onAudio } = {}) {
    const { tts, dashscopeWsUrl } = cascadeConfig
    this.onAudio = onAudio
    this.aborted = false
    this.failure = null
    this.doneResolvers = []
    const instruction = String(tts.instruction || '').trim()
    // Qwen-Audio-3.0-TTS: natural-language direction via `instruction`;
    // fine-grained [whisper]/[laughing] tags travel inside sent text.
    // Official docs mark tag reliability highest on unidirectional streams —
    // duplex cascade still passes tags through unchanged for best effort.
    this.task = new DashScopeTask({
      url: dashscopeWsUrl,
      apiKey: tts.apiKey,
      taskGroup: 'audio',
      task: 'tts',
      function: 'SpeechSynthesizer',
      model: tts.model,
      parameters: {
        text_type: 'PlainText',
        voice: tts.voice,
        format: 'pcm',
        sample_rate: tts.sampleRate,
        ...(instruction ? { instruction } : {}),
      },
      onBinary: buffer => {
        if (!this.aborted) this.onAudio?.(buffer)
      },
      onError: error => {
        this.failure = this.failure || error
        this.resolveDone()
      },
      onFinished: () => this.resolveDone(),
    })
  }

  resolveDone() {
    while (this.doneResolvers.length) this.doneResolvers.shift()?.()
  }

  start() {
    return this.task.connect()
  }

  sendText(text) {
    if (this.aborted || !String(text).trim()) return
    this.task.continueTask({ text })
  }

  async finish({ timeoutMs = 30000 } = {}) {
    if (this.aborted) return
    if (!this.task.finished && !this.failure) {
      const wait = new Promise(resolve => {
        this.doneResolvers.push(resolve)
        const timer = setTimeout(resolve, timeoutMs)
        timer.unref?.()
      })
      this.task.finishTask()
      await wait
    }
    if (this.failure && !this.aborted) throw this.failure
  }

  abort() {
    this.aborted = true
    this.task.close()
    this.resolveDone()
  }
}

/** Runtime factories for registered cascade TTS plugins. */
export const TTS_PROVIDERS = {
  dashscope: (cascadeConfig, handlers) => (
    new DashScopeSynthesizer(cascadeConfig, handlers)
  ),
  voicebox: (cascadeConfig, handlers) => (
    createVoiceBoxSynthesizer(cascadeConfig, handlers)
  ),
  fish: (cascadeConfig, handlers) => (
    createFishAudioSynthesizer(cascadeConfig, handlers)
  ),
  listenhub: (cascadeConfig, handlers) => (
    createListenHubSynthesizer(cascadeConfig, handlers)
  ),
  minimax: (cascadeConfig, handlers) => (
    createMinimaxSynthesizer(cascadeConfig, handlers)
  ),
}

export function listTtsProviders() {
  return Object.keys(TTS_PROVIDERS)
}

export function createSynthesizer(cascadeConfig, handlers) {
  const raw = String(cascadeConfig?.tts?.provider || 'dashscope')
  const key = resolveCascadeTtsProviderId(raw)
  const factory = TTS_PROVIDERS[key]
  if (!factory) {
    throw new Error(
      `不支持的级联 TTS 供应商：${raw}（可用：${listTtsProviders().join(', ')}）`,
    )
  }
  return factory(cascadeConfig, handlers)
}
