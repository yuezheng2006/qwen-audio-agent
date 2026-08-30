# VoiceStudio 仓库分析

分析对象：<https://github.com/debpalash/VoiceStudio>

## 结论

VoiceStudio 的核心不是“套壳某个 TTS”，而是把本地语音能力做成一个可运营的语音平台：统一引擎注册、统一任务/API、跨平台运行、模型目录、诊断和可恢复队列。它适合成为我们语音工作室与语音基础设施的参考，但不应成为产品定位：我们的主产品仍然是跨端 Agent，语音是 Agent 的输入、输出和工具层。

## 值得借鉴

1. **引擎注册表与能力矩阵**：TTS/ASR 引擎不只是列表，而是声明克隆、语言、硬件、平台和授权能力；新增引擎必须有明确用户价值、适配器、测试和维护人。参考：<https://github.com/debpalash/VoiceStudio/blob/main/docs/engine-acceptance.md>。
2. **统一语音平台协议**：同时提供 HTTP、SSE、WebSocket、OpenAI-compatible API、MCP 和本地控制接口，让 GUI、编辑器、Agent、CLI 都能复用同一个语音后端。参考：<https://github.com/debpalash/VoiceStudio/blob/main/docs/speech-platform.md>。
3. **采集层与数据层分离**：桌面端负责麦克风、快捷键、焦点窗口和文本回填；后端负责 ASR 模型和音频数据面。这对我们的 Mac 客户端、浏览器、移动端和 TUI 共用 Agent Core 很有价值。
4. **默认本地、远程显式授权**：本地优先，远程 worker 和远程 ASR 明确标识音频离开设备；这应成为我们声音克隆和私人 Agent 的信任基础。
5. **多档模型而非单一模型**：高质量克隆、低延迟 CPU、Apple Silicon、批处理隔离分别由不同引擎承担。我们可以把“实时对话”“录音转写”“高质量朗读”“声音克隆”设计成不同能力档位。
6. **任务持久化和诊断**：长任务有 job/events、重启恢复、取消、日志和自检，而不是只依赖前端一次请求。这是我们后续朗读、转写、视频配音和批量任务必须补上的基础。
7. **产品化的音色生命周期**：克隆/设计后的声音有 profile、预览、锁定、使用记录和目标模型，而不是一个孤立的 voice ID。

## 不建议照搬

- 不把仓库的大量本地 TTS/ASR 依赖整体搬入当前 Node Agent。它的 Python + PyTorch 依赖重，安装和模型管理成本高；我们应采用 sidecar/worker 适配器，按平台和能力懒加载。
- 不把“646 语言、16 TTS、11 ASR”作为早期目标。先保证中文/英文的实时对话、转写、朗读和个人音色链路稳定。
- 不把 Agent 退化成语音生产工具。VoiceStudio 强在制作管线；我们要在其语音能力之上继续提供问答、聊天、工具调用、记忆、知识库和跨端会话。
- 注意其 AGPL-3.0 许可证及各模型独立许可证；只借鉴架构和公开协议，代码或依赖引入前要逐项做许可证审查。

## 对我们架构的落地建议

```text
跨端客户端（Mac / Windows / iOS / Android / Web / TUI）
        │ 统一 Gateway / Agent Protocol
        ├── Agent Core：会话、记忆、工具、权限、任务
        ├── Voice Runtime：采集、VAD、ASR、TTS、播放、打断
        ├── Voice Profile：录音、裁剪、质量检查、克隆、预览、版本
        └── Plugin/Worker：faster-whisper、MLX、Qwen、CosyVoice、云端 provider
```

近期优先级：

1. 为每个 ASR/TTS/Voice Clone 插件补齐 capability contract、平台支持、依赖状态和 smoke test。
2. 把当前录音裁剪和 clone 流程升级为可保存、可复用、可删除的 Voice Profile。
3. 为语音任务增加统一 job/events 协议，支持取消、进度、重启后查询。
4. 提供 OpenAI-compatible audio API 与 MCP 语音工具，让外部 Agent 和客户端直接复用。
5. 把本地模型放到可选 sidecar/worker，默认安装保持轻量，模型按需下载。

## 参考事实

VoiceStudio 当前公开说明包含 Tauri + React/Vite + FastAPI + SQLite 的分层架构，支持 macOS、Windows、Linux、本地 REST/SSE/WebSocket、OpenAI-compatible audio API 和 MCP；其官方仓库 README 与语音平台文档分别说明了这些边界。

