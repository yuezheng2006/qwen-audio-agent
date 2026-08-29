import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyPersonaBlock,
  celebDisplayNameFromLabel,
  loadPersonaBody,
  resolvePersonaId,
  personaDisplayName,
} from '../src/conversation/persona.mjs'
import { loadFrontendPrompt } from '../src/conversation/frontend-agent-context.mjs'
import { buildFrontendInstructions } from '../src/voice/frontend-tools.mjs'

test('maps gallery voice labels to persona ids', () => {
  assert.equal(celebDisplayNameFromLabel('马季·多层饭店·降噪'), '马季')
  assert.equal(resolvePersonaId({ voiceLabel: '马季·多层饭店·降噪' }), 'maji')
  assert.equal(resolvePersonaId({ voiceLabel: '罗永浩·降噪' }), 'luoyonghao')
  assert.equal(resolvePersonaId({ voiceId: 'fenggetts-abc' }), 'fengge')
  assert.equal(resolvePersonaId({ voiceId: 'cosy-custom-1', voiceLabel: '我的克隆' }), 'generic')
  assert.equal(personaDisplayName('maji'), '马季')
})

test('splices persona block and continuity name into PROMPT', () => {
  const template = [
    '# Role',
    '',
    '<!-- persona:start 默认峰哥 -->',
    '旧人设',
    '<!-- persona:end -->',
    '',
    '始终是同一个{{persona_name}}。',
    '',
    '# Instruction hierarchy',
  ].join('\n')
  const out = applyPersonaBlock(template, '你是马季。', { displayName: '马季' })
  assert.match(out, /<!-- persona:start 马季 -->/)
  assert.match(out, /你是马季。/)
  assert.doesNotMatch(out, /旧人设/)
  assert.match(out, /始终是同一个马季。/)
  assert.doesNotMatch(out, /\{\{persona_name\}\}/)
})

test('loadFrontendPrompt follows active voice label via Nuwa VOICE slice', () => {
  const maji = loadFrontendPrompt({ voiceLabel: '马季·降噪' })
  assert.match(maji, /马季/)
  assert.match(maji, /垫话|包袱|第一人称「我」/)
  assert.match(maji, /同一个马季/)
  assert.doesNotMatch(maji, /辩证反转优先/)

  const fengge = loadFrontendPrompt({ voiceId: 'fenggetts-x', voiceLabel: '峰哥复刻' })
  assert.match(fengge, /你是峰哥/)
  assert.match(fengge, /辩证反转/)
})

test('support persona loads without celebrity gallery voice', () => {
  const body = loadPersonaBody('support')
  assert.match(body, /客服|knowledge_search|kb_id/)
  assert.doesNotMatch(body, /辩证反转/)
  const prompt = buildFrontendInstructions({
    workspace: 'support',
    personaId: 'support',
    voiceLabel: '客服助手',
    memories: [{ scope: 'memory', content: '峰哥喜欢夜话' }],
  })
  assert.match(prompt, /客服/)
  assert.doesNotMatch(prompt, /峰哥喜欢夜话/)
})

test('buildFrontendInstructions drops 千问Audio for non-fengge personas', () => {
  const maji = buildFrontendInstructions({ voiceLabel: '马季·降噪' })
  assert.match(maji, /马季/)
  assert.match(maji, /不要自称千问Audio或峰哥/)
  assert.doesNotMatch(maji, /没有当前用户的个性化覆盖时，你叫千问Audio/)

  const fengge = buildFrontendInstructions({
    voiceId: 'fenggetts-x',
    voiceLabel: '峰哥',
  })
  assert.match(fengge, /千问Audio/)
})

test('Nuwa persona VOICE/SKILL exist for curated gallery names', () => {
  for (const id of [
    'fengge',
    'maji',
    'liuzhenyun',
    'luoyonghao',
    'leijun',
    'mayun',
    'baiyansong',
    'shantianfang',
    'support',
  ]) {
    const body = loadPersonaBody(id)
    assert.ok(body.length > 40, id)
  }
  // 周迅 removed — no persona binding
  assert.equal(resolvePersonaId({ voiceLabel: '周迅·访谈·降噪' }), 'generic')
})
