import { chunkTextForSpeech } from './chunk-text.mjs'

const STATUSES = new Set([
  'idle',
  'reading',
  'explaining',
  'paused',
  'stopped',
])

/**
 * Long-form read / explain controller.
 * read  → serial speak() chunks (cascade_mode speak)
 * explain → per-chunk LLM prompt via speak of generated text (or text.message hook)
 *
 * Interrupt: mark paused + resumeIndex; resume continues from next chunk.
 */
export class ReaderSession {
  constructor({
    contentStore,
    getFrontend,
    onProgress = () => {},
    chunkOptions = {},
    gapMs = 120,
  } = {}) {
    this.contentStore = contentStore
    this.getFrontend = getFrontend
    this.onProgress = onProgress
    this.chunkOptions = chunkOptions
    this.gapMs = gapMs
    this.state = {
      status: 'idle',
      mode: null,
      contentId: null,
      title: null,
      index: 0,
      total: 0,
      resumeIndex: 0,
      error: null,
    }
    this.chunks = []
    this.runToken = 0
    this.queue = Promise.resolve()
  }

  snapshot() {
    return { ...this.state }
  }

  listContents() {
    return this.contentStore?.list() || []
  }

  async start(mode, { contentId, text, offset = 0 } = {}) {
    if (!['read', 'explain'].includes(mode)) {
      throw new Error(`unsupported reader mode: ${mode}`)
    }
    let body = String(text || '').trim()
    let title = 'inline'
    let id = contentId || 'inline'
    if (!body) {
      const doc = this.contentStore?.get(contentId)
      if (!doc?.text) throw new Error(`content not found: ${contentId || '(empty)'}`)
      body = doc.text
      title = doc.title
      id = doc.id
    }
    this.chunks = chunkTextForSpeech(body, this.chunkOptions)
    if (!this.chunks.length) throw new Error('content is empty after chunking')
    const startIndex = Math.max(0, Math.min(this.chunks.length - 1, Number(offset) || 0))
    this.runToken += 1
    this.state = {
      status: mode === 'read' ? 'reading' : 'explaining',
      mode,
      contentId: id,
      title,
      index: startIndex,
      total: this.chunks.length,
      resumeIndex: startIndex,
      error: null,
    }
    this.emit()
    this.#enqueuePump(this.runToken)
    return this.snapshot()
  }

  pause() {
    if (!['reading', 'explaining'].includes(this.state.status)) {
      return this.snapshot()
    }
    this.runToken += 1
    this.state = {
      ...this.state,
      status: 'paused',
      resumeIndex: this.state.index,
    }
    void this.getFrontend()?.cancel?.()
    this.emit()
    return this.snapshot()
  }

  async resume() {
    if (this.state.status !== 'paused' && this.state.status !== 'stopped') {
      return this.snapshot()
    }
    if (!this.chunks.length) throw new Error('nothing to resume')
    const index = Math.min(this.chunks.length - 1, this.state.resumeIndex || this.state.index)
    this.state = {
      ...this.state,
      status: this.state.mode === 'explain' ? 'explaining' : 'reading',
      index,
      resumeIndex: index,
      error: null,
    }
    this.runToken += 1
    this.emit()
    this.#enqueuePump(this.runToken)
    return this.snapshot()
  }

  stop() {
    this.runToken += 1
    this.state = {
      ...this.state,
      status: 'stopped',
      resumeIndex: this.state.index,
    }
    void this.getFrontend()?.cancel?.()
    this.emit()
    return this.snapshot()
  }

  async seek(offset = 0) {
    if (!this.chunks.length) throw new Error('nothing to seek')
    const index = Math.max(0, Math.min(this.chunks.length - 1, Number(offset) || 0))
    const wasActive = ['reading', 'explaining'].includes(this.state.status)
    this.runToken += 1
    this.state = {
      ...this.state,
      index,
      resumeIndex: index,
      status: wasActive
        ? (this.state.mode === 'explain' ? 'explaining' : 'reading')
        : 'paused',
    }
    void this.getFrontend()?.cancel?.()
    this.emit()
    if (wasActive) this.#enqueuePump(this.runToken)
    return this.snapshot()
  }

  /** Called when user barge-in cancels playback — keep resume point. */
  noteInterruption() {
    if (!['reading', 'explaining'].includes(this.state.status)) return this.snapshot()
    this.runToken += 1
    this.state = {
      ...this.state,
      status: 'paused',
      resumeIndex: Math.min(this.state.total, this.state.index + 1),
    }
    this.emit()
    return this.snapshot()
  }

  emit() {
    this.onProgress(this.snapshot())
  }

  #enqueuePump(token) {
    this.queue = this.queue
      .catch(() => {})
      .then(() => this.#pump(token))
  }

  async #pump(token) {
    while (
      token === this.runToken
      && ['reading', 'explaining'].includes(this.state.status)
      && this.state.index < this.chunks.length
    ) {
      const index = this.state.index
      const chunk = this.chunks[index]
      const frontend = this.getFrontend?.()
      if (!frontend?.speak) {
        this.state = {
          ...this.state,
          status: 'paused',
          error: 'voice frontend unavailable',
        }
        this.emit()
        return
      }
      const text = this.state.mode === 'explain'
        ? `这一段的意思是：${chunk}`
        : chunk
      try {
        await frontend.speak(text)
      } catch (error) {
        if (token !== this.runToken) return
        this.state = {
          ...this.state,
          status: 'paused',
          resumeIndex: index,
          error: error.message,
        }
        this.emit()
        return
      }
      if (token !== this.runToken) return
      const next = index + 1
      this.state = {
        ...this.state,
        index: next,
        resumeIndex: next,
      }
      this.emit()
      if (next < this.chunks.length && this.gapMs > 0) {
        await sleep(this.gapMs)
      }
    }
    if (token === this.runToken && this.state.index >= this.chunks.length) {
      this.state = {
        ...this.state,
        status: 'stopped',
        resumeIndex: this.chunks.length,
      }
      this.emit()
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function isReaderStatus(value) {
  return STATUSES.has(value)
}
