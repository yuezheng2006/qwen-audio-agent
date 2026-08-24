# Plugin Extensions

Plugins are the open extension boundary for qwen-audio-agent. The first built-in
reference plugin is `qwaudio.tool.weather`; it validates Manifest, Plugin Host,
capability registration, and health reporting.

Plugin kinds include `agent`, `voice`, `stt`, `tts`, `memory`, `knowledge`, `reader`,
`tool`, `skill`, `persona`, and `client-extension`. Plugins must declare stable ids,
capabilities, platforms, and permissions. Failed activation is reported in health
state instead of silently disabling the Gateway.

The current plugin API version is `1`.
