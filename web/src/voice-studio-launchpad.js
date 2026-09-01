/** Launchpad tiles aligned with VoiceStudio IA (subset; no full port). */
export const VOICE_STUDIO_TILES = [
  {
    id: 'gallery',
    title: '使用一个声音',
    blurb: '试听声音，并选它来和助手聊天',
    status: 'live',
    view: 'gallery',
  },
  {
    id: 'clone',
    title: '复制我的声音',
    blurb: '录一小段声音，生成属于你的音色',
    status: 'live',
    view: 'clone',
  },
  {
    id: 'design',
    title: '声音设计',
    blurb: '描述式生成音色',
    status: 'soon',
  },
  {
    id: 'dub',
    title: '视频配音',
    blurb: '转录翻译再配音',
    status: 'live',
    view: 'dub',
  },
  {
    id: 'audiobook',
    title: '朗读一本书',
    blurb: '导入书籍，用选定的声音朗读',
    status: 'live',
    jump: 'reading',
  },
  {
    id: 'stories',
    title: '故事模式',
    blurb: '多角色配音',
    status: 'soon',
  },
  {
    id: 'dictation',
    title: '听写',
    blurb: '系统快捷键',
    status: 'soon',
  },
  {
    id: 'engines',
    title: '高级设置',
    blurb: '调整语音前台和连接方式',
    status: 'jump',
    jump: 'mode',
  },
]

export function defaultVoiceStudioView() {
  return 'launchpad'
}

export function resolveVoiceStudioView(requested) {
  const allowed = new Set(['launchpad', 'gallery', 'clone', 'dub'])
  return allowed.has(requested) ? requested : 'launchpad'
}
