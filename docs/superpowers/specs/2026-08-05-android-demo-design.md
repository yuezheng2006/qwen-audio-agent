---
title: Android demo（examples）设计
date: 2026-08-05
status: approved
---

# Android demo（examples）设计

## 目标

在 `examples/android-demo/` 提供可演示的 Android 客户端：连接本仓 Gateway，完成实时语音对话。分两阶段：

1. **第一期**：薄 Demo App + 同仓 `:sdk` 模块（边界一次留好）
2. **第二期**（非本 spec）：提炼可发布 AAR / 任务权限 UI / 前台服务等

## 决策摘要

| 项 | 选择 |
| --- | --- |
| 用途 | 演示 + SDK 雏形（路线 C） |
| 技术 | 原生 Kotlin |
| 工程形态 | 双模块 Gradle：`:sdk` + `:app` |
| 第一期能力 | 连接、按住说话、听回复、字幕、文本发送、打断、状态/错误 |
| 连接 | 局域网 `ws://`（cleartext debug）+ 可选 `wss://` |
| 鉴权 | personal 无 token；预留 `authToken` |
| Gateway | **不改协议**；App 不 spawn / 不停 Gateway |

## 架构

```text
examples/android-demo/
  :sdk   → VoiceAgentClient（协议 / WS / PCM）
  :app   → Compose 单屏演示 UI
       ↓
Gateway WS /api/realtime + 可选 HTTP /api/health
```

音频契约与现有 Web/Desktop 一致：

- 上行：16 kHz PCM16，Base64，事件 `audio.append`
- 下行：24 kHz PCM16（以 `voice.ready` / `audio.delta` 为准），事件 `audio.delta`
- 连接：`connect`（含 `voiceEnabled` / `inputEnabled` / `clientType` 等）
- 文本：`text.message`
- 打断：`interrupt` + 本地停播；响应 `playback.clear`

## SDK 表面（第一期）

```kotlin
class VoiceAgentClient(config: VoiceAgentConfig) {
  fun connect()
  fun disconnect()
  fun startListening()
  fun stopListening()
  fun sendText(text: String)
  fun interrupt()
  val events: SharedFlow<VoiceAgentEvent>
}
```

包分层：`protocol` / `transport` / `audio` / `client`。

事件名对齐 `shared/realtime-events.mjs`（Kotlin 常量手写，不依赖 Node）。

## App UI（第一期）

单屏 Compose：URL、连接/断开、状态与错误、字幕、按住说话、文本发送、打断。

## 非目标（第一期）

- 任务卡 / 权限确认 UI
- 前台服务长驻、蓝牙深度优化
- Gateway 鉴权改造
- CI 强制编译 Android（可选后续）

## 验收

1. 本机 Gateway（cascade）运行，手机同一 Wi‑Fi  
2. App 填局域网 URL → 连接成功  
3. 按住说话 → 用户字幕 → TTS 播放 + 助手字幕  
4. 文本发送一轮成功  
5. 播放中打断成功  
6. 断网/关 Gateway 有断开提示，恢复后可重连  

## 仓库约定

- 工程位于 `examples/android-demo/`，不进根 npm workspace  
- `build/`、`.gradle/`、local 密钥 ignore  
- 说明文档：`examples/android-demo/README.md`
