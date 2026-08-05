import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs'
import { basename, extname, join, relative, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { chunkMarkdown, scoreChunk } from './chunk-md.mjs'
import { assertKnowledgeProvider } from './provider.mjs'

/**
 * Markdown-first local knowledge base.
 * Source of truth = *.md under knowledgeDir (optionally per-kb subfolders).
 * Index is always rebuilt from markdown — never treated as the corpus.
 */
export function createLocalKnowledgeProvider({
  knowledgeDir,
  defaultKbId = 'default',
} = {}) {
  if (!knowledgeDir) throw new Error('knowledgeDir is required')
  mkdirSync(knowledgeDir, { recursive: true, mode: 0o700 })

  /** @type {Map<string, { sources: any[], chunks: any[], builtAt: number }>} */
  const indexes = new Map()

  function kbRoot(kbId = defaultKbId) {
    const id = String(kbId || defaultKbId).trim() || defaultKbId
    // Flat layout: markdown directly under knowledgeDir => default kb
    // Nested: knowledgeDir/<kbId>/**/*.md
    const nested = resolve(knowledgeDir, id)
    if (id !== defaultKbId || existsSync(nested) && statSync(nested).isDirectory()) {
      // Prefer nested when the folder exists; for default also accept root md files
      if (id === defaultKbId) return knowledgeDir
      mkdirSync(nested, { recursive: true, mode: 0o700 })
      return nested
    }
    return knowledgeDir
  }

  function listMarkdownFiles(root) {
    const files = []
    const walk = (dir) => {
      if (!existsSync(dir)) return
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full)
          continue
        }
        if (extname(entry.name).toLowerCase() === '.md') files.push(full)
      }
    }
    walk(root)
    return files.sort()
  }

  function discoverKbIds() {
    const ids = new Set([defaultKbId])
    if (!existsSync(knowledgeDir)) return [...ids]
    for (const entry of readdirSync(knowledgeDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const nestedMd = listMarkdownFiles(join(knowledgeDir, entry.name))
      if (nestedMd.length) ids.add(entry.name)
    }
    return [...ids]
  }

  function buildIndex(kbId = defaultKbId) {
    const root = kbRoot(kbId)
    const files = listMarkdownFiles(root)
    // For default kb, only take root-level tree files that are NOT inside
    // another kb subfolder that itself looks like a kb (has md). Nested kb
    // folders are separate corpora.
    const nestedKbDirs = new Set(
      discoverKbIds().filter(id => id !== defaultKbId).map(id => resolve(knowledgeDir, id)),
    )
    const filtered = kbId === defaultKbId
      ? files.filter(file => ![...nestedKbDirs].some(dir => file.startsWith(`${dir}/`)))
      : files

    const sources = []
    const chunks = []
    for (const file of filtered) {
      const raw = readFileSync(file, 'utf8')
      const rel = relative(root, file)
      const sourceId = `src_${createHash('sha256').update(rel).digest('hex').slice(0, 12)}`
      const title = basename(file, extname(file))
      sources.push({
        id: sourceId,
        path: file,
        relativePath: rel,
        title,
        bytes: Buffer.byteLength(raw, 'utf8'),
        mtimeMs: statSync(file).mtimeMs,
      })
      for (const chunk of chunkMarkdown(raw, { sourceId })) {
        chunks.push({
          ...chunk,
          kbId,
          title,
          relativePath: rel,
        })
      }
    }
    const built = { sources, chunks, builtAt: Date.now(), kbId }
    indexes.set(kbId, built)
    return built
  }

  function ensureIndex(kbId = defaultKbId) {
    return indexes.get(kbId) || buildIndex(kbId)
  }

  const provider = {
    kind: 'local',
    knowledgeDir,
    ingest({ kbId = defaultKbId } = {}) {
      return buildIndex(kbId)
    },
    search(query, { kbId = defaultKbId, limit = 6 } = {}) {
      const needle = String(query || '').trim()
      if (!needle) return []
      const index = ensureIndex(kbId)
      const top = Math.min(20, Math.max(1, Number(limit) || 6))
      return index.chunks
        .map(chunk => ({
          id: chunk.id,
          kbId: chunk.kbId,
          sourceId: chunk.sourceId,
          title: chunk.title,
          relativePath: chunk.relativePath,
          heading: chunk.heading,
          content: chunk.content,
          score: scoreChunk(needle, `${chunk.title}\n${chunk.heading || ''}\n${chunk.content}`),
        }))
        .filter(hit => hit.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, top)
    },
    listSources({ kbId } = {}) {
      if (kbId) return ensureIndex(kbId).sources
      return discoverKbIds().flatMap(id => (
        ensureIndex(id).sources.map(source => ({ ...source, kbId: id }))
      ))
    },
    listContents() {
      // Alias used by reader discovery of markdown corpora under knowledge/
      return this.listSources()
    },
    health() {
      const kbIds = discoverKbIds()
      let sourceCount = 0
      let chunkCount = 0
      for (const id of kbIds) {
        const index = ensureIndex(id)
        sourceCount += index.sources.length
        chunkCount += index.chunks.length
      }
      return {
        kind: 'local',
        ok: true,
        format: 'markdown',
        knowledgeDir,
        kbIds,
        sourceCount,
        chunkCount,
        warning: sourceCount
          ? null
          : `no .md files under ${knowledgeDir}; drop markdown into this folder`,
      }
    },
  }

  return assertKnowledgeProvider(provider, 'local')
}

export function createNoneKnowledgeProvider() {
  return assertKnowledgeProvider({
    kind: 'none',
    ingest: () => ({ sources: [], chunks: [] }),
    search: () => [],
    listSources: () => [],
    health: () => ({
      kind: 'none',
      ok: true,
      format: 'markdown',
      sourceCount: 0,
      chunkCount: 0,
      warning: 'knowledge provider disabled',
    }),
  }, 'none')
}
