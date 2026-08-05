/**
 * Panel-direct speak: cascade TTS → WAV, without voice-session Reader.
 * Clears instruction so clone likeness matches the approved no-instr sample.
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { pcm16ToWav } from './wav.mjs'
import { buildSpeakScript, buildWereadMarkdown } from './export.mjs'
import { createSynthesizer as defaultCreateSynthesizer } from '../../cascade/adapters/tts.mjs'
import { importContentDocument } from '../ingest/import-content.mjs'

export async function speakWereadScript({
  text,
  cascadeConfig,
  createSynthesizer = defaultCreateSynthesizer,
} = {}) {
  const script = String(text || '').trim()
  if (!script) throw new Error('朗读文本为空')
  if (!cascadeConfig?.tts?.apiKey) {
    throw new Error('TTS 未配置 API Key（DASHSCOPE_API_KEY / CASCADE_TTS_API_KEY）')
  }

  const sampleRate = cascadeConfig.tts.sampleRate || 24000
  const config = {
    ...cascadeConfig,
    tts: {
      ...cascadeConfig.tts,
      instruction: undefined,
    },
  }
  delete config.tts.instruction

  const chunks = []
  const synthesizer = createSynthesizer(config, {
    onAudio(pcm) {
      chunks.push(Buffer.from(pcm))
    },
  })
  await synthesizer.start()
  for (const line of script.split(/\n+/)) {
    const piece = line.trim()
    if (!piece) continue
    const ended = /[。！？.!?]$/.test(piece) ? piece : `${piece}。`
    synthesizer.sendText(ended)
  }
  await synthesizer.finish({ timeoutMs: 180_000 })
  const pcm = Buffer.concat(chunks)
  if (!pcm.length) throw new Error('TTS 未返回音频')
  const wav = pcm16ToWav(pcm, sampleRate)
  return {
    wav,
    sampleRate,
    bytes: wav.length,
    pcmBytes: pcm.length,
  }
}

export async function prepareAndSpeakWeread({
  weread,
  bookId,
  mode = 'highlights',
  itemIds = null,
  persistContent = false,
  contentDir = '',
  knowledgeDir = '',
  cascadeConfig,
  createSynthesizer = defaultCreateSynthesizer,
  importContent = importContentDocument,
} = {}) {
  const id = String(bookId || '').trim()
  if (!id) throw new Error('bookId is required')
  if (!weread) throw new Error('weread client is required')

  let title = '未命名'
  let author = ''
  let highlights = []
  let reviews = []

  if (mode === 'highlights' || mode === 'mixed') {
    const hl = await weread.highlights(id)
    title = hl.book?.title || title
    author = hl.book?.author || author
    highlights = hl.highlights || []
  }
  if (mode === 'reviews' || mode === 'mixed') {
    const rv = await weread.reviews(id)
    reviews = rv.reviews || []
    if (mode === 'reviews' && !title) title = '未命名'
    if (mode === 'reviews' && title === '未命名') {
      try {
        const hl = await weread.highlights(id)
        title = hl.book?.title || title
        author = hl.book?.author || author
      } catch {
        // highlights optional when only reviews requested
      }
    }
  }

  const script = buildSpeakScript({
    title,
    mode,
    highlights,
    reviews,
    itemIds,
  })

  let persisted = null
  if (persistContent && contentDir) {
    const md = buildWereadMarkdown({
      title,
      author,
      highlights: mode === 'reviews' ? [] : highlights,
      reviews: mode === 'highlights' ? [] : reviews,
    })
    const exportDir = join(homedir(), '.config/qwaudio/weread-exports')
    mkdirSync(exportDir, { recursive: true, mode: 0o700 })
    const safe = String(title).replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60)
    const sourcePath = join(exportDir, `${safe}-${id}.md`)
    writeFileSync(sourcePath, md, 'utf8')
    persisted = await importContent({
      sourcePath,
      contentDir,
      knowledgeDir,
      title: `微信读书·${title}`,
      indexKnowledge: Boolean(knowledgeDir),
    })
  }

  const audio = await speakWereadScript({
    text: script.text,
    cascadeConfig,
    createSynthesizer,
  })
  return {
    ...audio,
    title,
    truncated: script.truncated,
    count: script.count,
    persisted,
  }
}
