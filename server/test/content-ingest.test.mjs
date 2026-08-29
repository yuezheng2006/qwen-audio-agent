import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  slugifyTitle,
  splitMarkdownIntoChapters,
} from '../src/voice/reader/ingest/split-chapters.mjs'
import {
  extractMarkdownFromSource,
  resolveParseStrategy,
  writeTempMarkdown,
} from '../src/voice/reader/ingest/mineru-client.mjs'
import {
  fetchUrlAsMarkdown,
  htmlToReadableMarkdown,
  importContentDocument,
} from '../src/voice/reader/ingest/import-content.mjs'
import { MarkdownContentStore } from '../src/voice/reader/content-store.mjs'
import { createLocalKnowledgeProvider } from '../src/knowledge/local-provider.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const IMPORT_CLI = join(REPO_ROOT, 'scripts/import-content.mjs')

test('split chapters on Chinese and markdown headings', () => {
  const chapters = splitMarkdownIntoChapters(`
前言废话

# 第一章 开端

天黑了。

## 插曲

雨还在下。

第二章 远行

他走了。
`.trim(), { title: '测试书' })

  assert.ok(chapters.length >= 3)
  const opening = chapters.find(item => /开端|第一章/.test(item.title))
  assert.ok(opening)
  assert.match(opening.body, /天黑了/)
})

test('split chapters on English Chapter headings', () => {
  const chapters = splitMarkdownIntoChapters(`
Chapter 1 Dawn

Light rose.

Chapter 2 Dusk

Night fell.
`.trim(), { title: 'EN' })
  assert.equal(chapters.length, 2)
  assert.match(chapters[0].title, /Chapter 1/i)
  assert.match(chapters[1].body, /Night fell/)
})

test('split empty markdown returns empty list', () => {
  assert.deepEqual(splitMarkdownIntoChapters(''), [])
  assert.deepEqual(splitMarkdownIntoChapters('   \n\n'), [])
})

test('split falls back to size windows when no headings', () => {
  const blob = `${'甲乙丙丁戊己庚辛壬癸。'.repeat(2_000)}\n\n${'子丑寅卯辰巳午未申酉。'.repeat(2_000)}`
  assert.ok(blob.length > 12_000)
  const chapters = splitMarkdownIntoChapters(blob, {
    title: '长卷',
    maxChapterChars: 4_000,
  })
  assert.ok(chapters.length >= 3)
  assert.match(chapters[0].title, /长卷/)
  assert.match(chapters[0].body, /^# /)
})

test('slugify strips unsafe path characters', () => {
  assert.equal(slugifyTitle('峰哥/口述:卷一'), '峰哥-口述-卷一')
  assert.equal(slugifyTitle(''), 'book')
  assert.equal(slugifyTitle('   '), 'book')
  assert.equal(slugifyTitle('a'.repeat(100)).length, 80)
})

test('paste and URL import write catalog chapters', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qwaudio-paste-'))
  const pasted = await importContentDocument({
    contentDir: root,
    title: '粘贴长文',
    markdown: '# 第一章\n\n天黑了。风很大。路很远。\n\n# 第二章\n\n他走了。再也没回来。\n',
  })
  assert.equal(pasted.parser, 'paste')
  assert.ok(pasted.chapters.length >= 2)

  const html = htmlToReadableMarkdown('<html><body><h1>标题</h1><p>这是一段足够长的正文用来通过导入门槛检查。</p></body></html>')
  assert.match(html, /标题/)
  assert.doesNotMatch(html, /<p>/)

  const fetched = await fetchUrlAsMarkdown('https://example.test/a.md', async () => ({
    ok: true,
    headers: { get: () => 'text/markdown' },
    text: async () => '# 远程\n\n足够长的远程正文，用于确认 URL 导入路径。\n',
  }))
  assert.equal(fetched.parser, 'url-text')
  assert.match(fetched.markdown, /远程/)

  const uploaded = await importContentDocument({
    contentDir: join(root, 'upload-lib'),
    title: '上传书',
    fileName: 'book.md',
    fileBytes: Buffer.from('# 第一章\n\n上传正文足够长。\n\n# 第二章\n\n上传结束。\n'),
  })
  assert.equal(uploaded.parser, 'upload')
  assert.ok(uploaded.chapters.length >= 2)
})

