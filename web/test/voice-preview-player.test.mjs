import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatPreviewTime,
  previewProgressRatio,
  voiceAvatarLabel,
  voiceAvatarTone,
} from '../src/voice-preview-player.js'

test('formatPreviewTime pads seconds', () => {
  assert.equal(formatPreviewTime(0), '0:00')
  assert.equal(formatPreviewTime(9.9), '0:09')
  assert.equal(formatPreviewTime(65), '1:05')
  assert.equal(formatPreviewTime(NaN), '0:00')
})

test('previewProgressRatio clamps', () => {
  assert.equal(previewProgressRatio(0, 10), 0)
  assert.equal(previewProgressRatio(5, 10), 0.5)
  assert.equal(previewProgressRatio(12, 10), 1)
  assert.equal(previewProgressRatio(3, 0), 0)
})

test('voiceAvatarLabel takes first characters', () => {
  assert.equal(voiceAvatarLabel('白岩松'), '白岩')
  assert.equal(voiceAvatarLabel('雷军'), '雷军')
  assert.equal(voiceAvatarLabel('A'), 'A')
  assert.equal(voiceAvatarLabel(''), '?')
})

test('voiceAvatarTone is stable and returns hsl pair', () => {
  const a = voiceAvatarTone('罗永浩')
  const b = voiceAvatarTone('罗永浩')
  assert.equal(a.from, b.from)
  assert.equal(a.to, b.to)
  assert.match(a.from, /^hsl\(\d+ \d+% \d+%\)$/)
  assert.match(a.to, /^hsl\(\d+ \d+% \d+%\)$/)
})

test('voiceAvatarTone differs across names and falls back for empty', () => {
  const a = voiceAvatarTone('马季')
  const b = voiceAvatarTone('白岩松')
  assert.notEqual(`${a.from}|${a.to}`, `${b.from}|${b.to}`)
  const empty = voiceAvatarTone('')
  assert.match(empty.from, /^hsl\(\d+ \d+% \d+%\)$/)
  assert.match(empty.to, /^hsl\(\d+ \d+% \d+%\)$/)
})
