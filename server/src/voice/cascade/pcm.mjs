export function decodePcmBase64(audio) {
  return Buffer.from(String(audio || ''), 'base64')
}

export function encodePcmBase64(buffer) {
  return Buffer.from(buffer).toString('base64')
}

// Root mean square of a PCM16 little-endian buffer, normalized to 0..1.
export function pcm16Rms(buffer) {
  const samples = Math.floor(buffer.length / 2)
  if (!samples) return 0
  let sum = 0
  for (let i = 0; i < samples; i += 1) {
    const value = buffer.readInt16LE(i * 2) / 32768
    sum += value * value
  }
  return Math.sqrt(sum / samples)
}

export function pcm16DurationMs(buffer, sampleRate) {
  return (buffer.length / 2 / sampleRate) * 1000
}
