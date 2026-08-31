import { randomUUID } from 'node:crypto'

export const MEDIA_JOB_PHASES = Object.freeze([
  'inspect',
  'extract_audio',
  'separate',
  'transcribe_aligned',
  'translate',
  'synthesize_segments',
  'fit_timing',
  'remux',
  'lipsync',
])

const PHASE_STATUS = new Set(['pending', 'running', 'completed', 'failed', 'skipped'])
const JOB_STATUS = new Set(['queued', 'running', 'paused', 'completed', 'failed', 'cancelled'])

function clean(value, fallback = '') {
  return String(value || '').trim() || fallback
}

function phaseState(name) {
  return { name, status: 'pending', artifactIds: [], error: null, startedAt: null, completedAt: null }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

export function createMediaJob({
  id = `media_${randomUUID().replaceAll('-', '')}`,
  ownerId,
  sourceRef,
  sourceLanguage = 'auto',
  targetLanguage,
  options = {},
  phases = MEDIA_JOB_PHASES,
  now = () => Date.now(),
} = {}) {
  const owner = clean(ownerId)
  const source = clean(sourceRef)
  const target = clean(targetLanguage)
  if (!owner) throw new TypeError('MediaJob ownerId is required')
  if (!source) throw new TypeError('MediaJob sourceRef is required')
  if (!target) throw new TypeError('MediaJob targetLanguage is required')
  const selectedPhases = [...new Set(phases.map(clean).filter(Boolean))]
  const unknown = selectedPhases.filter(phase => !MEDIA_JOB_PHASES.includes(phase))
  if (unknown.length) throw new TypeError(`Unsupported MediaJob phases: ${unknown.join(', ')}`)

  const createdAt = now()
  const state = {
    id: clean(id),
    ownerId: owner,
    sourceRef: source,
    sourceLanguage: clean(sourceLanguage, 'auto'),
    targetLanguage: target,
    options: clone(options),
    status: 'queued',
    currentPhase: null,
    phases: selectedPhases.map(phaseState),
    artifacts: [],
    error: null,
    createdAt,
    updatedAt: createdAt,
  }

  function phase(name) {
    const row = state.phases.find(item => item.name === name)
    if (!row) throw new Error(`MediaJob phase is not configured: ${name}`)
    return row
  }

  function touch() {
    state.updatedAt = now()
  }

  function snapshot() {
    return clone(state)
  }

  return {
    id: state.id,
    snapshot,
    startPhase(name) {
      if (['completed', 'cancelled'].includes(state.status)) {
        throw new Error(`MediaJob is already ${state.status}`)
      }
      const row = phase(name)
      if (!['pending', 'failed'].includes(row.status)) {
        throw new Error(`MediaJob phase cannot start from ${row.status}: ${name}`)
      }
      row.status = 'running'
      row.error = null
      row.startedAt = row.startedAt || now()
      state.currentPhase = name
      state.status = 'running'
      state.error = null
      touch()
      return snapshot()
    },
    completePhase(name, { artifactIds = [] } = {}) {
      const row = phase(name)
      if (row.status !== 'running') {
        throw new Error(`MediaJob phase is not running: ${name}`)
      }
      row.status = 'completed'
      row.artifactIds = [...new Set(artifactIds.map(clean).filter(Boolean))]
      row.completedAt = now()
      state.artifacts = [...new Set([...state.artifacts, ...row.artifactIds])]
      state.currentPhase = state.phases.find(item => item.status === 'pending')?.name || null
      if (!state.currentPhase) state.status = 'completed'
      touch()
      return snapshot()
    },
    skipPhase(name) {
      const row = phase(name)
      if (row.status !== 'pending') throw new Error(`MediaJob phase cannot skip from ${row.status}: ${name}`)
      row.status = 'skipped'
      row.completedAt = now()
      state.currentPhase = state.phases.find(item => item.status === 'pending')?.name || null
      if (!state.currentPhase) state.status = 'completed'
      touch()
      return snapshot()
    },
    failPhase(name, error) {
      const row = phase(name)
      if (!['running', 'pending'].includes(row.status)) {
        throw new Error(`MediaJob phase cannot fail from ${row.status}: ${name}`)
      }
      row.status = 'failed'
      row.error = clean(error, 'MediaJob phase failed')
      state.status = 'failed'
      state.error = row.error
      state.currentPhase = name
      touch()
      return snapshot()
    },
    pause() {
      if (state.status !== 'running') throw new Error(`MediaJob cannot pause from ${state.status}`)
      state.status = 'paused'
      touch()
      return snapshot()
    },
    cancel() {
      if (['completed', 'cancelled'].includes(state.status)) return snapshot()
      state.status = 'cancelled'
      touch()
      return snapshot()
    },
    canResume() {
      return ['queued', 'paused', 'failed'].includes(state.status)
        && state.phases.some(item => ['pending', 'failed'].includes(item.status))
    },
  }
}

export function isMediaJobPhase(value) {
  return MEDIA_JOB_PHASES.includes(clean(value))
}

export function isMediaJobStatus(value) {
  return JOB_STATUS.has(clean(value))
}

export function isMediaJobPhaseStatus(value) {
  return PHASE_STATUS.has(clean(value))
}
