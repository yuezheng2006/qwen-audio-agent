const SOURCE_SUFFIXES = [
  '多层饭店',
  '降噪',
  '复刻',
]

/**
 * Convert provider/gallery labels into a compact display label.
 *
 * Provider labels often contain implementation hints after a middle dot,
 * while persona matching needs the human-facing name only. Keep unknown
 * labels intact so custom cloned voices remain discoverable.
 */
export function friendlyVoiceLabel(value, fallback = '') {
  const text = String(value || '').trim()
  if (!text) return String(fallback || '').trim()

  const [head, ...rest] = text.split('·').map(part => part.trim())
  if (!rest.length) return head
  if (SOURCE_SUFFIXES.some(suffix => rest.includes(suffix))) return head
  return text
}
