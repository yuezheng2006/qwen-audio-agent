import assert from 'node:assert/strict'
import test from 'node:test'
import { createWereadClient } from '../src/voice/reader/weread/client.mjs'
import { buildSpeakScript } from '../src/voice/reader/weread/export.mjs'

test('shelf total counts books + albums + mp entry', async () => {
  const client = createWereadClient({
    apiKey: 'wrk-test',
    skillVersion: '1.0.4',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        books: [
          { bookId: '1', title: 'A', author: 'a', readUpdateTime: 200 },
          { bookId: '2', title: 'B', author: 'b', readUpdateTime: 100 },
        ],
        albums: [{ albumInfo: { albumId: 'x', name: '有声' } }],
        mp: { name: '文章收藏' },
      }),
    }),
  })
  const shelf = await client.shelf()
  assert.equal(shelf.total, 4)
  assert.equal(shelf.recent[0].title, 'A')
  assert.equal(shelf.books.length, 2)
})

test('highlights maps markText and chapter titles', async () => {
  const client = createWereadClient({
    apiKey: 'wrk-test',
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body)
      assert.equal(body.api_name, '/book/bookmarklist')
      assert.equal(body.bookId, '91')
      assert.equal(body.skill_version, '1.0.4')
      return {
        ok: true,
        json: async () => ({
          book: { bookId: '91', title: '猪', author: '王' },
          chapters: [{ chapterUid: 7, title: '积极的结论' }],
          updated: [{
            bookmarkId: 'bm1',
            chapterUid: 7,
            markText: '真理直率无比',
            createTime: 1747000000,
            range: '1-10',
          }],
        }),
      }
    },
  })
  const result = await client.highlights('91')
  assert.equal(result.book.title, '猪')
  assert.equal(result.highlights.length, 1)
  assert.equal(result.highlights[0].chapterTitle, '积极的结论')
  assert.match(result.highlights[0].createTime, /^\d{4}-\d{2}-\d{2}$/)
})

test('reviews merges mine and public book reviews', async () => {
  const client = createWereadClient({
    apiKey: 'wrk-test',
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body)
      if (body.api_name === '/review/list/mine') {
        return {
          ok: true,
          json: async () => ({
            hasMore: 0,
            reviews: [{
              review: {
                reviewId: 'mine1',
                content: '我的想法',
                createTime: 1747000000,
                star: 4,
              },
            }],
          }),
        }
      }
      if (body.api_name === '/review/list') {
        assert.equal(body.bookId, '91')
        assert.equal(body.reviewListType, 1)
        return {
          ok: true,
          json: async () => ({
            reviewsCnt: 12,
            reviewsHasMore: 0,
            deepVRecommendInfo: { subtitle: '86% 推荐' },
            reviews: [{
              idx: 1,
              review: {
                review: {
                  reviewId: 'pub1',
                  content: '公开好评',
                  star: 100,
                  createTime: 1747000000,
                  author: { name: '读者甲', userVid: 1 },
                },
              },
            }],
          }),
        }
      }
      throw new Error(`unexpected ${body.api_name}`)
    },
  })
  const result = await client.reviews('91')
  assert.equal(result.mine.length, 1)
  assert.equal(result.public.length, 1)
  assert.equal(result.public[0].star, 5)
  assert.equal(result.public[0].authorName, '读者甲')
  assert.equal(result.reviews.length, 2)
  assert.equal(result.deepVRecommendInfo.subtitle, '86% 推荐')
})

test('buildSpeakScript speaks content only and truncates', () => {
  const built = buildSpeakScript({
    title: '一只特立独行的猪',
    mode: 'highlights',
    highlights: [
      { id: '1', markText: '甲'.repeat(100) },
      { id: '2', markText: '乙'.repeat(100) },
    ],
    maxChars: 80,
  })
  assert.doesNotMatch(built.text, /峰哥为你读/)
  assert.match(built.text, /^甲/)
  assert.equal(built.truncated, true)
  assert.ok(built.count >= 1)
})

test('notebooks maps note counts and sorts by noteTotal', async () => {
  const client = createWereadClient({
    apiKey: 'wrk-test',
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body)
      assert.equal(body.api_name, '/user/notebooks')
      return {
        ok: true,
        json: async () => ({
          totalBookCount: 2,
          totalNoteCount: 21,
          hasMore: 0,
          books: [
            {
              bookId: 'a',
              book: { bookId: 'a', title: '少' },
              noteCount: 2,
              reviewCount: 0,
              bookmarkCount: 0,
              sort: 1,
            },
            {
              bookId: 'b',
              book: { bookId: 'b', title: '多' },
              noteCount: 19,
              reviewCount: 0,
              bookmarkCount: 0,
              sort: 2,
            },
          ],
        }),
      }
    },
  })
  const notebooks = await client.notebooks()
  assert.equal(notebooks.books[0].title, '多')
  assert.equal(notebooks.books[0].noteTotal, 19)
})

test('client rejects missing api key', async () => {
  const client = createWereadClient({ apiKey: '' })
  await assert.rejects(() => client.shelf(), /WEREAD_API_KEY/)
})
