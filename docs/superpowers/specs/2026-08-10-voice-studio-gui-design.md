---
title: Voice Studio GUI（已克隆音色 + 试听）
date: 2026-08-10
status: draft
related:
  - docs/superpowers/specs/2026-08-07-voice-studio-tools-design.md
  - docs/superpowers/specs/2026-08-10-voice-studio-gallery-design.md
  - docs/superpowers/plans/2026-08-10-voice-studio-gallery.md
  - 决策/qwen-audio-agent-celeb-clone-voices-gui.md
---

# Voice Studio GUI 设计

## 目标

在 RuntimeSettings 中选用本机已就绪的克隆音色（含刘震云 / 郭德纲 / 罗永浩·降噪定稿），支持：

1. **列表** — 看 label / provider / 是否当前生效  
2. **试听** — 用该 `remote_voice_id` 合成固定短句并播放（**不**重启 gateway）  
3. **选用** — 确认写入 cascade TTS 并重启 gateway（与 `voice_confirm` / `POST /api/runtime/cascade-tts` 同缝）

本阶段不做完整 clone 工作室（上传样本、选 preset enroll）。Agent 侧工具能力已有；GUI 先覆盖「选 + 听 + 上线」。

## 非目标

- 上传录音 / 在线 enroll UI  
- Fish / MiniMax 试听合成（一期仅 **DashScope** 音色可试听；其它 provider 可列表与选用，试听按钮禁用并提示）  
- CosyVoice 本地  
- 把名人 wav 提交进 git  

## 架构

```text
RuntimeSettings（TTS 分区）
  → GET  /api/voice/profiles
  → POST /api/voice/preview   → DashScope TTS WS → audio/wav
  → POST /api/voice/confirm   → VoiceStudioService.confirm → persistCascadeTts + restart
```

- HTTP 与 Realtime 工具共用 `VoiceStudioService`。  
- `ownerId` 取 HTTP identity（与 notes/memory 一致）。  
- `voiceStudioEnabled=false` 时路由返回 404/503，UI 隐藏音色块。

## HTTP

### `GET /api/voice/profiles`

Query：`status?`（默认只关心 `ready`+`confirmed`，或返回全部由前端过滤）。

响应：

```json
{
  "status": "ok",
  "profiles": [
    {
      "id": "...",
      "label": "刘震云·北大·降噪",
      "provider": "dashscope",
      "remote_voice_id": "qwen-audio-3.0-tts-flash-liudn-...",
      "target_model": "qwen-audio-3.0-tts-flash",
      "status": "ready"
    }
  ],
  "active": { "provider": "dashscope", "voice": "...", "model": "..." }
}
```

`active` 来自 service.`status`，用于高亮当前音色。

### `POST /api/voice/preview`

Body：

```json
{ "profile_id": "..." }
```

或 `{ "provider", "remote_voice_id", "model?" }`。

行为：

1. 解析 profile / remote id；非 dashscope → `400` + `preview_unsupported`  
2. 用 cascade 配置的 DashScope key + model（profile.`target_model` 优先）合成固定文案  
3. 返回 `audio/wav`（PCM16 mono wrap），或 JSON `{ audio_base64, mime, text }`（二选一：**推荐直接 `audio/wav`**，前端 `Blob` 播放）

固定试听文案（中文，一期写死，不开放任意文本以免滥用）：

> 大家好，这是音色试听。今天天气不错，我们聊聊生活里的小事。

超时：约 30–60s；失败返回 JSON `{ error, error_code }`。

并发：单进程简单串行或限 1 个 in-flight preview（避免打爆 TTS）。

### `POST /api/voice/confirm`

Body：与工具对齐：

```json
{ "profile_id": "...", "restart": true }
```

内部调用 `voiceStudioService.confirm(ownerId, input)`；  
非 cascade → `409 mode_conflict`；成功则 gateway 重启。

## UI（RuntimeSettings · TTS）

在现有 Provider / Model / Voice ID 表单**上方**增加：

**已克隆音色**

- 列表：`label`、`provider`、状态徽章；当前生效行标记「使用中」  
- 每行：  
  - **试听** — `fetch` preview → `URL.createObjectURL` → `Audio.play()`；播放中按钮变「停止」  
  - **选用** — confirm（二次确认文案：将重启 Gateway）  
- 空列表：提示「暂无 ready 音色；可用语音工具 clone，或导入 remote id」  
- 加载失败：沿用 settings `error` 行  

不新增顶层 Tab（避免设置分区膨胀）；音色与 cascade TTS 同区。

## 定稿三人音色

不硬编码进前端。依赖本机 `~/.config/qwaudio/voice-profiles/` 已 import 的 profile（开发机已有）。  
可选后置：gateway 启动时若缺失则从 `config/voice-presets/catalog` 引导——**本期不做**。

## 错误与权限

| 情况 | 表现 |
|---|---|
| 未启用 voice studio | UI 不展示块；API 503 |
| 非 cascade 选用 | 409，提示先切 cascade |
| 非 dashscope 试听 | 按钮 disabled + title 说明 |
| preview 失败 | 行内/全局 error，不重启 |
| confirm 失败 | 同现有 TTS 应用错误处理 |

## 测试

- HTTP：list / preview(mock synthesizer) / confirm(mock persist)  
- 前端：可测 refresh + 按钮 disabled 逻辑（轻量）；试听可用集成手测  

## 验收

1. 打开 **语音工作室 → 声音库**（或设置 · 音色跳转），能看到三人·降噪定稿  
2. 点试听能听到对应音色短句，**gateway 不重启**  
3. 点选用后重启，health 中 cascade voice 变为该 `remote_voice_id`  
4. 手写 Voice ID 在 **语音工作室 → 克隆** 仍可用  

## 分期

| 期 | 内容 |
|---|---|
| 一期（已完成） | list + preview(dashscope) + confirm + TTS 区 UI |
| 二期 | Gallery（收藏/标签筛选）+ A/B 对比试听 + 样本质量提示 — 见 [voice-studio-gallery-design.md](./2026-08-10-voice-studio-gallery-design.md) / [实现 plan](../plans/2026-08-10-voice-studio-gallery.md) |
| 启动台（已完成） | 顶层固定入口 Launchpad — 见 [voice-studio-launchpad-design.md](./2026-08-11-voice-studio-launchpad-design.md) |
| 后置 | 上传 clone、preset 一键 enroll、多供应商试听、Voice Design、portable 音色包、GUI 种子定稿音色 |
