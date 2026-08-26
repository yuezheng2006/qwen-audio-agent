# Hello Tool Plugin

This is the smallest server-side plugin example for qwen-audio-agent.

Copy the directory into the Gateway user's `plugins/` directory, then restart
the Gateway. The plugin is discovered from its `plugin.mjs` module and adds the
`hello` capability.

Plugins should declare every requested permission in `manifest.permissions`.
The embedding host grants permissions before activation; a plugin with a missing
grant is reported as failed and its `activate()` function is not called.

The public SDK entry point is:

```js
import { definePluginManifest } from 'qwen-audio-agent/plugin-sdk'
```
