import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs'
import { basename, extname, join, relative, resolve } from 'node:path'
import { createHash } from 'node:crypto'

/**
 * Markdown-first content library for read/explain modes.
 * Source of truth = *.md under contentDir.
 */
export class MarkdownContentStore {
  constructor({ contentDir } = {}) {
    if (!contentDir) throw new Error('contentDir is required')
    this.contentDir = contentDir
    mkdirSync(contentDir, { recursive: true, mode: 0o700 })
  }

  list() {
    return this.#files().map(file => this.#meta(file))
  }

  get(contentIdOrName) {
    const key = String(contentIdOrName || '').trim()
    if (!key) return null
    const files = this.#files()
    const byId = files.find(file => this.#idFor(file) === key)
    if (byId) return this.#load(byId)
    const byName = files.find(file => (
      basename(file, extname(file)) === key
      || relative(this.contentDir, file) === key
      || basename(file) === key
    ))
    return byName ? this.#load(byName) : null
  }

  health() {
    const items = this.list()
    return {
      ok: true,
      format: 'markdown',
      contentDir: this.contentDir,
      count: items.length,
      warning: items.length
        ? null
        : `no .md files under ${this.contentDir}`,
    }
  }

  listBooks() {
    const files = this.list()
    const byRel = new Map(files.map(item => [item.relativePath, item]))
    const claimed = new Set()
    const books = []
    if (existsSync(this.contentDir)) {
      for (const entry of readdirSync(this.contentDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const catalogPath = join(this.contentDir, entry.name, 'CATALOG.json')
        if (!existsSync(catalogPath)) continue
        let catalog
        try {
          catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
        } catch {
          continue
        }
        const chapters = (catalog.chapters || []).map(chapter => {
          const meta = byRel.get(chapter.relativePath)
          if (meta) claimed.add(meta.id)
          return {
            order: chapter.order,
            title: chapter.title,
            relativePath: chapter.relativePath,
            fileName: chapter.fileName,
            id: meta?.id || null,
            bytes: meta?.bytes || 0,
          }
        }).filter(chapter => chapter.id)
        books.push({
          slug: catalog.slug || entry.name,
          title: catalog.title || entry.name,
          catalog: true,
          importedAt: catalog.importedAt || null,
          chapterCount: chapters.length,
          chapters,
        })
      }
    }
    const loose = files.filter(item => !claimed.has(item.id))
    return { books, loose, count: books.length + (loose.length ? 1 : 0) }
  }

  #files() {
    const files = []
    const walk = (dir) => {
      if (!existsSync(dir)) return
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (extname(entry.name).toLowerCase() === '.md') files.push(full)
      }
    }
    walk(this.contentDir)
    return files.sort()
  }

  #idFor(file) {
    const rel = relative(this.contentDir, file)
    return `doc_${createHash('sha256').update(rel).digest('hex').slice(0, 12)}`
  }

  #meta(file) {
    const rel = relative(this.contentDir, file)
    return {
      id: this.#idFor(file),
      title: basename(file, extname(file)),
      relativePath: rel,
      path: file,
      bytes: statSync(file).size,
      mtimeMs: statSync(file).mtimeMs,
    }
  }

  #load(file) {
    const meta = this.#meta(file)
    return {
      ...meta,
      text: readFileSync(file, 'utf8'),
    }
  }
}

export function resolveContentPath(contentDir, root, env = process.env) {
  if (env.CONTENT_DIR) return resolve(env.CONTENT_DIR)
  if (contentDir) return resolve(contentDir)
  return resolve(root, 'content')
}
