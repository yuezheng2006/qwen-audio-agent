import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createVoiceMemTurnContextRetriever,
} from '../src/voice/cascade/adapters/voicemem.mjs'

const config = {
  turnContext: {
    provider: 'voicemem',
    url: 'http://127.0.0.1:8765',
    apiKey: 'secret',
    minChars: 3,
  },
}

test('partial retrieval is speculative and final reuses the in-flight result', async () => {
  const requests = []
  let release
  const fetchImpl = async (url, options) => {
    requests.push({ url, options })
    await new Promise(resolve => { release = resolve })
    return new Response(JSON.stringify({
      facts: ['用户喜欢茶'],
      affect: ['用户语气疲惫'],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const provider = createVoiceMemTurnContextRetriever(config, { fetchImpl })
  const turn = provider.openTurn({ sessionId: 'sess_1', turnId: 'turn_1' })
  turn.partial({ text: '我想喝茶' })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(requests.length, 1)
  const pending = turn.final({ transcript: '我想喝茶', deadlineMs: 100 })
  release()
  const result = await pending
  assert.deepEqual(result.facts, ['用户喜欢茶'])
  assert.deepEqual(result.affect, ['用户语气疲惫'])
  assert.equal(requests[0].url, 'http://127.0.0.1:8765/v1/turn/partial')
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    session_id: 'sess_1',
    turn_id: 'turn_1',
    text: '我想喝茶',
  })
  assert.equal(requests[0].options.headers.authorization, 'Bearer secret')
})

test('stale partial requests are cancelled and short partials do not query', async () => {
  const calls = []
  const fetchImpl = (_url, { signal }) => {
    calls.push(signal)
    return new Promise(() => {})
  }
  const provider = createVoiceMemTurnContextRetriever(config, { fetchImpl })
  const turn = provider.openTurn({ sessionId: 's', turnId: 't' })
  turn.partial({ text: '我' })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(calls.length, 0)
  turn.partial({ text: '我想喝茶' })
  await new Promise(resolve => setTimeout(resolve, 0))
  turn.partial({ text: '我想喝咖啡' })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(calls.length, 2)
  assert.equal(calls[0].aborted, true)
  turn.cancel()
  assert.equal(calls[1].aborted, true)
})

test('HTTP failure is isolated from the turn', async () => {
  const provider = createVoiceMemTurnContextRetriever(config, {
    fetchImpl: async () => new Response('bad', { status: 503 }),
  })
  const turn = provider.openTurn({ sessionId: 's', turnId: 't' })
  turn.partial({ text: '我想喝茶' })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(await turn.final({ transcript: '我想喝茶', deadlineMs: 50 }), null)
})
