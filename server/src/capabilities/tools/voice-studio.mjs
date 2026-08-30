export const VOICE_LIST_PRESETS_TOOL_NAME = 'voice_list_presets'
export const VOICE_CLONE_TOOL_NAME = 'voice_clone'
export const VOICE_IMPORT_TOOL_NAME = 'voice_import'
export const VOICE_CONFIRM_TOOL_NAME = 'voice_confirm'
export const VOICE_LIST_TOOL_NAME = 'voice_list'
export const VOICE_STATUS_TOOL_NAME = 'voice_status'
export const AUDIO_TRANSCRIBE_TOOL_NAME = 'audio_transcribe'

const names = [
  VOICE_LIST_PRESETS_TOOL_NAME,
  VOICE_CLONE_TOOL_NAME,
  VOICE_IMPORT_TOOL_NAME,
  VOICE_CONFIRM_TOOL_NAME,
  VOICE_LIST_TOOL_NAME,
  VOICE_STATUS_TOOL_NAME,
  AUDIO_TRANSCRIBE_TOOL_NAME,
]

function definition(name, description, properties, required = []) {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: {
        type: 'object',
        properties,
        required,
        additionalProperties: false,
      },
    },
  }
}

const PRESET_DEFINITION = definition(
  VOICE_LIST_PRESETS_TOOL_NAME,
  '列出可选的演示音色。用户想挑一个沉稳、温暖或适合旁白的声音时调用；不会返回本机样本路径。',
  {
    query: { type: 'string', description: '按风格、性别或用途筛选，例如「沉稳旁白」。' },
  },
)

const VOICE_INPUT_PROPERTIES = {
  provider: { type: 'string', description: '音色供应商，如 dashscope、fish、minimax。' },
  label: { type: 'string', description: '给这条音色起的名称。' },
  preset_id: { type: 'string', description: '演示音色 id。' },
  sample_url: { type: 'string', description: '可访问的音频样本 URL。' },
  sample_path: { type: 'string', description: '本机音频样本路径。' },
  sample_data_url: { type: 'string', description: '浏览器录音生成的 base64 音频数据。' },
  target_model: { type: 'string', description: '供应商目标 TTS 模型。' },
}

const CLONE_DEFINITION = definition(
  VOICE_CLONE_TOOL_NAME,
  '用 preset_id、sample_url 或 sample_path 之一创建新音色。用户说「克隆我的声音」「做一个旁白音色」时调用。',
  VOICE_INPUT_PROPERTIES,
)

const IMPORT_DEFINITION = definition(
  VOICE_IMPORT_TOOL_NAME,
  '导入供应商已有的音色 ID。用户已经拿到 speaker 或 voice ID、想在本机使用时调用。',
  {
    provider: VOICE_INPUT_PROPERTIES.provider,
    remote_voice_id: { type: 'string', description: '供应商已有的音色 ID。' },
    label: VOICE_INPUT_PROPERTIES.label,
    target_model: VOICE_INPUT_PROPERTIES.target_model,
  },
  ['provider', 'remote_voice_id'],
)

const CONFIRM_DEFINITION = definition(
  VOICE_CONFIRM_TOOL_NAME,
  '确认一条已准备好的音色并切换当前 Cascade TTS。用户说「就用这个声音」「确认并启用」时调用。',
  {
    profile_id: { type: 'string', description: 'voice profile id。' },
    provider: VOICE_INPUT_PROPERTIES.provider,
    remote_voice_id: IMPORT_DEFINITION.function.parameters.properties.remote_voice_id,
    restart: { type: 'boolean', description: '是否重启 Gateway 使新音色立即生效，默认是。' },
  },
)

const LIST_DEFINITION = definition(
  VOICE_LIST_TOOL_NAME,
  '查看我已经创建或导入的音色。用户想看看有哪些可用声音时调用。',
  {
    status: { type: 'string', description: '按 draft、ready、confirmed、failed 筛选。' },
  },
)

