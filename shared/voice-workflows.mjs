// Product-level workflow catalog. It describes user jobs, not engine details.
// Engines and execution stay behind plugin/adapter seams.

export const VOICE_WORKFLOW_API_VERSION = '1'

const WORKFLOW_ID = /^[a-z][a-z0-9-]*$/
const STATUSES = new Set(['live', 'planned', 'settings'])

function text(value, field) {
  const result = String(value || '').trim()
  if (!result) throw new Error(`voice workflow ${field} is required`)
  return result
}

export function defineVoiceWorkflow(workflow) {
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
    throw new Error('voice workflow must be an object')
  }
  const id = text(workflow.id, 'id')
  const status = text(workflow.status, 'status')
  if (!WORKFLOW_ID.test(id)) throw new Error(`voice workflow id is invalid: ${id}`)
  if (!STATUSES.has(status)) throw new Error(`voice workflow status is invalid: ${status}`)
  const capabilities = Array.isArray(workflow.capabilities)
    ? [...new Set(workflow.capabilities.map(value => text(value, 'capability')))]
    : []
  return Object.freeze({
    apiVersion: VOICE_WORKFLOW_API_VERSION,
    id,
    title: text(workflow.title, 'title'),
    description: text(workflow.description, 'description'),
    status,
    capabilities: Object.freeze(capabilities),
    ...(workflow.view ? { view: text(workflow.view, 'view') } : {}),
    ...(workflow.jump ? { jump: text(workflow.jump, 'jump') } : {}),
  })
}

export const VOICE_WORKFLOWS = Object.freeze([
  defineVoiceWorkflow({
    id: 'voice-gallery', title: '使用一个声音',
    description: '试听声音，并选它来和助手聊天', status: 'live',
    capabilities: ['voice.profile.list', 'voice.profile.select'], view: 'gallery',
  }),
  defineVoiceWorkflow({
    id: 'voice-clone', title: '复制我的声音',
    description: '录一小段声音，生成属于你的音色', status: 'live',
    capabilities: ['audio.record', 'speech.clone'], view: 'clone',
  }),
  defineVoiceWorkflow({
    id: 'voice-design', title: '声音设计',
    description: '描述式生成音色', status: 'planned',
    capabilities: ['speech.design'],
  }),
  defineVoiceWorkflow({
    id: 'video-dubbing', title: '视频配音',
    description: '转录、翻译，再配音', status: 'live',
    capabilities: ['speech.transcribe', 'speech.synthesize'], view: 'dub',
  }),
  defineVoiceWorkflow({
    id: 'audiobook', title: '朗读一本书',
    description: '导入书籍，用选定的声音朗读', status: 'live',
    capabilities: ['speech.synthesize'], jump: 'reading',
  }),
  defineVoiceWorkflow({
    id: 'multi-voice-story', title: '故事模式',
    description: '多角色配音', status: 'planned',
    capabilities: ['speech.synthesize', 'voice.profile.select'],
  }),
  defineVoiceWorkflow({
    id: 'dictation', title: '听写',
    description: '用快捷键把语音变成文字', status: 'planned',
    capabilities: ['speech.transcribe'],
  }),
  defineVoiceWorkflow({
    id: 'model-catalogue', title: '模型目录',
    description: '查看模型、设备和插件状态', status: 'settings',
    capabilities: ['model.catalogue'], jump: 'mode',
  }),
])

export function voiceWorkflow(id) {
  return VOICE_WORKFLOWS.find(workflow => workflow.id === String(id || '').trim()) || null
}
