export function supportConnectContext(token = '') {
  return {
    workspace: 'support',
    personaId: 'support',
    ...(token ? { token } : {}),
  }
}

export function isSupportPath(pathname = window.location.pathname) {
  return /\/support\/?$/.test(String(pathname || ''))
}

export const SUPPORT_DEMO_EXAMPLES = [
  { id: 'hours', label: '营业时间到几点？', hint: '应回答 9:00–21:00' },
  { id: 'read', label: '怎么开始朗读？', hint: '应提到 Header「阅读」和书架' },
  { id: 'refund', label: '演示订单怎么退款？', hint: '应提到 48 小时，没有单号不编造' },
]

export function supportLineFromEvent(event) {
  const text = String(event?.content || event?.transcript || '').trim()
  if (event?.type === 'error' && event.message) {
    return { role: 'system', text: String(event.message), live: false }
  }
  if (!text) return null
  if (event.type === 'transcript.delta' && event.role === 'assistant') {
    return { role: 'assistant', text, live: true }
  }
  if (event.type === 'transcript.final' && event.role === 'user') {
    return { role: 'user', text, live: false }
  }
  if (event.type === 'transcript.final' && event.role === 'assistant') {
    return { role: 'assistant', text, live: false }
  }
  return null
}

export function mergeSupportLine(lines, line) {
  if (!line) return lines
  if (line.role === 'assistant' && line.live) {
    const last = lines.at(-1)
    if (last?.role === 'assistant' && last.live) {
      return [...lines.slice(0, -1), line]
    }
  }
  if (line.role === 'assistant' && !line.live) {
    const last = lines.at(-1)
    if (last?.role === 'assistant' && last.live) {
      return [...lines.slice(0, -1), line]
    }
  }
  return [...lines, line]
}
