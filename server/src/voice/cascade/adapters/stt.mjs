import { DashScopeTask } from './dashscope-ws.mjs'

// Streaming STT adapter contract: one recognizer per utterance.
//
//   const recognizer = createRecognizer(config, {
//     onPartial(text),        // cumulative partial transcript
//   })
//   await recognizer.start()
//   recognizer.sendAudio(pcm16Buffer)
//   const finalText = await recognizer.finish()
//   recognizer.abort()
//
// Register additional providers in STT_PROVIDERS to swap vendors without
// touching the cascade session.

class DashScopeRecognizer {
  constructor(cascadeConfig, { onPartial } = {}) {
    const { stt, dashscopeWsUrl } = cascadeConfig
    this.onPartial = onPartial
    this.sentences = []
    this.partial = ''
    this.finalResolvers = []
    this.failure = null
    this.task = new DashScopeTask({
      url: dashscopeWsUrl,
      apiKey: stt.apiKey,
      taskGroup: 'audio',
      task: 'asr',
      function: 'recognition',
      model: stt.model,
      parameters: {
        format: 'pcm',
        sample_rate: 16000,
      },
      onResult: payload => this.handleResult(payload),
      onError: error => this.handleError(error),
      onFinished: () => this.resolveFinal(),
    })
  }

  handleResult(payload) {
    const sentence = payload.output?.sentence
    if (!sentence) return
    const text = String(sentence.text || '')
    if (sentence.end_time != null) {
      this.sentences.push(text)
      this.partial = ''
    } else {
      this.partial = text
    }
    this.onPartial?.(this.transcript())
  }

  transcript() {
    return [...this.sentences, this.partial].join('').trim()
  }

  handleError(error) {
    this.failure = this.failure || error
    this.resolveFinal()
  }

  resolveFinal() {
    while (this.finalResolvers.length) {
      this.finalResolvers.shift()?.()
    }
  }

  start() {
    return this.task.connect()
  }

  sendAudio(buffer) {
    this.task.sendAudio(buffer)
  }

  async finish({ timeoutMs = 5000 } = {}) {
    if (!this.task.finished && !this.failure) {
      const wait = new Promise(resolve => {
        this.finalResolvers.push(resolve)
        const timer = setTimeout(resolve, timeoutMs)
        timer.unref?.()
      })
      this.task.finishTask()
      await wait
    }
    if (this.failure && !this.transcript()) throw this.failure
    return this.transcript()
  }

  abort() {
    this.task.close()
  }
}

const STT_PROVIDERS = {
  dashscope: (cascadeConfig, handlers) => (
    new DashScopeRecognizer(cascadeConfig, handlers)
  ),
}

export function createRecognizer(cascadeConfig, handlers) {
  const factory = STT_PROVIDERS[cascadeConfig.stt.provider]
  if (!factory) {
    throw new Error(`不支持的级联 STT 供应商：${cascadeConfig.stt.provider}`)
  }
  return factory(cascadeConfig, handlers)
}
