const listeners = new Set()

export function onEpisodeStoreChanged(listener) {
  if (typeof listener !== 'function') return () => {}
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function emitEpisodeStoreChanged(ownerId) {
  for (const listener of listeners) {
    try {
      listener(ownerId)
    } catch {
      // listeners must not break tool path
    }
  }
}
