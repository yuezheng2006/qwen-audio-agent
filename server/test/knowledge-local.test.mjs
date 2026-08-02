import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalKnowledgeProvider } from '../src/knowledge/local-provider.mjs'
import { chunkMarkdown, scoreChunk } from '../src/knowledge/chunk-md.mjs'

test('chunks markdown by headings', () => {
  const chunks = chunkMarkdown([
    '# 产品',
    '',
    '峰哥语音助手支持级联复刻。',
    '',
    '## 价格',
    '',
    '个人版免费试用。',
  ].join('\n'), { sourceId: 'demo' })
  assert.ok(chunks.length >= 2)
  assert.ok(chunks.some(chunk => chunk.content.includes('复刻')))
})

test('local knowledge is markdown-first and searchable', () => {
  const root = mkdtempSync(join(tmpdir(), 'qwaudio-kb-'))
  writeFileSync(join(root, 'faq.md'), [
    '# FAQ',
    '',
    '默认音色是峰哥复刻，前台模式是 cascade。',
    '',
    'S2S 只用系统音色 longanqian。',
  ].join('\n'))
  const nested = join(root, 'handbook')
  mkdirSync(nested)
  writeFileSync(join(nested, 'guide.md'), '# 手册\n\n如何导入 Markdown 知识库。\n')

  const provider = createLocalKnowledgeProvider({ knowledgeDir: root })
  const built = provider.ingest()
  assert.ok(built.sources.length >= 1)
  assert.ok(built.chunks.length >= 1)
  assert.equal(provider.health().format, 'markdown')

  const hits = provider.search('峰哥复刻 cascade')
  assert.ok(hits.length >= 1)
  assert.match(hits[0].content, /峰哥|cascade/)
  assert.ok(scoreChunk('峰哥', '峰哥复刻音色') > 0)
})
