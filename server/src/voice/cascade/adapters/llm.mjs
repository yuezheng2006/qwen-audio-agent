// Streaming chat client for any OpenAI-compatible endpoint (DashScope
// compatible-mode by default). Streams text deltas and accumulates tool
// calls; the caller decides how to gate text into TTS.
//
//   const stream = await streamChat(config.llm, {
//     messages, tools, toolChoice, signal,
//     onTextDelta(text) {},
//   })
//   // stream = { text, toolCalls, finishReason }

function parseSseLines(chunkText, carry) {
  const text = carry + chunkText
  const lines = text.split('\n')
  const rest = lines.pop() || ''
  const events = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const data = trimmed.slice(5).trim()
    if (!data || data === '[DONE]') continue
    try {
      events.push(JSON.parse(data))
    } catch {
      // Ignore malformed keep-alive fragments.
    }
  }
  return { events, rest }
}

export async function streamChat(llmConfig, {
  messages,
  tools = [],
  toolChoice,
  signal,
  onTextDelta,
}) {
  const body = {
    model: llmConfig.model,
    messages,
    stream: true,
    max_tokens: llmConfig.maxTokens,
  }
  if (tools.length) {
    body.tools = tools
    body.parallel_tool_calls = false
  }
  if (toolChoice) body.tool_choice = toolChoice
  const response = await fetch(`${llmConfig.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${llmConfig.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`级联 LLM 请求失败 ${response.status}：${detail.slice(0, 200)}`)
  }
  const decoder = new TextDecoder()
  let carry = ''
  let text = ''
  let finishReason = ''
  const toolCalls = []
  for await (const chunk of response.body) {
    const parsed = parseSseLines(decoder.decode(chunk, { stream: true }), carry)
    carry = parsed.rest
    for (const event of parsed.events) {
      const choice = event.choices?.[0]
      if (!choice) continue
      if (choice.finish_reason) finishReason = choice.finish_reason
      const delta = choice.delta || {}
      if (delta.content) {
        text += delta.content
        onTextDelta?.(delta.content)
      }
      for (const call of delta.tool_calls || []) {
        const index = Number.isInteger(call.index) ? call.index : 0
        toolCalls[index] = toolCalls[index] || {
          id: '',
          name: '',
          arguments: '',
        }
        if (call.id) toolCalls[index].id = call.id
        if (call.function?.name) toolCalls[index].name += call.function.name
        if (call.function?.arguments) {
          toolCalls[index].arguments += call.function.arguments
        }
      }
    }
  }
  return {
    text,
    toolCalls: toolCalls.filter(Boolean).filter(call => call.name),
    finishReason: finishReason || 'stop',
  }
}
