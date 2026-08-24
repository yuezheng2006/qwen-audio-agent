# 插件扩展

插件是 qwen-audio-agent 开放能力的统一扩展边界。当前第一个内置参考插件是
`qwaudio.tool.weather`，用于验证 Manifest、Plugin Host、能力注册和健康状态链路。

插件由 `manifest` 和 `activate()` 组成。插件类型包括 `agent`、`voice`、`stt`、
`tts`、`memory`、`knowledge`、`reader`、`tool`、`skill`、`persona` 和
`client-extension`。

插件必须显式声明稳定 id、能力、平台和权限；激活失败时应进入 `failed` 状态并出现在
健康信息中，不能让 Gateway 静默失效。当前插件 API 版本为 `1`。后续所有 Agent、
Voice、Knowledge、Reader 和客户端扩展都应复用这套 Manifest 与 Host 生命周期。
