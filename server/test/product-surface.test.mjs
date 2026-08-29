import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { frontendTools } from '../src/voice/frontend-tools.mjs'
import { VOICE_STUDIO_TILES } from '../../web/src/voice-studio-launchpad.js'
import { isSupportPath } from '../../web/src/support-workspace.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

test('phase-1 product surfaces stay wired', () => {
  assert.equal(isSupportPath('/support'), true)
  assert.ok(existsSync(resolve(root, 'config/knowledge/support/faq.md')))
  assert.ok(existsSync(resolve(root, 'config/frontend-agent/personas/support/VOICE.md')))
  assert.ok(existsSync(resolve(root, 'config/frontend-agent/personas/fengge.md')))
  assert.ok(existsSync(resolve(root, 'skills/book-sales-video/SKILL.md')))
  assert.ok(existsSync(resolve(root, 'web/src/VoiceStudioPanel.jsx')))
  assert.ok(existsSync(resolve(root, 'web/src/SupportApp.jsx')))

  const names = frontendTools({ workspace: 'support' }).map(item => item.function.name)
  assert.ok(names.includes('knowledge_search'))
  assert.ok(!names.includes('memory'))
  assert.ok(!names.includes('content_control'))

  const live = VOICE_STUDIO_TILES.filter(tile => tile.status === 'live').map(tile => tile.id)
  assert.ok(live.includes('gallery'))
  assert.ok(live.includes('clone'))

  const gateway = readFileSync(resolve(root, 'server/src/voice/realtime-gateway.mjs'), 'utf8')
  assert.match(gateway, /ownerId: conversationOwnerId\(\)/)
  assert.match(gateway, /advertisedWorkspaceMatches/)
})
