import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import { createHash } from 'node:crypto'

/**
 * Markdown-first long-term memory files on disk.
 * Used by OpenViking / EverMind providers as the local readable source of truth
 * (and offline fallback), matching talk-to-fengge persona memories layout.
 */
export class MarkdownMemoryFs {
  constructor({ rootDir } = {}) {
    if (!rootDir) throw new Error('rootDir is required')
    this.rootDir = rootDir
    mkdirSync(rootDir, { recursive: true, mode: 0o700 })
  }

  list({ query = '', limit = 20 } = {}) {
    const needle = String(query || '').trim().toLocaleLowerCase()
    const files = this.#files()
    const entries = files.map(file => this.#readEntry(file)).filter(Boolean)
    const filtered = needle
      ? entries.filter(entry => (
          entry.id.toLocaleLowerCase().includes(needle)
          || entry.content.toLocaleLowerCase().includes(needle)
          || entry.title.toLocaleLowerCase().includes(needle)
        ))
      : entries
    return filtered
      .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
      .slice(0, Math.min(64, Math.max(1, Number(limit) || 20)))
  }

  remember(content) {
    const text = String(content || '').trim()
    if (!text) throw new Error('memory content is required')
    const id = `mem_${createHash('sha256').update(text).digest('hex').slice(0, 16)}`
    const existing = this.#files().find(file => basename(file, '.md') === id)
    const file = existing || join(this.rootDir, `${id}.md`)
    const title = text.slice(0, 40).replace(/\s+/g, ' ')
    const body = [
      '---',
      `id: ${id}`,
      `updated_at: ${Date.now()}`,
      'scope: long_term',
      '---',
      '',
      `# ${title}`,
      '',
      text,
      '',
    ].join('\n')
    const temporary = `${file}.${process.pid}.tmp`
    writeFileSync(temporary, body, { encoding: 'utf8', mode: 0o600 })
    renameSync(temporary, file)
    return {
      id,
      scope: 'long_term',
      content: text,
      updated_at: Date.now(),
      editable: true,
      path: file,
    }
  }

  forget({ query = '', all = false, ids = [] } = {}) {
    const files = this.#files()
    if (all) {
      let removed = 0
      for (const file of files) {
        unlinkSync(file)
        removed += 1
      }
      return removed
    }
    const targets = new Set(ids.map(id => String(id || '').trim()).filter(Boolean))
    const needle = String(query || '').trim().toLocaleLowerCase()
    let removed = 0
    for (const file of files) {
      const entry = this.#readEntry(file)
      if (!entry) continue
      const hit = (
        targets.has(entry.id)
        || (needle && (
          entry.id.toLocaleLowerCase() === needle
          || entry.content.toLocaleLowerCase().includes(needle)
        ))
      )
      if (!hit) continue
      unlinkSync(file)
      removed += 1
    }
    return removed
  }

  #files() {
    if (!existsSync(this.rootDir)) return []
    return readdirSync(this.rootDir)
      .filter(name => name.endsWith('.md') && !name.startsWith('.'))
      .map(name => join(this.rootDir, name))
      .sort()
  }

  #readEntry(file) {
    try {
      const raw = readFileSync(file, 'utf8')
      const id = basename(file, '.md')
      const updated = Number(raw.match(/^updated_at:\s*(\d+)/m)?.[1]) || 0
      const content = raw
        .replace(/^---[\s\S]*?---\s*/m, '')
        .replace(/^#.*$/m, '')
        .trim()
      if (!content) return null
      return {
        id,
        scope: 'long_term',
        title: id,
        content,
        updated_at: updated,
        editable: true,
        path: file,
      }
    } catch {
      return null
    }
  }
}
