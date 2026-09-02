const DEFAULT_PATH = '/v1/turn/partial'

function listValue(value) {
  if (Array.isArray(value)) return value.map(item => String(item)).filter(Boolean)
  if (value == null || value === '') return []
  return [String(value)]
}

function normalizeResult(payload) {
  const source = payload?.result && typeof payload.result === 'object'
    ? payload.result
    : payload || {}
  return {
    facts: listValue(source.facts || source.left_hits || source.result_leftbrain || source.leftbrain),
    relationship: listValue(source.relationship || source.persona),
    affect: listValue(source.affect || source.emotion || source.result_rightbrain || source.rightbrain),
    source: source.source || 'voicemem',
  }
}

function timeoutSignal(parentSignal, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  timer.unref?.()
  const abort = () => controller.abort()
  parentSignal?.addEventListener('abort', abort, { once: true })
  return {
    signal: controller.signal,
    abort: () => controller.abort(),
    dispose: () => {
      clearTimeout(timer)
      parentSignal?.removeEventListener('abort', abort)
    },
  }
}

function waitFor(promise, timeoutMs) {
  if (!promise) return Promise.resolve(null)
  return Promise.race([
    promise,
    new Promise(resolve => {
      const timer = setTimeout(() => resolve(null), timeoutMs)
      timer.unref?.()
    }),
  ])
}

export class VoiceMemTurnContextRetriever {
  constructor(cascadeConfig, { fetchImpl = globalThis.fetch, log = () => {} } = {}) {
    this.config = cascadeConfig?.turnContext || {}
    this.fetchImpl = fetchImpl
    this.log = log
  }

  describe() {
    return {
      protocolVersion: 1,
      key: 'voicemem',
      capabilities: { speculative: true, emotionAware: true },
    }
  }

  openTurn({ sessionId, turnId } = {}) {
    const config = this.config
    const minChars = Math.max(1, Number(config.minChars) || 6)
    const requestTimeoutMs = Math.max(50, Number(config.requestTimeoutMs) || 1000)
    const baseUrl = String(config.url || '').replace(/\/+$/, '')
    let revision = 0
    let latestText = ''
    let latestResult = null
    let latestResultRevision = 0
    let inFlight = null
    let activeRequest = null
    let cancelled = false

    const prefetch = (text, currentRevision) => {
      activeRequest?.abort()
      const request = timeoutSignal(null, requestTimeoutMs)
      activeRequest = request
      const promise = this.fetchImpl(`${baseUrl}${config.partialPath || DEFAULT_PATH}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({ session_id: sessionId, turn_id: turnId, text }),
        signal: request.signal,
      }).then(async response => {
        if (!response.ok) throw new Error(`VoiceMem 服务不可用（HTTP ${response.status}）`)
        return normalizeResult(await response.json())
      }).then(result => {
        if (!cancelled && currentRevision === revision) {
          latestResult = result
          latestResultRevision = currentRevision
        }
        return result
      }).catch(error => {
        if (!cancelled && error?.name !== 'AbortError') {
          this.log(`VoiceMem 当前轮次预取失败：${error.message}`)
        }
        return null
      }).finally(() => {
        request.dispose()
        if (activeRequest === request) activeRequest = null
      })
      inFlight = promise
      void promise
    }

    return {
      partial: ({ text } = {}) => {
        if (cancelled) return
        const nextText = String(text || '').trim()
        if (nextText.length < minChars || nextText === latestText) return
        latestText = nextText
        revision += 1
        // The abort is owned by the request signal. A new revision makes the
        // old result unusable even if a non-abortable transport resolves late.
        prefetch(nextText, revision)
      },
      snapshot: () => latestResult,
      final: async ({ deadlineMs = config.deadlineMs ?? 250 } = {}) => {
        if (cancelled) return null
        if (latestResult && latestResultRevision === revision) return latestResult
        await waitFor(inFlight, Math.max(0, Number(deadlineMs) || 0))
        return latestResultRevision === revision ? latestResult : null
      },
      cancel: () => {
        cancelled = true
        revision += 1
        activeRequest?.abort()
      },
    }
  }
}

export function createVoiceMemTurnContextRetriever(cascadeConfig, options) {
  const config = cascadeConfig?.turnContext || {}
  if (!String(config.url || '').trim()) {
    throw new Error('VoiceMem 缺少 CASCADE_TURN_CONTEXT_URL')
  }
  return new VoiceMemTurnContextRetriever(cascadeConfig, options)
}
