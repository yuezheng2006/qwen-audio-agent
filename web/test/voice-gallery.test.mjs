import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CURATED_CELEB_NAMES,
  DEMOTED_CELEB_NAMES,
  friendlyVoiceName,
  isDraftCelebVoice,
  organizeVoiceProfiles,
  previewDownloadFilename,
  previewDownloadHref,
  previewUrlFor,
} from '../src/voice-gallery.js'

test('friendly names drop source and denoise suffixes', () => {
  assert.equal(friendlyVoiceName({ label: '郭德纲·划船·降噪' }), '郭德纲')
  assert.equal(friendlyVoiceName({ label: '罗永浩·大连·降噪' }), '罗永浩')
  assert.equal(friendlyVoiceName({ label: '刘震云·北大·降噪' }), '刘震云')
  assert.equal(friendlyVoiceName({ label: '雷军·年度演讲·降噪' }), '雷军')
  assert.equal(friendlyVoiceName({ label: '周迅·访谈·降噪' }), '周迅')
  assert.equal(friendlyVoiceName({ label: '峰哥复刻' }), '峰哥复刻')
})

test('active roster after QA removals', () => {
  for (const name of ['刘震云', '罗永浩', '雷军', '马云', '白岩松', '单田芳', '马季']) {
    assert.ok(CURATED_CELEB_NAMES.includes(name), name)
    assert.equal(isDraftCelebVoice({ label: `${name}·样本·降噪` }), false)
  }
})

test('QA rejects are demoted and hidden', () => {
  for (const name of ['周迅', '黄渤', '徐峥', '林志玲', '冯巩', '郭德纲']) {
    assert.ok(DEMOTED_CELEB_NAMES.includes(name), name)
    assert.equal(isDraftCelebVoice({ label: `${name}·任意·降噪` }), true)
  }
})

test('friendly names still resolve for kept classics', () => {
  assert.equal(friendlyVoiceName({ label: '单田芳·白眉大侠·降噪' }), '单田芳')
  assert.equal(friendlyVoiceName({ label: '马季·多层饭店·降噪' }), '马季')
})

test('non-denoise celeb samples are drafts', () => {
  assert.equal(isDraftCelebVoice({ label: '郭德纲·划船刺使' }), true)
  assert.equal(isDraftCelebVoice({ label: '罗永浩·单人2' }), true)
  assert.equal(isDraftCelebVoice({ label: '雷军·年度演讲·降噪' }), false)
  assert.equal(isDraftCelebVoice({ label: '自定义音色' }), false)
})

test('gallery hides celeb drafts by default', () => {
  const profiles = [
    { id: '1', label: '郭德纲', remote_voice_id: 'a', provider: 'dashscope', status: 'ready' },
    { id: '2', label: '黄渤·星空演讲·降噪', remote_voice_id: 'b', provider: 'dashscope', status: 'ready' },
    { id: '3', label: '罗永浩·大连·降噪', remote_voice_id: 'c', provider: 'dashscope', status: 'ready' },
    { id: '4', label: '刘震云·北大·降噪', remote_voice_id: 'e', provider: 'dashscope', status: 'ready' },
    { id: '5', label: '雷军·年度演讲·降噪', remote_voice_id: 'f', provider: 'dashscope', status: 'ready' },
    { id: '6', label: '我的克隆', remote_voice_id: 'd', provider: 'dashscope', status: 'ready' },
    { id: '7', label: '林志玲·十三邀·降噪', remote_voice_id: 'g', provider: 'dashscope', status: 'ready' },
  ]
  const visible = organizeVoiceProfiles(profiles)
  assert.deepEqual(visible.map(item => item.label), [
    '罗永浩·大连·降噪',
    '刘震云·北大·降噪',
    '雷军·年度演讲·降噪',
    '我的克隆',
  ])
  assert.equal(organizeVoiceProfiles(profiles, { showAll: true }).length, 7)
})

test('preview download uses friendly wav name', () => {
  assert.equal(previewUrlFor({
    id: 'p1',
    has_preview: true,
  }), 'api/voice/profiles/p1/preview')
  assert.equal(previewDownloadHref({
    id: 'p1',
    has_preview: true,
  }), 'api/voice/profiles/p1/preview?download=1')
  assert.equal(previewDownloadFilename({ label: '雷军·年度演讲·降噪' }), '雷军.wav')
  assert.equal(previewDownloadFilename({ label: '我的克隆' }), '我的克隆.wav')
  assert.equal(previewDownloadHref({ id: 'x' }), '')
})
