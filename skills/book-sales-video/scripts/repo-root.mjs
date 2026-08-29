import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function findQwaudioRoot(startDir = dirname(fileURLToPath(import.meta.url))) {
  if (process.env.QWAUDIO_ROOT) {
    const root = String(process.env.QWAUDIO_ROOT).trim()
    if (root && existsSync(join(root, 'package.json'))) return root
  }
  let dir = startDir
  for (let i = 0; i < 12; i += 1) {
    const pkg = join(dir, 'package.json')
    if (existsSync(pkg)) {
      try {
        const json = JSON.parse(readFileSync(pkg, 'utf8'))
        if (json?.name === 'qwen-audio-agent') return dir
      } catch {
        // continue
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(
    '找不到 qwen-audio-agent 仓库根目录。请从本仓 skills/book-sales-video 运行，或设置 QWAUDIO_ROOT。',
  )
}
