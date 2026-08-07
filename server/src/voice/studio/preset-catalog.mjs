import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function normalizePreset(raw = {}) {
  const sample = raw.sample && typeof raw.sample === 'object' ? raw.sample : {}
  return {
    id: String(raw.id || ''),
    label: String(raw.label || ''),
    locale: String(raw.locale || 'zh-CN'),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    notes: raw.notes ?? null,
    sample: {
      relativePath: String(sample.relativePath || ''),
      durationSec: Number(sample.durationSec) || 0,
      license: String(sample.license || 'demo'),
    },
  }
}

function toPublicItem(preset) {
  return {
    id: preset.id,
    label: preset.label,
    locale: preset.locale,
    tags: [...preset.tags],
    durationSec: preset.sample.durationSec,
    license: preset.sample.license,
  }
}

function matchesQuery(preset, query) {
  const needle = String(query || '').trim().toLowerCase()
  if (!needle) return true
  const haystack = [
    preset.id,
    preset.label,
    preset.locale,
    ...preset.tags,
  ].join(' ').toLowerCase()
  return haystack.includes(needle)
}

export function loadPresetCatalog(dir) {
  const catalogPath = dir ? join(dir, 'catalog.json') : null
  let payload = {}
  if (!catalogPath || !existsSync(catalogPath)) {
    console.warn(`[voice-studio] preset catalog missing: ${catalogPath || '(no directory)'}`)
  } else {
    payload = JSON.parse(readFileSync(catalogPath, 'utf8'))
  }
  const presets = (Array.isArray(payload.presets) ? payload.presets : [])
    .map(normalizePreset)
    .filter(item => item.id)

  const byId = new Map(presets.map(item => [item.id, item]))

  return {
    list({ query } = {}) {
      return presets
        .filter(item => matchesQuery(item, query))
        .map(toPublicItem)
    },

    get(id) {
      const preset = byId.get(String(id || ''))
      return preset ? toPublicItem(preset) : null
    },

    resolveSamplePath(id) {
      const preset = byId.get(String(id || ''))
      if (!preset?.sample?.relativePath) return null
      return join(dir || '', preset.sample.relativePath)
    },
  }
}
