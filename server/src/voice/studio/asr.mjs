export function asrUnavailable(provider = 'auto') {
  return {
    status: 'failed',
    error: true,
    error_code: 'asr_unavailable',
    provider,
    retryable: false,
    user_message: '音频转写暂不可用，当前尚未配置云端 ASR 后端。',
  }
}

export function createAsrService({ backend } = {}) {
  return {
    async transcribe(input = {}) {
      const { provider = 'auto' } = input
      if (!backend?.transcribe) return asrUnavailable(provider)
      return backend.transcribe(input)
    },
  }
}
