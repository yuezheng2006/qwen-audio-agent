---
title: Voice Studio Launchpad（固定入口）
date: 2026-08-11
status: draft
related:
  - docs/superpowers/specs/2026-08-10-voice-studio-gallery-design.md
  - docs/superpowers/specs/2026-08-10-voice-studio-gui-design.md
  - docs/superpowers/plans/2026-08-11-voice-studio-launchpad.md
  - https://github.com/debpalash/VoiceStudio/blob/main/README_CN.md
---

# Voice Studio Launchpad 设计

## 目标

对照 [VoiceStudio README_CN](https://github.com/debpalash/VoiceStudio/blob/main/README_CN.md) 的**启动台**信息架构，在本仓 WebUI 提供顶层固定入口「语音工作室」，用磁贴导航已有能力；**不**整仓移植配音 / Demucs / 多引擎 / 听写壳。

本期：

1. **Launchpad** — 顶层 drawer + 磁贴网格  
2. **声音库** — 真实页（一期/二期 Gallery：定稿列表、试听、选用、A/B）  
3. **克隆** — 轻量页：`quality_tips` + 语音克隆指引 + 手动 Voice ID  
4. **设置 · 音色** — 精简为摘要 + 跳转工作室（避免双份 Gallery）

## 非目标

- HTTP enroll / 录音上传工作室 UI  
- Voice Design、视频配音、有声书、故事、系统听写  
- 14 TTS 引擎矩阵  
- 独立 Electron 窗（仍用 WebUI drawer，对齐微信读书面板）

## 入口

| 位置 | 行为 |
|---|---|
| WebUI header「语音工作室」 | 打开 `VoiceStudioPanel`，默认 `launchpad` |
| 设置 → 音色 | 「打开语音工作室」→ 同上（可直达 `gallery`） |
| 启动台「引擎设置」磁贴 | 关闭工作室并打开设置 → 模式 |
| 桌面 orb 设置钮 | 仍开 RuntimeSettings（不强制塞启动台） |

## 视图

```text
VoiceStudioPanel
  view: launchpad | gallery | clone
```

### Launchpad 磁贴

| id | 标题 | 状态 |
|---|---|---|
| gallery | 声音库 | live |
| clone | 克隆 | live |
| design | 声音设计 | soon |
| dub | 视频配音 | soon |
| audiobook | 有声书 | soon |
| stories | 故事模式 | soon |
| dictation | 听写 | soon |
| engines | 引擎设置 | jump → 设置·模式 |

### Gallery / Clone

- Gallery：复用 `GET/POST /api/voice/*`；默认隐藏名人试稿；友好短名。  
- Clone：`GET /api/voice/capabilities` tips；`POST /api/runtime/cascade-tts` 粘贴 Voice ID。

## 架构

```text
App header → VoiceStudioPanel
  → VoiceGallery（profiles / preview / confirm）
  → Clone 页（capabilities + cascade-tts）
RuntimeSettings · 音色 → onOpenVoiceStudio('gallery')
```

## 验收

- Header 有固定「语音工作室」；打开见启动台  
- 声音库可见定稿短名，可试听/选用  
- 克隆页有 tips + Voice ID  
- 设置音色不再堆完整 Gallery  
---

## 分期回链

- 一期 GUI：[2026-08-10-voice-studio-gui-design.md](./2026-08-10-voice-studio-gui-design.md)  
- 二期 Gallery：[2026-08-10-voice-studio-gallery-design.md](./2026-08-10-voice-studio-gallery-design.md)（入口迁至本 Launchpad）  
