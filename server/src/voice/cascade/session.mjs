import { randomUUID } from 'crypto'
import { decodePcmBase64, encodePcmBase64 } from './pcm.mjs'
import { EnergyVad } from './vad.mjs'
import { SentenceStream } from './sentence-stream.mjs'
import { CancelScope } from './cancel-scope.mjs'
import {
  POST_COMMIT_BARGE_HOLD_MS,
  buildInterruptedUserContent,
  createBargeInController,
} from './barge-in.mjs'
import { createRecognizer } from './adapters/stt.mjs'
import { createSynthesizer } from './adapters/tts.mjs'
import { streamChat } from './adapters/llm.mjs'
import {
  createTurnContextRetriever,
  renderTurnContext,
} from './turn-context.mjs'

const MAX_HISTORY_MESSAGES = 60
const PREROLL_MS = 400
const INPUT_SAMPLE_RATE = 16000

function id(prefix) {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`
}

// One CascadeSession serves one Gateway RealtimeFrontend connection and
// speaks the same OpenAI-Realtime-style protocol the DashScope S2S provider
// does, backed by a local VAD -> STT -> LLM -> TTS pipeline.
export class CascadeSession {
  constructor(ws, { cascadeConfig, log = () => {}, adapters = {} }) {
    this.ws = ws
    this.config = cascadeConfig
    this.log = log
    this.adapters = {
      createRecognizer,
      createSynthesizer,
      streamChat,
      createTurnContextRetriever,
      ...adapters,
    }
    this.turnContextRetriever = this.adapters.createTurnContextRetriever(this.config, { log })
    this.session = { id: id('sess'), instructions: '', tools: [] }
    this.history = []
    this.activeResponse = null
    this.responseQueue = []
    this.cancelScope = new CancelScope()
    this.utterance = null
    this.preroll = []
    this.prerollMs = 0
    this.interruptedText = ''
    this.responseStartedAt = 0
    this.bargeHoldUntil = 0
    this.bargeIn = createBargeInController({
      getSpokenSoFar: () => this.activeResponse?.spokenSoFar || '',
      isHoldActive: () => Date.now() < this.bargeHoldUntil,
      onConfirm: () => this.confirmBargeIn(),
    })
    this.vad = new EnergyVad({
      sampleRate: INPUT_SAMPLE_RATE,
      ...cascadeConfig.vad,
      onSpeechStart: () => this.handleSpeechStart(),
      onSpeechEnd: reason => this.handleSpeechEnd(reason),
    })
    ws.on('message', raw => this.handleMessage(raw))
    ws.on('close', () => this.dispose())
    this.emit({ type: 'session.created', session: { id: this.session.id } })
  }

  isAssistantBusy() {
    return Boolean(this.activeResponse && !this.activeResponse.done)
  }

  emitTiming(name, at = Date.now()) {
    const started = this.responseStartedAt || at
    this.emit({
      type: 'cascade.timing',
      name,
      ms: Math.max(0, at - started),
      response_id: this.activeResponse?.id || null,
    })
  }

  confirmBargeIn() {
    if (!this.isAssistantBusy()) return
    const spoken = this.activeResponse?.spokenSoFar || ''
    if (spoken) this.interruptedText = spoken
    this.responseQueue = []
    this.cancelActiveResponse('user_interruption')
  }

  emit(event) {
    if (this.ws.readyState !== this.ws.OPEN) return
    this.ws.send(JSON.stringify({ event_id: id('event'), ...event }))
  }

  dispose() {
    this.cancelActiveResponse('session_closed')
    this.utterance?.turnContext?.cancel?.()
    this.utterance?.recognizer?.abort()
    this.utterance = null
    this.bargeIn.reset()
    this.cancelScope.reset()
  }

  emitForResponse(response, event) {
    if (!this.cancelScope.shouldEmit(response.generation)) return
    if (response.cancelled || response.done) return
    this.emit(event)
  }

  handleMessage(raw) {
    let event
    try {
      event = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (event.type === 'session.update') {
      this.session = { ...this.session, ...(event.session || {}) }
      this.emit({ type: 'session.updated', session: this.session })
    } else if (event.type === 'input_audio_buffer.append') {
      this.handleAudio(decodePcmBase64(event.audio))
    } else if (event.type === 'conversation.item.create') {
      this.handleItemCreate(event.item || {})
    } else if (event.type === 'response.create') {
      this.enqueueResponse(event.response || {})
    } else if (event.type === 'response.cancel') {
      this.responseQueue = []
      this.cancelActiveResponse('client_cancelled')
    }
  }

  handleItemCreate(item) {
    if (item.type === 'message') {
      const text = (item.content || [])
        .filter(part => part.type === 'input_text')
        .map(part => part.text)
        .join('\n')
      if (text) this.pushHistory({ role: item.role || 'user', content: text })
    } else if (item.type === 'function_call_output') {
      this.pushHistory({
        role: 'tool',
        tool_call_id: item.call_id,
        content: String(item.output || ''),
      })
    }
    this.emit({ type: 'conversation.item.created', item })
  }

  pushHistory(message) {
    this.history.push(message)
    if (this.history.length > MAX_HISTORY_MESSAGES) {
      this.history.splice(0, this.history.length - MAX_HISTORY_MESSAGES)
      // Never leave an orphan tool result at the head; models reject it.
      while (this.history.length && this.history[0].role === 'tool') {
        this.history.shift()
      }
    }
  }

  // ---- Audio input path -------------------------------------------------

  handleAudio(buffer) {
    if (!buffer.length) return
    if (this.utterance) {
      this.utterance.frames.push(buffer)
      this.feedRecognizer()
    } else {
      this.preroll.push(buffer)
      this.prerollMs += (buffer.length / 2 / INPUT_SAMPLE_RATE) * 1000
      while (this.prerollMs > PREROLL_MS && this.preroll.length > 1) {
        const dropped = this.preroll.shift()
        this.prerollMs -= (dropped.length / 2 / INPUT_SAMPLE_RATE) * 1000
      }
    }
    this.vad.push(buffer)
  }

  handleSpeechStart() {
    // Soft barge-in while the assistant is speaking: wait for STT partials
    // and suppress short backchannels (嗯/好/yeah) before cancelling audio.
    if (this.isAssistantBusy()) {
      this.bargeIn.armSoft()
    } else {
      this.bargeIn.reset()
    }
    const itemId = id('item')
    const utterance = {
      itemId,
      frames: [...this.preroll],
      sentBytes: 0,
      recognizer: null,
      recognizerReady: false,
      turnContext: null,
    }
    this.preroll = []
    this.prerollMs = 0
    this.utterance = utterance
    try {
      utterance.turnContext = this.turnContextRetriever?.openTurn?.({
        sessionId: this.session.id,
        turnId: itemId,
      }) || null
    } catch (error) {
      this.log(`当前轮次记忆初始化失败：${error.message}`)
    }
    this.emit({ type: 'input_audio_buffer.speech_started', item_id: itemId })
    const recognizer = this.adapters.createRecognizer(this.config, {
      onPartial: text => {
        if (this.utterance !== utterance || !text) return
        this.emit({
          type: 'conversation.item.input_audio_transcription.delta',
          item_id: itemId,
          text,
        })
        this.bargeIn.notePartial(text)
        try {
          utterance.turnContext?.partial?.({ text, atMs: Date.now() })
        } catch (error) {
          this.log(`当前轮次记忆预取失败：${error.message}`)
        }
      },
    })
    utterance.recognizer = recognizer
    // Keep the start promise: a short utterance can end before the STT
    // connection is up, and its queued audio must still be flushed then.
    utterance.started = recognizer.start().then(() => {
      utterance.recognizerReady = true
      this.feedRecognizerFor(utterance)
    }).catch(error => {
      this.log(`级联 STT 启动失败：${error.message}`)
      utterance.failed = error
    })
  }

  feedRecognizer() {
    if (this.utterance) this.feedRecognizerFor(this.utterance)
  }

  async handleSpeechEnd() {
    const utterance = this.utterance
    if (!utterance) return
    this.utterance = null
    const itemId = utterance.itemId
    let transcript = ''
    try {
      await utterance.started
      if (utterance.failed) throw utterance.failed
      this.feedRecognizerFor(utterance)
      transcript = await utterance.recognizer.finish()
    } catch (error) {
      utterance.turnContext?.cancel?.()
      this.log(`级联 STT 失败：${error.message}`)
      this.bargeIn.reset()
      this.emit({
        type: 'input_audio_buffer.speech_stopped',
        item_id: itemId,
        reason: 'turn_invalid',
      })
      this.emit({
        type: 'conversation.item.input_audio_transcription.failed',
        item_id: itemId,
      })
      return
    }
    const decision = this.bargeIn.decideOnSpeechEnd(transcript)
    if (decision.action === 'suppress') {
      utterance.turnContext?.cancel?.()
      // Backchannel / noise while assistant spoke — keep playback going.
      this.emit({
        type: 'input_audio_buffer.speech_stopped',
        item_id: itemId,
        reason: 'turn_invalid',
      })
      return
    }
    if (!transcript) {
      utterance.turnContext?.cancel?.()
      this.bargeIn.reset()
      this.emit({
        type: 'input_audio_buffer.speech_stopped',
        item_id: itemId,
        reason: 'turn_invalid',
      })
      return
    }
    // Confirmed interrupt (or idle turn): clear queued follow-ups and stop TTS.
    if (this.isAssistantBusy()) {
      this.confirmBargeIn()
    } else {
      this.responseQueue = []
    }
    this.bargeIn.reset()
    const interrupted = this.interruptedText
    this.interruptedText = ''
    const userContent = interrupted
      ? buildInterruptedUserContent(transcript, interrupted)
      : transcript
    this.emit({ type: 'input_audio_buffer.speech_stopped', item_id: itemId })
    this.emit({ type: 'input_audio_buffer.committed', item_id: itemId })
    this.emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: itemId,
      transcript,
    })
    let turnContext = null
    try {
      turnContext = await utterance.turnContext?.final?.({
        transcript,
        deadlineMs: 250,
      }) || null
    } catch (error) {
      this.log(`当前轮次记忆检索失败：${error.message}`)
    }
    this.pushHistory({ role: 'user', content: userContent })
    // Absorb trailing "hello hello" / room echo right after the user turn.
    this.bargeHoldUntil = Date.now() + POST_COMMIT_BARGE_HOLD_MS
    this.enqueueResponse({}, { turnContext })
  }

  feedRecognizerFor(utterance) {
    if (!utterance.recognizerReady) return
    while (utterance.sentBytes < utterance.frames.length) {
      utterance.recognizer.sendAudio(utterance.frames[utterance.sentBytes])
      utterance.sentBytes += 1
    }
  }

  // ---- Response path ----------------------------------------------------

  enqueueResponse(payload, { turnContext = null } = {}) {
    this.responseQueue.push({ payload, turnContext })
    this.drainResponses()
  }

  async drainResponses() {
    if (this.activeResponse || !this.responseQueue.length) return
    const queued = this.responseQueue.shift()
    const payload = queued.payload
    this.cancelScope.newResponse()
    const response = {
      id: id('resp'),
      generation: this.cancelScope.capture(),
      cancelled: false,
      abort: new AbortController(),
      synthesizer: null,
      ttsChain: Promise.resolve(),
      done: false,
      spokenSoFar: '',
      turnContext: queued.turnContext,
      timing: {
        llmFirstToken: false,
        ttsFirstByte: false,
      },
    }
    this.activeResponse = response
    this.responseStartedAt = Date.now()
    this.emit({ type: 'response.created', response: { id: response.id } })
    try {
      await this.runResponse(response, payload)
      this.finishResponse(response, 'completed')
    } catch (error) {
      if (response.cancelled) {
        this.finishResponse(response, 'cancelled')
      } else {
        this.log(`级联响应失败：${error.message}`)
        this.finishResponse(response, 'failed')
        this.emit({ type: 'error', error: { message: error.message } })
      }
    }
    if (this.activeResponse === response) this.activeResponse = null
    this.drainResponses()
  }

  finishResponse(response, status) {
    if (response.done) return
    response.done = true
    response.synthesizer?.abort()
    this.emit({
      type: 'response.done',
      response: { id: response.id, status },
    })
    this.cancelScope.responseDone(response.generation)
  }

  cancelActiveResponse(reason) {
    const response = this.activeResponse
    if (!response || response.done) return
    response.cancelled = true
    response.cancelReason = reason
    // Advance generation first so in-flight PCM is stale before abort races.
    this.cancelScope.cancel()
    response.abort.abort()
    response.synthesizer?.abort()
    this.finishResponse(response, 'cancelled')
  }

  wantsAudio(payload) {
    const modalities = payload.modalities || this.session.modalities
    if (!Array.isArray(modalities)) return true
    return modalities.includes('audio')
  }

  async runResponse(response, payload) {
    const audio = this.wantsAudio(payload)
    if (payload.cascade_mode === 'speak') {
      await this.speakContent(response, String(payload.content || ''), { audio })
      return
    }
    await this.generate(response, payload, { audio })
  }

  async ensureSynthesizer(response) {
    if (response.synthesizer) return response.synthesizer
    const synthesizer = this.adapters.createSynthesizer(this.config, {
      onAudio: buffer => {
        if (!response.timing.ttsFirstByte) {
          response.timing.ttsFirstByte = true
          this.emitTiming('tts_first_byte')
        }
        this.emitForResponse(response, {
          type: 'response.audio.delta',
          response_id: response.id,
          delta: encodePcmBase64(buffer),
        })
      },
    })
    response.synthesizer = synthesizer
    await synthesizer.start()
    return synthesizer
  }

  async speakContent(response, content, { audio }) {
    if (!content.trim()) return
    response.spokenSoFar = `${response.spokenSoFar || ''}${content}`
    if (audio) {
      const synthesizer = await this.ensureSynthesizer(response)
      this.emitForResponse(response, {
        type: 'response.audio_transcript.delta',
        response_id: response.id,
        delta: content,
      })
      if (!this.cancelScope.shouldEmit(response.generation) || response.cancelled) {
        throw new Error('cancelled')
      }
      synthesizer.sendText(content)
      await synthesizer.finish()
      if (response.cancelled || this.cancelScope.isStale(response.generation)) {
        throw new Error('cancelled')
      }
      this.emitForResponse(response, {
        type: 'response.audio_transcript.done',
        response_id: response.id,
        transcript: content,
      })
    } else {
      this.emitForResponse(response, {
        type: 'response.text.delta',
        response_id: response.id,
        delta: content,
      })
      this.emitForResponse(response, {
        type: 'response.text.done',
        response_id: response.id,
        text: content,
      })
    }
    if (!response.cancelled && !this.cancelScope.isStale(response.generation)) {
      this.pushHistory({ role: 'assistant', content })
    }
  }

  buildMessages(payload, turnContext = null) {
    const sections = [this.session.instructions || '']
    if (payload.instructions) sections.push(payload.instructions)
    const system = sections.filter(Boolean).join('\n\n')
    const messages = [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...this.history,
    ]
    const renderedTurnContext = renderTurnContext(turnContext)
    if (renderedTurnContext) messages.push({ role: 'system', content: renderedTurnContext })
    return messages
  }

  async generate(response, payload, { audio }) {
    const useTools = payload.tool_choice !== 'none'
      && Array.isArray(this.session.tools)
      && this.session.tools.length > 0
    let spoken = ''
    let synthesizerFailure = null
    const speakSentence = sentence => {
      if (
        response.cancelled
        || response.done
        || this.cancelScope.isStale(response.generation)
      ) return
      spoken += sentence
      response.spokenSoFar = spoken
      if (audio) {
        this.emitForResponse(response, {
          type: 'response.audio_transcript.delta',
          response_id: response.id,
          delta: sentence,
        })
        // Serialize sends: synthesizer startup is asynchronous and a later
        // sentence must never overtake an earlier one.
        response.ttsChain = response.ttsChain
          .then(() => {
            if (
              response.cancelled
              || this.cancelScope.isStale(response.generation)
            ) return null
            return this.ensureSynthesizer(response)
          })
          .then(synthesizer => {
            if (!synthesizer) return
            if (
              response.cancelled
              || this.cancelScope.isStale(response.generation)
            ) return
            synthesizer.sendText(sentence)
          })
          .catch(error => {
            synthesizerFailure = synthesizerFailure || error
          })
      } else {
        this.emitForResponse(response, {
          type: 'response.text.delta',
          response_id: response.id,
          delta: sentence,
        })
      }
    }
    const sentences = new SentenceStream({ onSentence: speakSentence })
    const result = await this.adapters.streamChat(this.config.llm, {
      messages: this.buildMessages(payload, response.turnContext),
      tools: useTools ? this.session.tools : [],
      signal: response.abort.signal,
      onTextDelta: text => {
        if (
          response.cancelled
          || this.cancelScope.isStale(response.generation)
        ) return
        if (!response.timing.llmFirstToken) {
          response.timing.llmFirstToken = true
          this.emitTiming('llm_first_token')
        }
        sentences.push(text)
      },
    })
    if (response.cancelled || this.cancelScope.isStale(response.generation)) {
      throw new Error('cancelled')
    }
    const dropped = sentences.finish(result.finishReason)
    if (dropped) {
      this.log(`级联 LLM 触顶，按句边界丢弃尾句：${dropped.slice(0, 40)}…`)
    }
    await response.ttsChain
    if (synthesizerFailure) throw synthesizerFailure
    if (response.synthesizer) {
      await response.synthesizer.finish()
      if (response.cancelled || this.cancelScope.isStale(response.generation)) {
        throw new Error('cancelled')
      }
    }
    if (spoken) {
      this.emitForResponse(response, audio
        ? {
            type: 'response.audio_transcript.done',
            response_id: response.id,
            transcript: spoken,
          }
        : {
            type: 'response.text.done',
            response_id: response.id,
            text: spoken,
          })
    }
    if (response.cancelled || this.cancelScope.isStale(response.generation)) {
      throw new Error('cancelled')
    }
    const toolCall = result.toolCalls[0]
    if (toolCall) {
      const callId = toolCall.id || id('call')
      this.pushHistory({
        role: 'assistant',
        content: spoken || null,
        tool_calls: [{
          id: callId,
          type: 'function',
          function: { name: toolCall.name, arguments: toolCall.arguments },
        }],
      })
      this.emit({
        type: 'response.function_call_arguments.done',
        response_id: response.id,
        call_id: callId,
        name: toolCall.name,
        arguments: toolCall.arguments || '{}',
      })
    } else if (spoken) {
      this.pushHistory({ role: 'assistant', content: spoken })
    }
  }
}
