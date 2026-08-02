import { config } from '../../core/config.mjs'
import {
  getRealtimeTools,
  buildFrontendInstructions,
} from '../frontend-tools.mjs'
import { cascadeRealtimeUrl } from '../cascade/server.mjs'
import { openAiCompatibleProtocol } from './openai-compatible-protocol.mjs'
import { dashscopeProvider } from './dashscope.mjs'

/**
 * Local open cascade frontend: VAD → pluggable STT → LLM → pluggable TTS,
 * served over the same Realtime protocol from a loopback WebSocket.
 */
export const cascadeProvider = {
  key: 'cascade',
  label: 'Cascade（本地级联）',
  inputSampleRate: 16000,
  outputSampleRate: 24000,
  protocol: openAiCompatibleProtocol,

  model: () => [
    config.cascade.stt.model,
    config.cascade.llm.model,
    config.cascade.tts.model,
  ].join(' + '),
  voice: () => config.cascade.tts.voice,
  isConfigured: () => Boolean(
    config.cascade?.stt?.apiKey
    && config.cascade?.llm?.apiKey
    && config.cascade?.tts?.apiKey,
  ),
  missingKeyMessage: '请先配置 DASHSCOPE_API_KEY（或各 CASCADE_*_API_KEY）',
  connectTimeoutMessage: '连接本地级联语音服务超时',

  url: () => cascadeRealtimeUrl(),
  headers: () => ({}),
  classifyError: message => dashscopeProvider.classifyError(message),

  buildSession: ({ agentContext }) => ({
    instructions: buildFrontendInstructions(agentContext),
    tools: getRealtimeTools(),
    modalities: agentContext?.textOnly === true ? ['text'] : ['text', 'audio'],
  }),

  buildSpeakResponse: (content, { textOnly = false } = {}) => ({
    cascade_mode: 'speak',
    modalities: textOnly ? ['text'] : ['text', 'audio'],
    content,
  }),

  buildResultInjection: (content, options) => (
    dashscopeProvider.buildResultInjection(content, options)
  ),

  buildPermissionInjection: (permission, options) => (
    dashscopeProvider.buildPermissionInjection(permission, options)
  ),
}
