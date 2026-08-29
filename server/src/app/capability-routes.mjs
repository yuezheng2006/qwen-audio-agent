import { maybeAwait } from '../conversation/memory/provider.mjs'
import { isToolScope } from '../core/memory-scopes.mjs'
import { importContentDocument } from '../voice/reader/ingest/import-content.mjs'
import { createWereadClient } from '../voice/reader/weread/client.mjs'
import {
  prepareAndSpeakWeread,
  speakWereadScript,
} from '../voice/reader/weread/speak.mjs'
import { resolveCascadeConfig } from '../core/config.mjs'
import { verifySupportToken } from '../conversation/workspace.mjs'

const MEMORY_WRITE_SCOPES = new Set(['profile', 'long_term', 'rules'])
const REMINDER_KINDS = new Set(['reminder', 'scheduled_task'])
const REMINDER_RECURRENCE = new Set(['once', 'daily', 'weekly', 'weekdays'])
const CONTENT_ACTIONS = new Set([
  'list',
  'status',
  'start_read',
  'start_explain',
  'pause',
  'resume',
  'stop',
  'seek',
])

function memoryScopeOf(target) {
  if (MEMORY_WRITE_SCOPES.has(target?.scope)) return target.scope
  return 'long_term'
}

/**
 * Memory / knowledge / content HTTP seams used by WebUI and ops.
 * Extracted for focused TDD without booting the full gateway.
 */
