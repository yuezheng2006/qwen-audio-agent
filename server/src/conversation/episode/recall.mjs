import { isMemorableFact } from './turn-capture.mjs'

export const DEFAULT_EPISODE_PROMPT_LIMIT = 5

function tokenize(text) {
  const normalized = String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
  const parts = normalized.split(/\s+/).filter(Boolean)
  const tokens = new Set(parts.filter(part => part.length >= 2))
  // CJK bigrams for short Chinese utterances without spaces.
  const compact = normalized.replace(/\s+/g, '')
  if (/[\u4e00-\u9fff]/.test(compact)) {
    for (let i = 0; i < compact.length - 1; i += 1) {
      tokens.add(compact.slice(i, i + 2))
    }
  }
  return tokens
}

function overlapScore(content, queryTokens) {
  if (!queryTokens.size) return 0
  const contentTokens = tokenize(content)
  let hits = 0
  for (const token of queryTokens) {
    if (contentTokens.has(token)) hits += 1
  }
  return hits / queryTokens.size
}

function isPromptWorthy(episode) {
  if (!episode) return false
  if (String(episode.source || '') === 'user') return true
  return isMemorableFact(episode.content)
}

/**
 * Recency-weighted keyword recall. Newer episodes win ties.
 * Without query: prefer memorable facts so ambient chatter cannot crowd them out.
 */
export function selectEpisodesForPrompt(episodes = [], {
  query = '',
  limit = DEFAULT_EPISODE_PROMPT_LIMIT,
  now = Date.now(),
} = {}) {
  const capped = Math.max(0, Number(limit) || DEFAULT_EPISODE_PROMPT_LIMIT)
  if (!capped || !episodes?.length) return []
  const queryTokens = tokenize(query)
  const memorable = episodes.filter(isPromptWorthy)
  const pool = (!queryTokens.size && memorable.length >= Math.min(1, capped))
    ? memorable
    : episodes

  const scored = pool.map((episode, index) => {
    const ageMs = Math.max(0, now - (Number(episode.at) || 0))
    const ageDays = ageMs / (24 * 60 * 60 * 1000)
    const recency = 1 / (1 + ageDays)
    const overlap = queryTokens.size
      ? overlapScore(episode.content, queryTokens)
      : 0
    const confidence = Math.min(1, Math.max(0, Number(episode.confidence) || 0.5))
    const worthy = isPromptWorthy(episode) ? 1 : 0
    const score = queryTokens.size
      ? (overlap * 0.65) + (recency * 0.15) + (confidence * 0.1) + (worthy * 0.1)
      : (recency * 0.55) + (confidence * 0.2) + (worthy * 0.25)
    return { episode, score, index, worthy }
  })
  scored.sort((left, right) => (
    right.score - left.score
    || right.worthy - left.worthy
    || right.index - left.index
  ))
  const minScore = queryTokens.size ? 0.08 : 0
  return scored
    .filter(item => item.score >= minScore)
    .slice(0, capped)
    .map(item => item.episode)
}

export function loadRecalledEpisodes(episodeStore, ownerId, {
  query = '',
  limit = DEFAULT_EPISODE_PROMPT_LIMIT,
  listLimit = 80,
} = {}) {
  if (!episodeStore || typeof episodeStore.list !== 'function') return []
  const episodes = episodeStore.list(ownerId, { limit: listLimit }) || []
  return selectEpisodesForPrompt(episodes, { query, limit })
}
