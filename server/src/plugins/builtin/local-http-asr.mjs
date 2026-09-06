import { definePluginManifest } from '../manifest.mjs'

function pcm16Wav(pcm, sampleRate = 16000, channels = 1) {
  const audio = Buffer.concat([Buffer.from(pcm)])
  const blockAlign = channels * 2
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + audio.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * blockAlign, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(audio.length, 40)
  return Buffer.concat([header, audio])
}

function responseText(payload) {
  if (typeof payload === 'string') return payload.trim()
  return String(payload?.text || payload?.transcript || payload?.result?.text || '').trim()
}

export function createLocalHttpAsrPlugin({
  id,
  provider,
  label,
  description,
  model,
  envUrl,
}) {
  const manifest = definePluginManifest({
    id,
    version: '1.0.0',
    kind: 'stt',
    label,
    description,
    capabilities: ['stt.utterance', 'speech.transcribe', 'multilingual'],
    platforms: ['server', 'macos', 'windows', 'linux'],
    permissions: ['network.loopback'],
    runtime: 'local-sidecar',
    dataBoundary: 'local',
  })

  class LocalHttpAsrRecognizer {
    constructor(cascadeConfig, { onPartial, fetchImpl = globalThis.fetch } = {}) {
      this.config = cascadeConfig
      this.onPartial = onPartial
      this.fetchImpl = fetchImpl
      this.audio = []
      this.aborted = false
      this.controller = null
    }

    start() {
      const url = String(this.config?.stt?.url || '').trim()
      if (!url) throw new Error(`${provider} ASR 缺少 ${envUrl}`)
      if (typeof this.fetchImpl !== 'function') throw new Error(`${provider} ASR 需要可用的 fetch 实现`)
    }

    sendAudio(buffer) {
      if (!this.aborted && buffer?.length) this.audio.push(Buffer.from(buffer))
    }

    async finish({ timeoutMs = 30000 } = {}) {
      if (this.aborted || !this.audio.length) return ''
      const stt = this.config.stt
      this.controller = new AbortController()
      const timer = setTimeout(() => this.controller.abort(), timeoutMs)
      timer.unref?.()
      try {
        const response = await this.fetchImpl(String(stt.url), {
          method: 'POST',
          headers: {
            'content-type': 'audio/wav',
            'x-provider': provider,
            'x-model': String(stt.model || model),
            ...(stt.apiKey ? { authorization: `Bearer ${stt.apiKey}` } : {}),
          },
          body: pcm16Wav(Buffer.concat(this.audio), Number(stt.sampleRate) || 16000),
          signal: this.controller.signal,
        })
        if (!response.ok) throw new Error(`${provider} ASR sidecar failed (HTTP ${response.status})`)
        const text = responseText(await response.json())
        this.onPartial?.(text)
        return text
      } catch (error) {
        if (this.aborted) return ''
        if (error?.name === 'AbortError') throw new Error(`${provider} ASR 服务响应超时`)
        throw new Error(`${provider} ASR 服务不可用：${error?.message || error}`)
      } finally {
        clearTimeout(timer)
        this.controller = null
      }
    }

    abort() {
      this.aborted = true
      this.controller?.abort()
      this.audio = []
    }
  }

  return {
    manifest,
    activate({ registerSttProvider }) {
      registerSttProvider(provider, (config, handlers) => new LocalHttpAsrRecognizer(config, handlers))
    },
  }
}

export const fireRedAsrPlugin = createLocalHttpAsrPlugin({
  id: 'qwaudio.stt.firered',
  provider: 'firered',
  label: 'FireRedASR 本地识别',
  description: '通过本地 sidecar 调用 FireRedASR，适合中文、方言和英文识别。',
  model: 'FireRedASR2-AED',
  envUrl: 'FIRERED_ASR_URL',
})

export const hojoAsrPlugin = createLocalHttpAsrPlugin({
  id: 'qwaudio.stt.hojo',
  provider: 'hojo',
  label: 'Hojo-ASR-Multi 本地识别',
  description: '通过本地 sidecar 调用 Hojo-ASR-Multi-V1 多语言识别。',
  model: 'HojoAI/Hojo-ASR-Multi-V1',
  envUrl: 'HOJO_ASR_URL',
})
