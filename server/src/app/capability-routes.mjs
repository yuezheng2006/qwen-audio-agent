import { maybeAwait } from '../conversation/memory/provider.mjs'

/**
 * Memory / knowledge / content HTTP seams used by WebUI and ops.
 * Extracted for focused TDD without booting the full gateway.
 */
export function registerCapabilityRoutes(app, {
  memoryStore,
  knowledgeStore,
  contentStore,
  readerProgressByOwner = new Map(),
  capabilityRegistry = null,
  getOwnerId = req => req.identity?.ownerId || 'anonymous',
} = {}) {
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
      const scope = target.scope === 'profile' ? 'profile' : 'long_term'
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

  app.get('/api/knowledge', (req, res) => {
    try {
      const health = knowledgeStore.health()
      const sources = knowledgeStore.listSources({
        kbId: req.query.kbId || undefined,
      })
      res.json({ health, sources, count: sources.length })
    } catch (error) {
      res.status(503).json({ error: error.message })
    }
  })

  app.post('/api/knowledge/search', (req, res) => {
    try {
      const query = String(req.body?.query || '').trim()
      if (!query) return res.status(400).json({ error: 'query is required' })
      const kbId = req.body?.kbId || undefined
      knowledgeStore.ingest?.({ kbId })
      const hits = knowledgeStore.search(query, {
        kbId,
        limit: Math.min(20, Number(req.body?.limit) || 6),
      })
      res.json({ hits, count: hits.length, format: 'markdown' })
    } catch (error) {
      res.status(503).json({ error: error.message })
    }
  })

  app.post('/api/knowledge/reindex', (req, res) => {
    try {
      const kbId = req.body?.kbId || undefined
      const built = knowledgeStore.ingest({ kbId })
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
