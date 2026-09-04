import { VOICE_WORKFLOWS } from '../../shared/voice-workflows.mjs'

/** UI projection of the shared workflow catalog. Execution stays in adapters. */
export const VOICE_STUDIO_TILES = VOICE_WORKFLOWS.map(workflow => ({
  id: workflow.id.replace('voice-', '').replace('video-dubbing', 'dub').replace('multi-voice-story', 'stories').replace('model-catalogue', 'engines'),
  title: workflow.title,
  blurb: workflow.description,
  status: workflow.status === 'planned' ? 'soon' : workflow.status === 'settings' ? 'jump' : 'live',
  ...(workflow.view ? { view: workflow.view } : {}),
  ...(workflow.jump ? { jump: workflow.jump } : {}),
}))

export function defaultVoiceStudioView() {
  return 'launchpad'
}

export function resolveVoiceStudioView(requested) {
  const allowed = new Set(['launchpad', 'gallery', 'clone', 'dub'])
  return allowed.has(requested) ? requested : 'launchpad'
}
