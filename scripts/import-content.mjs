#!/usr/bin/env node
/**
 * Import a large document into the local content library via MinerU when needed.
 *
 *   npm run content:import -- ./book.pdf --title 某书 --index-knowledge
 */

import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { importContentDocument } from '../server/src/voice/reader/ingest/import-content.mjs'
import { userConfigDirectory } from '../shared/runtime-environment.mjs'

function parseArgs(argv) {
  const out = {
    sourcePath: '',
    title: '',
    indexKnowledge: false,
    contentDir: process.env.CONTENT_DIR || '',
    knowledgeDir: process.env.KNOWLEDGE_DIR || '',
    apiUrl: process.env.MINERU_API_URL || '',
  }
  const positionals = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--title') out.title = argv[++i] || ''
    else if (arg === '--content-dir') out.contentDir = argv[++i] || ''
    else if (arg === '--knowledge-dir') out.knowledgeDir = argv[++i] || ''
    else if (arg === '--mineru-api') out.apiUrl = argv[++i] || ''
    else if (arg === '--index-knowledge') out.indexKnowledge = true
    else if (arg === '-h' || arg === '--help') out.help = true
    else if (!arg.startsWith('-')) positionals.push(arg)
  }
  out.sourcePath = positionals[0] || ''
  return out
}

function usage(code = 0) {
  process.stdout.write(`用法：
  npm run content:import -- <文件> [--title 书名] [--index-knowledge]
  npm run content:import -- ./novel.pdf --title 某书 --mineru-api http://127.0.0.1:8000

说明：
  - PDF/DOCX/PPTX/XLSX/图片 → MinerU（MINERU_API_URL 或 mineru CLI）
  - .md/.txt → 直接分章写入 CONTENT_DIR
  - 详见 docs/content-ingest-rag.md
`)
  process.exit(code)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.sourcePath) usage(args.help ? 0 : 1)

  const configRoot = userConfigDirectory(process.env, homedir())
  const contentDir = resolve(args.contentDir || resolve(configRoot, 'content'))
  const knowledgeDir = resolve(args.knowledgeDir || resolve(configRoot, 'knowledge'))
  const sourcePath = resolve(args.sourcePath)

  const result = await importContentDocument({
    sourcePath,
    contentDir,
    knowledgeDir,
    title: args.title,
    indexKnowledge: args.indexKnowledge,
    extractOptions: {
      apiUrl: args.apiUrl,
    },
  })

  process.stdout.write(`${JSON.stringify({
    ok: result.ok,
    title: result.title,
    slug: result.slug,
    parser: result.parser,
    chapters: result.chapters.length,
    contentDir: result.contentDir,
    catalogPath: result.catalogPath,
    knowledge: result.knowledge,
    next: 'content_control list / start_read；若 indexKnowledge 则 POST /api/knowledge/reindex',
  }, null, 2)}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(`${error.message || error}\n`)
    process.exitCode = 1
  })
}
