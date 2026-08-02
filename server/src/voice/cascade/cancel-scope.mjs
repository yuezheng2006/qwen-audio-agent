// Generation-tagged cancel signal for the cascade pipeline.
//
// Borrowed from HuggingFace speech-to-speech CancelScope: abort alone cannot
// stop audio already in flight, so every outbound PCM/text chunk carries the
// generation captured at response start. After cancel(), the send path drops
// stale (and briefly all) packets until responseDone/newResponse.

export class CancelScope {
  constructor() {
    this._gen = 0
    this._discarding = false
    this._discardedGeneration = null
  }

  get generation() {
    return this._gen
  }

  get discarding() {
    return this._discarding
  }

  capture() {
    return this._gen
  }

  cancel() {
    this._discardedGeneration = this._gen
    this._gen = (this._gen + 1) >>> 0
    this._discarding = true
  }

  newResponse() {
    this._discarding = false
    this._discardedGeneration = null
  }

  responseDone(generation = null) {
    if (
      generation != null
      && this._discardedGeneration != null
      && generation !== this._discardedGeneration
      && generation !== this._gen
    ) {
      return
    }
    this._discarding = false
    this._discardedGeneration = null
  }

  isStale(generation) {
    return generation !== this._gen
  }

  shouldEmit(generation) {
    if (this._discarding) return false
    return !this.isStale(generation)
  }

  reset() {
    this._discarding = false
    this._discardedGeneration = null
  }
}
