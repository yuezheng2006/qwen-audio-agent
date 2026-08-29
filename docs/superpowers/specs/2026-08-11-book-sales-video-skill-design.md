---
title: 图书带货视频 Skill（作者配音）
date: 2026-08-11
status: active
related:
  - skills/book-sales-video/SKILL.md
  - docs/superpowers/specs/2026-08-11-voice-studio-launchpad-design.md
  - https://github.com/Kianzzz/book-sales-video
---

# 图书带货视频 Skill 设计

## 目标

在本仓自研 Codex Skill「图书带货视频」，流程与 OpenChatCut 交付契约对齐上游 [Kianzzz/book-sales-video](https://github.com/Kianzzz/book-sales-video)（MIT），配音改为 Voice Studio DashScope clone，并按书作者自动选声（如刘震云书 → `刘震云·北大·降噪`）。

## 非目标

- WebUI Launchpad「视频配音」磁贴（仍 `soon`）
- 豆包 TTS / `DOUBAO_*`
- 整仓移植上游以外的云端 ChatCut 路线

## 架构

```text
书名/飞书文案
  → WeRead 研究（author）
  → resolve_author_voice
  → 口播/分镜（唯一审核）
  → qwaudio_narrate → narration.wav + alignment
  → Pexels / image_gen / OpenChatCut
```

### 本仓核心

| 模块 | 职责 |
|---|---|
| `server/src/voice/studio/author-voice.mjs` | 作者 → profile（降噪/favorite 优先） |
| `server/src/voice/studio/narrate.mjs` | 句界合成 + PCM 对齐账本 |
| `POST /api/voice/narrate` | 同核 HTTP（Accept: json 可拿 report） |
| `skills/book-sales-video/` | Skill 主入口、预检、装配脚本 |

### 配音契约

与上游 `doubao_tts` report 对齐：

- 一个 `audio/narration.wav`
- `alignment.version = 2`
- `alignment.method = trimmed-pcm-duration-plus-fixed-join-pause`
- `segments[].startMs|endMs|durationMs|text|joinPauseAfterMs`

`provider` 记为 `qwaudio-dashscope`；附带 `voice_match`（作者匹配结果）。

## 安装

```bash
ln -sfn "$(pwd)/skills/book-sales-video" \
  "${CODEX_HOME:-$HOME/.codex}/skills/book-sales-video"
```

详见 [skills/book-sales-video/README.md](../../../skills/book-sales-video/README.md)。

## 验收

- 作者「刘震云」解析到降噪音色，不静默 fallback
- 无命中时 `fallback: true` 且消息可读
- 预检 `gates.qwaudioVoiceReady`，无 `doubaoReady`
- 多句 narrate 的 alignment 单调且含 join pause
