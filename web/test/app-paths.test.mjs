import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  apiUrl,
  pageAssetUrls,
  realtimeSocketUrl,
} from '../src/app-paths.js'

const distHtml = join(dirname(fileURLToPath(import.meta.url)), '../dist/index.html')

test('api and socket URLs stay at site root from /support', () => {
  assert.equal(apiUrl('support/session?token=x'), '/api/support/session?token=x')
  assert.equal(apiUrl('/api/content/books'), '/api/content/books')
  assert.equal(
    realtimeSocketUrl('visitor', { protocol: 'http:', host: '127.0.0.1:3101' }),
    'ws://127.0.0.1:3101/api/realtime?sessionId=visitor',
  )
  assert.equal(
    realtimeSocketUrl(
      'visitor',
      { protocol: 'https:', host: 'voice.example.com' },
      { workspace: 'support' },
    ),
    'wss://voice.example.com/api/realtime?sessionId=visitor&workspace=support',
  )
})

test('relative assets from /support/ would miss the bundle', () => {
  const relative = pageAssetUrls(
    '<script src="./assets/index.js"></script><link href="./assets/index.css" rel="stylesheet">',
    'http://127.0.0.1:3101/support/',
  )
  assert.deepEqual(relative, [
    'http://127.0.0.1:3101/support/assets/index.js',
    'http://127.0.0.1:3101/support/assets/index.css',
  ])

  const absolute = pageAssetUrls(
    '<script src="/assets/index.js"></script><link href="/assets/index.css" rel="stylesheet">',
    'http://127.0.0.1:3101/support',
  )
  assert.deepEqual(absolute, [
    'http://127.0.0.1:3101/assets/index.js',
    'http://127.0.0.1:3101/assets/index.css',
  ])
})

test('built index.html uses root-absolute assets so /support can boot', () => {
  assert.ok(existsSync(distHtml), 'web/dist/index.html missing; run npm run build --workspace web')
  const html = readFileSync(distHtml, 'utf8')
  const assets = pageAssetUrls(html, 'http://127.0.0.1:3101/support')
  assert.ok(assets.length >= 2, 'expected js and css')
  assert.ok(assets.every(url => url.includes('/assets/') && !url.includes('/support/assets/')))
  assert.doesNotMatch(html, /src="\.\//)
})
