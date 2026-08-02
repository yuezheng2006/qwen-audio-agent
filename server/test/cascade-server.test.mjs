import assert from 'node:assert/strict'
import test from 'node:test'
import { once } from 'node:events'
import WebSocket from 'ws'
import {
  cascadeRealtimeUrl,
  startCascadeServer,
  stopCascadeServer,
} from '../src/voice/cascade/server.mjs'
import { REALTIME_PROVIDERS } from '../src/voice/realtime-provider.mjs'
import { cascadeTestConfig } from './helpers/fake-dashscope.mjs'

test('serves the Realtime handshake over a loopback socket', async () => {
  const url = await startCascadeServer({
    cascadeConfig: cascadeTestConfig('ws://unused'),
    log: () => {},
  })
  try {
    assert.match(url, /^ws:\/\/127\.0\.0\.1:\d+$/)
    assert.equal(cascadeRealtimeUrl(), url)
    const ws = new WebSocket(url)
    const [raw] = await once(ws, 'message')
    const created = JSON.parse(raw.toString())
    assert.equal(created.type, 'session.created')
    ws.send(JSON.stringify({
      type: 'session.update',
      session: { instructions: '你是小峰', tools: [] },
    }))
    const [updatedRaw] = await once(ws, 'message')
    const updated = JSON.parse(updatedRaw.toString())
    assert.equal(updated.type, 'session.updated')
    assert.equal(updated.session.instructions, '你是小峰')
    ws.close()
    await once(ws, 'close')
  } finally {
    stopCascadeServer()
  }
  assert.equal(cascadeRealtimeUrl(), '')
})

test('starting twice reuses the same loopback endpoint', async () => {
  const first = await startCascadeServer({
    cascadeConfig: cascadeTestConfig('ws://unused'),
    log: () => {},
  })
  try {
    assert.equal(await startCascadeServer(), first)
  } finally {
    stopCascadeServer()
  }
})

test('the cascade provider is registered with the expected surface', () => {
  const provider = REALTIME_PROVIDERS.cascade
  assert.ok(provider, 'cascade provider must be registered')
  assert.equal(provider.inputSampleRate, 16000)
  const session = provider.buildSession({ agentContext: {} })
  assert.ok(session.instructions.length > 0)
  assert.ok(Array.isArray(session.tools) && session.tools.length > 0)
  assert.deepEqual(session.modalities, ['text', 'audio'])
  const textOnly = provider.buildSession({ agentContext: { textOnly: true } })
  assert.deepEqual(textOnly.modalities, ['text'])
})

test('speak responses bypass the LLM via the cascade_mode payload', () => {
  const provider = REALTIME_PROVIDERS.cascade
  const spoken = provider.buildSpeakResponse('任务完成了。', {})
  assert.equal(spoken.cascade_mode, 'speak')
  assert.equal(spoken.content, '任务完成了。')
  assert.deepEqual(spoken.modalities, ['text', 'audio'])
  const silent = provider.buildSpeakResponse('结果', { textOnly: true })
  assert.deepEqual(silent.modalities, ['text'])
})

test('result and permission injections share the S2S payload contract', () => {
  const provider = REALTIME_PROVIDERS.cascade
  const result = provider.buildResultInjection('后台结果', {})
  assert.equal(result.item.type, 'message')
  assert.equal(result.item.role, 'user')
  assert.equal(result.response.tool_choice, 'none')
  assert.ok(result.response.instructions.length > 0)
  const permission = provider.buildPermissionInjection({
    id: 'auth_1',
    summary: '写入文件',
  }, {})
  assert.equal(permission.item.type, 'message')
  assert.ok(JSON.stringify(permission.item.content).includes('auth_1'))
  assert.ok(permission.response.instructions.length > 0)
})
