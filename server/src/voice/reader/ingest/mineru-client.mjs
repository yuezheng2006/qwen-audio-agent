/**
 * MinerU access seam (opendatalab/MinerU).
 * Prefer HTTP mineru-api; fall back to local `mineru` CLI.
 * https://github.com/opendatalab/MinerU
 */

import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'

const DIRECT_TEXT_EXT = new Set(['.md', '.markdown', '.txt', '.text'])
const MINERU_EXT = new Set([
  '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.bmp',
  '.docx', '.pptx', '.xlsx',
])

export function resolveParseStrategy(filePath) {
  const ext = extname(filePath || '').toLowerCase()
  if (DIRECT_TEXT_EXT.has(ext)) return 'plaintext'
  if (MINERU_EXT.has(ext)) return 'mineru'
  return 'unsupported'
}

export async function extractMarkdownFromSource(sourcePath, {
  apiUrl = process.env.MINERU_API_URL || '',
  fetchImpl = globalThis.fetch,
  runCommand = defaultRunCommand,
  workDir,
} = {}) {
  const absolute = String(sourcePath || '').trim()
  if (!absolute || !existsSync(absolute)) {
    throw new Error(`源文件不存在：${sourcePath}`)
  }
  const strategy = resolveParseStrategy(absolute)
  if (strategy === 'plaintext') {
    return {
      markdown: readFileSync(absolute, 'utf8'),
      parser: 'plaintext',
      strategy,
    }
  }
  if (strategy === 'unsupported') {
    throw new Error(
      `暂不支持 ${extname(absolute) || '未知'}；请用 PDF/DOCX/PPTX/XLSX/图片，或先转为 Markdown。推荐 MinerU：https://github.com/opendatalab/MinerU`,
    )
  }

  const baseUrl = String(apiUrl || '').replace(/\/+$/, '')
  if (baseUrl) {
    const markdown = await parseViaMineruApi(absolute, baseUrl, fetchImpl)
    return { markdown, parser: 'mineru-api', strategy }
  }

  const markdown = await parseViaMineruCli(absolute, {
    runCommand,
    workDir,
  })
  return { markdown, parser: 'mineru-cli', strategy }
}

async function parseViaMineruApi(filePath, baseUrl, fetchImpl) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('MinerU API 需要 fetch')
  }
  const bytes = readFileSync(filePath)
  const form = new FormData()
  form.append(
    'files',
    new Blob([Uint8Array.from(bytes)]),
    basename(filePath),
  )
  form.append('return_md', 'true')

  const response = await fetchImpl(`${baseUrl}/file_parse`, {
    method: 'POST',
    body: form,
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(
      `MinerU API 失败 (${response.status}): ${detail.slice(0, 240)}`,
    )
  }

  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const payload = await response.json()
    const markdown = pickMarkdownFromApiPayload(payload)
    if (!markdown) {
      throw new Error('MinerU API 未返回 Markdown（return_md=true）')
    }
    return markdown
  }

  // Some deployments return plain markdown or a zip; prefer text body.
  const text = await response.text()
  if (text.trim().startsWith('{')) {
    try {
      const markdown = pickMarkdownFromApiPayload(JSON.parse(text))
      if (markdown) return markdown
    } catch {
      // fall through
    }
  }
  if (text.trim()) return text
  throw new Error('MinerU API 返回空结果')
}

function pickMarkdownFromApiPayload(payload) {
  if (!payload || typeof payload !== 'object') return ''
  if (typeof payload.md_content === 'string') return payload.md_content
  if (typeof payload.markdown === 'string') return payload.markdown
  if (typeof payload.content === 'string') return payload.content
  const results = payload.results || payload.data || payload.files
  if (Array.isArray(results)) {
    for (const item of results) {
      const md = pickMarkdownFromApiPayload(item)
      if (md) return md
    }
  }
  if (results && typeof results === 'object') {
    for (const value of Object.values(results)) {
      if (typeof value === 'string' && value.includes('#')) return value
      const md = pickMarkdownFromApiPayload(value)
      if (md) return md
    }
  }
  return ''
}

async function parseViaMineruCli(filePath, { runCommand, workDir } = {}) {
  const root = workDir || mkdtempSync(join(tmpdir(), 'qwaudio-mineru-'))
  const outDir = join(root, 'out')
  mkdirSync(outDir, { recursive: true })
  try {
    await runCommand('mineru', ['-p', filePath, '-o', outDir], {
      timeoutMs: 600_000,
    })
    const markdownPath = findFirstMarkdown(outDir)
    if (!markdownPath) {
      throw new Error(`MinerU CLI 未产出 Markdown：${outDir}`)
    }
    return readFileSync(markdownPath, 'utf8')
  } catch (error) {
    const message = String(error?.message || error)
    if (/ENOENT|not found|spawn mineru/i.test(message)) {
      throw new Error(
        '未找到 MinerU。请安装并启动其一：\n'
        + '  1) mineru-api --host 127.0.0.1 --port 8000 且设置 MINERU_API_URL\n'
        + '  2) 或安装 mineru CLI：https://github.com/opendatalab/MinerU',
      )
    }
    throw error
  } finally {
    if (!workDir) {
      try { rmSync(root, { recursive: true, force: true }) } catch { /* ignore */ }
    }
  }
}

function findFirstMarkdown(dir) {
  const stack = [dir]
  const hits = []
  while (stack.length) {
    const current = stack.pop()
    if (!existsSync(current)) continue
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (extname(entry.name).toLowerCase() === '.md') hits.push(full)
    }
  }
  hits.sort((a, b) => {
    const prefer = name => /full|md|content/i.test(basename(name)) ? 0 : 1
    return prefer(a) - prefer(b) || statSync(b).size - statSync(a).size
  })
  return hits[0] || null
}

function defaultRunCommand(command, args, { timeoutMs = 600_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`命令超时：${command}`))
    }, timeoutMs)
    timer.unref?.()
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('error', reject)
    child.on('close', code => {
      clearTimeout(timer)
      if (code === 0) resolve({ code, stderr })
      else reject(new Error(`${command} 退出 ${code}: ${stderr.slice(0, 400)}`))
    })
  })
}

// Kept for tests that want to write a fixture without spawning MinerU.
export function writeTempMarkdown(markdown, fileName = 'source.md') {
  const dir = mkdtempSync(join(tmpdir(), 'qwaudio-md-'))
  const path = join(dir, fileName)
  writeFileSync(path, markdown, 'utf8')
  return path
}
