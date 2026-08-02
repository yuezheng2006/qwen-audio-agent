const HARD_ENDS = new Set(['。', '！', '？', '!', '?', '.', ';', '；', '\n'])
const SOFT_ENDS = new Set(['，', ',', '、', '：', ':'])

// Sentence-boundary gate between a streaming LLM and a streaming TTS.
//
// Two lessons are baked in:
// 1. The trailing sentence is held back until the finish reason is known.
//    When the model stops at the token limit (finish_reason=length) the last
//    sentence is usually cut mid-word; dropping the whole held sentence keeps
//    speech, captions and history consistent instead of reading a broken tail.
// 2. The first sentence may release at a soft boundary (comma) once it is
//    long enough, so time-to-first-audio does not wait for a full stop.
export class SentenceStream {
  constructor({ onSentence, firstSoftMinChars = 6 } = {}) {
    this.onSentence = onSentence
    this.firstSoftMinChars = firstSoftMinChars
    this.buffer = ''
    this.releasedAny = false
  }

  push(text) {
    this.buffer += String(text || '')
    let boundary = this.lastBoundary()
    while (boundary >= 0) {
      const sentence = this.buffer.slice(0, boundary + 1)
      this.buffer = this.buffer.slice(boundary + 1)
      this.emit(sentence)
      boundary = this.lastBoundary()
    }
  }

  lastBoundary() {
    let hard = -1
    for (let i = 0; i < this.buffer.length; i += 1) {
      if (HARD_ENDS.has(this.buffer[i])) hard = i
    }
    if (hard >= 0) return hard
    if (this.releasedAny) return -1
    for (let i = this.buffer.length - 1; i >= this.firstSoftMinChars - 1; i -= 1) {
      if (SOFT_ENDS.has(this.buffer[i])) return i
    }
    return -1
  }

  finish(finishReason = 'stop') {
    const remainder = this.buffer
    this.buffer = ''
    if (!remainder.trim()) return ''
    // A cut-off tail is only dropped when something complete was already
    // said; an unpunctuated half answer still beats total silence.
    if (finishReason === 'length' && this.releasedAny) return remainder
    this.emit(remainder)
    return ''
  }

  emit(sentence) {
    if (!sentence.trim()) return
    this.releasedAny = true
    this.onSentence?.(sentence)
  }
}
