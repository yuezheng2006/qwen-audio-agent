import { pcm16DurationMs, pcm16Rms } from './pcm.mjs'

// Energy-based VAD over PCM16 input frames. Emits speech boundaries the
// cascade session translates into Realtime input_audio_buffer events.
//
// maxSpeechMs guards against endless monologues: without it a user who never
// pauses keeps the turn open forever and the assistant never responds.
export class EnergyVad {
  constructor({
    sampleRate = 16000,
    // Defaults match resolveCascadeConfig：近场优先，远场弱拾音忽略。
    threshold = 0.04,
    minSpeechMs = 320,
    silenceMs = 650,
    maxSpeechMs = 12000,
    onSpeechStart,
    onSpeechEnd,
  } = {}) {
    this.sampleRate = sampleRate
    this.threshold = threshold
    this.minSpeechMs = minSpeechMs
    this.silenceMs = silenceMs
    this.maxSpeechMs = maxSpeechMs
    this.onSpeechStart = onSpeechStart
    this.onSpeechEnd = onSpeechEnd
    this.reset()
  }

  reset() {
    this.speaking = false
    this.voicedMs = 0
    this.silentMs = 0
    this.speechMs = 0
  }

  push(buffer) {
    const frameMs = pcm16DurationMs(buffer, this.sampleRate)
    const voiced = pcm16Rms(buffer) >= this.threshold
    if (!this.speaking) {
      if (voiced) {
        this.voicedMs += frameMs
        if (this.voicedMs >= this.minSpeechMs) {
          this.speaking = true
          this.speechMs = this.voicedMs
          this.silentMs = 0
          this.onSpeechStart?.()
        }
      } else {
        this.voicedMs = 0
      }
      return
    }
    this.speechMs += frameMs
    if (voiced) this.silentMs = 0
    else this.silentMs += frameMs
    if (this.silentMs >= this.silenceMs) {
      this.finishSpeech('silence')
      return
    }
    if (this.maxSpeechMs > 0 && this.speechMs >= this.maxSpeechMs) {
      this.finishSpeech('max_duration')
    }
  }

  finishSpeech(reason) {
    if (!this.speaking) return
    this.reset()
    this.onSpeechEnd?.(reason)
  }
}