test('parse strategy routes text vs mineru vs unsupported', () => {
  assert.equal(resolveParseStrategy('a.md'), 'plaintext')
  assert.equal(resolveParseStrategy('a.markdown'), 'plaintext')
  assert.equal(resolveParseStrategy('a.txt'), 'plaintext')
  assert.equal(resolveParseStrategy('a.PDF'), 'mineru')
  assert.equal(resolveParseStrategy('a.docx'), 'mineru')
  assert.equal(resolveParseStrategy('a.png'), 'mineru')
  assert.equal(resolveParseStrategy('a.epub'), 'unsupported')
})

test('extract plaintext and reject missing or unsupported sources', async () => {
  const mdPath = writeTempMarkdown('# hi\n\nok\n')
  const plain = await extractMarkdownFromSource(mdPath)
  assert.equal(plain.parser, 'plaintext')
  assert.match(plain.markdown, /ok/)

  await assert.rejects(
    () => extractMarkdownFromSource(join(tmpdir(), 'no-such-file-qwaudio.md')),
    /源文件不存在/,
  )

  const root = mkdtempSync(join(tmpdir(), 'qwaudio-unsup-'))
  const epub = join(root, 'x.epub')
  writeFileSync(epub, 'fake')
  await assert.rejects(
    () => extractMarkdownFromSource(epub),
    /暂不支持/,
  )
})

test('extract via MinerU API mock payloads and errors', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qwaudio-mineru-api-'))
  const pdf = join(root, 'scan.pdf')
  writeFileSync(pdf, '%PDF-fake')

  const ok = await extractMarkdownFromSource(pdf, {
    apiUrl: 'http://mineru.test',
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ md_content: '# From API\n\nbody\n' }),
      text: async () => '',
    }),
  })
  assert.equal(ok.parser, 'mineru-api')
  assert.match(ok.markdown, /From API/)

  const nested = await extractMarkdownFromSource(pdf, {
    apiUrl: 'http://mineru.test/',
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        results: [{ markdown: '# Nested\n\nx\n' }],
      }),
      text: async () => '',
    }),
  })
  assert.match(nested.markdown, /Nested/)

  const plainBody = await extractMarkdownFromSource(pdf, {
    apiUrl: 'http://mineru.test',
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => 'text/plain' },
      text: async () => '# Plain body\n\ny\n',
      json: async () => ({}),
    }),
  })
  assert.match(plainBody.markdown, /Plain body/)

  await assert.rejects(
    () => extractMarkdownFromSource(pdf, {
      apiUrl: 'http://mineru.test',
      fetchImpl: async () => ({
        ok: false,
        status: 500,
        headers: { get: () => 'text/plain' },
        text: async () => 'boom',
      }),
    }),
    /MinerU API 失败 \(500\)/,
  )

  await assert.rejects(
    () => extractMarkdownFromSource(pdf, {
      apiUrl: 'http://mineru.test',
      fetchImpl: async () => ({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ status: 'ok' }),
        text: async () => '',
      }),
    }),
    /未返回 Markdown/,
  )
})

test('extract via MinerU CLI mock and ENOENT guidance', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qwaudio-mineru-cli-'))
  const pdf = join(root, 'scan.pdf')
  writeFileSync(pdf, '%PDF-fake')
  const workDir = join(root, 'work')
  mkdirSync(workDir)

  const viaCli = await extractMarkdownFromSource(pdf, {
    apiUrl: '',
    workDir,
    runCommand: async (_cmd, args) => {
      const outDir = args[args.indexOf('-o') + 1]
      mkdirSync(join(outDir, 'nested'), { recursive: true })
      writeFileSync(join(outDir, 'nested', 'full.md'), '# CLI\n\nparsed\n')
      return { code: 0, stderr: '' }
    },
  })
  assert.equal(viaCli.parser, 'mineru-cli')
  assert.match(viaCli.markdown, /parsed/)

  await assert.rejects(
    () => extractMarkdownFromSource(pdf, {
      apiUrl: '',
      runCommand: async () => {
        const err = new Error('spawn mineru ENOENT')
        err.code = 'ENOENT'
        throw err
      },
    }),
    /未找到 MinerU/,
  )
})

