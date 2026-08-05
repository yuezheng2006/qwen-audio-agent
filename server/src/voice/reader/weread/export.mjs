/**
 * Build speakable scripts / optional markdown from WeRead highlights & reviews.
 */

const DEFAULT_MAX_CHARS = 4000

export function buildSpeakScript({
  title = '未命名',
  mode = 'highlights',
  highlights = [],
  reviews = [],
  itemIds = null,
  maxChars = DEFAULT_MAX_CHARS,
} = {}) {
  const idSet = Array.isArray(itemIds) && itemIds.length
    ? new Set(itemIds.map(String))
    : null

  const parts = []
  // No host intro — speak content only.
  let count = 0
  if (mode === 'highlights' || mode === 'mixed') {
    for (const item of highlights) {
      if (idSet && !idSet.has(String(item.id))) continue
      const text = String(item.markText || '').trim()
      if (!text) continue
      parts.push(text)
      count += 1
    }
  }
  if (mode === 'reviews' || mode === 'mixed') {
    for (const item of reviews) {
      if (idSet && !idSet.has(String(item.id))) continue
      const text = String(item.content || '').trim()
      if (!text) continue
      parts.push(text)
      count += 1
    }
  }

  if (!count) {
    throw new Error(mode === 'reviews' ? '没有可朗读的书评' : '没有可朗读的金句')
  }

  let text = parts.join('\n')
  let truncated = false
  const limit = Math.max(200, Number(maxChars) || DEFAULT_MAX_CHARS)
  if (text.length > limit) {
    text = `${text.slice(0, limit)}……`
    truncated = true
  }
  return { text, truncated, count, title, mode }
}

export function buildWereadMarkdown({
  title,
  author = '',
  highlights = [],
  reviews = [],
} = {}) {
  const lines = [`# ${title}`, '']
  if (author) lines.push(`作者：${author}`, '')
  if (highlights.length) {
    lines.push('## 我的划线', '')
    let lastChapter = null
    for (const item of highlights) {
      if (item.chapterTitle && item.chapterTitle !== lastChapter) {
        lastChapter = item.chapterTitle
        lines.push(`### ${lastChapter}`, '')
      }
      lines.push(`- ${item.markText}`)
      if (item.createTime) lines.push(`  - _${item.createTime}_`)
      lines.push('')
    }
  }
  if (reviews.length) {
    lines.push('## 我的想法', '')
    for (const item of reviews) {
      lines.push(`### ${item.chapterName || '书评'}`, '', item.content, '')
    }
  }
  return `${lines.join('\n').trim()}\n`
}
