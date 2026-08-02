import { createHash } from 'node:crypto'

const DEFAULT_MAX_CHARS = 700
const DEFAULT_OVERLAP = 80

export function chunkMarkdown(text, {
  maxChars = DEFAULT_MAX_CHARS,
  overlap = DEFAULT_OVERLAP,
  sourceId = 'doc',
} = {}) {
  const normalized = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .trim()
  if (!normalized) return []

  const sections = splitByHeadings(normalized)
  const chunks = []
  for (const section of sections) {
    const pieces = splitByLength(section.body, maxChars, overlap)
    pieces.forEach((body, index) => {
      const content = [section.heading, body].filter(Boolean).join('\n\n').trim()
      if (!content) return
      const id = `chk_${createHash('sha256')
        .update(`${sourceId}:${section.heading}:${index}:${content}`)
        .digest('hex')
        .slice(0, 16)}`
      chunks.push({
        id,
        sourceId,
        heading: section.heading || null,
        content,
        index: chunks.length,
      })
    })
  }
  return chunks
}

function splitByHeadings(text) {
  const lines = text.split('\n')
  const sections = []
  let heading = ''
  let body = []
  const flush = () => {
    const content = body.join('\n').trim()
    if (heading || content) {
      sections.push({ heading, body: content })
    }
    body = []
  }
  for (const line of lines) {
    if (/^#{1,6}\s+\S/.test(line)) {
      flush()
      heading = line.replace(/^#{1,6}\s+/, '').trim()
      continue
    }
    body.push(line)
  }
  flush()
  return sections.length ? sections : [{ heading: '', body: text }]
}

function splitByLength(text, maxChars, overlap) {
  const clean = String(text || '').trim()
  if (!clean) return []
  if ([...clean].length <= maxChars) return [clean]
  const chars = [...clean]
  const pieces = []
  let start = 0
  while (start < chars.length) {
    let end = Math.min(chars.length, start + maxChars)
    if (end < chars.length) {
      const window = chars.slice(start, end).join('')
      const breakAt = Math.max(
        window.lastIndexOf('\n\n'),
        window.lastIndexOf('。'),
        window.lastIndexOf('！'),
        window.lastIndexOf('？'),
        window.lastIndexOf('. '),
      )
      if (breakAt > maxChars * 0.4) end = start + breakAt + 1
    }
    pieces.push(chars.slice(start, end).join('').trim())
    if (end >= chars.length) break
    start = Math.max(0, end - overlap)
  }
  return pieces.filter(Boolean)
}

export function tokenize(text) {
  return String(text || '')
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map(token => token.trim())
    .filter(token => token.length > 1)
}

/** Lightweight keyword score (BM25-ish TF over query terms). */
export function scoreChunk(query, chunkContent) {
  const q = tokenize(query)
  if (!q.length) return 0
  const tokens = tokenize(chunkContent)
  if (!tokens.length) return 0
  const tf = new Map()
  for (const token of tokens) tf.set(token, (tf.get(token) || 0) + 1)
  let score = 0
  for (const term of q) {
    const freq = tf.get(term) || 0
    if (!freq) {
      // CJK substring fallback for short queries without whitespace tokens
      if (term.length >= 2 && chunkContent.includes(term)) score += 0.6
      continue
    }
    score += 1 + Math.log(1 + freq)
  }
  // Prefer denser matches
  const coverage = q.filter(term => (
    tf.has(term) || (term.length >= 2 && chunkContent.includes(term))
  )).length / q.length
  return score * (0.5 + coverage)
}
