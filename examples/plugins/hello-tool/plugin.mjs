import { definePluginManifest } from 'qwen-audio-agent/plugin-sdk'

export const manifest = definePluginManifest({
  id: 'example.tool.hello',
  version: '1.0.0',
  kind: 'tool',
  label: 'Hello Tool',
  description: 'A minimal third-party capability plugin.',
  capabilities: ['tool.hello'],
  platforms: ['server'],
  permissions: [],
})

export function activate({ registerTool, plugin }) {
  registerTool({
    name: 'hello',
    definition: {
      type: 'function',
      function: {
        name: 'hello',
        description: 'Return a short greeting.',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
    },
    handler: async () => ({
      status: 'ok',
      message: 'Hello from a plugin.',
    }),
  }, { source: plugin.id })
}
