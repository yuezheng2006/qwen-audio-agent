import { createSynthesizer as defaultCreateSynthesizer } from '../cascade/adapters/tts.mjs'

export const PREVIEW_TEXT = '大家好，这是音色试听。今天天气不错，我们聊聊生活里的小事。'

export function pcm16ToWav(pcm, sampleRate) {
  const data = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm)
  const rate = Number(sampleRate) || 24000
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

export async function synthesizeVoicePreview({
  apiKey,
  model,
  voice,
  sampleRate = 24000,
  text = PREVIEW_TEXT,
  dashscopeWsUrl = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
  createSynthesizer = defaultCreateSynthesizer,
  finishTimeoutMs = 60_000,
} = {}) {
  const key = String(apiKey || '').trim()
  const remote = String(voice || '').trim()
  if (!key || !remote) {
    const error = new Error('preview 需要有效的 apiKey 与 voice')
    error.code = 'preview_invalid'
    throw error
  }
  const chunks = []
  const synthesizer = createSynthesizer({
    dashscopeWsUrl,
    tts: {
      provider: 'dashscope',
      apiKey: key,
      model: String(model || 'qwen-audio-3.0-tts-flash').trim() || 'qwen-audio-3.0-tts-flash',
      voice: remote,
      sampleRate,
    },
  }, {
    onAudio(buffer) {
      chunks.push(Buffer.from(buffer))
    },
  })
  await synthesizer.start()
  synthesizer.sendText(String(text || PREVIEW_TEXT))
  await synthesizer.finish({ timeoutMs: finishTimeoutMs })
  return pcm16ToWav(Buffer.concat(chunks), sampleRate)
}
