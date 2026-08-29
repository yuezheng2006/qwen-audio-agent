---
title: Voice Studio Launchpad 实现计划
date: 2026-08-11
status: draft
related:
  - docs/superpowers/specs/2026-08-11-voice-studio-launchpad-design.md
---

# Voice Studio Launchpad 实现计划

**Architecture:** WebUI 顶层 drawer（对齐 WereadReaderPanel）；Gallery 抽组件；设置音色 Tab 只跳转。

**Design:** [docs/superpowers/specs/2026-08-11-voice-studio-launchpad-design.md](../specs/2026-08-11-voice-studio-launchpad-design.md)

## File map

| 文件 | 职责 |
|---|---|
| `web/src/voice-gallery.js` | 定稿过滤 / 友好名（已有） |
| `web/src/VoiceGallery.jsx` | Gallery UI + preview/confirm |
| `web/src/VoiceStudioPanel.jsx` | launchpad / gallery / clone |
| `web/src/App.jsx` | header 入口 |
| `web/src/RuntimeSettings.jsx` | 音色 Tab 精简 |
| `web/src/styles.css` | launchpad 样式 |
| `web/test/voice-gallery.test.mjs` | 过滤/命名回归 |
| `web/test/voice-studio-launchpad.test.mjs` | 磁贴清单 / view 默认 |

## Tasks

### Task 1: docs

- [x] Spec + 本 plan  
- [x] 回写 gallery design：入口改为 VoiceStudioPanel  

### Task 2: VoiceGallery extract

- [x] 从 RuntimeSettings 迁 Gallery 逻辑到 `VoiceGallery.jsx`  
- [x] `node --test web/test/voice-gallery.test.mjs`  

### Task 3: VoiceStudioPanel + wire

- [x] Panel + styles  
- [x] App header；RuntimeSettings 跳转  
- [x] `npm run build --workspace web`  

### Task 4: memory

- [x] 更新 vault decision（Launchpad 固定入口）  
