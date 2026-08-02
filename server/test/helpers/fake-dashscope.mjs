import { createServer } from 'node:http'
import { once } from 'node:events'
import { WebSocketServer } from 'ws'

// Fake DashScope duplex WebSocket endpoint for adapter tests.
// `script(action, payload, reply)` decides the reply for each client action;
// binary uploads arrive with action === 'binary'.
export async function startFakeDashScope(script) {
  const server = createServer()
  const wss = new WebSocketServer({ server })
  const state = { sockets: [], binaries: [], headers: null }
  const reply = (ws, taskId) => ({
    event: (kind, payload = {}, header = {}) => ws.send(JSON.stringify({
      header: { event: kind, task_id: taskId, ...header },
      payload,
    })),
    binary: buffer => ws.send(buffer, { binary: true }),
  })
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

export function cascadeTestConfig(url, overrides = {}) {
  return {
    dashscopeWsUrl: url,
    stt: {
      provider: 'dashscope',
      model: 'qwen3-asr-flash-realtime',
      apiKey: 'stt-key',
      ...overrides.stt,
    },
    llm: {
      baseUrl: 'http://127.0.0.1:1',
      model: 'fake-llm',
      apiKey: 'llm-key',
      maxTokens: 500,
      ...overrides.llm,
    },
    tts: {
      provider: 'dashscope',
      model: 'qwen-audio-3.0-tts-flash',
      voice: 'test-voice',
      apiKey: 'tts-key',
      sampleRate: 24000,
      ...overrides.tts,
    },
    vad: {
      threshold: 0.015,
      minSpeechMs: 100,
      silenceMs: 300,
      maxSpeechMs: 12000,
      ...overrides.vad,
    },
  }
}
