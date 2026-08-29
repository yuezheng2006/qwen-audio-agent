export function knowledgeHealthSummary(health) {
  if (!health || typeof health !== 'object') {
    return { kind: 'unknown', ok: false, label: '知识库未就绪' }
  }
  const kind = String(health.kind || (health.knowledgeDir ? 'local' : 'unknown'))
  const warning = String(health.warning || '').trim()
  const ok = health.ok !== false
  if (kind === 'weknora') {
    const kbCount = Array.isArray(health.kbIds) ? health.kbIds.length : 0
    return {
      kind,
      ok,
      label: ok
        ? `WeKnora 已接通${kbCount ? ` · ${kbCount} 库` : ''}`
        : (warning || 'WeKnora 未接通'),
    }
  }
  if (kind === 'none') {
    return { kind, ok: false, label: '知识检索已关闭' }
  }
  return {
    kind: kind || 'local',
    ok,
    label: warning
      ? `本地知识库 · ${warning}`
      : (health.knowledgeDir || '本地知识库'),
  }
}
