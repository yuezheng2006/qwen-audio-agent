import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createReaderProgressStore } from '../src/voice/reader/reader-progress.mjs'

test('reader progress persists per owner and content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qwaudio-progress-'))
  const store = createReaderProgressStore({
    filePath: join(dir, 'reader-progress.json'),
    now: () => 1000,
  })
  const saved = store.put('owner-a', {
    contentId: 'doc_1',
    index: 3,
    total: 10,
    title: '开端',
    bookSlug: 'night-story',
  })
  assert.equal(saved.index, 3)
  assert.equal(store.get('owner-a', 'doc_1').title, '开端')
  assert.equal(store.list('owner-a').length, 1)
  assert.equal(store.get('owner-b', 'doc_1'), null)

  const reopened = createReaderProgressStore({
    filePath: join(dir, 'reader-progress.json'),
  })
  assert.equal(reopened.get('owner-a', 'doc_1').index, 3)
})
