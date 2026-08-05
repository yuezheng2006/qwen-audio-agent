import { emitEpisodeStoreChanged } from '../../conversation/episode/hooks.mjs'

export const EPISODE_CORRECT_TOOL_NAME = 'episode_correct'
export const EPISODE_FORGET_TOOL_NAME = 'episode_forget'

const CORRECT_DEFINITION = {
  type: 'function',
  function: {
    name: EPISODE_CORRECT_TOOL_NAME,
    description: '纠正近期情节记忆中的一条事实。用户更正「上次说错了 / 不是这样」时调用；提供 id 或能唯一定位的 query，以及纠正后的内容。',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: '情节记忆 id（来自 Recent Episodes）。',
        },
        query: {
          type: 'string',
          description: '用于匹配要纠正条目的关键词或原文片段。',
        },
        content: {
          type: 'string',
          description: '纠正后的事实表述。',
        },
      },
      required: ['content'],
      additionalProperties: false,
    },
  },
}

const FORGET_DEFINITION = {
  type: 'function',
  function: {
    name: EPISODE_FORGET_TOOL_NAME,
    description: '删除近期情节记忆。用户说「忘掉刚才那句 / 别记这个」时调用；可按 id、query 或最近 N 条删除。',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: '情节记忆 id。',
        },
        query: {
          type: 'string',
          description: '匹配要删除条目的关键词。',
        },
        last_n: {
          type: 'integer',
          description: '删除最近 N 条自动记录。',
        },
        all: {
          type: 'boolean',
          description: '清空该用户全部情节记忆（需用户明确要求）。',
        },
      },
      additionalProperties: false,
    },
  },
}

export function createEpisodeMemoryTools({
  episodeStore,
  onChanged = null,
} = {}) {
  if (!episodeStore) return []

  const notify = async (ownerId) => {
    emitEpisodeStoreChanged(ownerId)
    if (typeof onChanged === 'function') {
      await onChanged(ownerId)
    }
  }

  return [
    {
      name: EPISODE_CORRECT_TOOL_NAME,
      definition: CORRECT_DEFINITION,
      source: 'capability',
      handler: async (args = {}, context = {}) => {
        const ownerId = context.ownerId
        if (!ownerId) {
          return {
            status: 'failed',
            error: true,
            error_code: 'missing_owner',
            user_message: '无法纠正情节记忆。',
          }
        }
        const content = String(args.content || '').trim()
        if (!content) {
          return {
            status: 'failed',
            error: true,
            error_code: 'missing_content',
            user_message: '需要提供纠正后的内容。',
          }
        }
        if (!args.id && !args.query) {
          return {
            status: 'failed',
            error: true,
            error_code: 'missing_target',
            user_message: '需要提供情节 id 或关键词才能纠正。',
          }
        }
        const updated = episodeStore.replace(ownerId, {
          id: args.id,
          query: args.query,
          content,
        })
        if (!updated) {
          return {
            status: 'not_found',
            user_message: '没有找到可纠正的情节记忆。',
          }
        }
        await notify(ownerId)
        return {
          status: 'ok',
          episode: updated,
          user_message: '已更新情节记忆。',
        }
      },
    },
    {
      name: EPISODE_FORGET_TOOL_NAME,
      definition: FORGET_DEFINITION,
      source: 'capability',
      handler: async (args = {}, context = {}) => {
        const ownerId = context.ownerId
        if (!ownerId) {
          return {
            status: 'failed',
            error: true,
            error_code: 'missing_owner',
            user_message: '无法删除情节记忆。',
          }
        }
        if (!args.id && !args.query && !args.last_n && args.all !== true) {
          return {
            status: 'failed',
            error: true,
            error_code: 'missing_target',
            user_message: '需要指定要忘掉的情节。',
          }
        }
        const removed = episodeStore.forget(ownerId, {
          id: args.id,
          query: args.query,
          lastN: args.last_n,
          all: args.all === true,
        })
        if (!removed) {
          return {
            status: 'not_found',
            removed: 0,
            user_message: '没有找到可删除的情节记忆。',
          }
        }
        await notify(ownerId)
        return {
          status: 'ok',
          removed,
          user_message: `已删除 ${removed} 条情节记忆。`,
        }
      },
    },
  ]
}
