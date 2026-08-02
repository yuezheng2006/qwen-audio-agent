/**
 * VoiceBox-inspired sentence/paragraph chunking for long-form speak queues.
 * CJK-aware; keeps chunks under maxChars without splitting mid-tag-ish tokens.
 */

const SENTENCE_END = /([。！？!?；;…]|\.(?:\s|$))/

export function chunkTextForSpeech(text, {
  maxChars = 220,
  minChars = 40,
} = {}) {
  const normalized = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!normalized) return []

  const paragraphs = normalized.split(/\n{2,}/).map(part => part.trim()).filter(Boolean)
  const chunks = []
  for (const paragraph of paragraphs) {
    for (const sentence of splitSentences(paragraph)) {
      if ([...sentence].length <= maxChars) {
        maybeMergeOrPush(chunks, sentence, maxChars, minChars)
        continue
      }
      for (const piece of hardSplit(sentence, maxChars)) {
        maybeMergeOrPush(chunks, piece, maxChars, minChars)
      }
    }
  }
  return chunks.filter(Boolean)
}

function splitSentences(text) {
  const parts = []
  let buf = ''
  const chars = [...text]
  for (let i = 0; i < chars.length; i += 1) {
    buf += chars[i]
    const window = buf.slice(-2)
    if (SENTENCE_END.test(window) || SENTENCE_END.test(chars[i])) {
      parts.push(buf.trim())
      buf = ''
    }
  }
  if (buf.trim()) parts.push(buf.trim())
  return parts
}

function hardSplit(text, maxChars) {
  const chars = [...text]
  const pieces = []
  for (let i = 0; i < chars.length; i += maxChars) {
    pieces.push(chars.slice(i, i + maxChars).join('').trim())
  }
  return pieces.filter(Boolean)
}

function maybeMergeOrPush(chunks, next, maxChars, minChars) {
  if (!chunks.length) {
    chunks.push(next)
    return
  }
  const last = chunks[chunks.length - 1]
  const mergedLen = [...last].length + 1 + [...next].length
  if ([...last].length < minChars && mergedLen <= maxChars) {
    chunks[chunks.length - 1] = `${last}${/^[。！？!?；;…]/.test(next) ? '' : ''}${next}`
    // Prefer joining without extra space for CJK
    if (!/[\u3400-\u9fff]/.test(last.slice(-1)) && !/[\u3400-\u9fff]/.test(next[0])) {
      chunks[chunks.length - 1] = `${last} ${next}`
    } else {
      chunks[chunks.length - 1] = `${last}${next}`
    }
    return
  }
  chunks.push(next)
}
