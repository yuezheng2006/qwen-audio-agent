function clean(value, fallback = '') {
  return String(value || '').trim() || fallback
}

function normalizeTranslatedSegment(segment, translatedText, index) {
  const text = clean(translatedText)
  const startMs = Number(segment?.startMs)
  const endMs = Number(segment?.endMs)
  if (!text) throw new Error(`translation segment ${index + 1} is empty`)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error(`translation segment ${index + 1} has invalid timing`)
  }
  return {
    id: clean(segment?.id, `segment_${index + 1}`),
    speakerId: clean(segment?.speakerId) || null,
    startMs: Math.round(startMs),
    endMs: Math.round(endMs),
    sourceText: clean(segment?.text),
    targetText: text,
  }
}

export function createSegmentTranslationAdapter({
  translate,
  provider = 'unknown',
} = {}) {
  if (typeof translate !== 'function') throw new TypeError('translate function is required')
  return {
    async translateSegments({ segments, sourceLanguage = 'auto', targetLanguage, ...options } = {}) {
      const source = Array.isArray(segments) ? segments : []
      const target = clean(targetLanguage)
      if (!source.length) throw new TypeError('segments are required')
      if (!target) throw new TypeError('targetLanguage is required')
      const translated = await translate({
        segments: source.map(segment => ({ ...segment })),
        sourceLanguage,
        targetLanguage: target,
        ...options,
      })
      const texts = Array.isArray(translated)
        ? translated
        : translated?.segments
      if (!Array.isArray(texts) || texts.length !== source.length) {
        throw new Error('translation returned an unexpected segment count')
      }
      return {
        artifactId: 'translated_segments',
        kind: 'text.translation.segments',
        provider,
        sourceLanguage: clean(translated?.sourceLanguage, sourceLanguage),
        targetLanguage: target,
        segments: source.map((segment, index) => normalizeTranslatedSegment(
          segment,
          typeof texts[index] === 'string' ? texts[index] : texts[index]?.targetText,
          index,
        )),
      }
    },
  }
}
