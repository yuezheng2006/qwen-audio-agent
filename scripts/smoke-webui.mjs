#!/usr/bin/env node
/**
 * Live WebUI smoke: fetch pages the way a browser resolves URLs.
 * Fails if / or /support boot to HTML-as-JS, or core APIs are missing.
 *
 *   node scripts/smoke-webui.mjs [baseUrl]
 */
import { pageAssetUrls } from '../web/src/app-paths.js'

const base = String(process.argv[2] || process.env.GATEWAY_URL || 'http://127.0.0.1:3101')
  .replace(/\/+$/, '')
const token = process.env.SUPPORT_INBOUND_TOKEN || 'demo-support'

async function get(path, { accept } = {}) {
  const url = path.startsWith('http') ? path : `${base}${path}`
  const response = await fetch(url, { redirect: 'follow' })
  const type = response.headers.get('content-type') || ''
  const body = await response.text()
  if (accept && !accept.test(type)) {
    throw new Error(`${url} expected ${accept} got ${type || 'unknown'} (${response.status})`)
  }
  if (!response.ok) {
    throw new Error(`${url} ${response.status} ${body.slice(0, 180)}`)
  }
  return { url, response, type, body }
}

async function assertPageBoots(path) {
  const page = await get(path, { accept: /text\/html/ })
  const assets = pageAssetUrls(page.body, page.url)
  if (!assets.length) throw new Error(`${path} has no js/css assets`)
  for (const asset of assets) {
    const loaded = await get(asset)
    if (/text\/html/i.test(loaded.type)) {
      throw new Error(`${path} asset ${asset} returned HTML (SPA fallback). Check vite base.`)
    }
    if (asset.endsWith('.js') && !/javascript/i.test(loaded.type)) {
      throw new Error(`${path} asset ${asset} is not JavaScript (${loaded.type})`)
    }
  }
  return assets
}

const failures = []
const check = async (name, fn) => {
  try {
    const detail = await fn()
    process.stdout.write(`ok  ${name}${detail ? `  ${detail}` : ''}\n`)
  } catch (error) {
    failures.push(name)
    process.stderr.write(`fail  ${name}\n  ${error.message}\n`)
  }
}

await check('GET / boots', async () => {
  const assets = await assertPageBoots('/')
  return `${assets.length} assets`
})
await check('GET /support boots', async () => {
  const assets = await assertPageBoots('/support?token=' + encodeURIComponent(token))
  return `${assets.length} assets`
})
await check('GET /api/health', async () => {
  const { body } = await get('/api/health', { accept: /json/ })
  const payload = JSON.parse(body)
  if (!payload.ok) throw new Error('health.ok is false')
  return payload.realtimeProvider || 'ok'
})
await check('GET /api/content/books', async () => {
  const { body } = await get('/api/content/books', { accept: /json/ })
  const payload = JSON.parse(body)
  if (!Array.isArray(payload.books)) throw new Error('books missing')
  return `${payload.books.length} books`
})
await check('UI session fetch (Promise to json)', async () => {
  const response = await fetch(`${base}/api/support/session?token=${encodeURIComponent(token)}`)
  const payload = await response.json()
  if (!response.ok || !payload.ok) throw new Error(payload.error || 'session denied')
  return payload.visitorId ? 'visitor' : 'ok'
})
await check('GET /api/support/session', async () => {
  const { body } = await get(`/api/support/session?token=${encodeURIComponent(token)}`, {
    accept: /json/,
  })
  const payload = JSON.parse(body)
  if (!payload.ok) throw new Error(payload.error || 'session denied')
  return payload.workspace
})

await check('support example gets assistant text', async () => {
  const wsUrl = `${base.replace(/^http/, 'ws')}/api/realtime?sessionId=smoke-support`
  const events = []
  const socket = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve)
    socket.addEventListener('error', () => reject(new Error('websocket error')))
  })
  const acked = new Set()
  socket.addEventListener('message', message => {
    let event
    try {
      event = JSON.parse(message.data)
    } catch {
      return
    }
    events.push(event)
    if (event.type === 'audio.delta' && event.responseId && !acked.has(event.responseId)) {
      acked.add(event.responseId)
      socket.send(JSON.stringify({ type: 'playback.started', responseId: event.responseId }))
    }
    if (event.type === 'audio.done' && event.responseId) {
      socket.send(JSON.stringify({ type: 'playback.ended', responseId: event.responseId }))
    }
  })
  socket.send(JSON.stringify({
    type: 'connect',
    workspace: 'support',
    personaId: 'support',
    token,
    outputEnabled: true,
    inputEnabled: false,
    clientType: 'web',
    clientLabel: 'Smoke',
  }))
  await new Promise(resolve => setTimeout(resolve, 600))
  socket.send(JSON.stringify({ type: 'text.message', text: '营业时间到几点？' }))
  const deadline = Date.now() + 25000
  while (Date.now() < deadline) {
    const reply = events.find(event => (
      event.type === 'transcript.final'
      && event.role === 'assistant'
      && event.content
    ))
    if (reply) {
      socket.close()
      return String(reply.content).replace(/\s+/g, ' ').slice(0, 48)
    }
    const error = events.find(event => event.type === 'error' && event.message)
    if (error) {
      socket.close()
      throw new Error(error.message)
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  socket.close()
  throw new Error(`no assistant reply (${events.map(event => event.type).join(',') || 'no events'})`)
})

if (failures.length) {
  process.stderr.write(`\nsmoke-webui failed: ${failures.join(', ')}\n`)
  process.exit(1)
}
process.stdout.write('\nsmoke-webui passed\n')
