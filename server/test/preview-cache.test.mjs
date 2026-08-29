import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createPreviewCache,
  withPreviewFlag,
} from '../src/voice/studio/preview-cache.mjs'

test('preview cache write/read/has', () => {
  const dir = mkdtempSync(join(tmpdir(), 'voice-preview-cache-'))
  try {
    const cache = createPreviewCache({ dir })
    assert.equal(cache.has('p1'), false)
    cache.write('p1', Buffer.from('RIFF....'))
    assert.equal(cache.has('p1'), true)
    assert.equal(cache.read('p1').toString('ascii', 0, 4), 'RIFF')
    assert.equal(withPreviewFlag({ id: 'p1', label: 'x' }, cache).has_preview, true)
    assert.equal(withPreviewFlag({ id: 'p2', label: 'y' }, cache).has_preview, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
