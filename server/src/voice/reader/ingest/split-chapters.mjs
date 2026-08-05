/**
 * Split long Markdown into chapter units for Reader + optional knowledge index.
 * Prefers heading / 「第X章」 boundaries; falls back to size windows.
 */

const CHAPTER_HEADING = /^(#{1,3})\s+(.+?)\s*$/
const CHAPTER_CN = /^(第[一二三四五六七八九十百千零〇两\d]+[章节回部卷集].*)$/
const CHAPTER_EN = /^(chapter\s+\d+\b.*)$/i

export function slugifyTitle(raw, fallback = 'book') {
  const text = String(raw || '')
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return (text || fallback).slice(0, 80)
}

export function splitMarkdownIntoChapters(markdown, {
  title = '未命名',
  maxChapterChars = 12_000,
} = {}) {
  const text = String(markdown || '').replace(/\r\n/g, '\n').trim()
  if (!text) return []

  const lines = text.split('\n')
  const sections = []
  let current = { title: null, lines: [] }

  const flush = () => {
    const body = current.lines.join('\n').trim()
    if (!body && !current.title) return
    sections.push({
      title: current.title || `${title} · 续`,
      body: body || '（空）',
    })
    current = { title: null, lines: [] }
  }

  for (const line of lines) {
    const trimmed = line.trim()
    const heading = trimmed.match(CHAPTER_HEADING)
    const cn = trimmed.match(CHAPTER_CN)
    const en = trimmed.match(CHAPTER_EN)
    if (heading || cn || en) {
      if (current.title || current.lines.some(item => item.trim())) flush()
      current.title = heading ? heading[2].trim() : trimmed
      current.lines = [line]
      continue
    }
    current.lines.push(line)
  }
  flush()

  if (sections.length <= 1 && text.length > maxChapterChars) {
    return splitBySize(text, title, maxChapterChars)
  }

  return sections.map((section, index) => ({
    order: index + 1,
    title: section.title || `${title} · ${index + 1}`,
    body: ensureHeading(section.title, section.body),
  }))
}

function ensureHeading(title, body) {
  const trimmed = String(body || '').trim()
  if (!title) return trimmed
  if (/^#\s+/m.test(trimmed.split('\n', 1)[0] || '')) return trimmed
  return `# ${title}\n\n${trimmed}`
}

function splitBySize(text, title, maxChapterChars) {
  const parts = []
  let offset = 0
  let order = 1
  while (offset < text.length) {
    let end = Math.min(text.length, offset + maxChapterChars)
    if (end < text.length) {
      const window = text.slice(offset, end)
      const breakAt = Math.max(
        window.lastIndexOf('\n\n'),
        window.lastIndexOf('。'),
        window.lastIndexOf('\n'),
      )
      if (breakAt > maxChapterChars * 0.4) end = offset + breakAt + 1
    }
    const body = text.slice(offset, end).trim()
    if (body) {
      const chapterTitle = `${title} · ${order}`
      parts.push({
        order,
        title: chapterTitle,
        body: ensureHeading(chapterTitle, body),
      })
      order += 1
    }
    offset = end
  }
  return parts
}
