#!/usr/bin/env node
/**
 * Resolve book author → Voice Studio profile. Prints JSON (no secrets).
 *
 * Usage:
 *   node resolve_author_voice.mjs --author "刘震云"
 *   node resolve_author_voice.mjs --author "刘震云" --profile-id <id>
 */

import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { findQwaudioRoot } from './repo-root.mjs'
import {
  defaultVoiceProfileDir,
  loadAllProfiles,
  resolveFallbackVoice,
} from './load-profiles.mjs'

function parseArgs(argv) {
  const out = {
    author: '',
    profileId: '',
    voice: '',
    allowDraftCelebs: false,
    json: true,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--author') out.author = String(argv[++i] || '')
    else if (arg === '--profile-id') out.profileId = String(argv[++i] || '')
    else if (arg === '--voice') out.voice = String(argv[++i] || '')
    else if (arg === '--allow-draft-celebs') out.allowDraftCelebs = true
    else if (arg === '--help' || arg === '-h') out.help = true
  }
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(`Usage: node resolve_author_voice.mjs --author "刘震云" [--profile-id id] [--voice remote_id]`)
    return 0
  }
  const root = findQwaudioRoot()
  const authorVoiceUrl = pathToFileURL(join(root, 'server/src/voice/studio/author-voice.mjs')).href
  const { resolveAuthorVoice, serializeVoiceMatch } = await import(authorVoiceUrl)
  const profiles = loadAllProfiles(defaultVoiceProfileDir())
  const result = resolveAuthorVoice({
    author: args.author,
    profiles,
    profileId: args.profileId,
    voice: args.voice,
    fallbackVoice: resolveFallbackVoice(),
    allowDraftCelebs: args.allowDraftCelebs,
  })
  const match = serializeVoiceMatch(result)
  const payload = {
    ...match,
    status: result.profile ? 'ok' : 'error',
    profile_status: match.status,
    voice_profile_dir: defaultVoiceProfileDir(),
    profile_count: profiles.length,
  }
  if (!result.profile) {
    payload.error_code = 'voice_unresolved'
  }
  console.log(JSON.stringify(payload, null, 2))
  return result.profile ? 0 : 2
}

main().then(code => process.exit(code)).catch(error => {
  console.error(JSON.stringify({
    status: 'error',
    error: error.message || String(error),
    error_code: error.code || 'resolve_failed',
  }, null, 2))
  process.exit(1)
})
