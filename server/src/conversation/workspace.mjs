import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export const SUPPORT_WORKSPACE = 'support'
export const SUPPORT_PERSONA_ID = 'support'
export const SUPPORT_VOICE_LABEL = '客服助手'
export const SUPPORT_KB_ID = 'support'

export const SUPPORT_TOOL_ALLOWLIST = new Set([
  'knowledge_search',
  'notes',
  'spawn_thinking',
  'get_current_time',
  'get_agent_task_status',
  'cancel_agent_task',
])

export const REGISTERED_WORKSPACES = Object.freeze({
  [SUPPORT_WORKSPACE]: Object.freeze({
    id: SUPPORT_WORKSPACE,
    requiresToken: true,
    isolateData: true,
    kbId: SUPPORT_KB_ID,
    personaId: SUPPORT_PERSONA_ID,
    voiceLabel: SUPPORT_VOICE_LABEL,
    toolAllowlist: SUPPORT_TOOL_ALLOWLIST,
  }),
})

export function normalizeWorkspace(value) {
  const id = String(value || '').trim().toLowerCase()
  if (!id) return ''
  return REGISTERED_WORKSPACES[id] ? id : ''
}

export function isRegisteredWorkspace(value) {
  const id = String(value || '').trim().toLowerCase()
  return !id || Boolean(REGISTERED_WORKSPACES[id])
}

export function isSupportWorkspace(value) {
  return normalizeWorkspace(value) === SUPPORT_WORKSPACE
}

export function workspaceSpec(value) {
  const id = normalizeWorkspace(value)
  return id ? REGISTERED_WORKSPACES[id] : null
}

export function supportConnectContext() {
  return {
    workspace: SUPPORT_WORKSPACE,
    personaId: SUPPORT_PERSONA_ID,
    voiceLabel: SUPPORT_VOICE_LABEL,
  }
}

export function workspaceConnectContext(workspace) {
  const spec = workspaceSpec(workspace)
  if (!spec) return {}
  return {
    workspace: spec.id,
    personaId: spec.personaId,
    voiceLabel: spec.voiceLabel,
  }
}

export function filterRealtimeTools(tools = [], workspace) {
  const spec = workspaceSpec(workspace)
  if (!spec?.toolAllowlist) return tools
  return tools.filter(tool => {
    const name = tool?.function?.name || tool?.name
    return spec.toolAllowlist.has(name)
  })
}

export function verifyInboundToken(workspace, token, tokens = {}) {
  const requested = String(workspace || '').trim().toLowerCase()
  if (requested && !REGISTERED_WORKSPACES[requested]) {
    return { ok: false, error: '未注册的 workspace' }
  }
  const spec = workspaceSpec(requested)
  if (!spec?.requiresToken) return { ok: true }
  const got = String(token || '').trim()
  const want = String(
    tokens[spec.id] ?? process.env.SUPPORT_INBOUND_TOKEN ?? '',
  ).trim()
  if (!want) return { ok: false, error: `未配置 ${spec.id} 进线令牌` }
  if (!got || got !== want) return { ok: false, error: '进线令牌无效' }
  return { ok: true }
}

export function verifySupportToken(token, expected = process.env.SUPPORT_INBOUND_TOKEN) {
  return verifyInboundToken(SUPPORT_WORKSPACE, token, {
    [SUPPORT_WORKSPACE]: expected,
  })
}

export function workspaceOwnerId(ownerId, workspace) {
  const owner = String(ownerId || 'default').trim() || 'default'
  const spec = workspaceSpec(workspace)
  if (!spec?.isolateData) return owner
  return `${spec.id}::${owner}`
}

export function advertisedWorkspaceMatches(advertised, workspace) {
  const requested = String(advertised || '').trim().toLowerCase()
  if (!requested) return true
  return requested === normalizeWorkspace(workspace)
}

export function workspaceKbId(workspace, requestedKb) {
  const spec = workspaceSpec(workspace)
  if (spec?.kbId) return spec.kbId
  return String(requestedKb || '').trim() || undefined
}

export function seedSupportKnowledge(knowledgeDir, seedDir) {
  if (!knowledgeDir || !seedDir || !existsSync(seedDir)) {
    return { copied: 0 }
  }
  const dest = join(knowledgeDir, SUPPORT_KB_ID)
  mkdirSync(dest, { recursive: true, mode: 0o700 })
  const existing = readdirSync(dest).filter(name => name.endsWith('.md'))
  if (existing.length) return { copied: 0, skipped: true }
  let copied = 0
  for (const name of readdirSync(seedDir)) {
    if (!name.endsWith('.md')) continue
    copyFileSync(join(seedDir, name), join(dest, name))
    copied += 1
  }
  return { copied }
}
