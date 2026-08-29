import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MarkdownContentStore } from '../src/voice/reader/content-store.mjs'

test('listBooks groups CATALOG chapters and leftover md', () => {
  const root = mkdtempSync(join(tmpdir(), 'qwaudio-books-'))
  const bookDir = join(root, 'night-story')
  mkdirSync(bookDir)
  writeFileSync(join(bookDir, 'ch-001-open.md'), '# 开端\n\n天黑了。\n')
  writeFileSync(join(bookDir, 'ch-002-end.md'), '# 结尾\n\n天亮了。\n')
  writeFileSync(join(bookDir, 'CATALOG.json'), JSON.stringify({
    title: '夜话',
    slug: 'night-story',
    importedAt: '2026-08-16T00:00:00.000Z',
    chapters: [
      { order: 1, title: '开端', relativePath: 'night-story/ch-001-open.md', fileName: 'ch-001-open.md' },
      { order: 2, title: '结尾', relativePath: 'night-story/ch-002-end.md', fileName: 'ch-002-end.md' },
    ],
  }))
  writeFileSync(join(root, 'scratch.md'), '一段散落长文。\n')

  const store = new MarkdownContentStore({ contentDir: root })
  const catalog = store.listBooks()
  assert.equal(catalog.books.length, 1)
  assert.equal(catalog.books[0].title, '夜话')
  assert.equal(catalog.books[0].chapters.length, 2)
  assert.ok(catalog.books[0].chapters[0].id.startsWith('doc_'))
  assert.equal(catalog.loose.length, 1)
  assert.equal(catalog.loose[0].title, 'scratch')
})
