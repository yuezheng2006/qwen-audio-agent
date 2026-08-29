import { DEFAULT_SAMPLE_HINTS } from './providers/contract.mjs'

export const DEFAULT_QUALITY_TIPS = Object.freeze([
  '录 5–15 秒连续自然说话（约 8 秒最佳），不要越长越好',
  '安静近场、无混响无背景音乐；嘈杂样本会克隆出嘈杂音色',
  '单一说话人；语气与目标用途接近（朗读/聊天）',
])

export function previewCapable(provider) {
  return String(provider || '').trim() === 'dashscope'
}

export function sampleHintsToSnake(hints = {}) {
  const formats = Array.isArray(hints.formats)
    ? hints.formats.map(String)
    : [...DEFAULT_SAMPLE_HINTS.formats]
  return {
    min_sec: Number(hints.minSec ?? DEFAULT_SAMPLE_HINTS.minSec),
    max_sec: Number(hints.maxSec ?? DEFAULT_SAMPLE_HINTS.maxSec),
    formats,
  }
}

export function qualityTipsFor(_providerId) {
  return [...DEFAULT_QUALITY_TIPS]
}