const STATUS_DEFINITION = definition(
  VOICE_STATUS_TOOL_NAME,
  '查看当前正在使用的声音，以及最近确认的 Voice Studio 音色。',
  {},
)

const TRANSCRIBE_DEFINITION = definition(
  AUDIO_TRANSCRIBE_TOOL_NAME,
  '将音频转写为文字。当前仅在配置云端 ASR 后端时可用。',
  {
    source: {
      type: 'object',
      description: '音频来源，支持 URL 或本机路径。',
      properties: {
        kind: { type: 'string', enum: ['url', 'file'] },
        url: { type: 'string' },
        path: { type: 'string' },
      },
      additionalProperties: false,
    },
    language: { type: 'string', description: '音频语言，例如 zh、en。' },
    provider: { type: 'string', description: 'ASR 供应商，例如 auto、dashscope。' },
  },
  ['source'],
)

function missingOwner(message) {
  return {
    status: 'failed',
    error: true,
    error_code: 'missing_owner',
    user_message: message,
  }
}

function publicPresets(presets) {
  return (Array.isArray(presets) ? presets : []).map(preset => ({
    id: preset.id,
    label: preset.label,
    locale: preset.locale,
    tags: Array.isArray(preset.tags) ? preset.tags : [],
    durationSec: preset.durationSec,
    license: preset.license,
  }))
}

export function createVoiceStudioTools({ service } = {}) {
  if (!service) return []
  const ownerRequired = (context, message) => {
    const ownerId = context?.ownerId
    return ownerId
      ? { ownerId }
      : { error: missingOwner(message) }
  }

  return [
    {
      name: VOICE_LIST_PRESETS_TOOL_NAME,
      definition: PRESET_DEFINITION,
      source: 'capability',
      handler: async (args = {}) => {
        const result = await service.listPresets({ query: args.query })
        return result?.presets
          ? { ...result, presets: publicPresets(result.presets) }
          : result
      },
    },
    {
      name: VOICE_CLONE_TOOL_NAME,
      definition: CLONE_DEFINITION,
      source: 'capability',
      handler: async (args = {}, context = {}) => {
        const owner = ownerRequired(context, '无法创建音色。')
        return owner.error || service.clone(owner.ownerId, args)
      },
    },
    {
      name: VOICE_IMPORT_TOOL_NAME,
      definition: IMPORT_DEFINITION,
      source: 'capability',
      handler: async (args = {}, context = {}) => {
        const owner = ownerRequired(context, '无法导入音色。')
        return owner.error || service.importVoice(owner.ownerId, args)
      },
    },
    {
      name: VOICE_CONFIRM_TOOL_NAME,
      definition: CONFIRM_DEFINITION,
      source: 'capability',
      handler: async (args = {}, context = {}) => {
        const owner = ownerRequired(context, '无法确认音色。')
        return owner.error || service.confirm(owner.ownerId, args)
      },
    },
    {
      name: VOICE_LIST_TOOL_NAME,
      definition: LIST_DEFINITION,
      source: 'capability',
      handler: async (args = {}, context = {}) => {
        const owner = ownerRequired(context, '无法查看音色。')
        return owner.error || service.list(owner.ownerId, { status: args.status })
      },
    },
    {
      name: VOICE_STATUS_TOOL_NAME,
      definition: STATUS_DEFINITION,
      source: 'capability',
      handler: async (_args = {}, context = {}) => {
        const owner = ownerRequired(context, '无法查看音色状态。')
        return owner.error || service.status(owner.ownerId)
      },
    },
    {
      name: AUDIO_TRANSCRIBE_TOOL_NAME,
      definition: TRANSCRIBE_DEFINITION,
      source: 'capability',
      handler: async (args = {}, context = {}) => {
        const owner = ownerRequired(context, '无法转写音频。')
        return owner.error || service.transcribe(owner.ownerId, args)
      },
    },
  ]
}

export const VOICE_STUDIO_TOOL_NAMES = names
