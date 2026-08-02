import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { streamChat } from '../src/voice/cascade/adapters/llm.mjs'

// Fake OpenAI-compatible /chat/completions endpoint streaming scripted SSE
// chunks. Captures the request body for contract assertions.
async function startFakeLlm(chunks, { status = 200 } = {}) {
  const state = { body: null, headers: null }
  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', part => { raw += part })
    request.on('end', () => {
      state.body = JSON.parse(raw)
      state.headers = request.headers
      if (status !== 200) {
        response.writeHead(status, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'quota exhausted' } }))
        return
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const chunk of chunks) {
        response.write(`data: ${JSON.stringify(chunk)}\n\n`)
      }
      response.write('data: [DONE]\n\n')
      response.end()
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return {
    config: {
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      model: 'fake-llm',
      apiKey: 'llm-key',
      maxTokens: 321,
    },
    state,
    close: () => new Promise(resolvePromise => server.close(resolvePromise)),
  }
}

function delta(content, finishReason = null) {
  return {
    choices: [{ delta: { content }, finish_reason: finishReason }],
  }
}

test('streams text deltas and reports the finish reason', async () => {
  const fake = await startFakeLlm([
    delta('你好'),
    delta('，峰哥。'),
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
  ])
  const deltas = []
  const result = await streamChat(fake.config, {
    messages: [{ role: 'user', content: '打个招呼' }],
    onTextDelta: text => deltas.push(text),
  })
  assert.deepEqual(deltas, ['你好', '，峰哥。'])
  assert.equal(result.text, '你好，峰哥。')
  assert.equal(result.finishReason, 'stop')
  assert.deepEqual(result.toolCalls, [])
  await fake.close()
})

test('sends model, token limit, auth and serialized tools', async () => {
  const tools = [{
    type: 'function',
    function: { name: 'spawn_thinking', parameters: { type: 'object' } },
  }]
  const fake = await startFakeLlm([delta('好', 'stop')])
  await streamChat(fake.config, {
    messages: [{ role: 'user', content: 'hi' }],
    tools,
  })
  assert.equal(fake.state.headers.authorization, 'Bearer llm-key')
  assert.equal(fake.state.body.model, 'fake-llm')
  assert.equal(fake.state.body.max_tokens, 321)
  assert.equal(fake.state.body.stream, true)
  assert.deepEqual(fake.state.body.tools, tools)
  assert.equal(fake.state.body.parallel_tool_calls, false)
  await fake.close()
})

test('assembles a tool call streamed across multiple chunks', async () => {
  const fake = await startFakeLlm([
    {
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: 'call_abc',
            function: { name: 'spawn_thinking', arguments: '{"obj' },
          }],
        },
      }],
    },
    {
      choices: [{
        delta: {
          tool_calls: [{ index: 0, function: { arguments: 'ective":"x"}' } }],
        },
        finish_reason: 'tool_calls',
      }],
    },
  ])
  const result = await streamChat(fake.config, {
    messages: [{ role: 'user', content: '做点事' }],
    tools: [{ type: 'function', function: { name: 'spawn_thinking' } }],
  })
  assert.equal(result.toolCalls.length, 1)
  assert.deepEqual(result.toolCalls[0], {
    id: 'call_abc',
    name: 'spawn_thinking',
    arguments: '{"objective":"x"}',
  })
  assert.equal(result.finishReason, 'tool_calls')
  await fake.close()
})

test('non-200 responses raise a descriptive error', async () => {
  const fake = await startFakeLlm([], { status: 429 })
  await assert.rejects(
    () => streamChat(fake.config, {
      messages: [{ role: 'user', content: 'hi' }],
    }),
    /级联 LLM 请求失败 429/,
  )
  await fake.close()
})

test('an abort signal cancels the stream', async () => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write(`data: ${JSON.stringify(delta('第一段'))}\n\n`)
    // Keep the stream open; the client aborts before completion.
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const controller = new AbortController()
  const pending = streamChat({
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    model: 'fake-llm',
    apiKey: 'key',
    maxTokens: 100,
  }, {
    messages: [{ role: 'user', content: 'hi' }],
    signal: controller.signal,
    onTextDelta: () => controller.abort(),
  })
  await assert.rejects(() => pending, /abort/i)
  await new Promise(resolvePromise => server.close(resolvePromise))
})
