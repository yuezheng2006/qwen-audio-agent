import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  filterRealtimeTools,
  isRegisteredWorkspace,
  normalizeWorkspace,
  advertisedWorkspaceMatches,
  seedSupportKnowledge,
  supportConnectContext,
  verifyInboundToken,
  verifySupportToken,
  workspaceKbId,
  workspaceOwnerId,
} from '../src/conversation/workspace.mjs'
import { frontendTools } from '../src/voice/frontend-tools.mjs'
import { resolvePersonaId, personaDisplayName } from '../src/conversation/persona.mjs'

test('support workspace filters tools and maps persona', () => {
  assert.equal(normalizeWorkspace('support'), 'support')
  assert.equal(normalizeWorkspace('gallery'), '')
  assert.equal(resolvePersonaId({ voiceLabel: '客服助手' }), 'support')
  assert.equal(personaDisplayName('support'), '客服助手')
  assert.deepEqual(supportConnectContext().personaId, 'support')

  const tools = filterRealtimeTools([
    { type: 'function', function: { name: 'knowledge_search' } },
    { type: 'function', function: { name: 'memory' } },
    { type: 'function', function: { name: 'spawn_thinking' } },
  ], 'support')
  assert.deepEqual(tools.map(item => item.function.name), [
    'knowledge_search',
    'spawn_thinking',
  ])

  const names = frontendTools({ workspace: 'support' }).map(item => item.function.name)
  assert.ok(names.includes('knowledge_search'))
  assert.ok(!names.includes('memory'))
  assert.ok(!names.includes('content_control'))
})

test('support inbound token rejects empty or mismatch', () => {
  assert.equal(verifySupportToken('abc', '').ok, false)
  assert.equal(verifySupportToken('', 'secret').ok, false)
  assert.equal(verifySupportToken('nope', 'secret').ok, false)
  assert.equal(verifySupportToken('secret', 'secret').ok, true)
})

test('inbound token is workspace-scoped and rejects unknown workspaces', () => {
  assert.equal(isRegisteredWorkspace(''), true)
  assert.equal(isRegisteredWorkspace('support'), true)
  assert.equal(isRegisteredWorkspace('gallery'), false)
  assert.equal(verifyInboundToken('', 'anything').ok, true)
  assert.equal(verifyInboundToken('gallery', 'secret').ok, false)
  assert.match(verifyInboundToken('gallery', 'secret').error, /未注册/)
  assert.equal(verifyInboundToken('support', 'secret', { support: 'secret' }).ok, true)
  assert.equal(verifyInboundToken('support', 'nope', { support: 'secret' }).ok, false)
})

test('workspace owner and knowledge stay isolated', () => {
  assert.equal(workspaceOwnerId('alice', ''), 'alice')
  assert.equal(workspaceOwnerId('alice', 'support'), 'support::alice')
  assert.notEqual(workspaceOwnerId('alice', 'support'), workspaceOwnerId('alice', ''))
  assert.equal(workspaceKbId('support', 'default'), 'support')
  assert.equal(workspaceKbId('', 'books'), 'books')
  assert.equal(workspaceKbId('', ''), undefined)
  assert.equal(advertisedWorkspaceMatches('', 'support'), true)
  assert.equal(advertisedWorkspaceMatches('support', 'support'), true)
  assert.equal(advertisedWorkspaceMatches('support', ''), false)
  assert.equal(advertisedWorkspaceMatches('gallery', 'support'), false)
})

test('seedSupportKnowledge copies bundled FAQ once', () => {
  const root = mkdtempSync(join(tmpdir(), 'qwaudio-support-kb-'))
  const seedDir = join(root, 'seed')
  const knowledgeDir = join(root, 'knowledge')
  mkdirSync(seedDir)
  writeFileSync(join(seedDir, 'faq.md'), '# FAQ\n\n退款 48 小时。\n')
  const first = seedSupportKnowledge(knowledgeDir, seedDir)
  assert.equal(first.copied, 1)
  assert.match(readFileSync(join(knowledgeDir, 'support', 'faq.md'), 'utf8'), /退款/)
  writeFileSync(join(knowledgeDir, 'support', 'faq.md'), '# 用户改过\n')
  const second = seedSupportKnowledge(knowledgeDir, seedDir)
  assert.equal(second.skipped, true)
  assert.match(readFileSync(join(knowledgeDir, 'support', 'faq.md'), 'utf8'), /用户改过/)
})
