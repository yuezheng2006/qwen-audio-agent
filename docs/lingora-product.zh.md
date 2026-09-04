# 聆界 Lingora

聆界是 qwen-audio-agent 的产品层品牌。底层仓库、Agent Runtime、Gateway 和公开协议继续保持原有名称与兼容性；Lingora 只负责面向用户的产品体验、客户端和能力编排。

## 产品结构

| 产品名 | 职责 |
| --- | --- |
| Lingora | 跨端 Agent 产品与应用平台 |
| Lingora Agent | 会话、记忆、工具和任务运行时 |
| Lingora Voice | VAD、STT、TTS、打断和 VoiceMem |
| Lingora Studio | 录音、裁剪、音色克隆和声音资产 |
| Lingora Plugins | 模型、语音、记忆、工具和客户端扩展 |
| Lingora Desktop / Mobile | Mac、Windows、Linux、iOS、Android 客户端 |

## 品牌边界

- 不把 Lingora 当作新的 Agent 内核，不复制一套运行时。
- 不将 Voice Studio 或 Voicebox 的品牌、代码和界面直接搬入本项目。
- 产品层可以持续演进，底层协议保持稳定，保证第三方插件和客户端不被品牌调整影响。
