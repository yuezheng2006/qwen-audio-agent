import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { config } from '../core/config.mjs'
import { friendlyVoiceLabel } from '../../../shared/voice-label.mjs'

const PERSONA_START = /<!--\s*persona:start[\s\S]*?-->/
const PERSONA_END = /<!--\s*persona:end\s*-->/
const PERSONA_NAME_TOKEN = /\{\{persona_name\}\}/g

/** Display name → persona file id (without .md). */
export const PERSONA_BY_DISPLAY_NAME = Object.freeze({
  峰哥: 'fengge',
  马季: 'maji',
  刘震云: 'liuzhenyun',
  罗永浩: 'luoyonghao',
  雷军: 'leijun',
  马云: 'mayun',
  白岩松: 'baiyansong',
  单田芳: 'shantianfang',
  郭德纲: 'guodegang',
  客服助手: 'support',
  客服: 'support',
})

const FENGGE_VOICE_RE = /fengge|峰哥/i

export function personasDir(baseDir = config.frontendPromptDir) {
  return resolve(baseDir, 'personas')
}

export function celebDisplayNameFromLabel(label) {
  const text = String(label || '').trim()
  if (!text) return ''
  const short = friendlyVoiceLabel(text, text)
  const names = Object.keys(PERSONA_BY_DISPLAY_NAME)
    .sort((a, b) => b.length - a.length)
  return names.find(name => (
    short === name
    || text === name
    || text.startsWith(`${name}·`)
    // 峰哥复刻 / 峰哥亡命天涯 — no middle dot
    || (name === '峰哥' && (short.startsWith('峰哥') || text.startsWith('峰哥')))
  )) || ''
}

export function resolvePersonaId({
  personaId,
  voiceLabel,
  voiceId,
  displayName,
} = {}) {
  const explicit = String(personaId || '').trim().toLowerCase()
  if (explicit) return explicit

  const fromDisplay = String(displayName || '').trim()
  if (fromDisplay && PERSONA_BY_DISPLAY_NAME[fromDisplay]) {
    return PERSONA_BY_DISPLAY_NAME[fromDisplay]
  }

  const celeb = celebDisplayNameFromLabel(voiceLabel)
  if (celeb && PERSONA_BY_DISPLAY_NAME[celeb]) {
    return PERSONA_BY_DISPLAY_NAME[celeb]
  }

  const voice = String(voiceId || '').trim()
  if (voice && FENGGE_VOICE_RE.test(voice)) return 'fengge'

  // Unknown custom clone: stay generic assistant (no celebrity/fengge bleed).
  if (voice || String(voiceLabel || '').trim()) return 'generic'
  return 'fengge'
}

export function personaDisplayName(personaId, fallbackLabel = '') {
  const id = String(personaId || '').trim().toLowerCase()
  const entry = Object.entries(PERSONA_BY_DISPLAY_NAME)
    .find(([, value]) => value === id)
  if (entry) return entry[0]
  const celeb = celebDisplayNameFromLabel(fallbackLabel)
  if (celeb) return celeb
  const short = friendlyVoiceLabel(fallbackLabel, '')
  if (short) return short
  if (id === 'generic') return '助手'
  if (id === 'support') return '客服助手'
  return '峰哥'
}

function stripSkillFrontmatter(text) {
  const source = String(text || '')
  if (!source.startsWith('---')) return source.trim()
  const end = source.indexOf('\n---', 3)
  if (end < 0) return source.trim()
  return source.slice(end + 4).trim()
}

/**
 * Prefer Nuwa VOICE.md (runtime slice) → full SKILL.md → flat legacy .md.
 * Voice gallery: switching TTS voice loads the matching persona skill.
 */
export function loadPersonaBody(personaId, {
  dir = personasDir(),
} = {}) {
  const id = String(personaId || 'fengge').trim().toLowerCase() || 'fengge'
  const candidates = [
    resolve(dir, id, 'VOICE.md'),
    resolve(dir, id, 'SKILL.md'),
    resolve(dir, `${id}.md`),
  ]
  if (id === 'generic') candidates.push(resolve(dir, 'generic.md'))
  candidates.push(resolve(dir, 'fengge.md'))

  const path = candidates.find(candidate => existsSync(candidate))
  if (!path) throw new Error(`persona file missing: ${id}`)
  const raw = readFileSync(path, 'utf8').trim()
  if (!raw) throw new Error(`persona file empty: ${path}`)
  return stripSkillFrontmatter(raw)
}

export function applyPersonaBlock(prompt, personaBody, {
  displayName = '峰哥',
} = {}) {
  const source = String(prompt || '')
  const body = String(personaBody || '').trim()
  if (!body) throw new Error('persona body must not be empty')

  const startMatch = source.match(PERSONA_START)
  const endMatch = source.match(PERSONA_END)
  if (!startMatch || !endMatch) {
    throw new Error('PROMPT.md missing persona:start / persona:end markers')
  }
  const startIndex = startMatch.index
  const endIndex = endMatch.index + endMatch[0].length
  if (endIndex <= startIndex) {
    throw new Error('PROMPT.md persona markers are out of order')
  }

  const startComment = `<!-- persona:start ${displayName} -->`
  const endComment = '<!-- persona:end -->'
  const spliced = [
    source.slice(0, startIndex),
    startComment,
    '\n',
    body,
    '\n',
    endComment,
    source.slice(endIndex),
  ].join('')

  return spliced.replace(PERSONA_NAME_TOKEN, displayName)
}

export function resolveActivePersona(options = {}) {
  const voiceId = options.voiceId ?? config.cascade?.tts?.voice
  const voiceLabel = options.voiceLabel
    ?? config.cascade?.tts?.voiceLabel
    ?? process.env.CASCADE_TTS_VOICE_LABEL
    ?? ''
  const personaId = resolvePersonaId({
    personaId: options.personaId,
    voiceLabel,
    voiceId,
    displayName: options.displayName,
  })
  const displayName = personaDisplayName(personaId, voiceLabel)
  return {
    id: personaId,
    displayName,
    voiceId: String(voiceId || '').trim() || null,
    voiceLabel: String(voiceLabel || '').trim() || null,
  }
}
