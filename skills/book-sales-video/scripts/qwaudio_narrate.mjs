#!/usr/bin/env node
/**
 * One-shot narration via qwen-audio-agent Voice Studio (DashScope clones).
 * Contract compatible with upstream doubao_tts: --text-file --output --report
 *
 * Usage:
 *   node qwaudio_narrate.mjs --text-file audio/narration.txt \
 *     --output audio/narration.wav --report audio/narration.wav.json \
 *     --author "刘震云"
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { findQwaudioRoot } from './repo-root.mjs'
import {
  defaultVoiceProfileDir,
  loadAllProfiles,
  resolveDashScopeApiKey,
  resolveFallbackVoice,
  resolveTtsModel,
} from './load-profiles.mjs'

function parseArgs(argv) {
  const out = {
    textFile: '',
    output: '',
    report: '',
    author: '',
    profileId: '',
    voice: '',
    joinPauseMs: 180,
    force: false,
    allowDraftCelebs: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--text-file') out.textFile = String(argv[++i] || '')
    else if (arg === '--output') out.output = String(argv[++i] || '')
    else if (arg === '--report') out.report = String(argv[++i] || '')
    else if (arg === '--author') out.author = String(argv[++i] || '')
    else if (arg === '--profile-id') out.profileId = String(argv[++i] || '')
    else if (arg === '--voice') out.voice = String(argv[++i] || '')
    else if (arg === '--join-pause-ms') out.joinPauseMs = Number(argv[++i] || 180)
    else if (arg === '--force') out.force = true
    else if (arg === '--allow-draft-celebs') out.allowDraftCelebs = true
    else if (arg === '--help' || arg === '-h') out.help = true
  }
  return out
}

function remoteOf(profile) {
  return String(profile?.remoteId || profile?.remote_voice_id || '').trim()
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(`Usage: node qwaudio_narrate.mjs --text-file FILE --output FILE.wav [--report FILE.json] --author NAME`)
    return 0
  }
  if (!args.textFile || !args.output) {
    throw Object.assign(new Error('需要 --text-file 与 --output'), { code: 'args_required' })
  }
  const textPath = resolve(args.textFile)
  const outputPath = resolve(args.output)
  const reportPath = resolve(args.report || `${outputPath}.json`)
  if (!existsSync(textPath)) {
    throw Object.assign(new Error(`文本不存在: ${textPath}`), { code: 'text_missing' })
  }

  if (!args.force && existsSync(outputPath) && existsSync(reportPath)) {
    const existing = JSON.parse(readFileSync(reportPath, 'utf8'))
    console.log(JSON.stringify({ ...existing, cache_hit: true, output: outputPath }, null, 2))
    return 0
  }

  const root = findQwaudioRoot()
  const authorVoiceUrl = pathToFileURL(join(root, 'server/src/voice/studio/author-voice.mjs')).href
  const narrateUrl = pathToFileURL(join(root, 'server/src/voice/studio/narrate.mjs')).href
  const { resolveAuthorVoice, serializeVoiceMatch } = await import(authorVoiceUrl)
  const { synthesizeNarration } = await import(narrateUrl)

  const apiKey = resolveDashScopeApiKey()
  if (!apiKey) {
    throw Object.assign(
      new Error('缺少 DASHSCOPE_API_KEY / CASCADE_TTS_API_KEY'),
      { code: 'api_key_missing' },
    )
  }

  const profiles = loadAllProfiles(defaultVoiceProfileDir())
  const match = resolveAuthorVoice({
    author: args.author,
    profiles,
    profileId: args.profileId,
    voice: args.voice,
    fallbackVoice: resolveFallbackVoice(),
    allowDraftCelebs: args.allowDraftCelebs,
  })
  if (!match.profile || !remoteOf(match.profile)) {
    throw Object.assign(new Error(match.message || '无法解析配音音色'), {
      code: 'voice_unresolved',
    })
  }

  const text = readFileSync(textPath, 'utf8')
  const sampleRate = Number(process.env.CASCADE_TTS_SAMPLE_RATE || 24000) || 24000
  const { wav, report } = await synthesizeNarration({
    text,
    apiKey,
    model: resolveTtsModel(match.profile),
    voice: remoteOf(match.profile),
    sampleRate,
    joinPauseMs: args.joinPauseMs,
    label: match.profile.label || '',
    profileId: match.profile.id || null,
    author: args.author,
    matchType: match.match_type,
    fallback: match.fallback,
  })

  mkdirSync(dirname(outputPath), { recursive: true })
  mkdirSync(dirname(reportPath), { recursive: true })
  writeFileSync(outputPath, wav)
  const payload = {
    output: outputPath,
    ...report,
    voice_match: serializeVoiceMatch(match),
  }
  writeFileSync(reportPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(payload, null, 2))
  return 0
}

main().then(code => process.exit(code)).catch(error => {
  console.error(JSON.stringify({
    status: 'error',
    error: error.message || String(error),
    error_code: error.code || 'narrate_failed',
  }, null, 2))
  process.exit(1)
})
