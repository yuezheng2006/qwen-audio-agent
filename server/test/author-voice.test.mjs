import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CURATED_CELEB_NAMES,
  DEMOTED_CELEB_NAMES,
  resolveAuthorVoice,
  serializeVoiceMatch,
  authorNameCandidates,
} from '../src/voice/studio/author-voice.mjs'

const profiles = [
  {
    id: 'liu',
    label: '刘震云·北大·降噪',
    provider: 'dashscope',
    remoteId: 'voice-liu-dn',
    status: 'ready',
    favorite: false,
  },
  {
    id: 'liu-draft',
    label: '刘震云·试稿',
    provider: 'dashscope',
    remoteId: 'voice-liu-draft',
    status: 'ready',
  },
  {
    id: 'gdg',
    label: '郭德纲·划船·降噪',
    provider: 'dashscope',
    remoteId: 'voice-gdg-dn',
    status: 'ready',
  },
  {
    id: 'luo',
    label: '罗永浩·大连·降噪',
    provider: 'dashscope',
    remoteId: 'voice-luo-dn',
    status: 'confirmed',
    favorite: true,
  },
]

test('curated celeb list includes 刘震云', () => {
  assert.ok(CURATED_CELEB_NAMES.includes('刘震云'))
  assert.ok(DEMOTED_CELEB_NAMES.includes('郭德纲'))
})

test('authorNameCandidates splits co-authors', () => {
  assert.deepEqual(authorNameCandidates('刘震云 / 某某译'), ['刘震云', '某某译'])
})

test('resolveAuthorVoice matches 刘震云 to denoise profile', () => {
  const result = resolveAuthorVoice({ author: '刘震云', profiles })
  assert.equal(result.match_type, 'author')
  assert.equal(result.fallback, false)
  assert.equal(result.profile.id, 'liu')
  assert.match(result.message, /刘震云/)
})

test('resolveAuthorVoice prefers denoise over draft for same author', () => {
  const result = resolveAuthorVoice({
    author: '刘震云著',
    profiles: [
      profiles[1],
      profiles[0],
    ],
  })
  assert.equal(result.profile.id, 'liu')
})

test('resolveAuthorVoice skips demoted 郭德纲 unless allowDraftCelebs', () => {
  const blocked = resolveAuthorVoice({ author: '郭德纲', profiles })
  assert.equal(blocked.match_type, 'none')
  const allowed = resolveAuthorVoice({
    author: '郭德纲',
    profiles,
    allowDraftCelebs: true,
  })
  assert.equal(allowed.profile.id, 'gdg')
})

test('resolveAuthorVoice matches 罗永浩', () => {
  const result = resolveAuthorVoice({ author: '罗永浩', profiles })
  assert.equal(result.profile.id, 'luo')
})

test('resolveAuthorVoice falls back when no author match', () => {
  const result = resolveAuthorVoice({
    author: '余华',
    profiles,
    fallbackVoice: 'default-voice',
  })
  assert.equal(result.match_type, 'fallback')
  assert.equal(result.fallback, true)
  assert.equal(result.profile.remoteId, 'default-voice')
})

test('serializeVoiceMatch exposes remote_voice_id', () => {
  const result = resolveAuthorVoice({ author: '刘震云', profiles })
  const json = serializeVoiceMatch(result)
  assert.equal(json.remote_voice_id, 'voice-liu-dn')
  assert.equal(json.friendly_name, '刘震云')
  assert.equal(json.profile_id, 'liu')
})

test('explicit profileId wins over author', () => {
  const result = resolveAuthorVoice({
    author: '刘震云',
    profileId: 'luo',
    profiles,
  })
  assert.equal(result.match_type, 'profile_id')
  assert.equal(result.profile.id, 'luo')
})
