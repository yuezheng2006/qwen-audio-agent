import { createHash } from 'node:crypto'
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'

const MAX_PROFILE_CHARS = 6000
const MAX_ENTRY_CHARS = 500
const MAX_MANAGED_ENTRIES = 32
const MANAGED_START = '<!-- qwenaudio:managed-profile:start -->'
const MANAGED_END = '<!-- qwenaudio:managed-profile:end -->'
const MANAGED_HEADING = '## 千问Audio 维护的档案'

function bounded(value) {
  return [...String(value || '').trim()].slice(0, MAX_PROFILE_CHARS).join('')
}

function hasProfileData(content) {
  return content
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .map(line => line.trim())
    .some(line => line && !line.startsWith('#') && line !== '-' && !/^- [^：]+：$/.test(line))
}

function clean(value, limit = MAX_ENTRY_CHARS) {
  return [...String(value || '')
    .replaceAll('<!--', '＜!--')
    .replaceAll('-->', '--＞')
    .replace(/\s+/g, ' ')
    .trim()]
    .slice(0, limit)
    .join('')
}

function profileId(content) {
  return `profile_${createHash('sha256').update(content).digest('hex').slice(0, 16)}`
}

function managedPattern() {
  return new RegExp(
    `\\n?${MANAGED_HEADING}\\n\\n${MANAGED_START}\\n([\\s\\S]*?)\\n${MANAGED_END}\\n?`,
  )
}

function parseManaged(content) {
  const block = content.match(managedPattern())?.[1] || ''
  return block.split('\n').map(line => {
    const match = line.match(/^- (.*?) <!-- (profile_[a-f0-9]{16}) -->$/)
    if (!match) return null
    return { id: match[2], content: clean(match[1]) }
  }).filter(entry => entry?.content)
}

function withoutManaged(content) {
  return content.replace(managedPattern(), '\n').trim()
}

function render(content, entries) {
  const base = withoutManaged(content)
  if (!entries.length) return `${base}\n`
  return [
    base,
    '',
    MANAGED_HEADING,
    '',
    MANAGED_START,
    ...entries.map(entry => `- ${entry.content} <!-- ${entry.id} -->`),
    MANAGED_END,
    '',
  ].join('\n')
}

export class UserProfile {
  constructor({
    filePath = null,
    onWarning = warning => console.warn(warning.message),
  } = {}) {
    this.filePath = filePath
    this.onWarning = onWarning
    this.warning = null
  }

  read() {
    if (!this.filePath) return ''
    try {
      const content = bounded(readFileSync(this.filePath, 'utf8'))
      this.warning = null
      return hasProfileData(content) ? content : ''
    } catch (error) {
      if (error.code === 'ENOENT') return ''
      this.warning = {
        message: `无法读取用户档案：${error.message}`,
        at: Date.now(),
      }
      try {
        this.onWarning?.(this.warning)
      } catch {
        // Diagnostics must not prevent the voice service from running.
      }
      return ''
    }
  }

  list({ query = '' } = {}) {
    const content = this.read()
    if (!content) return []
    const needle = clean(query).toLocaleLowerCase()
    const base = withoutManaged(content)
    const managed = parseManaged(content)
      .filter(entry => !needle || entry.content.toLocaleLowerCase().includes(needle))
      .map(entry => ({
        ...entry,
        scope: 'user',
        updated_at: null,
        editable: true,
      }))
    const baseEntry = hasProfileData(base) && (!needle || base.toLocaleLowerCase().includes(needle))
      ? [{
          id: 'user_profile',
          scope: 'user',
          content: base,
          updated_at: null,
          editable: false,
        }]
      : []
    return [...baseEntry, ...managed]
  }

  remember(value) {
    const content = clean(value)
    if (!content) throw new Error('profile content is required')
    const current = this.readRaw()
    const entries = parseManaged(current)
    const existing = entries.find(entry => (
      entry.content.toLocaleLowerCase() === content.toLocaleLowerCase()
    ))
    if (existing) return { ...existing, scope: 'user', updated_at: null, editable: true }
    if (entries.length >= MAX_MANAGED_ENTRIES) {
      throw new Error(`用户档案最多保存 ${MAX_MANAGED_ENTRIES} 条托管记录`)
    }
    const entry = { id: profileId(content), content }
    entries.push(entry)
    const next = render(current || '# USER', entries)
    if ([...next].length > MAX_PROFILE_CHARS) {
      throw new Error(`用户档案最多保存 ${MAX_PROFILE_CHARS} 个字符`)
    }
    this.persist(next)
    return { ...entry, scope: 'user', updated_at: null, editable: true }
  }

  replace({ ids = [], content: value } = {}) {
    const content = clean(value)
    const targets = new Set(ids.map(id => clean(id)).filter(Boolean))
    if (!content) throw new Error('profile content is required')
    if (!targets.size) throw new Error('profile ids are required')
    const current = this.readRaw()
    const entries = parseManaged(current)
    const matched = entries.filter(entry => targets.has(entry.id))
    if (!matched.length) return { replaced: 0, memory: null }
    const retained = entries.filter(entry => !targets.has(entry.id))
    let entry = retained.find(item => (
      item.content.toLocaleLowerCase() === content.toLocaleLowerCase()
    ))
    if (!entry) {
      entry = { id: profileId(content), content }
      retained.push(entry)
    }
    const next = render(current || '# USER', retained)
    if ([...next].length > MAX_PROFILE_CHARS) {
      throw new Error(`用户档案最多保存 ${MAX_PROFILE_CHARS} 个字符`)
    }
    this.persist(next)
    return {
      replaced: matched.length,
      memory: {
        ...entry,
        scope: 'user',
        updated_at: null,
        editable: true,
      },
    }
  }

  forget({ query = '', all = false } = {}) {
    const current = this.readRaw()
    const entries = parseManaged(current)
    const needle = clean(query).toLocaleLowerCase()
    const retained = all
      ? []
      : entries.filter(entry => (
          !needle
          || (
            entry.id.toLocaleLowerCase() !== needle
            && !entry.content.toLocaleLowerCase().includes(needle)
          )
        ))
    const removed = entries.length - retained.length
    if (removed) this.persist(render(current, retained))
    return removed
  }

  readRaw() {
    if (!this.filePath) return ''
    try {
      return readFileSync(this.filePath, 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') return ''
      throw error
    }
  }

  persist(content) {
    if (!this.filePath) throw new Error('user profile is unavailable')
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 })
    const temporary = `${this.filePath}.${process.pid}.tmp`
    writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 })
    renameSync(temporary, this.filePath)
    chmodSync(this.filePath, 0o600)
    this.warning = null
  }

  health() {
    return {
      ok: !this.warning,
      configured: Boolean(this.filePath),
      warning: this.warning,
    }
  }
}