export function registerCapabilityRoutes(app, {
  memoryStore,
  knowledgeStore,
  contentStore,
  notesStore = null,
  taskManager = null,
  readerProgressByOwner = new Map(),
  readerSessionsByOwner = new Map(),
  capabilityRegistry = null,
  getOwnerId = req => req.identity?.ownerId || 'anonymous',
  importContent = importContentDocument,
  wereadClient = null,
  speakWeread = prepareAndSpeakWeread,
  speakScript = speakWereadScript,
  resolveCascade = resolveCascadeConfig,
  readerProgressStore = null,
  supportInboundToken = process.env.SUPPORT_INBOUND_TOKEN || '',
} = {}) {
  const weread = wereadClient || createWereadClient()
  app.get('/api/memory', async (req, res) => {
    try {
      const memories = await maybeAwait(memoryStore.list(getOwnerId(req), {
        scope: req.query.scope || 'all',
        query: req.query.query || '',
        limit: Math.min(64, Number(req.query.limit) || 64),
      }))
      res.json({ memories, count: memories.length })
    } catch (error) {
      res.status(503).json({ error: error.message })
    }
  })

  app.post('/api/memory', async (req, res) => {
    const scope = String(req.body?.scope || 'long_term').trim().toLowerCase()
    const content = String(req.body?.content || '').trim()
    if (!MEMORY_WRITE_SCOPES.has(scope) || !isToolScope(scope)) {
      return res.status(400).json({ error: 'scope must be profile|long_term|rules' })
    }
    if (!content) return res.status(400).json({ error: 'content is required' })
    try {
      const memory = await maybeAwait(memoryStore.remember(getOwnerId(req), {
        scope,
        content,
      }))
      res.status(201).json({ ok: true, memory })
    } catch (error) {
      res.status(503).json({ error: error.message })
    }
  })

  app.patch('/api/memory/:id', async (req, res) => {
    const id = String(req.params.id || '').trim()
    const content = String(req.body?.content || '').trim()
    if (!id) return res.status(400).json({ error: 'memory id is required' })
    if (!content) return res.status(400).json({ error: 'content is required' })
    try {
      const memories = await maybeAwait(memoryStore.list(getOwnerId(req), {
        scope: 'all',
        limit: 64,
      }))
      const target = memories.find(memory => memory.id === id)
      if (!target) return res.status(404).json({ error: 'memory not found' })
      const scope = memoryScopeOf(target)
      const result = await maybeAwait(memoryStore.replace(getOwnerId(req), {
        scope,
        ids: [id],
        content,
      }))
      res.json({ ok: true, ...result, scope })
    } catch (error) {
      res.status(503).json({ error: error.message })
    }
  })

  app.delete('/api/memory/:id', async (req, res) => {
    const id = String(req.params.id || '').trim()
    if (!id) return res.status(400).json({ error: 'memory id is required' })
    try {
      const memories = await maybeAwait(memoryStore.list(getOwnerId(req), {
        scope: 'all',
        limit: 64,
      }))
      const target = memories.find(memory => memory.id === id)
      if (!target) return res.status(404).json({ error: 'memory not found' })
      const scope = memoryScopeOf(target)
      const removed = await maybeAwait(memoryStore.forget(getOwnerId(req), {
        scope,
        query: id,
      }))
      if (!removed) {
        return res.status(409).json({ error: 'memory could not be removed' })
      }
      res.json({ ok: true, removed, id })
    } catch (error) {
      res.status(503).json({ error: error.message })
    }
  })

  app.delete('/api/memory', async (req, res) => {
    if (req.query.confirm !== 'true') {
      return res.status(400).json({
        error: '清空长期记忆需要 confirm=true',
      })
    }
    try {
      const removed = await maybeAwait(memoryStore.forget(getOwnerId(req), {
        scope: 'long_term',
        all: true,
      }))
      res.json({ ok: true, removed })
    } catch (error) {
      res.status(503).json({ error: error.message })
    }
  })

  app.get('/api/notes', (req, res) => {
    if (!notesStore) return res.status(503).json({ error: 'notes unavailable' })
    try {
      const lists = notesStore.lists(getOwnerId(req))
      res.json({ lists, count: lists.length, health: notesStore.health() })
    } catch (error) {
      res.status(503).json({ error: error.message })
    }
  })

  app.get('/api/notes/:list', (req, res) => {
    if (!notesStore) return res.status(503).json({ error: 'notes unavailable' })
    try {
      const list = decodeURIComponent(String(req.params.list || ''))
      const result = notesStore.show(getOwnerId(req), list)
      if (result.status === 'not_found') {
        return res.status(404).json(result)
      }
      if (result.status === 'ambiguous') {
        return res.status(409).json(result)
      }
      res.json(result)
    } catch (error) {
      res.status(503).json({ error: error.message })
    }
  })

  app.post('/api/notes', (req, res) => {
    if (!notesStore) return res.status(503).json({ error: 'notes unavailable' })
    const action = String(req.body?.action || 'add').trim().toLowerCase()
    const list = String(req.body?.list || '').trim()
    const items = Array.isArray(req.body?.items)
      ? req.body.items.map(item => String(item || '').trim()).filter(Boolean)
      : []
    if (!list) return res.status(400).json({ error: 'list is required' })
    try {
      const ownerId = getOwnerId(req)
      let result
      if (action === 'add') {
        result = notesStore.add(ownerId, { list, items })
      } else if (action === 'remove') {
        result = notesStore.remove(ownerId, { list, items })
      } else if (action === 'clear') {
        result = notesStore.clear(ownerId, list)
      } else if (action === 'drop') {
        result = notesStore.drop(ownerId, list)
      } else {
        return res.status(400).json({ error: 'action must be add|remove|clear|drop' })
      }
      if (result.status === 'not_found') return res.status(404).json(result)
      if (result.status === 'ambiguous' || result.status === 'list_full') {
        return res.status(409).json(result)
      }
      res.json(result)
    } catch (error) {
      res.status(400).json({ error: error.message })
    }
  })

  app.get('/api/reminders', (req, res) => {
    if (!taskManager) return res.status(503).json({ error: 'reminders unavailable' })
    try {
      const reminders = taskManager.list({
        ownerId: getOwnerId(req),
        sessionId: req.query.sessionId,
      }).filter(task => (
        task.status === 'scheduled' && REMINDER_KINDS.has(task.kind)
      ))
      res.json({ reminders, count: reminders.length })
    } catch (error) {
      res.status(503).json({ error: error.message })
    }
  })

  app.post('/api/reminders', (req, res) => {
    if (!taskManager) return res.status(503).json({ error: 'reminders unavailable' })
    const executeAt = Date.parse(req.body?.execute_at)
    const reminder = String(req.body?.reminder || '').trim()
    const recurrence = String(req.body?.recurrence || 'once').trim().toLowerCase()
    if (!executeAt || executeAt <= Date.now()) {
      return res.status(400).json({ error: 'execute_at must be a future ISO time' })
    }
    if (!reminder) return res.status(400).json({ error: 'reminder is required' })
    if (!REMINDER_RECURRENCE.has(recurrence)) {
      return res.status(400).json({ error: 'recurrence must be once|daily|weekly|weekdays' })
    }
    try {
      const task = taskManager.createScheduled({
        objective: reminder,
        ownerId: getOwnerId(req),
        sessionId: String(req.body?.sessionId || 'main'),
        schedule: { at: executeAt, recurrence },
        type: 'reminder',
      })
      res.status(201).json({ ok: true, reminder: task })
    } catch (error) {
      res.status(503).json({ error: error.message })
    }
  })

  app.delete('/api/reminders/:id', async (req, res) => {
    if (!taskManager) return res.status(503).json({ error: 'reminders unavailable' })
    const id = String(req.params.id || '').trim()
    if (!id) return res.status(400).json({ error: 'reminder id is required' })
    try {
      const existing = taskManager.get(id, { ownerId: getOwnerId(req) })
      if (!existing) return res.status(404).json({ error: 'reminder not found' })
      if (
        existing.status !== 'scheduled'
        || !REMINDER_KINDS.has(existing.kind)
      ) {
        return res.status(409).json({ error: 'task is not a scheduled reminder' })
      }
      const task = await taskManager.cancel(id, { ownerId: getOwnerId(req) })
      if (!task) {
        return res.status(409).json({ error: 'reminder could not be cancelled' })
      }
      res.json({ ok: true, reminder: task })
    } catch (error) {
      res.status(503).json({ error: error.message })
    }
  })

  app.post('/api/content/control', async (req, res) => {
    const action = String(req.body?.action || '').trim().toLowerCase()
    if (!CONTENT_ACTIONS.has(action)) {
      return res.status(400).json({
        error: 'action must be list|status|start_read|start_explain|pause|resume|stop|seek',
      })
    }
    const ownerId = getOwnerId(req)
    const readerSession = readerSessionsByOwner.get(ownerId)
    if (!readerSession && action !== 'list') {
      return res.status(409).json({
        error: '请先开启语音会话后再控制朗读',
        status: 'reader_unavailable',
      })
    }
    try {
      if (action === 'list') {
        const contents = readerSession?.listContents?.() || contentStore?.list?.() || []
        return res.json({ status: 'ok', contents })
      }
      if (action === 'status') {
        const progress = readerSession.snapshot()
        readerProgressByOwner.set(ownerId, progress)
        return res.json({ status: 'ok', progress })
      }
      let progress
      if (action === 'start_read' || action === 'start_explain') {
        progress = await readerSession.start(
          action === 'start_read' ? 'read' : 'explain',
          {
            contentId: String(req.body?.content_id || '').trim(),
            offset: Number(req.body?.offset) || 0,
          },
        )
      } else if (action === 'pause') {
        progress = readerSession.pause()
      } else if (action === 'resume') {
        progress = await readerSession.resume()
      } else if (action === 'stop') {
        progress = readerSession.stop()
      } else if (action === 'seek') {
        progress = await readerSession.seek(Number(req.body?.offset) || 0)
      }
      if (progress) {
        readerProgressByOwner.set(ownerId, progress)
        if (progress.contentId || progress.content_id) {
          try {
            readerProgressStore?.put(ownerId, {
              contentId: progress.contentId || progress.content_id,
              index: progress.index,
              total: progress.total,
              title: progress.title,
            })
          } catch {
            // persistence must not block playback control
          }
        }
      }
      res.json({ status: 'ok', action, progress })
    } catch (error) {
      res.status(503).json({ error: error.message })
    }
  })

  app.get('/api/knowledge', async (req, res) => {
    try {
      const health = await maybeAwait(knowledgeStore.health())
      const sources = await maybeAwait(knowledgeStore.listSources({
        kbId: req.query.kbId || undefined,
      }))
      res.json({ health, sources, count: sources.length })
    } catch (error) {
      res.status(503).json({ error: error.message })
    }
  })

  app.post('/api/knowledge/search', async (req, res) => {
    try {
      const query = String(req.body?.query || '').trim()
      if (!query) return res.status(400).json({ error: 'query is required' })
      const kbId = req.body?.kbId || undefined
      await maybeAwait(knowledgeStore.ingest?.({ kbId }))
      const hits = await maybeAwait(knowledgeStore.search(query, {
        kbId,
        limit: Math.min(20, Number(req.body?.limit) || 6),
      }))
      res.json({ hits, count: hits.length, format: 'markdown' })
    } catch (error) {
      res.status(503).json({ error: error.message })
    }
  })

  app.post('/api/knowledge/reindex', async (req, res) => {
    try {
      const kbId = req.body?.kbId || undefined
      const built = await maybeAwait(knowledgeStore.ingest({ kbId }))
      res.json({
        ok: true,
        format: 'markdown',
        kbId: built.kbId || kbId || 'default',
        sources: built.sources?.length || 0,
        chunks: built.chunks?.length || 0,
      })
    } catch (error) {
      res.status(503).json({ error: error.message })
    }
  })

  app.get('/api/content', (req, res) => {
    try {
      const contents = contentStore.list()
      res.json({
        health: contentStore.health(),
        contents,
        count: contents.length,
        reader: readerProgressByOwner.get(getOwnerId(req)) || { status: 'idle' },
      })
    } catch (error) {
      res.status(503).json({ error: error.message })
    }
  })

  app.get('/api/content/books', (req, res) => {
    try {
      const catalog = contentStore.listBooks?.() || { books: [], loose: [] }
      res.json({
        ...catalog,
        reader: readerProgressByOwner.get(getOwnerId(req)) || { status: 'idle' },
        cursors: readerProgressStore?.list(getOwnerId(req)) || [],
      })
    } catch (error) {
      res.status(503).json({ error: error.message })
    }
  })

  app.get('/api/content/progress', (req, res) => {
    const ownerId = getOwnerId(req)
    const contentId = String(req.query.contentId || '').trim()
    if (contentId) {
      return res.json({
        cursor: readerProgressStore?.get(ownerId, contentId) || null,
      })
    }
    res.json({ cursors: readerProgressStore?.list(ownerId) || [] })
  })

  app.put('/api/content/progress', (req, res) => {
    try {
      const cursor = readerProgressStore?.put(getOwnerId(req), {
        contentId: req.body?.contentId || req.body?.content_id,
        bookSlug: req.body?.bookSlug,
        index: req.body?.index,
        total: req.body?.total,
        title: req.body?.title,
      })
      res.json({ ok: true, cursor })
    } catch (error) {
      res.status(400).json({ error: error.message })
    }
  })

  app.post('/api/content/speak', async (req, res) => {
    try {
      let text = String(req.body?.text || req.body?.markdown || '').trim()
      const contentId = String(req.body?.content_id || req.body?.contentId || '').trim()
      let title = String(req.body?.title || '').trim()
      if (!text && contentId) {
        const doc = contentStore.get(contentId)
        if (!doc?.text) return res.status(404).json({ error: 'content not found' })
        text = doc.text
        title = title || doc.title
      }
      if (!text) return res.status(400).json({ error: 'text or content_id is required' })
      const audio = await speakScript({
        text,
        cascadeConfig: resolveCascade(process.env),
      })
      res.setHeader('Content-Type', 'audio/wav')
      res.setHeader('X-Content-Title', encodeURIComponent(title || '朗读'))
      res.send(audio.wav)
    } catch (error) {
      res.status(503).json({ error: error.message })
    }
  })

  // Large-file ingest: local path, pasted text, URL, or base64 upload.
  app.post('/api/content/import', async (req, res) => {
    try {
      const sourcePath = String(req.body?.sourcePath || '').trim()
      const markdown = String(req.body?.markdown || '').trim()
      const text = String(req.body?.text || '').trim()
      const url = String(req.body?.url || '').trim()
      const fileName = String(req.body?.fileName || req.body?.filename || '').trim()
      const fileBase64 = String(req.body?.fileBase64 || req.body?.bytesBase64 || '').trim()
      if (!sourcePath && !markdown && !text && !url && !fileBase64) {
        return res.status(400).json({
          error: '需要 sourcePath、markdown、text、url 或文件',
        })
      }
      const contentDir = contentStore?.contentDir
      if (!contentDir) {
        return res.status(503).json({ error: 'contentStore is not configured' })
      }
      const knowledgeDir = knowledgeStore?.knowledgeDir || ''
      const indexKnowledge = req.body?.indexKnowledge === true
      const result = await importContent({
        sourcePath,
        markdown,
        text,
        url,
        fileName,
        fileBytes: fileBase64 ? Buffer.from(fileBase64, 'base64') : null,
        contentDir,
        knowledgeDir,
        title: String(req.body?.title || '').trim(),
        indexKnowledge,
        extractOptions: {
          apiUrl: process.env.MINERU_API_URL || '',
        },
      })
      if (indexKnowledge && knowledgeStore?.ingest) {
        await maybeAwait(knowledgeStore.ingest({ kbId: req.body?.kbId || undefined }))
      }
      res.json(result)
    } catch (error) {
      res.status(503).json({ error: error.message })
    }
  })

  app.get('/api/support/session', (req, res) => {
    const checked = verifySupportToken(req.query.token, supportInboundToken)
    if (!checked.ok) return res.status(401).json({ error: checked.error })
    res.json({
      ok: true,
      workspace: 'support',
      visitorId: `support_${Date.now().toString(36)}`,
    })
  })

  app.post('/api/support/escalate', (req, res) => {
    const checked = verifySupportToken(
      req.body?.token || req.query.token,
      supportInboundToken,
    )
    if (!checked.ok) return res.status(401).json({ error: checked.error })
    if (!taskManager?.create) {
      return res.status(503).json({ error: 'taskManager is not configured' })
    }
    const objective = String(req.body?.objective || req.body?.summary || '').trim()
    if (!objective) return res.status(400).json({ error: 'objective is required' })
    const task = taskManager.create({
      objective: `[客服升级] ${objective}`,
      ownerId: getOwnerId(req),
      sessionId: String(req.body?.sessionId || 'support'),
      kind: 'work',
    })
    res.status(201).json({ ok: true, task })
  })

  app.get('/api/weread/status', (_req, res) => {
    res.json({
      configured: Boolean(weread.configured),
      skillVersion: weread.skillVersion || '1.0.4',
    })
  })

  app.get('/api/weread/shelf', async (_req, res) => {
    try {
      const shelf = await weread.shelf()
      let withNotes = []
      try {
        if (typeof weread.notebooks === 'function') {
          const notebooks = await weread.notebooks({ count: 40 })
          withNotes = (notebooks.books || [])
            .filter(item => (item.noteCount || 0) + (item.reviewCount || 0) > 0)
            .slice(0, 30)
        }
      } catch {
        // notebooks optional; shelf still useful
      }
      res.json({ ...shelf, withNotes })
    } catch (error) {
      res.status(503).json({ error: error.message })
    }
  })

  app.get('/api/weread/notebooks', async (_req, res) => {
    try {
      res.json(await weread.notebooks())
    } catch (error) {
      res.status(503).json({ error: error.message })
    }
  })

  app.get('/api/weread/highlights', async (req, res) => {
    try {
      const bookId = String(req.query.bookId || '').trim()
      if (!bookId) return res.status(400).json({ error: 'bookId is required' })
      res.json(await weread.highlights(bookId))
    } catch (error) {
      res.status(503).json({ error: error.message })
    }
  })

  app.get('/api/weread/reviews', async (req, res) => {
    try {
      const bookId = String(req.query.bookId || '').trim()
      if (!bookId) return res.status(400).json({ error: 'bookId is required' })
      res.json(await weread.reviews(bookId))
    } catch (error) {
      res.status(503).json({ error: error.message })
    }
  })

  app.post('/api/weread/speak', async (req, res) => {
    try {
      const bookId = String(req.body?.bookId || '').trim()
      if (!bookId) return res.status(400).json({ error: 'bookId is required' })
      const mode = String(req.body?.mode || 'highlights').trim() || 'highlights'
      if (!['highlights', 'reviews', 'mixed'].includes(mode)) {
        return res.status(400).json({ error: 'mode must be highlights|reviews|mixed' })
      }
      const result = await speakWeread({
        weread,
        bookId,
        mode,
        itemIds: Array.isArray(req.body?.itemIds) ? req.body.itemIds : null,
        persistContent: req.body?.persistContent === true,
        contentDir: contentStore?.contentDir || '',
        knowledgeDir: knowledgeStore?.knowledgeDir || '',
        cascadeConfig: resolveCascade(process.env),
        importContent,
      })
      if (result.truncated) res.setHeader('X-Weread-Truncated', '1')
      res.setHeader('X-Weread-Title', encodeURIComponent(result.title || ''))
      res.setHeader('X-Weread-Count', String(result.count || 0))
      res.setHeader('Content-Type', 'audio/wav')
      res.send(result.wav)
    } catch (error) {
      const message = String(error?.message || error)
      const status = /没有可朗读|bookId is required|mode must/.test(message) ? 400 : 503
      res.status(status).json({ error: message })
    }
  })

  app.get('/api/skills', (req, res) => {
    try {
      const health = capabilityRegistry?.health?.() || {
        skills: [],
        skillCount: 0,
        tools: [],
        toolCount: 0,
        mcp: { servers: [], toolCount: 0 },
      }
      res.json({
        skills: health.skills || [],
        count: health.skillCount || 0,
        tools: health.tools || [],
        mcp: health.mcp || { servers: [], toolCount: 0 },
      })
    } catch (error) {
      res.status(503).json({ error: error.message })
    }
  })

  app.get('/api/capabilities', (req, res) => {
    try {
      res.json(capabilityRegistry?.health?.() || {
        tools: [],
        toolCount: 0,
        skills: [],
        skillCount: 0,
        mcp: { servers: [], toolCount: 0 },
      })
    } catch (error) {
      res.status(503).json({ error: error.message })
    }
  })
}
