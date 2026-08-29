import { VersionedJsonStore } from '../../core/versioned-json-store.mjs'

function cursorKey(ownerId, contentId) {
  return `${ownerId}::${contentId}`
}

export function createReaderProgressStore({
  filePath = null,
  now = () => Date.now(),
} = {}) {
  const store = new VersionedJsonStore({
    filePath,
    version: 1,
    label: '朗读进度',
    now,
  })
  const state = store.load({
    fallback: () => ({ cursors: {} }),
    validate: parsed => parsed && parsed.cursors && typeof parsed.cursors === 'object',
  })
  if (!state.cursors) state.cursors = {}

  return {
    get(ownerId, contentId) {
      return state.cursors[cursorKey(ownerId, contentId)] || null
    },
    list(ownerId) {
      const prefix = `${ownerId}::`
      return Object.entries(state.cursors)
        .filter(([key]) => key.startsWith(prefix))
        .map(([, row]) => row)
    },
    put(ownerId, cursor = {}) {
      const contentId = String(cursor.contentId || '').trim()
      if (!contentId) throw new Error('contentId is required')
      const row = {
        ownerId,
        contentId,
        bookSlug: cursor.bookSlug || null,
        index: Number(cursor.index) || 0,
        total: Number(cursor.total) || 0,
        title: String(cursor.title || ''),
        updatedAt: now(),
      }
      state.cursors[cursorKey(ownerId, contentId)] = row
      store.save({ cursors: state.cursors })
      return row
    },
  }
}
