import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function parseFrontmatter(raw) {
  const text = String(raw || '')
  if (!text.startsWith('---')) {
    return { meta: {}, body: text.trim() }
  }
  const end = text.indexOf('\n---', 3)
  if (end < 0) return { meta: {}, body: text.trim() }
  const fm = text.slice(3, end).trim()
  const body = text.slice(end + 4).trim()
  const meta = {}
  for (const line of fm.split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/)
    if (!match) continue
    const key = match[1]
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (value === 'true') value = true
    else if (value === 'false') value = false
    meta[key] = value
  }
  return { meta, body }
}

function walkSkillFiles(root) {
  const out = []
  if (!root || !existsSync(root)) return out
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()
    let entries = []
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of entries) {
      if (name.startsWith('.')) continue
      const full = join(dir, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        stack.push(full)
        continue
      }
      if (name === 'SKILL.md') out.push(full)
    }
  }
  return out.sort()
}

export function loadSkillsFromDir(skillsDir, {
  maxBodyChars = 1200,
} = {}) {
  const files = walkSkillFiles(skillsDir)
  const skills = []
  for (const file of files) {
    let raw = ''
    try {
      raw = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const { meta, body } = parseFrontmatter(raw)
    const name = String(meta.name || file.split('/').slice(-2, -1)[0] || 'skill').trim()
    if (!name) continue
    skills.push({
      name,
      description: String(meta.description || '').trim(),
      enabled: meta.enabled !== false,
      triggers: String(meta.triggers || '').trim(),
      path: file,
      body: body.slice(0, maxBodyChars),
    })
  }
  return skills
}
