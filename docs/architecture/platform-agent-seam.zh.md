# Agent / Platform 解耦规范

状态：Draft v0.1（2026-08-31）  
适用范围：qwen-audio-agent 的跨端客户端、语音运行时、插件和 Agent 接入。

## 目标

把产品拆成两个可以独立演进的模块：

```text
Client（macOS / Windows / iOS / Android / Web / TUI）
                         │
                         ▼
                 Platform Protocol
                         │
             ┌───────────┴───────────┐
             ▼                       ▼
       Local Agent Adapter       Remote Agent Adapter
             │                       │
             ▼                       ▼
          Agent Core             外部 Agent
```

- **Agent** 负责理解、推理、记忆、工具、任务和权限。
- **Platform** 负责录音、播放、ASR、TTS、音色、模型、插件和设备。
- Agent 只调用 Platform 的能力契约，不依赖任何具体语音引擎。
- Platform 可以没有 Agent 独立完成录音、转写、朗读和音色管理。
- Local Agent 是默认路径；云端 Agent、云端 ASR/TTS 和远程 Worker 都必须显式配置。

## 非目标

- 不在本规范中定义 Agent 的提示词、推理策略或模型选择算法。
- 不把 VoiceStudio 的实现代码移入本仓库；只借鉴工作区、生命周期和协议思想。
- 不把 Python、PyTorch 或某个 TTS/ASR SDK 作为 Platform Core 的硬依赖。
- 不让 UI 直接读取插件内部配置、数据库或模型目录。

## 领域职责

### Agent Core

稳定对象：`Session`、`Message`、`Memory`、`Task`、`Tool`、`Permission`、`AgentDelivery`。

Agent Core 可以提出以下意图，但不实现音频细节：

```text
speech.transcribe   将音频变成文本
speech.synthesize   将文本变成音频
speech.clone        从样本创建 Voice Profile
audio.interrupt     停止当前播报
voice.profile.list  查询可用声音
```

### Platform Core

稳定对象：`AudioSession`、`VoiceProfile`、`Capture`、`ModelRuntime`、`Plugin`、`PlatformJob`。

Platform Core 必须负责：

- 设备权限、采集格式、播放队列和打断。
- 本地/远程数据边界和用户可见提示。
- 引擎能力、安装状态、平台支持和健康检查。
- 长任务的进度、取消、重试、恢复和诊断。
- 将内部引擎错误归一化为用户可理解的错误。

### Media Platform 分层约束

媒体能力采用四层，依赖只能向下：

```text
Media Workspace / Client UI
            ↓ 只读 Job snapshot、提交用户意图
Media Orchestrator
            ↓ 调度阶段、保存 checkpoint、管理 artifact
Media Adapters
            ↓ 调用具体引擎
Engine / System Tools（FFmpeg、WhisperX、VoxCPM2、翻译服务）
```

- Agent Core 只能提交媒体目标和用户选项，不能 import FFmpeg、Whisper、Torch 或供应商 SDK。
- UI 只能依赖 `MediaJob` snapshot、阶段事件和公开 artifact，不能读中间目录或进程状态。
- Orchestrator 只能通过 Adapter contract 调用引擎；供应商格式、命令行参数和模型路径必须停留在 Adapter 内。
- Adapter 不得创建 Agent Session、修改 Memory 或直接驱动 UI；失败必须返回结构化错误。
- 任何远程翻译、远程 TTS 或远程 Worker 都必须在 Job 的 privacy 状态中显式记录。
- 新增媒体阶段先增加 contract 与 fake-adapter 测试，再接入真实引擎；不得从 UI 反向定义引擎接口。

## Capability Contract

第一版能力名采用稳定的点号命名：

| 能力 | 输入 | 输出 | 默认数据边界 |
| --- | --- | --- | --- |
| `audio.record` | 设备、采样率、时长上限 | `Capture` | local |
| `audio.play` | 音频引用、播放策略 | 播放状态事件 | local |
| `audio.interrupt` | `session_id` 或 `playback_id` | 确认事件 | local |
| `speech.transcribe` | `Capture` 或音频引用 | 文本、分段、置信度可选 | local-first |
| `speech.synthesize` | 文本、`voice_profile_id` | 音频引用、流式音频 | local-first |
| `speech.clone` | 经过确认的样本 | `VoiceProfile` | local-first |
| `voice.profile.list` | owner、过滤条件 | profile 列表 | local |
| `voice.profile.select` | profile id | 当前声音状态 | local |

能力调用的最小形状：

```json
{
  "type": "platform.capability.request",
  "request_id": "req_01",
  "capability": "speech.synthesize",
  "owner_id": "user_personal",
  "input": {
    "text": "任务已经完成。",
    "voice_profile_id": "voice_01"
  },
  "options": {
    "stream": true,
    "data_policy": "local_only"
  }
}
```

结果和进度使用同一关联 ID：

```json
{
  "type": "platform.capability.event",
  "request_id": "req_01",
  "capability": "speech.synthesize",
  "phase": "completed",
  "data": {
    "audio_ref": "capture://audio_01",
    "format": "wav",
    "sample_rate": 24000
  },
  "privacy": {
    "data_boundary": "local"
  }
}
```

