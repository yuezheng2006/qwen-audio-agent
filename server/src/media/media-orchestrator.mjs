import { createMediaJob } from './media-job.mjs'
import { mkdir } from 'node:fs/promises'

function clean(value, fallback = '') {
  return String(value || '').trim() || fallback
}

function requiredAdapter(adapters, name) {
  const adapter = adapters?.[name]
  if (!adapter) throw new Error(`Media adapter is unavailable: ${name}`)
  return adapter
}

export function createMediaOrchestrator({
  adapters = {},
  onEvent = null,
  now,
} = {}) {
  async function execute(input = {}) {
    const job = createMediaJob({
      id: input.jobId,
      ownerId: input.ownerId,
      sourceRef: input.sourceRef,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      options: input.options,
      phases: [
        'inspect', 'extract_audio', 'transcribe_aligned', 'translate',
        'synthesize_segments', 'fit_timing', 'remux',
      ],
      ...(now ? { now } : {}),
    })
    const emit = (type, data = {}) => {
      const event = { type, job: job.snapshot(), ...data }
      onEvent?.(event)
      input.onEvent?.(event)
    }
    const artifacts = {}
    const outputDir = clean(input.outputDir, 'media-output')
    try {
      await mkdir(outputDir, { recursive: true })
      job.startPhase('inspect')
      emit('media.phase.started', { phase: 'inspect' })
      artifacts.inspect = await requiredAdapter(adapters, 'ffmpeg').inspect(input.sourceRef)
      job.completePhase('inspect', { artifactIds: [artifacts.inspect.artifactId] })
      emit('media.phase.completed', { phase: 'inspect', artifact: artifacts.inspect })

      job.startPhase('extract_audio')
      emit('media.phase.started', { phase: 'extract_audio' })
      artifacts.audio = await requiredAdapter(adapters, 'ffmpeg').extractAudio(
        input.sourceRef,
        `${outputDir}/source.wav`,
        input.audioOptions,
      )
      job.completePhase('extract_audio', { artifactIds: [artifacts.audio.artifactId] })
      emit('media.phase.completed', { phase: 'extract_audio', artifact: artifacts.audio })

      job.startPhase('transcribe_aligned')
      emit('media.phase.started', { phase: 'transcribe_aligned' })
      artifacts.transcript = await requiredAdapter(adapters, 'transcription').transcribeAligned({
        audioRef: artifacts.audio.outputRef,
        language: input.sourceLanguage,
        ...(input.transcriptionOptions || {}),
      })
      job.completePhase('transcribe_aligned', { artifactIds: [artifacts.transcript.artifactId] })
      emit('media.phase.completed', { phase: 'transcribe_aligned', artifact: artifacts.transcript })

      job.startPhase('translate')
      emit('media.phase.started', { phase: 'translate' })
      artifacts.translation = await requiredAdapter(adapters, 'translation').translateSegments({
        segments: artifacts.transcript.segments,
        sourceLanguage: artifacts.transcript.language,
        targetLanguage: input.targetLanguage,
        ...(input.translationOptions || {}),
      })
      job.completePhase('translate', { artifactIds: [artifacts.translation.artifactId] })
      emit('media.phase.completed', { phase: 'translate', artifact: artifacts.translation })

      job.startPhase('synthesize_segments')
      emit('media.phase.started', { phase: 'synthesize_segments' })
      artifacts.synthesis = await requiredAdapter(adapters, 'synthesis').synthesizeSegments({
        segments: artifacts.translation.segments,
        voiceProfileId: input.voiceProfileId,
        ownerId: input.ownerId,
        outputDir,
        ...(input.synthesisOptions || {}),
      })
      job.completePhase('synthesize_segments', { artifactIds: [artifacts.synthesis.artifactId] })
      emit('media.phase.completed', { phase: 'synthesize_segments', artifact: artifacts.synthesis })

      job.startPhase('fit_timing')
      emit('media.phase.started', { phase: 'fit_timing' })
      const timedSegments = []
      for (const [index, segment] of artifacts.synthesis.segments.entries()) {
        const timed = await requiredAdapter(adapters, 'timing').fitSegment({
          segment,
          audioRef: segment.audioRef,
          outputRef: `${outputDir}/timed-${index + 1}.wav`,
          audioDurationMs: input.audioDurationsMs?.[index] || (segment.endMs - segment.startMs),
        })
        timedSegments.push(timed)
      }
      artifacts.timing = { artifactId: 'timed_segments', kind: 'audio.timed.segments', segments: timedSegments }
      job.completePhase('fit_timing', { artifactIds: [artifacts.timing.artifactId] })
      emit('media.phase.completed', { phase: 'fit_timing', artifact: artifacts.timing })

      job.startPhase('remux')
      emit('media.phase.started', { phase: 'remux' })
      artifacts.audioTimeline = await requiredAdapter(adapters, 'audioCompose').compose({
        segments: timedSegments,
        outputRef: `${outputDir}/dubbed.wav`,
        durationMs: Number(artifacts.inspect.format?.duration) * 1_000,
      })
      const streams = Array.isArray(artifacts.inspect.streams) ? artifacts.inspect.streams : []
      const hasVideo = streams.length === 0 || streams.some(stream => stream.codec_type === 'video' || stream.type === 'video')
      artifacts.output = hasVideo
        ? await requiredAdapter(adapters, 'remux').remux({
          videoRef: input.sourceRef,
          audioRef: artifacts.audioTimeline.outputRef,
          outputRef: `${outputDir}/dubbed.mp4`,
          durationMs: Number(artifacts.inspect.format?.duration) * 1_000,
        })
        : { artifactId: 'audio_output', kind: 'audio.dubbed', outputRef: artifacts.audioTimeline.outputRef }
      job.completePhase('remux', { artifactIds: [artifacts.output.artifactId] })
      emit('media.phase.completed', { phase: 'remux', artifact: artifacts.output })
      return { job: job.snapshot(), artifacts }
    } catch (error) {
      const phase = job.snapshot().currentPhase
      if (phase) job.failPhase(phase, error.message)
      emit('media.job.failed', { phase, error: error.message })
      throw Object.assign(error, { job: job.snapshot() })
    }
  }

  return { execute }
}
