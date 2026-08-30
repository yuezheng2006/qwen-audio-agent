const DEFAULT_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/wav',
]

export function selectRecorderMimeType(
  isTypeSupported = globalThis.MediaRecorder?.isTypeSupported,
  types = DEFAULT_MIME_TYPES,
) {
  if (typeof isTypeSupported !== 'function') return ''
  return types.find(type => isTypeSupported(type)) || ''
}

export function formatRecordingTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const minutes = Math.floor(total / 60)
  const remainder = String(total % 60).padStart(2, '0')
  return `${minutes}:${remainder}`
}

export function clampClipRange(start, end, duration) {
  const total = Math.max(0, Number(duration) || 0)
  const safeStart = Math.min(total, Math.max(0, Number(start) || 0))
  const safeEnd = Math.min(total, Math.max(safeStart, Number(end) || 0))
  return {
    start: safeStart,
    end: safeEnd,
    duration: Math.max(0, safeEnd - safeStart),
  }
}

export function encodeWav(audioBuffer, start = 0, end = audioBuffer?.duration) {
  const sampleRate = Number(audioBuffer?.sampleRate) || 16_000
  const channels = Math.max(1, Math.min(2, Number(audioBuffer?.numberOfChannels) || 1))
  const sourceLength = Number(audioBuffer?.length) || 0
  const range = clampClipRange(
    start,
    end,
    sourceLength / sampleRate,
  )
  const firstFrame = Math.floor(range.start * sampleRate)
  const lastFrame = Math.min(sourceLength, Math.ceil(range.end * sampleRate))
  const frameCount = Math.max(0, lastFrame - firstFrame)
  const bytesPerSample = 2
  const dataSize = frameCount * channels * bytesPerSample
  const output = new ArrayBuffer(44 + dataSize)
  const view = new DataView(output)
  const writeAscii = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index))
    }
  }
  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channels * bytesPerSample, true)
  view.setUint16(32, channels * bytesPerSample, true)
  view.setUint16(34, 16, true)
  writeAscii(36, 'data')
  view.setUint32(40, dataSize, true)

  const channelData = Array.from({ length: channels }, (_, channel) => (
    audioBuffer.getChannelData(channel)
  ))
  let offset = 44
  for (let frame = firstFrame; frame < lastFrame; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channelData[channel][frame] || 0))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += 2
    }
  }
  return new Blob([output], { type: 'audio/wav' })
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('读取录音失败'))
    reader.readAsDataURL(blob)
  })
}

