// Public, intentionally small entry point for third-party plugins.
// Keep Host and loader internals out of the SDK contract.
export {
  PLUGIN_API_VERSION,
  definePluginManifest,
  validatePluginManifest,
} from './manifest.mjs'
