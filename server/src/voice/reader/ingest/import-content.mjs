/**
 * Import large documents into CONTENT_DIR as chapter Markdown.
 * Optional mirror into KNOWLEDGE_DIR for retrieval Q&A.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { extractMarkdownFromSource, writeTempMarkdown } from './mineru-client.mjs'
import { slugifyTitle, splitMarkdownIntoChapters } from './split-chapters.mjs'

export function htmlToReadableMarkdown(html) {
  const text = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  return text
}

export async function fetchUrlAsMarkdown(url, fetchImpl = globalThis.fetch) {
  let parsed
  try {
    parsed = new URL(String(url || '').trim())
  } catch {
    throw new Error('URL 无效')
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('只支持 http/https URL')
  }
  const response = await fetchImpl(parsed.href, { redirect: 'follow' })
  if (!response.ok) {
    throw new Error(`抓取失败 ${response.status}`)
  }
  const type = String(response.headers?.get?.('content-type') || '')
  const body = await response.text()
  if (/markdown|text\/plain/i.test(type) || /\.(md|txt)$/i.test(parsed.pathname)) {
    return { markdown: body, parser: 'url-text' }
  }
  if (/html/i.test(type) || /^\s*</.test(body)) {
    const markdown = htmlToReadableMarkdown(body)
    if (markdown.length < 40) {
      throw new Error('网页正文过短，请另存为 Markdown 再导入')
    }
    return { markdown, parser: 'url-html' }
  }
  return { markdown: body, parser: 'url-text' }
}

async function resolveImportSource({
  sourcePath,
  markdown,
  text,
  url,
  fileName,
  fileBytes,
  fetchImpl = globalThis.fetch,
} = {}) {
  const path = String(sourcePath || '').trim()
  if (path) return { sourcePath: path, parser: null }
  const pasted = String(markdown || text || '').trim()
  if (pasted) {
    return { sourcePath: writeTempMarkdown(pasted, 'paste.md'), parser: 'paste' }
  }
  if (url) {
    const fetched = await fetchUrlAsMarkdown(url, fetchImpl)
    return {
      sourcePath: writeTempMarkdown(fetched.markdown, 'url.md'),
      parser: fetched.parser,
    }
  }
  if (fileBytes && fileName) {
    const dir = mkdtempSync(join(tmpdir(), 'qwaudio-upload-'))
    const dest = join(dir, basename(String(fileName)))
    writeFileSync(dest, fileBytes)
    return { sourcePath: dest, parser: 'upload' }
  }
  throw new Error('需要 sourcePath、markdown、text、url 或文件')
}

export async function importContentDocument({
  sourcePath,
  markdown,
  text,
  url,
  fileName,
  fileBytes,
  fetchImpl = globalThis.fetch,
  contentDir,
  knowledgeDir = '',
  title = '',
  indexKnowledge = false,
  extract = extractMarkdownFromSource,
  extractOptions = {},
} = {}) {
  if (!contentDir) throw new Error('contentDir is required')
  const resolved = await resolveImportSource({
    sourcePath,
    markdown,
    text,
    url,
    fileName,
    fileBytes,
    fetchImpl,
  })
  sourcePath = resolved.sourcePath

  const bookTitle = String(title || basename(sourcePath, extname(sourcePath))).trim()
    || '未命名'
  const bookSlug = slugifyTitle(bookTitle)
  const bookDir = join(contentDir, bookSlug)
  mkdirSync(bookDir, { recursive: true, mode: 0o700 })

  const extracted = await extract(sourcePath, extractOptions)
  const chapters = splitMarkdownIntoChapters(extracted.markdown, {
    title: bookTitle,
  })
  if (!chapters.length) throw new Error('解析结果为空，无法分章')

  const written = []
  for (const chapter of chapters) {
    const fileName = `ch-${String(chapter.order).padStart(3, '0')}-${slugifyTitle(chapter.title, `part-${chapter.order}`)}.md`
    const relativePath = join(bookSlug, fileName)
    const absolutePath = join(contentDir, relativePath)
    writeFileSync(absolutePath, `${chapter.body.trim()}\n`, 'utf8')
    written.push({
      order: chapter.order,
      title: chapter.title,
      relativePath,
      path: absolutePath,
      fileName,
    })
  }

  const catalog = {
    title: bookTitle,
    slug: bookSlug,
    sourcePath,
    parser: resolved.parser || extracted.parser,
    importedAt: new Date().toISOString(),
    chapterCount: written.length,
    chapters: written.map(item => ({
      order: item.order,
      title: item.title,
      relativePath: item.relativePath,
      fileName: item.fileName,
    })),
  }
  writeFileSync(
    join(bookDir, 'CATALOG.json'),
    `${JSON.stringify(catalog, null, 2)}\n`,
    'utf8',
  )

  let knowledge = null
  if (indexKnowledge) {
    if (!knowledgeDir) {
      throw new Error('indexKnowledge 需要 knowledgeDir')
    }
    knowledge = mirrorChaptersToKnowledge({
      knowledgeDir,
      bookSlug,
      chapters: written,
    })
  }

  return {
    ok: true,
    title: bookTitle,
    slug: bookSlug,
    parser: resolved.parser || extracted.parser,
    contentDir: bookDir,
    catalogPath: join(bookDir, 'CATALOG.json'),
    chapters: written,
    knowledge,
  }
}

function mirrorChaptersToKnowledge({ knowledgeDir, bookSlug, chapters }) {
  // Flat files under knowledgeDir so the default kb indexes them.
  // Nested folders become separate kbIds and are invisible to default search.
  mkdirSync(knowledgeDir, { recursive: true, mode: 0o700 })
  const copied = []
  for (const chapter of chapters) {
    const destName = `${bookSlug}--${chapter.fileName}`
    const dest = join(knowledgeDir, destName)
    if (!existsSync(chapter.path)) continue
    copyFileSync(chapter.path, dest)
    copied.push(destName)
  }
  const indexName = `${bookSlug}--INDEX.md`
  writeFileSync(
    join(knowledgeDir, indexName),
    `# ${bookSlug}\n\n自动从内容库镜像，供 knowledge_search 检索设定/情节问答。\n`,
    'utf8',
  )
  copied.push(indexName)
  return {
    knowledgeDir,
    files: copied,
    hint: '导入后会自动 ingest；也可 POST /api/knowledge/reindex',
  }
}
