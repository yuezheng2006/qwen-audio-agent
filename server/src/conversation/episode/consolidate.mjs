/**
 * Stub: future pass that proposes durable long_term facts from episodes.
 * Does not write MemoryProvider in P0.
 */
export function consolidateEpisodes(ownerId, episodes = [], {
  logger = null,
} = {}) {
  const count = Array.isArray(episodes) ? episodes.length : 0
  logger?.debug?.('episode.consolidate.stub', {
    ownerId: String(ownerId || ''),
    episodeCount: count,
  })
  return {
    proposed: [],
    skipped: count,
    reason: 'stub',
  }
}
