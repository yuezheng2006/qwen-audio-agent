import {
  createLocalKnowledgeProvider,
  createNoneKnowledgeProvider,
} from './local-provider.mjs'
import { KNOWLEDGE_PROVIDER_KINDS, assertKnowledgeProvider } from './provider.mjs'

export function resolveKnowledgeProviderKind(raw = process.env.KNOWLEDGE_PROVIDER) {
  const kind = String(raw || 'local').trim().toLowerCase() || 'local'
  if (!KNOWLEDGE_PROVIDER_KINDS.includes(kind)) {
    throw new Error(
      `unsupported KNOWLEDGE_PROVIDER=${raw}; use ${KNOWLEDGE_PROVIDER_KINDS.join('|')}`,
    )
  }
  return kind
}

export function resolveKnowledgeProvider(config = {}, env = process.env) {
  const kind = resolveKnowledgeProviderKind(
    env.KNOWLEDGE_PROVIDER ?? config.knowledgeProvider,
  )
  if (kind === 'none') {
    return assertKnowledgeProvider(createNoneKnowledgeProvider(), 'none')
  }
  return assertKnowledgeProvider(createLocalKnowledgeProvider({
    knowledgeDir: config.knowledgeDir,
    defaultKbId: config.knowledgeDefaultKbId || 'default',
  }), 'local')
}
