import assert from 'node:assert/strict'
import test from 'node:test'
import {
  VOICE_STUDIO_TILES,
  defaultVoiceStudioView,
  resolveVoiceStudioView,
} from '../src/voice-studio-launchpad.js'

test('launchpad includes live gallery and clone tiles', () => {
  const live = VOICE_STUDIO_TILES.filter(item => item.status === 'live').map(item => item.id)
  assert.deepEqual(live, ['gallery', 'clone', 'dub', 'audiobook'])
  const gallery = VOICE_STUDIO_TILES.find(item => item.id === 'gallery')
  assert.equal(gallery.blurb, '试听声音，并选它来和助手聊天')
  assert.ok(VOICE_STUDIO_TILES.some(item => item.id === 'engines' && item.status === 'jump'))
  assert.ok(VOICE_STUDIO_TILES.some(item => item.status === 'soon'))
})

test('voice studio view defaults and resolves safely', () => {
  assert.equal(defaultVoiceStudioView(), 'launchpad')
  assert.equal(resolveVoiceStudioView('gallery'), 'gallery')
  assert.equal(resolveVoiceStudioView('nope'), 'launchpad')
})