实现必须保证：请求可关联、事件有序、取消幂等、重连后可查询最终状态；内部路径、API Key、原始供应商 payload 不得进入 Agent 或普通 UI。

## Plugin Manifest

现有 Plugin API v1 继续作为加载和权限生命周期；Platform 插件额外遵守下列字段约定：

```json
{
  "id": "qwaudio.stt.faster-whisper",
  "version": "1.0.0",
  "apiVersion": "1",
  "kind": "stt",
  "label": "Faster-Whisper",
  "capabilities": ["speech.transcribe"],
  "platforms": ["macos", "windows", "linux"],
  "runtime": "local-sidecar",
  "dataBoundary": "local",
  "permissions": ["audio.microphone"],
  "healthcheck": {
    "kind": "http",
    "url": "http://127.0.0.1:8000/health"
  }
}
```

约束：

- 一个插件可以声明多个能力，但每个能力都必须有可测试的 Adapter。
- `runtime` 只能是 `builtin`、`local-sidecar`、`remote` 三类之一。
- `dataBoundary` 只能是 `local`、`local-first`、`remote-explicit`。
- `remote-explicit` 能力必须在调用前返回用户可见的远程处理提示。
- 插件不可直接修改 Agent Session、Memory 或 Permission；必须通过 Platform 接口。
- 缺失依赖进入 `unavailable`，不得伪装成 `ready`。

## Voice Profile

`VoiceProfile` 是 Platform 的对象，不属于 Agent 私有状态：

```text
VoiceProfile {
  id
  owner_id
  label
  source                 // recorded | imported | preset | generated
  provider
  runtime                // local | remote
  target_model?
  sample_refs[]
  status                 // draft | processing | ready | selected | failed
  capabilities[]
  created_at
  updated_at
}
```

Agent 只能通过 profile id 使用声音；不能保存或拼接供应商 Voice ID。供应商 Voice ID 只能存在 Platform Adapter 和 profile 的受控内部字段中。

## Local Agent First

默认路由：

```text
本地录音 → 本地 Agent → 本地 ASR/TTS → 本地播放
```

当本地能力不存在时，Platform 必须按顺序：

1. 展示缺失能力和安装建议。
2. 允许用户选择已配置的远程 Adapter。
3. 明确提示音频、文本或 Voice Profile 将离开本机。
4. 记录本次选择，但不得静默改变默认数据边界。

## 客户端形态

所有第一方客户端共享 Platform Protocol，不共享 UI 实现：

| 客户端 | 负责 | 不负责 |
| --- | --- | --- |
| macOS | 全局快捷键、麦克风、悬浮胶囊、文字回填 | Agent 推理、引擎细节 |
| Windows | 快捷键、设备权限、系统托盘 | Agent 推理、引擎细节 |
| iOS / Android | 移动录音、通知、会话 UI | 本地模型强绑定 |
| Web | 浏览器录音、工作台、会话 | 访问本机文件系统 |
| TUI / CLI | 命令、脚本、批任务 | 图形交互 |

Voice Studio 是 Platform 的一个工作区；聊天首页、任务中心和记忆属于 Agent 客户端层。

## 版本和兼容

- 复用现有 Gateway Client Protocol 6.0，不新建第二条客户端 WebSocket。
- Platform 能力在 `health.capabilities` 中按能力位声明。
- 新增能力向后兼容；修改已有输入/输出语义必须升级 Platform Contract 主版本。
- Agent 对未知能力必须降级为文本或明确不可用，不得阻塞会话。
- REST、WebSocket、MCP、CLI 都投影到同一个 Capability Contract；实现不能各自定义语义。

## 迁移计划

### P0：契约和现有能力归位

- [ ] 增加 Platform Capability 常量和校验器。
- [ ] 为现有 Voice Studio、Faster-Whisper、Cascade TTS 补齐 manifest 元数据。
- [ ] `VoiceProfile` 和 `Capture` 从 UI state 中独立出来。
- [ ] `/api/voice/*` 标注为 Platform REST 投影，继续保持兼容。
- [x] MediaJob 阶段、状态和 artifact 引用模型。
- [x] 带时间轴的转写和分段翻译 Adapter contract。

### P1：Local Agent 闭环

- [ ] Local Agent Adapter 调用 `speech.transcribe` / `speech.synthesize`。
- [ ] 全局听写胶囊和 Agent 播报共用 `audio.record` / `audio.play` 状态机。
- [ ] 统一语音任务的进度、取消、恢复和诊断。

### P2：开放接入

- [ ] 发布 Platform SDK 的 JavaScript / Python 最小客户端。
- [ ] 发布 MCP 工具投影和 OpenAI-compatible audio 投影。
- [ ] 支持本地 Sidecar 和远程 Worker，统一健康检查和授权提示。

### 验收标准

- 替换 Faster-Whisper 为另一种 ASR，不改 Agent Core 和第一方 UI。
- 替换 Local Agent 为外部 Agent，不改 Voice Profile 和音频数据面。
- 关闭所有云端 Key 后，录音、导入、profile 管理和已安装本地模型仍可用。
- 一个能力从 REST、WebSocket、MCP 调用时产生相同的结果语义和隐私提示。
- 进程重启或客户端重连后，未完成 Platform Job 可查询，不重复执行不可重入操作。
