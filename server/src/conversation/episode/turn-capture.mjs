const BACKCHANNEL = new Set([
  '嗯', '嗯嗯', '嗯哼', '好', '好的', '好啊', '好吧', '行', '行啊',
  '哦', '噢', '啊', '呃', '额', '唔', '对', '对的', '是', '是的',
  '知道了', '明白', '明白了', '了解', '收到', '可以',
  '你好', '您好', '哈喽', '嗨', '在吗', '在',
  'hello', 'hi', 'hey', 'yeah', 'yep', 'yes', 'okay', 'ok', 'right', 'sure',
  'mm-hmm', 'mhm', 'uh-huh',
])

/** Ambient ASR / meta chatter that should not crowd prompt recall. */
const LOW_SIGNAL = /^(你|我)?(现在|基本上|将来|那个|然后)|是吧$|行行行|什么定|刷的那个|上面已经|固件|编号|录个测试|新店|你肯定是|在输出的时候/

export const MIN_CAPTURE_CHARS = 6

export function normalizeCaptureText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[.,!?;:，。！？、…~\s]+/g, ' ')
    .trim()
}

export function significantCharCount(text) {
  return [...normalizeCaptureText(text).replace(/\s+/g, '')].length
}

/** Bare questions without a concrete assertion (e.g. destination / preference). */
export function isBareQuestion(text) {
  const original = String(text || '')
  const compact = normalizeCaptureText(original).replace(/\s+/g, '')
  if (!compact) return false
  const hasInterrogative = /[?？]/.test(original)
    || /(?:吗|呢)$/.test(compact)
    || /去哪|哪儿|什么|怎么|如何|多少/.test(compact)
  if (!hasInterrogative) return false
  const destination = compact.match(/[去到在]([\u4e00-\u9fff]{2,})/)
  if (destination && !/^哪/.test(destination[1])) return false
  if (/(?:喜欢|讨厌|怕|过敏|记得|提醒|出差|开会)/.test(compact)) return false
  return true
}

export function isLowSignalUtterance(text) {
  const compact = normalizeCaptureText(text).replace(/\s+/g, '')
  if (!compact) return true
  if (LOW_SIGNAL.test(compact)) return true
  // Fragmentary deixis with little propositional content.
  if (
    compact.length < 12
    && /^(你|我|这|那|就)/.test(compact)
    && !/[去到在要]/.test(compact)
    && !/(?:喜欢|讨厌|怕|过敏|记得|提醒)/.test(compact)
  ) {
    return true
  }
  return false
}

/** Durable-enough fact for auto-capture and connect-time prompt recall. */
export function isMemorableFact(text) {
  if (!passesBasicCaptureGate(text)) return false
  if (isBareQuestion(text)) return false
  if (isLowSignalUtterance(text)) return false
  return true
}

function passesBasicCaptureGate(text, {
  minChars = MIN_CAPTURE_CHARS,
} = {}) {
  const normalized = normalizeCaptureText(text)
  if (!normalized) return false
  if (BACKCHANNEL.has(normalized)) return false
  const compact = normalized.replace(/\s+/g, '')
  if (BACKCHANNEL.has(compact)) return false
  if (/^(hello|hi|hey|哈喽|嗨|你好|嗯|好){1,6}$/i.test(compact)) return false
  const chars = significantCharCount(normalized)
  if (chars >= minChars) return true
  // Short preference / fear facts are still durable ("我怕打雷").
  return chars >= 4 && /(?:喜欢|讨厌|怕|过敏|记得)/.test(compact)
}

export function shouldCaptureTurn(text, {
  minChars = MIN_CAPTURE_CHARS,
} = {}) {
  if (!passesBasicCaptureGate(text, { minChars })) return false
  if (isBareQuestion(text)) return false
  if (isLowSignalUtterance(text)) return false
  return true
}

export function normalizeEpisodeContent(text, { maxChars = 400 } = {}) {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars - 1)}…`
}

/** Auto-capture a user turn into the episode store when it passes filters. */
export function captureUserTurn(episodeStore, ownerId, transcript, {
  minChars = MIN_CAPTURE_CHARS,
} = {}) {
  if (!episodeStore || typeof episodeStore.append !== 'function') return null
  if (!shouldCaptureTurn(transcript, { minChars })) return null
  return episodeStore.append(ownerId, {
    role: 'user',
    content: transcript,
    source: 'auto',
    confidence: 0.5,
  })
}
