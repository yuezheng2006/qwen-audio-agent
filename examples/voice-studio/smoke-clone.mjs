#!/usr/bin/env node
/**
 * Voice Studio clone smoke (local + optional live DashScope enroll).
 *
 * Usage:
 *   node examples/voice-studio/smoke-clone.mjs
 *   node examples/voice-studio/smoke-clone.mjs --live-enroll
 *
 * Loads ~/.config/qwaudio/config.env. Never prints secrets.
 * Does NOT call voice_confirm / restart gateway.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createVoiceProfileStore } from '../../server/src/voice/studio/profile-store.mjs'
import { loadPresetCatalog } from '../../server/src/voice/studio/preset-catalog.mjs'
import { createVoiceCloneProviders } from '../../server/src/voice/studio/providers/registry.mjs'
import { createVoiceStudioService } from '../../server/src/voice/studio/service.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '../..')
const liveEnroll = process.argv.includes('--live-enroll')

function loadEnvFile(path) {
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!m) continue
    out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

function mask(value) {
  const v = String(value || '')
  if (!v) return '(missing)'
  return `set len=${v.length}`
}

function step(title) {
  console.log(`\n== ${title} ==`)
}

function ok(msg, extra) {
  console.log(`✅ ${msg}`)
  if (extra !== undefined) console.log('   ', typeof extra === 'string' ? extra : JSON.stringify(extra))
}

function fail(msg, extra) {
  console.log(`❌ ${msg}`)
  if (extra !== undefined) console.log('   ', typeof extra === 'string' ? extra : JSON.stringify(extra))
}

const env = {
  ...loadEnvFile(join(process.env.HOME || '', '.config/qwaudio/config.env')),
  ...process.env,
}

const dashKey = env.DASHSCOPE_API_KEY || ''
const fishKey = env.FISH_API_KEY || ''
const activeVoice = env.CASCADE_TTS_VOICE_ID || ''
const sampleSrc = '/tmp/qwaudio-tts-smoke/fengge-clone.wav'
const presetsDir = join(root, 'config/voice-presets')
const sampleDest = join(presetsDir, 'samples/demo-calm-male.wav')

step('环境')
console.log('DASHSCOPE_API_KEY', mask(dashKey))
console.log('FISH_API_KEY', mask(fishKey))
console.log('CASCADE_TTS_PROVIDER', env.CASCADE_TTS_PROVIDER || '(empty)')
console.log('CASCADE_TTS_VOICE_ID', activeVoice ? `${activeVoice.slice(0, 24)}…` : '(empty)')
console.log('sample', existsSync(sampleSrc) ? sampleSrc : 'MISSING')
console.log('live-enroll', liveEnroll)

if (!existsSync(sampleSrc)) {
  fail('缺少样本 /tmp/qwaudio-tts-smoke/fengge-clone.wav')
  process.exit(1)
}

mkdirSync(join(presetsDir, 'samples'), { recursive: true })
copyFileSync(sampleSrc, sampleDest)
ok('已放入预设样本', sampleDest)

const work = mkdtempSync(join(tmpdir(), 'voice-studio-smoke-'))
const store = createVoiceProfileStore({ dir: join(work, 'profiles') })
const catalog = loadPresetCatalog(presetsDir)
const providers = createVoiceCloneProviders({
  dashscopeApiKey: dashKey,
  fishApiKey: fishKey,
  minimaxApiKey: env.MINIMAX_API_KEY || '',
  fishEnrollEnabled: false,
  minimaxEnrollEnabled: false,
  dashscopeTargetModel: env.CASCADE_TTS_MODEL || 'qwen-audio-3.0-tts-flash',
})

const persistCalls = []
const service = createVoiceStudioService({
  store,
  catalog,
  providers,
  presetsDir,
  isCascadeMode: true,
  getActiveCascade: () => ({
    provider: env.CASCADE_TTS_PROVIDER || 'dashscope',
    voice: activeVoice,
    model: env.CASCADE_TTS_MODEL || 'qwen-audio-3.0-tts-flash',
  }),
  persistCascadeTts: async (patch) => {
    persistCalls.push(patch)
    return { provider: patch.provider, updates: patch }
  },
  restartGateway: () => {
    throw new Error('smoke must not restart gateway')
  },
  defaultProvider: 'dashscope',
})

let failures = 0

step('voice_list_presets')
{
  const out = service.listPresets()
  const presets = out.presets || []
  const calm = presets.find(p => p.id === 'demo-calm-male')
  if (out.status === 'ok' && presets.length === 4 && calm && !('path' in calm) && !calm.sample) {
    ok(`列出 ${presets.length} 条预设`, presets.map(p => p.id).join(', '))
  } else {
    fail('预设列表异常', out)
    failures += 1
  }
}

step('listenhub enroll_unsupported')
{
  const out = await service.clone('smoke-owner', {
    provider: 'listenhub',
    preset_id: 'demo-calm-male',
    label: '不应成功',
  })
  if (out.error && out.error_code === 'enroll_unsupported') {
    ok('listenhub 拒绝 clone', out.user_message)
  } else {
    fail('期望 enroll_unsupported', out)
    failures += 1
  }
}

step('voice_import 现有峰哥音色（不 confirm）')
{
  if (!activeVoice) {
    fail('无 CASCADE_TTS_VOICE_ID，跳过 import')
    failures += 1
  } else {
    const out = await service.importVoice('smoke-owner', {
      provider: 'dashscope',
      remote_voice_id: activeVoice,
      label: '峰哥-已有',
    })
    if (out.status === 'ok' && out.profile?.remote_voice_id === activeVoice && out.profile?.id) {
      ok('import ready', { profile_id: out.profile.id, status: out.profile.status })
      const confirmDry = await service.confirm('smoke-owner', {
        profile_id: out.profile.id,
        restart: false,
      })
      if (
        confirmDry.status === 'ok'
        && confirmDry.switching === false
        && persistCalls.length === 1
        && persistCalls[0].voice === activeVoice
      ) {
        ok('confirm(restart=false) 只持久化不重启', persistCalls[0])
      } else {
        fail('confirm dry-run 异常', { confirmDry, persistCalls })
        failures += 1
      }
    } else {
      fail('import 失败', out)
      failures += 1
    }
  }
}

step('fish importId')
{
  const ref = env.FISH_REFERENCE_ID
  if (!ref) {
    console.log('⏭ 无 FISH_REFERENCE_ID，跳过')
  } else {
    const out = await service.importVoice('smoke-owner', {
      provider: 'fish',
      remote_voice_id: ref,
      label: 'Fish-已有',
    })
    if (out.status === 'ok' && out.profile?.remote_voice_id === ref) {
      ok('fish import ready', { profile_id: out.profile.id })
    } else {
      fail('fish import 失败', out)
      failures += 1
    }
  }
}

step('audio_transcribe stub')
{
  const out = await service.transcribe('smoke-owner', {
    source: { kind: 'url', url: 'https://example.com/a.wav' },
    language: 'zh',
    provider: 'auto',
  })
  if (out.error_code === 'asr_unavailable') {
    ok('asr_unavailable（预期）', out.user_message)
  } else {
    fail('期望 asr_unavailable', out)
    failures += 1
  }
}

if (liveEnroll) {
  step('live DashScope enroll（preset 样本 → data URI）')
  if (!dashKey) {
    fail('无 DASHSCOPE_API_KEY')
    failures += 1
  } else {
    const out = await service.clone('smoke-owner', {
      provider: 'dashscope',
      preset_id: 'demo-calm-male',
      label: 'smoke-calm',
    })
    if (out.status === 'ok' && out.profile?.remote_voice_id) {
      ok('enroll 成功', {
        profile_id: out.profile.id,
        remote_voice_id: String(out.profile.remote_voice_id).slice(0, 40) + '…',
      })
      writeFileSync(
        join(work, 'enroll-result.json'),
        `${JSON.stringify({
          profile_id: out.profile.id,
          remote_voice_id: out.profile.remote_voice_id,
          provider: out.profile.provider,
          label: out.profile.label,
        }, null, 2)}\n`,
      )
      ok('结果已写', join(work, 'enroll-result.json'))
    } else {
      fail('enroll 失败', {
        error_code: out.error_code,
        user_message: out.user_message,
        status: out.status,
        profile_error: out.profile?.error || null,
      })
      failures += 1
    }
  }
} else {
  step('live enroll 跳过（加 --live-enroll 开启）')
}

step('voice_list / voice_status')
{
  const list = service.list('smoke-owner')
  const status = service.status('smoke-owner')
  const profiles = list.profiles || []
  ok(`profiles=${profiles.length}`, profiles.map(p => `${p.label}:${p.status}`).join(' | '))
  ok('status', {
    provider: status.active?.provider,
    voice: status.active?.voice ? `${String(status.active.voice).slice(0, 28)}…` : null,
  })
}

console.log(`\n工作目录保留: ${work}`)
console.log(failures ? `\n结果: ${failures} 项失败` : '\n结果: 全部通过')
if (!liveEnroll) {
  console.log('提示: 真实克隆请执行\n  node examples/voice-studio/smoke-clone.mjs --live-enroll')
}

// keep work dir for inspection; remove sample copy? keep for user demo
process.exit(failures ? 1 : 0)
