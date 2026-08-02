/**
 * Backchannel-aware barge-in helpers (StreamCore-inspired).
 * Confirm interrupt only when VAD speech + STT partial (≥2 chars), with a
 * short window that suppresses「嗯/好/yeah」style acknowledgements.
 */

export const BACKCHANNEL_WINDOW_MS = 800
export const MIN_PARTIAL_CHARS = 2
/** After a user turn commits, ignore soft barge-in briefly (trailing speech / AEC lag). */
export const POST_COMMIT_BARGE_HOLD_MS = 1400
/** Require this many significant chars before a short utterance can cut TTS. */
export const MIN_INTERRUPT_CHARS = 4

const BACKCHANNEL_TOKENS = new Set([
  '嗯',
  '嗯嗯',
  '嗯哼',
  '好',
  '好的',
  '好啊',
  '好吧',
  '行',
  '行啊',
  '哦',
  '噢',
  '啊',
  '呃',
  '额',
  '唔',
  '对',
  '对的',
  '是',
  '是的',
  '知道了',
  '明白',
  '明白了',
  '了解',
  '收到',
  '可以',
  '你好',
  '您好',
  '哈喽',
  '嗨',
  '在吗',
  '在',
  'hello',
  'hello hello',
  'hi',
  'hey',
  'mm-hmm',
  'mm hmm',
  'mhm',
  'uh-huh',
  'uh huh',
  'yeah',
  'yep',
  'yes',
  'okay',
  'ok',
  'right',
  'sure',
  'got it',
  'i see',
])

export function normalizePartial(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[.,!?;:，。！？、…~\s]+/g, ' ')
    .trim()
}

export function significantCharCount(text) {
  const normalized = normalizePartial(text).replace(/\s+/g, '')
  return [...normalized].length
}

export function isBackchannel(text) {
  const normalized = normalizePartial(text)
  if (!normalized) return false
  if (BACKCHANNEL_TOKENS.has(normalized)) return true
  // Allow mild repetition: 「嗯嗯嗯」「好好」「hello hello」
  const compact = normalized.replace(/\s+/g, '')
  if (BACKCHANNEL_TOKENS.has(compact)) return true
  if (/^(hello|hi|hey|哈喽|嗨|你好|嗯|好){1,6}$/i.test(compact)) return true
  return false
}

/**
 * Mic often hears the TTS we just played. Treat strong overlap as echo, not barge-in.
 */
export function looksLikeEcho(userText, spokenSoFar = '') {
  const user = normalizePartial(userText).replace(/\s+/g, '')
  const spoken = normalizePartial(spokenSoFar).replace(/\s+/g, '')
  if (!user || user.length < 2 || !spoken) return false
  if (spoken.includes(user)) return true
  if (user.length >= 4 && user.includes(spoken.slice(0, Math.min(spoken.length, user.length)))) {
    return true
  }
  let prefix = 0
  const limit = Math.min(user.length, spoken.length)
  while (prefix < limit && user[prefix] === spoken[prefix]) prefix += 1
  return prefix >= 4
}

export function shouldSuppressInterrupt(text, {
  spokenSoFar = '',
  holdActive = false,
  minInterruptChars = MIN_INTERRUPT_CHARS,
} = {}) {
  if (holdActive) return true
  if (!text || isBackchannel(text)) return true
  if (looksLikeEcho(text, spokenSoFar)) return true
  if (significantCharCount(text) < minInterruptChars) return true
  return false
}

export function isShortRedirect(text, { maxChars = 12 } = {}) {
  return significantCharCount(text) > 0 && significantCharCount(text) <= maxChars
}

/**
 * Build the next-turn user content after a barge-in, so the LLM does not
 * continue the interrupted answer.
 */
export function buildInterruptedUserContent(userText, interruptedText = '') {
  const user = String(userText || '').trim()
  const prior = String(interruptedText || '').trim()
  if (!user) return user
  if (!prior) {
    return [
      '[系统提示：你上一轮回答被用户打断。]',
      `用户说：${user}`,
      '请只回应用户这句话，不要继续或重复被打断的内容。',
    ].join('\n')
  }
  if (isShortRedirect(user)) {
    return [
      '[系统提示：你上一轮回答被用户打断。]',
      `用户说：${user}`,
      '请回应用户这句话，不要继续或重复被打断的内容。',
    ].join('\n')
  }
  const clipped = prior.length > 150 ? `…${prior.slice(-150)}` : prior
  return [
    '[系统提示：你上一轮回答被用户打断。]',
    `你当时说到：${clipped}`,
    `用户说：${user}`,
    '请针对用户这句话回应，不要继续朗读被打断的长文。',
  ].join('\n')
}

export function createBargeInController({
  windowMs = BACKCHANNEL_WINDOW_MS,
  minPartialChars = MIN_PARTIAL_CHARS,
  minInterruptChars = MIN_INTERRUPT_CHARS,
  now = () => Date.now(),
  getSpokenSoFar = () => '',
  isHoldActive = () => false,
  onConfirm = () => {},
} = {}) {
  let soft = false
  let pending = false
  let confirmed = false
  let startedAt = 0
  let latestPartial = ''
  let timer = null

  function clearTimer() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  function reset() {
    clearTimer()
    soft = false
    pending = false
    confirmed = false
    startedAt = 0
    latestPartial = ''
  }

  function armSoft() {
    soft = true
    pending = false
    confirmed = false
    startedAt = 0
    latestPartial = ''
    clearTimer()
  }

  function notePartial(text) {
    latestPartial = String(text || '')
    if (!soft || confirmed || pending) return { armed: soft, pending, confirmed }
    if (shouldSuppressInterrupt(latestPartial, {
      spokenSoFar: getSpokenSoFar(),
      holdActive: isHoldActive(),
      minInterruptChars,
    })) {
      return { armed: soft, pending, confirmed }
    }
    if (significantCharCount(latestPartial) < minPartialChars) {
      return { armed: soft, pending, confirmed }
    }
    pending = true
    startedAt = now()
    clearTimer()
    timer = setTimeout(() => {
      if (!soft || confirmed || !pending) return
      if (shouldSuppressInterrupt(latestPartial, {
        spokenSoFar: getSpokenSoFar(),
        holdActive: isHoldActive(),
        minInterruptChars,
      })) {
        pending = false
        return
      }
      confirmed = true
      pending = false
      onConfirm({ reason: 'speech_sustained', partial: latestPartial })
    }, windowMs)
    return { armed: soft, pending, confirmed }
  }

  function decideOnSpeechEnd(finalText) {
    const text = String(finalText || latestPartial || '').trim()
    if (!soft || confirmed) {
      return { action: confirmed ? 'already_confirmed' : 'normal', text }
    }
    clearTimer()
    if (shouldSuppressInterrupt(text, {
      spokenSoFar: getSpokenSoFar(),
      holdActive: isHoldActive(),
      minInterruptChars,
    })) {
      reset()
      return { action: 'suppress', text }
    }
    confirmed = true
    pending = false
    onConfirm({ reason: 'short_utterance', partial: text })
    return { action: 'confirm', text }
  }

  return {
    reset,
    armSoft,
    notePartial,
    decideOnSpeechEnd,
    get latestPartial() { return latestPartial },
    get soft() { return soft },
    get pending() { return pending },
    get confirmed() { return confirmed },
    get startedAt() { return startedAt },
  }
}
