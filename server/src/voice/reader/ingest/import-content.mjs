/**
 * Import large documents into CONTENT_DIR as chapter Markdown.
 * Optional mirror into KNOWLEDGE_DIR for retrieval Q&A.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs'
import { basename, extname, join } from 'node:path'
import { extractMarkdownFromSource } from './mineru-client.mjs'
import { slugifyTitle, splitMarkdownIntoChapters } from './split-chapters.mjs'

export async function importContentDocument({
  sourcePath,
  contentDir,
  knowledgeDir = '',
  title = '',
  indexKnowledge = false,
  extract = extractMarkdownFromSource,
  extractOptions = {},
} = {}) {
  if (!contentDir) throw new Error('contentDir is required')
  if (!sourcePath) throw new Error('sourcePath is required')

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
    parser: extracted.parser,
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
    parser: extracted.parser,
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
