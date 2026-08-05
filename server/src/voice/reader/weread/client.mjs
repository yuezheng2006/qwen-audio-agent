/**
 * WeRead Agent Gateway client (opendatalab-style access seam).
 * https://weread.qq.com/r/weread-skills
 */

const DEFAULT_GATEWAY = 'https://i.weread.qq.com/api/agent/gateway'
const DEFAULT_SKILL_VERSION = '1.0.4'

export function createWereadClient({
  apiKey = process.env.WEREAD_API_KEY || '',
  skillVersion = DEFAULT_SKILL_VERSION,
  gatewayUrl = DEFAULT_GATEWAY,
  fetchImpl = globalThis.fetch,
} = {}) {
  const key = String(apiKey || '').trim()

  async function call(apiName, params = {}) {
    if (!key) {
      throw new Error(
        '未配置 WEREAD_API_KEY。请到 https://weread.qq.com/r/weread-skills 获取后写入 ~/.config/qwaudio/config.env',
      )
    }
    if (typeof fetchImpl !== 'function') {
      throw new Error('weread client 需要 fetch')
    }
    const body = {
      api_name: apiName,
      skill_version: skillVersion,
      ...params,
    }
    const response = await fetchImpl(gatewayUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const payload = await response.json().catch(() => ({}))
    if (payload?.upgrade_info) {
      const info = payload.upgrade_info
      throw new Error(
        info.message
        || `微信读书 Skill 需升级到 ${info.latest_version || '最新版'}：${info.upgrade_url || ''}`,
      )
    }
    if (!response.ok) {
      throw new Error(`微信读书 HTTP ${response.status}`)
    }
    if (payload?.errcode) {
      throw new Error(`微信读书错误 ${payload.errcode}: ${payload.errmsg || ''}`)
    }
    return payload
  }

  return {
    skillVersion,
    configured: Boolean(key),

    async shelf({ recentLimit = 30 } = {}) {
      const data = await call('/shelf/sync')
      const books = Array.isArray(data.books) ? data.books : []
      const albums = Array.isArray(data.albums) ? data.albums : []
      const mp = data.mp && typeof data.mp === 'object' ? data.mp : null
      const total = books.length + albums.length + (mp ? 1 : 0)
      const recent = [...books]
        .sort((a, b) => (b.readUpdateTime || 0) - (a.readUpdateTime || 0))
        .slice(0, Math.max(1, Number(recentLimit) || 30))
        .map(normalizeBook)
      return {
        books: books.map(normalizeBook),
        albums,
        mp,
        total,
        recent,
        bookCount: books.length,
        albumCount: albums.length,
      }
    },

    async highlights(bookId) {
      const id = String(bookId || '').trim()
      if (!id) throw new Error('bookId is required')
      const data = await call('/book/bookmarklist', { bookId: id })
      const chapters = Array.isArray(data.chapters) ? data.chapters : []
      const byUid = new Map(chapters.map(item => [item.chapterUid, item]))
      const highlights = (Array.isArray(data.updated) ? data.updated : [])
        .map(item => {
          const chapter = byUid.get(item.chapterUid) || {}
          return {
            id: String(item.bookmarkId || `${item.chapterUid}:${item.range || ''}`),
            bookId: String(item.bookId || id),
            chapterUid: item.chapterUid,
            chapterTitle: chapter.title || '',
            markText: String(item.markText || '').trim(),
            createTime: formatDay(item.createTime),
            range: item.range || '',
            type: item.type,
          }
        })
        .filter(item => item.markText)
      return {
        book: normalizeBook(data.book || { bookId: id }),
        chapters,
        highlights,
      }
    },

    async notebooks({ count = 40 } = {}) {
      const pageSize = Math.min(100, Math.max(1, Number(count) || 40))
      const books = []
      let lastSort
      let guard = 0
      let totalBookCount = 0
      let totalNoteCount = 0
      while (guard < 10) {
        guard += 1
        const params = { count: pageSize }
        if (lastSort != null) params.lastSort = lastSort
        const data = await call('/user/notebooks', params)
        totalBookCount = data.totalBookCount ?? totalBookCount
        totalNoteCount = data.totalNoteCount ?? totalNoteCount
        for (const item of data.books || []) {
          const book = normalizeBook(item.book || { bookId: item.bookId })
          const noteCount = Number(item.noteCount || 0)
          const reviewCount = Number(item.reviewCount || 0)
          const bookmarkCount = Number(item.bookmarkCount || 0)
          books.push({
            ...book,
            bookId: String(item.bookId || book.bookId),
            noteCount,
            reviewCount,
            bookmarkCount,
            noteTotal: noteCount + reviewCount + bookmarkCount,
            readingProgress: item.readingProgress,
            markedStatus: item.markedStatus,
            sort: item.sort,
          })
        }
        if (!data.hasMore || !(data.books || []).length) break
        lastSort = data.books[data.books.length - 1]?.sort
        if (lastSort == null) break
      }
      books.sort((a, b) => (b.noteTotal || 0) - (a.noteTotal || 0))
      return {
        books,
        totalBookCount,
        totalNoteCount,
      }
    },

    async mineReviews(bookId, { maxItems = 200 } = {}) {
      const id = String(bookId || '').trim()
      if (!id) throw new Error('bookId is required')
      const limit = Math.min(200, Math.max(1, Number(maxItems) || 200))
      const reviews = []
      let synckey = 0
      let guard = 0
      while (guard < 20 && reviews.length < limit) {
        guard += 1
        const data = await call('/review/list/mine', {
          bookid: id,
          synckey,
          count: 50,
        })
        for (const item of data.reviews || []) {
          const rev = item.review || item
          const content = String(rev.content || '').trim()
          if (!content) continue
          reviews.push({
            id: String(rev.reviewId || `mine-${reviews.length}`),
            source: 'mine',
            content,
            chapterName: rev.chapterName || '',
            createTime: formatDay(rev.createTime),
            star: normalizeMineStar(rev.star),
            authorName: '我',
          })
          if (reviews.length >= limit) break
        }
        if (!data.hasMore) break
        synckey = data.synckey || synckey
        if (!data.synckey) break
      }
      return { bookId: id, reviews }
    },

    /** Public book reviews via /review/list (not personal notes). */
    async publicReviews(bookId, {
      maxItems = 40,
      reviewListType = 1,
    } = {}) {
      const id = String(bookId || '').trim()
      if (!id) throw new Error('bookId is required')
      const limit = Math.min(100, Math.max(1, Number(maxItems) || 40))
      const type = Number(reviewListType)
      const reviews = []
      let synckey = 0
      let maxIdx = 0
      let guard = 0
      let meta = {}
      while (guard < 10 && reviews.length < limit) {
        guard += 1
        const data = await call('/review/list', {
          bookId: id,
          reviewListType: Number.isFinite(type) ? type : 1,
          count: Math.min(20, limit - reviews.length),
          maxIdx,
          synckey,
        })
        if (guard === 1) {
          meta = {
            reviewsCnt: data.reviewsCnt,
            deepVRecommendInfo: data.deepVRecommendInfo || null,
            deepVRecommendValue: data.deepVRecommendValue,
          }
        }
        let lastIdx = maxIdx
        for (const item of data.reviews || []) {
          const mapped = mapPublicReview(item)
          if (!mapped) continue
          reviews.push(mapped)
          if (item.idx != null) lastIdx = item.idx
          if (reviews.length >= limit) break
        }
        if (!data.reviewsHasMore) break
        if (lastIdx === maxIdx) break
        maxIdx = lastIdx
        synckey = data.synckey || synckey
      }
      return { bookId: id, reviews, ...meta }
    },

    /**
     * Combined reviews for the panel:
     * - mine: personal thoughts
     * - public: recommended/public book reviews
     * - reviews: flattened list for speak selection
     */
    async reviews(bookId, {
      maxMine = 100,
      maxPublic = 40,
      reviewListType = 1,
    } = {}) {
      const id = String(bookId || '').trim()
      if (!id) throw new Error('bookId is required')
      const [minePayload, publicPayload] = await Promise.all([
        this.mineReviews(id, { maxItems: maxMine }).catch(() => ({
          bookId: id,
          reviews: [],
        })),
        this.publicReviews(id, { maxItems: maxPublic, reviewListType }).catch(() => ({
          bookId: id,
          reviews: [],
        })),
      ])
      const mine = minePayload.reviews || []
      const pub = publicPayload.reviews || []
      return {
        bookId: id,
        mine,
        public: pub,
        reviews: [...mine, ...pub],
        reviewsCnt: publicPayload.reviewsCnt,
        deepVRecommendInfo: publicPayload.deepVRecommendInfo || null,
      }
    },
  }
}

function mapPublicReview(item) {
  const wrap = item?.review || item || {}
  const rev = wrap.review || wrap
  const content = String(rev.content || '').trim()
  if (!content) return null
  const author = rev.author || {}
  return {
    id: String(rev.reviewId || wrap.reviewId || `pub-${item?.idx ?? content.slice(0, 8)}`),
    source: 'public',
    content,
    chapterName: rev.chapterName || '',
    createTime: formatDay(rev.createTime),
    star: normalizePublicStar(rev.star),
    authorName: author.name || '读者',
    authorVid: author.userVid || '',
    idx: item?.idx,
  }
}

function normalizePublicStar(star) {
  const n = Number(star)
  if (!Number.isFinite(n) || n <= 0) return 0
  // WeRead public API: 20/40/60/80/100 → 1..5
  if (n > 5) return Math.min(5, Math.max(1, Math.round(n / 20)))
  return Math.min(5, Math.max(0, Math.round(n)))
}

function normalizeMineStar(star) {
  const n = Number(star)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(5, Math.round(n))
}

function normalizeBook(book = {}) {
  return {
    bookId: String(book.bookId || ''),
    title: book.title || '未命名',
    author: book.author || '',
    cover: book.cover || '',
    category: book.category || '',
    readUpdateTime: book.readUpdateTime || 0,
    readUpdateDay: formatDay(book.readUpdateTime),
    finishReading: book.finishReading,
  }
}

function formatDay(ts) {
  if (!ts) return ''
  const date = new Date(Number(ts) * 1000)
  if (Number.isNaN(date.getTime())) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
