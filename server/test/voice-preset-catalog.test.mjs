import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import { loadPresetCatalog } from '../src/voice/studio/preset-catalog.mjs'

const dir = join(process.cwd(), 'config/voice-presets')

test('preset catalog lists four demo voices without absolute paths', () => {
  const catalog = loadPresetCatalog(dir)
  const items = catalog.list()
  assert.equal(items.length, 4)
  assert.ok(items.every(i => i.id && i.label && i.license === 'demo'))
  assert.ok(items.every(i => !('path' in i) && !('relativePath' in i)))
  const hit = catalog.list({ query: '沉稳' })
  assert.equal(hit[0].id, 'demo-calm-male')
})
