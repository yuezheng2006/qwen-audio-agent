import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const FIXTURE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/audio',
)

// Minimal PCM16 little-endian WAV reader for test fixtures.
export function loadPcm16Wav(name, { sampleRate = 16000 } = {}) {
  const path = resolve(FIXTURE_DIR, name)
  const file = readFileSync(path)
  if (file.toString('ascii', 0, 4) !== 'RIFF' || file.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`not a WAV file: ${path}`)
  }
  let offset = 12
  let rate = 0
  let channels = 0
  let bits = 0
  let data
  while (offset + 8 <= file.length) {
    const id = file.toString('ascii', offset, offset + 4)
    const size = file.readUInt32LE(offset + 4)
    const start = offset + 8
    if (id === 'fmt ') {
      channels = file.readUInt16LE(start + 2)
      rate = file.readUInt32LE(start + 4)
      bits = file.readUInt16LE(start + 14)
    } else if (id === 'data') {
      data = file.subarray(start, start + size)
      break
    }
    offset = start + size + (size % 2)
  }
  if (!data) throw new Error(`missing data chunk: ${path}`)
  if (rate !== sampleRate) {
    throw new Error(`expected ${sampleRate} Hz, got ${rate} in ${name}`)
  }
  if (channels !== 1 || bits !== 16) {
    throw new Error(`expected mono PCM16, got ${channels}ch ${bits}bit in ${name}`)
  }
  return { path, sampleRate: rate, pcm: Buffer.from(data) }
}

export function chunkPcm(pcm, frameMs = 20, sampleRate = 16000) {
  const frameBytes = Math.round(sampleRate * frameMs / 1000) * 2
  const frames = []
  for (let i = 0; i < pcm.length; i += frameBytes) {
    frames.push(pcm.subarray(i, Math.min(i + frameBytes, pcm.length)))
  }
  return frames
}

export function fixturePath(name) {
  return resolve(FIXTURE_DIR, name)
}
