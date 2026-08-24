# 插件扩展

插件是 qwen-audio-agent 开放能力的统一扩展边界。当前第一个内置参考插件是
`qwaudio.tool.weather`，用于验证 Manifest、Plugin Host、能力注册和健康状态链路。

插件由 `manifest` 和 `activate()` 组成。插件类型包括 `agent`、`voice`、`stt`、
`tts`、`memory`、`knowledge`、`reader`、`tool`、`skill`、`persona` 和
`client-extension`。

插件必须显式声明稳定 id、能力、平台和权限；激活失败时应进入 `failed` 状态并出现在
健康信息中，不能让 Gateway 静默失效。当前插件 API 版本为 `1`。后续所有 Agent、
Voice、Knowledge、Reader 和客户端扩展都应复用这套 Manifest 与 Host 生命周期。

## 本地插件

Gateway 启动时会扫描配置目录下的 `plugins/`，也可以通过 `pluginsDir` 传入显式目录。
目录只加载第一层的 `.js` 和 `.mjs` 文件，并按文件名排序。插件模块可以默认导出插件对象，
也可以分别导出 `manifest`、`activate` 和可选的 `deactivate`。

```js
export const manifest = {
  id: 'acme.tool.example',
  version: '1.0.0',
  kind: 'tool',
  label: '示例工具',
  capabilities: ['tool.example'],
  platforms: ['server'],
  permissions: [],
}

export function activate({ registerTool, plugin }) {
  registerTool(createExampleTool(), { source: plugin.id })
}
```

模块导入、Manifest 校验或注册失败时，插件会记录在 `health.plugins.loadFailures`，
不会影响其他插件和 Gateway 启动。

## faster-whisper

首个 STT 插件是 `qwaudio.stt.faster-whisper`。Gateway 不直接安装或管理 Python
依赖，而是向本机 faster-whisper 服务发送一轮 16kHz PCM WAV，服务返回
`{ "text": "..." }`。配置 `CASCADE_STT_PROVIDER=faster-whisper` 和
`CASCADE_STT_URL=http://127.0.0.1:8000/transcribe` 即可启用。

仓库提供了最小本地服务入口：

```bash
uv run --with faster-whisper python scripts/faster-whisper-server.py
```

默认下载并使用 `tiny` 模型；可通过 `FASTER_WHISPER_MODEL`、
`FASTER_WHISPER_DEVICE` 和 `FASTER_WHISPER_COMPUTE_TYPE` 调整。
