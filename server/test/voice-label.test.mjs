import assert from 'node:assert/strict'
import test from 'node:test'
import { friendlyVoiceLabel } from '../../shared/voice-label.mjs'

test('friendlyVoiceLabel strips source suffixes', () => {
  assert.equal(friendlyVoiceLabel('马季·多层饭店·降噪'), '马季')
  assert.equal(friendlyVoiceLabel('峰哥复刻'), '峰哥复刻')
  assert.equal(friendlyVoiceLabel('', 'fallback'), 'fallback')
})
