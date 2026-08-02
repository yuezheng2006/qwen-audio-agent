export const WEB_SEARCH_TOOL_NAME = 'web_search'

const TOOL_DEFINITION = {
  type: 'function',
  function: {
    name: WEB_SEARCH_TOOL_NAME,
    description: '联网检索当前事实、新闻或公开网页摘要。用户询问最新消息、实时数据、外部资料时先调用；只依据返回片段口述，没有命中就说明不确定。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '检索用的自然语言问题或关键词。',
        },
        limit: {
          type: 'integer',
          description: '返回条数，默认 5，最大 8。',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
}

function truncate(text, max = 220) {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<\/?b>/gi, '')
}

/**
 * DuckDuckGo HTML results (no API key). Inject fetchImpl in tests.
 */
export async function searchWeb(query, {
  limit = 5,
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  const q = String(query || '').trim()
  if (!q) return []
  const capped = Math.min(8, Math.max(1, Number(limit) || 5))
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      'User-Agent': 'qwen-audio-agent/1.0 (+voice-frontend web_search)',
      Accept: 'text/html',
    },
    signal,
  })
  if (!response.ok) {
    throw new Error(`web_search HTTP ${response.status}`)
  }
  const html = await response.text()
  const hits = []
  const blockRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td)>|)/gi
  let match
  while ((match = blockRe.exec(html)) && hits.length < capped) {
    const href = decodeHtml(match[1])
    const title = truncate(decodeHtml(match[2].replace(/<[^>]+>/g, '')), 120)
    const snippet = truncate(decodeHtml((match[3] || '').replace(/<[^>]+>/g, '')), 220)
    if (!title) continue
    hits.push({
      title,
      url: href.startsWith('http') ? href : '',
      snippet,
    })
  }
  if (hits.length) return hits

  // Fallback: Instant Answer API (often sparse, but keyless).
  const instantUrl = (
    `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}`
    + '&format=json&no_html=1&skip_disambig=1'
  )
  const instant = await fetchImpl(instantUrl, {
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!instant.ok) return []
  const payload = await instant.json()
  if (payload.AbstractText) {
    hits.push({
      title: truncate(payload.Heading || q, 120),
      url: String(payload.AbstractURL || ''),
      snippet: truncate(payload.AbstractText, 280),
    })
  }
  for (const topic of payload.RelatedTopics || []) {
    if (hits.length >= capped) break
    const item = topic.Topics ? topic.Topics[0] : topic
    if (!item?.Text) continue
    hits.push({
      title: truncate(item.Text.split(' - ')[0] || item.Text, 120),
      url: String(item.FirstURL || ''),
      snippet: truncate(item.Text, 220),
    })
  }
  return hits.slice(0, capped)
}

export function createWebSearchTool({ fetchImpl = globalThis.fetch } = {}) {
  return {
    name: WEB_SEARCH_TOOL_NAME,
    definition: TOOL_DEFINITION,
    source: 'capability',
    handler: async (args = {}) => {
      const query = String(args.query || '').trim()
      if (!query) {
        return {
          status: 'failed',
          error: true,
          error_code: 'missing_query',
          user_message: '需要提供检索问题。',
        }
      }
      try {
        const hits = await searchWeb(query, {
          limit: args.limit,
          fetchImpl,
        })
        if (!hits.length) {
          return {
            status: 'not_found',
            count: 0,
            query,
            hits: [],
            user_message: '没有检索到可靠结果。',
          }
        }
        return {
          status: 'ok',
          count: hits.length,
          query,
          hits,
        }
      } catch (error) {
        return {
          status: 'failed',
          error: true,
          error_code: 'web_search_failed',
          user_message: '联网检索暂时不可用。',
          detail: String(error.message || error).slice(0, 160),
          retryable: true,
        }
      }
    },
  }
}
