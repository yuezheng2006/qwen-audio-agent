# Plugin Extensions

Plugins are the open extension boundary for qwen-audio-agent. The first built-in
reference plugin is `qwaudio.tool.weather`; it validates Manifest, Plugin Host,
capability registration, and health reporting.

Plugin kinds include `agent`, `voice`, `stt`, `tts`, `memory`, `knowledge`, `reader`,
`tool`, `skill`, `persona`, and `client-extension`. Plugins must declare stable ids,
capabilities, platforms, and permissions. Failed activation is reported in health
state instead of silently disabling the Gateway.

The current plugin API version is `1`.

## Local plugins

At startup the Gateway scans `plugins/` below the configured user directory. An
explicit `pluginsDir` may be supplied by an embedding host. Only direct `.js` and
`.mjs` files are loaded, in filename order. A module may default-export a plugin
object, or export `manifest`, `activate`, and optionally `deactivate` separately.

```js
export const manifest = {
  id: 'acme.tool.example',
  version: '1.0.0',
  kind: 'tool',
  label: 'Example tool',
  capabilities: ['tool.example'],
  platforms: ['server'],
  permissions: [],
}

export function activate({ registerTool, plugin }) {
  registerTool(createExampleTool(), { source: plugin.id })
}
```

Import, manifest-validation, and registration failures are exposed under
`health.plugins.loadFailures`; they do not prevent other plugins or the Gateway
from starting.