test('import plaintext book writes chapters catalog and optional knowledge mirror', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qwaudio-ingest-'))
  const contentDir = join(root, 'content')
  const knowledgeDir = join(root, 'knowledge')
  const sourcePath = join(root, 'novel.md')
  writeFileSync(sourcePath, `# 第一章\n\n夜色渐浓。\n\n# 第二章\n\n晨光初现。\n`)

  const result = await importContentDocument({
    sourcePath,
    contentDir,
    knowledgeDir,
    title: '夜航',
    indexKnowledge: true,
  })

  assert.equal(result.parser, 'plaintext')
  assert.equal(result.chapters.length, 2)
  assert.ok(existsSync(result.catalogPath))
  const catalog = JSON.parse(readFileSync(result.catalogPath, 'utf8'))
  assert.equal(catalog.title, '夜航')
  assert.equal(catalog.chapterCount, 2)
  assert.equal(catalog.chapters[0].order, 1)

  const store = new MarkdownContentStore({ contentDir })
  const listed = store.list()
  assert.ok(listed.some(item => item.relativePath.includes('ch-001')))
  assert.ok(existsSync(join(knowledgeDir, '夜航--INDEX.md')))
  assert.ok(existsSync(join(knowledgeDir, `夜航--${catalog.chapters[0].fileName}`)))

  const kb = createLocalKnowledgeProvider({ knowledgeDir })
  kb.ingest()
  const hits = kb.search('夜色渐浓', { limit: 5 })
  assert.ok(hits.length >= 1)
  assert.match(hits[0].content, /夜色/)
})

test('import uses injected mineru extract for pdf-like sources', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qwaudio-ingest-pdf-'))
  const contentDir = join(root, 'content')
  const sourcePath = join(root, 'scan.pdf')
  writeFileSync(sourcePath, '%PDF-fake')

  const result = await importContentDocument({
    sourcePath,
    contentDir,
    title: '扫描件',
    extract: async () => ({
      markdown: '# 第1章\n\n你好。\n\n# 第2章\n\n再见。\n',
      parser: 'mineru-api',
      strategy: 'mineru',
    }),
  })

  assert.equal(result.parser, 'mineru-api')
  assert.equal(result.chapters.length, 2)
  assert.match(readFileSync(result.chapters[0].path, 'utf8'), /你好/)
})

test('import validates inputs and empty parse results', async () => {
  await assert.rejects(
    () => importContentDocument({ sourcePath: '/tmp/x.md' }),
    /contentDir is required/,
  )
  await assert.rejects(
    () => importContentDocument({ contentDir: '/tmp/c' }),
    /sourcePath|markdown|url|文件/,
  )

  const root = mkdtempSync(join(tmpdir(), 'qwaudio-ingest-err-'))
  const contentDir = join(root, 'content')
  const sourcePath = join(root, 'empty.md')
  writeFileSync(sourcePath, '   \n')
  await assert.rejects(
    () => importContentDocument({ sourcePath, contentDir }),
    /解析结果为空/,
  )

  writeFileSync(sourcePath, '# Only\n\nhi\n')
  await assert.rejects(
    () => importContentDocument({
      sourcePath,
      contentDir,
      indexKnowledge: true,
    }),
    /indexKnowledge 需要 knowledgeDir/,
  )
})

test('CLI content:import writes chapters with explicit dirs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qwaudio-ingest-cli-'))
  const contentDir = join(root, 'content')
  const knowledgeDir = join(root, 'knowledge')
  const sourcePath = join(root, 'cli-book.md')
  writeFileSync(sourcePath, '# 第一章\n\nCLI 开场。\n\n# 第二章\n\nCLI 收场。\n')

  const { code, stdout, stderr } = await runNode([
    IMPORT_CLI,
    sourcePath,
    '--title', 'CLI书',
    '--content-dir', contentDir,
    '--knowledge-dir', knowledgeDir,
    '--index-knowledge',
  ])
  assert.equal(code, 0, stderr || stdout)
  const payload = JSON.parse(stdout)
  assert.equal(payload.ok, true)
  assert.equal(payload.chapters, 2)
  assert.equal(payload.parser, 'plaintext')
  assert.ok(existsSync(payload.catalogPath))
  assert.ok(existsSync(join(knowledgeDir, 'CLI书--INDEX.md')))
})

test('CLI help exits 0; missing source exits non-zero', async () => {
  const help = await runNode([IMPORT_CLI, '--help'])
  assert.equal(help.code, 0)
  assert.match(help.stdout, /content:import/)

  const missing = await runNode([IMPORT_CLI])
  assert.notEqual(missing.code, 0)
})

function runNode(args) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, args, {
      cwd: REPO_ROOT,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('close', code => resolve({ code, stdout, stderr }))
  })
}
