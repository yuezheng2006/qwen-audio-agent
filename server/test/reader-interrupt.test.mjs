import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MarkdownContentStore } from '../src/voice/reader/content-store.mjs'
import { ReaderSession } from '../src/voice/reader/reader-session.mjs'
import { buildFrontendContext } from '../src/conversation/frontend-agent-context.mjs'

test('reader noteInterruption pauses and resume continues later chunks', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qwaudio-reader-int-'))
  writeFileSync(join(dir, 'book.md'), '一段。二段。三段。四段。')
  const store = new MarkdownContentStore({ contentDir: dir })
  const spoken = []
  let release
  const gate = new Promise(resolve => { release = resolve })
  const reader = new ReaderSession({
    contentStore: store,
    getFrontend: () => ({
      speak: async (text) => {
        spoken.push(text)
        if (spoken.length === 1) await gate
      },
      cancel: () => {},
    }),
    gapMs: 0,
    chunkOptions: { maxChars: 6, minChars: 2 },
  })

  await reader.start('read', { contentId: 'book' })
  for (let i = 0; i < 40 && spoken.length < 1; i += 1) {
    await new Promise(r => setTimeout(r, 10))
  }
  assert.equal(spoken.length, 1)
  reader.noteInterruption()
  assert.equal(reader.snapshot().status, 'paused')
  release()
  await new Promise(r => setTimeout(r, 20))

  const before = spoken.length
  await reader.resume()
  for (let i = 0; i < 50 && reader.snapshot().status !== 'stopped'; i += 1) {
    await new Promise(r => setTimeout(r, 10))
  }
  assert.ok(spoken.length > before)
})

test('frontend context injects knowledge hits when present', () => {
  const context = buildFrontendContext({
    knowledgeHits: [{
      title: 'faq',
      relativePath: 'faq.md',
      content: '默认音色是峰哥复刻',
    }],
  })
  assert.match(context, /## Knowledge/)
  assert.match(context, /峰哥复刻/)
  assert.match(context, /不要编造库外事实/)
})

test('frontend context omits knowledge section without hits', () => {
  const context = buildFrontendContext({ knowledgeHits: [] })
  assert.doesNotMatch(context, /## Knowledge/)
})
