import assert from 'node:assert/strict'
import test from 'node:test'
import { cursorFor, organizeBooks } from '../src/reading-library.js'

test('organizeBooks keeps catalogs and buckets leftover md', () => {
  const shelves = organizeBooks({
    books: [{ slug: 'night', title: '夜话', chapters: [{ id: 'a', title: '开端' }] }],
    loose: [{ id: 'b', title: 'scratch', relativePath: 'scratch.md' }],
  })
  assert.equal(shelves.length, 2)
  assert.equal(shelves[0].title, '夜话')
  assert.equal(shelves[1].title, '未分章')
  assert.equal(shelves[1].chapters[0].id, 'b')
})

test('cursorFor matches content id', () => {
  assert.equal(cursorFor([{ contentId: 'a', index: 2 }], 'a').index, 2)
  assert.equal(cursorFor([], 'a'), null)
})
