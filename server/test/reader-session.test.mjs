import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chunkTextForSpeech } from '../src/voice/reader/chunk-text.mjs'
import { MarkdownContentStore } from '../src/voice/reader/content-store.mjs'
import { ReaderSession } from '../src/voice/reader/reader-session.mjs'

test('chunks long chinese text for speak queue', () => {
  const chunks = chunkTextForSpeech(
    '第一句。第二句！第三句？这是一段稍长的说明文字，用来验证分块。',
    { maxChars: 20, minChars: 4 },
  )
  assert.ok(chunks.length >= 2)
  assert.ok(chunks.every(chunk => chunk.length > 0))
})

test('reader can pause and resume from next chunk', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qwaudio-content-'))
  writeFileSync(join(dir, 'chapter.md'), '第一段。第二段。第三段。第四段。')
  const store = new MarkdownContentStore({ contentDir: dir })
  const spoken = []
  let resolveGate
  const gate = new Promise(resolve => { resolveGate = resolve })
  let frontend = {
    speak: async (text) => {
      spoken.push(text)
      if (spoken.length === 1) await gate
    },
    cancel: () => {},
  }
  const reader = new ReaderSession({
    contentStore: store,
    getFrontend: () => frontend,
    gapMs: 0,
    chunkOptions: { maxChars: 8, minChars: 2 },
  })
  const started = await reader.start('read', { contentId: 'chapter' })
  assert.equal(started.status, 'reading')
  assert.ok(started.total >= 2)

  for (let i = 0; i < 30 && spoken.length < 1; i += 1) {
    await new Promise(r => setTimeout(r, 10))
  }
  assert.equal(spoken.length, 1)
  reader.pause()
  assert.equal(reader.snapshot().status, 'paused')
  resolveGate()
  await new Promise(r => setTimeout(r, 20))

  await reader.resume()
  for (let i = 0; i < 50 && reader.snapshot().status !== 'stopped'; i += 1) {
    await new Promise(r => setTimeout(r, 10))
  }
  assert.ok(spoken.length >= 2)
})

test('markdown content store lists md only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qwaudio-content-'))
  writeFileSync(join(dir, 'a.md'), '# A\n')
  writeFileSync(join(dir, 'b.txt'), 'ignore')
  mkdirSync(join(dir, 'nested'))
  writeFileSync(join(dir, 'nested', 'c.md'), '# C\n')
  const store = new MarkdownContentStore({ contentDir: dir })
  const list = store.list()
  assert.equal(list.length, 2)
  assert.ok(store.get('a'))
})
