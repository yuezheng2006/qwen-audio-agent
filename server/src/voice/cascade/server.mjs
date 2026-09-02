import { createServer } from 'http'
import { WebSocketServer } from 'ws'
import { config } from '../../core/config.mjs'
import { CascadeSession } from './session.mjs'

// Loopback WebSocket service that speaks the same Realtime protocol the
// Gateway already consumes. Registering it as a provider keeps the Gateway
// core unchanged: cascade internals live entirely under voice/cascade.
let activeUrl = ''
let httpServer = null

export function cascadeRealtimeUrl() {
  return activeUrl
}

export function startCascadeServer({
  cascadeConfig = config.cascade,
  log = message => process.stderr.write(`${message}\n`),
  adapters = {},
} = {}) {
  if (activeUrl) return Promise.resolve(activeUrl)
  return new Promise((resolve, reject) => {
    const server = createServer()
    const wss = new WebSocketServer({ server, maxPayload: 2 * 1024 * 1024 })
    wss.on('connection', ws => {
      const session = new CascadeSession(ws, { cascadeConfig, log, adapters })
      ws.on('error', () => session.dispose())
    })
    const host = cascadeConfig.host || '127.0.0.1'
    server.on('error', reject)
    server.listen(cascadeConfig.port || 0, host, () => {
      const { port } = server.address()
      httpServer = server
      activeUrl = `ws://${host}:${port}`
      resolve(activeUrl)
    })
  })
}

export function stopCascadeServer() {
  httpServer?.close()
  httpServer = null
  activeUrl = ''
}
