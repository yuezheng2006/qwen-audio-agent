import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { WebSocketServer } from 'ws'
import { DashScopeTask } from '../src/voice/cascade/adapters/dashscope-ws.mjs'

// Fake DashScope duplex endpoint. `script(action, payload, reply)` decides
// what the server sends back for each client action.
async function startFakeDashScope(script) {
  const server = createServer()
  const wss = new WebSocketServer({ server })
  const state = { sockets: [], binaries: [], headers: null }
  wss.on('connection', (ws, request) => {
    state.headers = request.headers
    state.sockets.push(ws)
    ws.on('message', (raw, isBinary) => {
      if (isBinary) {
        state.binaries.push(Buffer.from(raw))
        script('binary', raw, reply(ws))
        return
      }
      const event = JSON.parse(raw.toString())
      script(event.header.action, event.payload, reply(ws, event.header.task_id))
    })
  })
  const reply = (ws, taskId) => ({
    event: (kind, payload = {}, header = {}) => ws.send(JSON.stringify({
      header: { event: kind, task_id: taskId, ...header },
      payload,
    })),
    binary: buffer => ws.send(buffer, { binary: true }),
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return {
    url: `ws://127.0.0.1:${server.address().port}`,
    state,
    close: () => new Promise(resolvePromise => {
      for (const ws of state.sockets) ws.terminate()
      server.close(resolvePromise)
    }),
  }
}

test('runs a task, streams results and binary, then finishes', async () => {
  const fake = await startFakeDashScope((action, payload, reply) => {
    if (action === 'run-task') reply.event('task-started')
    if (action === 'continue-task') {
      reply.binary(Buffer.from([1, 2, 3]))
      reply.event('result-generated', { output: { echo: payload.input.text } })
    }
    if (action === 'finish-task') reply.event('task-finished')
  })
  const results = []
  const binaries = []
  let finished = false
  const task = new DashScopeTask({
    url: fake.url,
    apiKey: 'secret-key',
    taskGroup: 'audio',
    task: 'tts',
    function: 'SpeechSynthesizer',
    model: 'qwen-audio-3.0-tts-flash',
    parameters: { voice: 'test-voice' },
    onResult: payload => results.push(payload),
    onBinary: buffer => binaries.push(Buffer.from(buffer)),
    onFinished: () => { finished = true },
  })
  await task.connect()
  task.continueTask({ text: '你好' })
  task.finishTask()
  await new Promise(resolvePromise => setTimeout(resolvePromise, 100))
  assert.equal(fake.state.headers.authorization, 'Bearer secret-key')
  assert.deepEqual(results[0], { output: { echo: '你好' } })
  assert.deepEqual(binaries[0], Buffer.from([1, 2, 3]))
  assert.equal(finished, true)
  assert.equal(task.finished, true)
  await fake.close()
})

test('sends audio buffers as raw binary frames', async () => {
  const fake = await startFakeDashScope((action, _payload, reply) => {
    if (action === 'run-task') reply.event('task-started')
  })
  const task = new DashScopeTask({
    url: fake.url,
    apiKey: 'key',
    taskGroup: 'audio',
    task: 'asr',
    function: 'recognition',
    model: 'qwen3-asr-flash-realtime',
  })
  await task.connect()
  task.sendAudio(Buffer.from([9, 9]))
  await new Promise(resolvePromise => setTimeout(resolvePromise, 100))
  assert.deepEqual(fake.state.binaries, [Buffer.from([9, 9])])
  task.close()
  await fake.close()
})

test('task-failed rejects the connection and reports the error', async () => {
  const fake = await startFakeDashScope((action, _payload, reply) => {
    if (action === 'run-task') {
      reply.event('task-failed', {}, {
        error_code: 'InvalidParameter',
        error_message: '音色不存在',
      })
    }
  })
  const errors = []
  const task = new DashScopeTask({
    url: fake.url,
    apiKey: 'key',
    taskGroup: 'audio',
    task: 'tts',
    function: 'SpeechSynthesizer',
    model: 'qwen-audio-3.0-tts-flash',
    onError: error => errors.push(error),
  })
  await assert.rejects(() => task.connect(), /音色不存在/)
  assert.equal(errors[0].code, 'InvalidParameter')
  await fake.close()
})

test('an unexpected disconnect surfaces as an error', async () => {
  const fake = await startFakeDashScope((action, _payload, reply) => {
    if (action === 'run-task') reply.event('task-started')
  })
  const errors = []
  const task = new DashScopeTask({
    url: fake.url,
    apiKey: 'key',
    taskGroup: 'audio',
    task: 'asr',
    function: 'recognition',
    model: 'qwen3-asr-flash-realtime',
    onError: error => errors.push(error),
  })
  await task.connect()
  await fake.close()
  await new Promise(resolvePromise => setTimeout(resolvePromise, 100))
  assert.match(errors[0].message, /未完成即断开/)
})
