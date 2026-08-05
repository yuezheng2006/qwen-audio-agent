import assert from 'node:assert/strict'
import test from 'node:test'
import {
  shouldCaptureTurn,
  isBareQuestion,
  isMemorableFact,
  normalizeEpisodeContent,
} from '../src/conversation/episode/turn-capture.mjs'

test('filters backchannels and short noise', () => {
  assert.equal(shouldCaptureTurn('嗯'), false)
  assert.equal(shouldCaptureTurn('好的'), false)
  assert.equal(shouldCaptureTurn('ok'), false)
  assert.equal(shouldCaptureTurn('啊'), false)
  assert.equal(shouldCaptureTurn('蓝'), false)
  assert.equal(shouldCaptureTurn('你基本上就是啊'), false)
  assert.equal(shouldCaptureTurn('我这周要去哪？'), false)
})

test('keeps meaningful user facts', () => {
  assert.equal(shouldCaptureTurn('我喜欢蓝色'), true)
  assert.equal(shouldCaptureTurn('我怕打雷'), true)
  assert.equal(shouldCaptureTurn('周末想去爬山'), true)
  assert.equal(shouldCaptureTurn('这周要去青岛去玩'), true)
  assert.equal(isBareQuestion('我这周要去哪'), true)
  assert.equal(isMemorableFact('这周要去青岛去玩'), true)
  assert.equal(isMemorableFact('就像固件是走的那个啥，是吧？'), false)
})

test('normalizes and truncates content', () => {
  assert.equal(normalizeEpisodeContent('  我喜欢   蓝色  '), '我喜欢 蓝色')
  const long = '字'.repeat(500)
  assert.ok(normalizeEpisodeContent(long, { maxChars: 40 }).endsWith('…'))
})
