/** Launchpad tiles aligned with VoiceStudio IA (subset; no full port). */
export const VOICE_STUDIO_TILES = [
  {
    id: 'gallery',
    title: '声音库',
    blurb: '试听 · 下载 · 选用',
    status: 'live',
    view: 'gallery',
  },
  {
    id: 'clone',
    title: '克隆',
    blurb: '语音克隆或导入 ID',
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
    status: 'soon',
  },
  {
    id: 'audiobook',
    title: '有声书',
    blurb: '书架 · 导入 · 朗读',
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
    title: '引擎设置',
    blurb: 'cascade / S2S',
    status: 'jump',
    jump: 'mode',
  },
]

export function defaultVoiceStudioView() {
  return 'launchpad'
}

export function resolveVoiceStudioView(requested) {
  const allowed = new Set(['launchpad', 'gallery', 'clone'])
  return allowed.has(requested) ? requested : 'launchpad'
}
