/** Format seconds as m:ss (Voicebox-style compact clock). */
export function formatPreviewTime(seconds) {
  const value = Number(seconds)
  if (!Number.isFinite(value) || value < 0) return '0:00'
  const total = Math.floor(value)
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}

/** 1–2 character avatar label from a display name. */
export function voiceAvatarLabel(name) {
  const text = String(name || '').trim()
  if (!text) return '?'
  const chars = Array.from(text)
  if (chars.length === 1) return chars[0]
  // Prefer first two CJK / letters; skip spaces
  return chars.slice(0, 2).join('')
}

/** Stable hash → low-sat HSL pair for avatar gradients (purple/indigo/slate band). */
export function voiceAvatarTone(name) {
  const text = String(name || '').trim()
  let hash = 0
  for (const char of text) {
    hash = (hash * 31 + char.codePointAt(0)) >>> 0
  }
  // Hue band ~210–290 (indigo → violet); keep sat/light muted for dark UI
  const hue = 210 + (hash % 81)
  const sat = 28 + (hash % 18)
  const lightFrom = 28 + ((hash >> 3) % 8)
  const lightTo = 16 + ((hash >> 5) % 6)
  return {
    from: `hsl(${hue} ${sat}% ${lightFrom}%)`,
    to: `hsl(${hue + 12} ${Math.max(18, sat - 8)}% ${lightTo}%)`,
  }
}

export function previewProgressRatio(currentTime, duration) {
  const cur = Number(currentTime)
  const dur = Number(duration)
  if (!Number.isFinite(cur) || !Number.isFinite(dur) || dur <= 0) return 0
  return Math.min(1, Math.max(0, cur / dur))
}
