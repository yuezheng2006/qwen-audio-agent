import { useCallback, useEffect, useRef, useState } from 'react'

async function readJson(response) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload.error || `请求失败（${response.status}）`)
  }
  return payload
}

export default function WereadReaderPanel({ open, onClose }) {
  const [tab, setTab] = useState('shelf')
  const [status, setStatus] = useState(null)
  const [shelf, setShelf] = useState(null)
  const [book, setBook] = useState(null)
  const [highlights, setHighlights] = useState([])
  const [mineReviews, setMineReviews] = useState([])
  const [publicReviews, setPublicReviews] = useState([])
  const [reviewMeta, setReviewMeta] = useState(null)
  const [busy, setBusy] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [error, setError] = useState('')
  const audioRef = useRef(null)
  const objectUrlRef = useRef('')

  const stopAudio = useCallback(() => {
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = ''
    }
    setSpeaking(false)
  }, [])

  const refreshShelf = useCallback(async () => {
    const [statusPayload, shelfPayload] = await Promise.all([
      readJson(await fetch('api/weread/status')),
      readJson(await fetch('api/weread/shelf')),
    ])
    setStatus(statusPayload)
    setShelf(shelfPayload)
  }, [])

  const loadBook = useCallback(async (nextBook) => {
    if (!nextBook?.bookId) return
    setBusy(true)
    setError('')
    try {
      const [hl, rv] = await Promise.all([
        readJson(await fetch(`api/weread/highlights?bookId=${encodeURIComponent(nextBook.bookId)}`)),
        readJson(await fetch(`api/weread/reviews?bookId=${encodeURIComponent(nextBook.bookId)}`)),
      ])
      setBook(hl.book || nextBook)
      setHighlights(hl.highlights || [])
      setMineReviews(rv.mine || [])
      setPublicReviews(rv.public || [])
      setReviewMeta({
        reviewsCnt: rv.reviewsCnt,
        deepVRecommendInfo: rv.deepVRecommendInfo,
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }, [])

  const openBookInTab = useCallback(async (nextBook, nextTab) => {
    setTab(nextTab)
    await loadBook(nextBook)
  }, [loadBook])

  useEffect(() => {
    if (!open) return undefined
    setError('')
    let cancelled = false
    refreshShelf().catch(err => {
      if (!cancelled) setError(err.message)
    })
    return () => {
      cancelled = true
    }
  }, [open, refreshShelf])

  useEffect(() => () => stopAudio(), [stopAudio])

  if (!open) return null

  const speakItems = async (mode, itemIds) => {
    const ids = (itemIds || []).filter(Boolean)
    if (!book?.bookId || !ids.length) {
      setError(mode === 'reviews' ? '请先在书评页选一本书' : '请先在金句页选一本书')
      return
    }
    setBusy(true)
    setError('')
    stopAudio()
    try {
      const response = await fetch('api/weread/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookId: book.bookId,
          mode,
          itemIds: ids,
        }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error || `朗读失败（${response.status}）`)
      }
      const truncated = response.headers.get('X-Weread-Truncated') === '1'
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      objectUrlRef.current = url
      const audio = audioRef.current
      audio.src = url
      setSpeaking(true)
      await audio.play()
      if (truncated) {
        setError('文本过长，已截断后朗读')
      }
    } catch (err) {
      setError(err.message)
      setSpeaking(false)
    } finally {
      setBusy(false)
    }
  }

  const speakOne = (mode, id) => speakItems(mode, [id])

  const recent = shelf?.recent || shelf?.books || []
  const withNotes = shelf?.withNotes || []
  const highlightBooks = withNotes.filter(item => (item.noteCount || 0) > 0)

  const clearBook = () => {
    setBook(null)
    setHighlights([])
    setMineReviews([])
    setPublicReviews([])
    setReviewMeta(null)
  }

  const renderBookPicker = ({
    books,
    emptyText,
    subtitle,
    onPick,
  }) => (
    <>
      {subtitle && <p className="hint">{subtitle}</p>}
      <ul className="weread-list">
        {books.map(item => (
          <li key={`pick-${item.bookId}`}>
            <button
              type="button"
              className={book?.bookId === item.bookId ? 'active' : ''}
              disabled={busy}
              onClick={() => onPick(item)}
            >
              <b>{item.title}</b>
              <small>
                {item.author || '未知作者'}
                {item.noteCount != null ? ` · 划线 ${item.noteCount}` : ''}
                {item.reviewCount != null ? ` · 想法 ${item.reviewCount}` : ''}
                {item.readUpdateDay ? ` · ${item.readUpdateDay}` : ''}
              </small>
            </button>
          </li>
        ))}
      </ul>
      {!books.length && <div className="empty-memories">{emptyText}</div>}
    </>
  )

  const renderReviewList = (items, emptyText) => (
    <>
      <ul className="weread-list">
        {items.map(item => (
          <li key={item.id} className="weread-row">
            <div className="weread-item-body">
              <b>{item.content}</b>
              <small>
                {item.source === 'public'
                  ? `${item.authorName || '读者'}${item.star ? ` · ${item.star}星` : ''}`
                  : (item.chapterName || '我的想法')}
                {item.createTime ? ` · ${item.createTime}` : ''}
              </small>
            </div>
            <button
              type="button"
              className="weread-speak-one"
              disabled={busy || !book}
              onClick={() => speakOne('reviews', item.id)}
            >
              朗读
            </button>
          </li>
        ))}
      </ul>
      {!items.length && <div className="empty-memories">{emptyText}</div>}
    </>
  )

  const reviewIds = [...publicReviews, ...mineReviews].map(item => item.id).filter(Boolean)
  const highlightIds = highlights.map(item => item.id).filter(Boolean)

  const currentBookBar = (extraActions = null) => (book ? (
    <div className="weread-current-book">
      <div>
        <b>当前：《{book.title}》</b>
        <small>{book.author || ''}</small>
      </div>
      <div className="weread-row-actions">
        {extraActions}
        {speaking && (
          <button type="button" className="ghost" onClick={stopAudio}>停止</button>
        )}
        <button type="button" className="ghost" disabled={busy} onClick={clearBook}>
          重选
        </button>
      </div>
    </div>
  ) : null)

  return (
    <div className="settings-drawer weread-drawer" role="dialog" aria-label="微信读书阅读">
      <div className="settings-panel">
        <header>
          <h2>阅读</h2>
          <button className="ghost" onClick={() => { stopAudio(); onClose() }} disabled={busy}>
            关闭
          </button>
        </header>

        <p className="hint">
          书架浏览 · 金句划线 · 公开书评 · 单条或全部朗读
          {status?.configured === false ? ' · 未配置 WEREAD_API_KEY' : ''}
        </p>

        <div className="weread-tabs" role="tablist">
          {[
            ['shelf', '书架'],
            ['highlights', '金句'],
            ['reviews', '书评'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              className={tab === id ? 'active' : ''}
              aria-selected={tab === id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {error && <p className="settings-error">{error}</p>}

        {tab === 'shelf' && (
          <section>
            <p className="hint">浏览书架。右侧进入对应金句 / 书评。</p>
            {!!withNotes.length && (
              <>
                <div className="section-head">
                  <h3>有笔记</h3>
                  <small>{withNotes.length} 本</small>
                </div>
                <ul className="weread-list">
                  {withNotes.map(item => (
                    <li key={`note-${item.bookId}`} className="weread-row">
                      <button
                        type="button"
                        className={book?.bookId === item.bookId ? 'active' : ''}
                        disabled={busy}
                        onClick={() => loadBook(item)}
                      >
                        <b>{item.title}</b>
                        <small>
                          划线 {item.noteCount || 0} · 想法 {item.reviewCount || 0}
                          {item.author ? ` · ${item.author}` : ''}
                        </small>
                      </button>
                      <div className="weread-row-actions">
                        {(item.noteCount || 0) > 0 && (
                          <button
                            type="button"
                            className="weread-speak-one"
                            disabled={busy}
                            onClick={() => openBookInTab(item, 'highlights')}
                          >
                            金句
                          </button>
                        )}
                        <button
                          type="button"
                          className="weread-speak-one"
                          disabled={busy}
                          onClick={() => openBookInTab(item, 'reviews')}
                        >
                          书评
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="section-head">
              <h3>最近在读</h3>
              <small>{shelf ? `共 ${shelf.total} 条目` : ''}</small>
            </div>
            <ul className="weread-list">
              {recent.map(item => (
                <li key={item.bookId} className="weread-row">
                  <button
                    type="button"
                    className={book?.bookId === item.bookId ? 'active' : ''}
                    disabled={busy}
                    onClick={() => loadBook(item)}
                  >
                    <b>{item.title}</b>
                    <small>
                      {item.author || '未知作者'}
                      {item.readUpdateDay ? ` · ${item.readUpdateDay}` : ''}
                    </small>
                  </button>
                  <div className="weread-row-actions">
                    <button
                      type="button"
                      className="weread-speak-one"
                      disabled={busy}
                      onClick={() => openBookInTab(item, 'highlights')}
                    >
                      金句
                    </button>
                    <button
                      type="button"
                      className="weread-speak-one"
                      disabled={busy}
                      onClick={() => openBookInTab(item, 'reviews')}
                    >
                      书评
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {!recent.length && (
              <div className="empty-memories">
                {status?.configured === false
                  ? '请配置 WEREAD_API_KEY 后刷新'
                  : '书架为空或加载中…'}
              </div>
            )}
          </section>
        )}

        {tab === 'highlights' && (
          <section>
            <div className="section-head">
              <h3>金句</h3>
              <small>{book ? `${highlights.length} 条` : '选有划线的书'}</small>
            </div>
            {!book && renderBookPicker({
              books: highlightBooks,
              subtitle: '本页只处理划线金句。先选一本书：',
              emptyText: '暂无带划线的书；可在微信读书 App 划线后再来。',
              onPick: item => loadBook(item),
            })}
            {book && (
              <>
                {currentBookBar(
                  highlightIds.length > 0 ? (
                    <button
                      type="button"
                      className="weread-speak-one"
                      disabled={busy}
                      onClick={() => speakItems('highlights', highlightIds)}
                    >
                      朗读全部
                    </button>
                  ) : null,
                )}
                <ul className="weread-list">
                  {highlights.map(item => (
                    <li key={item.id} className="weread-row">
                      <div className="weread-item-body">
                        <b>{item.markText}</b>
                        <small>
                          {item.chapterTitle || '章节'}
                          {item.createTime ? ` · ${item.createTime}` : ''}
                        </small>
                      </div>
                      <button
                        type="button"
                        className="weread-speak-one"
                        disabled={busy}
                        onClick={() => speakOne('highlights', item.id)}
                      >
                        朗读
                      </button>
                    </li>
                  ))}
                </ul>
                {!highlights.length && (
                  <div className="empty-memories">
                    《{book.title}》没有划线。点「重选」换一本有划线的书。
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {tab === 'reviews' && (
          <section>
            <div className="section-head">
              <h3>书评</h3>
              <small>
                {book
                  ? `公开 ${publicReviews.length}${reviewMeta?.reviewsCnt != null ? ` / ${reviewMeta.reviewsCnt}` : ''} · 我的 ${mineReviews.length}`
                  : '选书后看公开书评'}
              </small>
            </div>
            {!book && renderBookPicker({
              books: recent.length ? recent : withNotes,
              subtitle: '本页只处理书评（含公开点评）。先选一本书：',
              emptyText: '书架为空，无法拉书评。',
              onPick: item => loadBook(item),
            })}
            {book && (
              <>
                {currentBookBar(
                  reviewIds.length > 0 ? (
                    <button
                      type="button"
                      className="weread-speak-one"
                      disabled={busy}
                      onClick={() => speakItems('reviews', reviewIds)}
                    >
                      朗读全部
                    </button>
                  ) : null,
                )}
                {reviewMeta?.deepVRecommendInfo?.subtitle && (
                  <p className="hint">{reviewMeta.deepVRecommendInfo.subtitle}</p>
                )}
                <h3>公开书评</h3>
                {renderReviewList(publicReviews, '暂时还没有公开点评')}
                <h3 style={{ marginTop: 18 }}>我的想法</h3>
                {renderReviewList(mineReviews, '你还没有写过想法')}
              </>
            )}
          </section>
        )}

        <audio
          ref={audioRef}
          className="weread-audio"
          controls
          onEnded={() => setSpeaking(false)}
          onPause={() => {
            if (audioRef.current?.ended) setSpeaking(false)
          }}
        />
      </div>
      <button
        type="button"
        className="settings-backdrop"
        aria-label="关闭阅读面板"
        onClick={() => { stopAudio(); onClose() }}
      />
    </div>
  )
}
