import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FENGGE_QWEN_TTS_VOICE } from '../../scripts/lib/gateway-mode.mjs'
import {
  persistGatewayMode,
  upsertEnvFile,
} from '../../scripts/lib/runtime-config-file.mjs'

test('upsertEnvFile updates existing keys and appends missing ones', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qwaudio-config-'))
  const path = join(dir, 'config.env')
  writeFileSync(path, 'FOO=1\nBAR=2\n')
  upsertEnvFile(path, { BAR: '9', BAZ: '3' })
  const text = readFileSync(path, 'utf8')
  assert.match(text, /^FOO=1$/m)
  assert.match(text, /^BAR=9$/m)
  assert.match(text, /^BAZ=3$/m)
})

test('persistGatewayMode writes cascade defaults with fengge voice', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qwaudio-config-'))
  const path = join(dir, 'config.env')
  const result = persistGatewayMode('cascade', { configPath: path, env: {} })
  assert.equal(result.mode, 'cascade')
  const text = readFileSync(path, 'utf8')
  assert.match(text, /^QWEN_AUDIO_REALTIME_PROVIDER=cascade$/m)
  assert.match(text, /^CASCADE_TTS_MODEL=qwen-audio-3.0-tts-flash$/m)
  assert.match(text, new RegExp(`^CASCADE_TTS_VOICE_ID=${FENGGE_QWEN_TTS_VOICE}$`, 'm'))
  assert.match(text, /^CASCADE_STT_MODEL=qwen-audio-3.0-asr-flash-streaming$/m)
})

test('persistGatewayMode writes s2s system voice', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qwaudio-config-'))
  const path = join(dir, 'config.env')
  persistGatewayMode('s2s', { configPath: path, env: {} })
  const text = readFileSync(path, 'utf8')
  assert.match(text, /^QWEN_AUDIO_REALTIME_PROVIDER=dashscope$/m)
  assert.match(text, /^QWEN_AUDIO_REALTIME_VOICE=longanqian$/m)
})

test('persistGatewayMode preserves fish TTS during cascade restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qwaudio-config-'))
  const path = join(dir, 'config.env')
  writeFileSync(path, [
    'CASCADE_TTS_PROVIDER=fish',
    'CASCADE_TTS_MODEL=s2.1-pro-free',
    'CASCADE_TTS_VOICE_ID=5337b76e9a7348e9a1d0c68fff02254c',
    'FISH_REFERENCE_ID=5337b76e9a7348e9a1d0c68fff02254c',
    '',
  ].join('\n'))
  persistGatewayMode('cascade', { configPath: path, env: {} })
  const text = readFileSync(path, 'utf8')
  assert.match(text, /^QWEN_AUDIO_REALTIME_PROVIDER=cascade$/m)
  assert.match(text, /^CASCADE_TTS_PROVIDER=fish$/m)
  assert.match(text, /^CASCADE_TTS_MODEL=s2.1-pro-free$/m)
  assert.match(text, /^CASCADE_TTS_VOICE_ID=5337b76e9a7348e9a1d0c68fff02254c$/m)
  assert.doesNotMatch(text, new RegExp(`CASCADE_TTS_VOICE_ID=${FENGGE_QWEN_TTS_VOICE}`))
})
