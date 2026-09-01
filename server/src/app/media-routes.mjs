import { mkdir, writeFile, stat } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const ALLOWED_EXTENSIONS = new Set([
  '.mp4', '.mov', '.mkv', '.webm', '.avi', '.mp3', '.wav', '.m4a', '.ogg',
])

function clean(value) {
  return String(value || '').trim()
}

function unavailable(res) {
  return res.status(503).json({
    error: '媒体工作区尚未装配可用的本地媒体编排器。',
    error_code: 'media_orchestrator_unavailable',
  })
}

export function registerMediaRoutes(app, {
  mediaOrchestrator = null,
  mediaDirectory,
  maxUploadBytes = 256 * 1024 * 1024,
} = {}) {
  const root = resolve(mediaDirectory || resolve(process.cwd(), 'media-assets'))
  const jobs = new Map()
  const outputs = new Map()

  app.post('/api/media/assets', async (req, res) => {
    const filename = clean(req.headers['x-media-filename']) || 'media.bin'
    const extension = extname(filename).toLowerCase()
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      return res.status(415).json({ error: '不支持的媒体格式。', error_code: 'media_type_unsupported' })
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: '媒体内容为空。', error_code: 'media_empty' })
    }
    if (req.body.length > maxUploadBytes) {
      return res.status(413).json({ error: '媒体文件过大。', error_code: 'media_too_large' })
    }
    const assetId = `asset_${randomUUID().replaceAll('-', '')}`
    const filePath = join(root, `${assetId}${extension}`)
    await mkdir(root, { recursive: true })
    await writeFile(filePath, req.body)
    return res.status(201).json({
      status: 'ok',
      asset_id: assetId,
      filename,
      bytes: req.body.length,
      source_ref: filePath,
    })
  })

  app.post('/api/media/jobs', async (req, res) => {
    if (!mediaOrchestrator) return unavailable(res)
    const sourceRef = clean(req.body?.source_ref)
    const targetLanguage = clean(req.body?.target_language)
    const voiceProfileId = clean(req.body?.voice_profile_id)
    if (!sourceRef || !targetLanguage || !voiceProfileId) {
      return res.status(400).json({
        error: '请先选择媒体、目标语言和声音。',
        error_code: 'media_job_input_missing',
      })
    }
    const jobId = `media_${randomUUID().replaceAll('-', '')}`
    const initial = {
      id: jobId,
      status: 'queued',
      currentPhase: null,
      sourceRef,
      targetLanguage,
    }
    jobs.set(jobId, initial)
    void mediaOrchestrator.execute({
      ...req.body,
      jobId,
      ownerId: req.identity?.ownerId || 'local',
      sourceRef,
      sourceLanguage: clean(req.body?.source_language || req.body?.sourceLanguage, 'auto'),
      targetLanguage,
      voiceProfileId,
      ...(req.body?.transcription_options ? { transcriptionOptions: req.body.transcription_options } : {}),
      ...(req.body?.translation_options ? { translationOptions: req.body.translation_options } : {}),
      ...(req.body?.synthesis_options ? { synthesisOptions: req.body.synthesis_options } : {}),
      onEvent: event => jobs.set(jobId, event.job),
    }).then(result => {
      jobs.set(jobId, result.job)
      const outputRef = clean(result.artifacts?.output?.outputRef)
      if (outputRef) outputs.set(jobId, outputRef)
    }).catch(error => {
      if (error.job) jobs.set(jobId, error.job)
      else jobs.set(jobId, { ...initial, status: 'failed', error: error.message })
    })
    return res.status(202).json({ status: 'queued', job: initial })
  })

  app.get('/api/media/jobs/:id', (req, res) => {
    const job = jobs.get(clean(req.params.id))
    if (!job) return res.status(404).json({ error: '媒体任务不存在。', error_code: 'media_job_not_found' })
    return res.json({ status: 'ok', job })
  })

  app.get('/api/media/jobs/:id/output', async (req, res) => {
    const outputRef = outputs.get(clean(req.params.id))
    if (!outputRef) return res.status(404).json({ error: '媒体输出尚未生成。', error_code: 'media_output_not_found' })
    try {
      const details = await stat(outputRef)
      if (!details.isFile()) throw new Error('output is not a file')
      return res.sendFile(outputRef)
    } catch {
      return res.status(404).json({ error: '媒体输出文件不可用。', error_code: 'media_output_unavailable' })
    }
  })

  return { jobs, root }
}
