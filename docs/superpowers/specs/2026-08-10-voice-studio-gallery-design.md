---
title: Voice Studio Gallery（收藏 / A/B / 样本提示）
date: 2026-08-10
status: draft
related:
  - docs/superpowers/specs/2026-08-10-voice-studio-gui-design.md
  - docs/superpowers/specs/2026-08-07-voice-studio-tools-design.md
  - docs/superpowers/specs/2026-08-11-voice-studio-launchpad-design.md
  - docs/superpowers/plans/2026-08-10-voice-studio-gallery.md
  - https://github.com/debpalash/VoiceStudio
---

# Voice Studio Gallery 设计（二期）

## 目标

在一期「选 + 听 + 上线」之上，提供迷你 **Voice Gallery**（收藏字段 / A/B / 样本提示），对齐 [debpalash/VoiceStudio](https://github.com/debpalash/VoiceStudio) 中可复用的产品习惯（非整仓移植）。

**入口（2026-08-11）：** Gallery 挂在顶层 [Voice Studio Launchpad](./2026-08-11-voice-studio-launchpad-design.md) 的「声音库」页；RuntimeSettings · 音色仅跳转，不再承载完整 Gallery。

1. **Gallery** — profile 支持收藏与标签；列表可搜索；GUI 默认只展示定稿（名人·降噪）  
2. **A/B 对比试听** — 勾选最多两个音色，用同一固定短句依次试听（**不**重启 gateway）  
3. **样本质量提示** — 暴露各 provider 的 enroll / preview 能力与中文 `qualityTips`（可行动，非空话）

Agent 侧 clone / confirm 工具一期已有；本期强化 **GUI 管理与对比**，并给未来上传 enroll UI 预留 tips 数据源。

## 非目标

- Voice Design（描述式性别/年龄/口音生成）  
- 可移植音色包（`.ovsvoice` 一类）  
- Stories / 有声书多角色编辑器  
- 视频配音、Demucs 人声分离、说话人分离、批量队列  
- 14 TTS 引擎矩阵 / Tauri 桌面听写壳  
- `POST /api/voice/preview-compare`（默认客户端两次 `preview`；体验差再加）  
- 开放任意试听文案（仍用一期固定短句）  
- 多供应商试听合成（仍仅 DashScope `canPreview=true`）

## 与 VoiceStudio 对照

| VoiceStudio | 本仓落点 | 本期 |
|---|---|---|
| Voice Gallery（收藏 / 标签 / 筛选） | `favorite` + `tags` + list 查询 + UI 迷你 Gallery | 做 |
| A/B comparison + preview widget | 双槽勾选 + 两次 `POST /api/voice/preview` 串行播放 | 做 |
| 样本质量 FAQ（5–15s、安静、单人、干声） | `qualityTips` + `GET /api/voice/capabilities` | 做 |
| 引擎能力前置校验（无 clone 则明确失败） | capabilities 含 `canEnroll` / `canPreview`；UI 禁用并给原因 | 做（轻量） |
| Voice Design / Dub / Audiobook / Dictation / 多引擎 | — | 不做 |

## 架构

```text
VoiceStudioPanel（声音库 · Gallery）
  → GET    /api/voice/profiles?favorite&tag&q&status
  → PATCH  /api/voice/profiles/:id     → store（不重启）
  → GET    /api/voice/capabilities     → providers + tips
  → POST   /api/voice/preview  ×2      → A/B（复用一期，串行锁）
  → POST   /api/voice/confirm          → 选用（一期，会重启）
```

- HTTP 与 Realtime 工具继续共用 `VoiceStudioService`。  
- `ownerId` 取 HTTP identity；`user_personal` 仍合并历史 `local` owner（与一期 routes 一致）。  
- `voiceStudioEnabled=false` → API 503，UI 隐藏块。

## 数据模型

在现有 `VoiceProfile` 上**直接加字段**（无后向兼容包袱）。读旧 JSON 时缺省：

- `favorite` → `false`  
- `tags` → `[]`

```text
VoiceProfile += {
  favorite: boolean
  tags: string[]   // 如 celebrity / denoise / zh；小写 trim；去重
}
```

序列化（`serializeProfile`）对外 JSON：

```json
{
  "id": "...",
  "label": "刘震云·北大·降噪",
  "provider": "dashscope",
  "remote_voice_id": "...",
  "target_model": "qwen-audio-3.0-tts-flash",
  "status": "ready",
  "favorite": true,
  "tags": ["celebrity", "denoise", "zh"]
}
```

标签规则：

- 存贮层规范化：`trim` → 小写 → 非空 → 去重；单标签最长 32；每 profile 最多 16 个  
- 建议种子（实现时可写进三人定稿或文档，不硬编码进前端筛选逻辑）：`celebrity`、`denoise`、`zh`

## HTTP

### `GET /api/voice/profiles`

Query（均可选，与现有 `status` 并存）：

| 参数 | 含义 |
|---|---|
| `status` | 按状态过滤（一期已有） |
| `favorite` | `1` / `true` → 仅收藏 |
| `tag` | 精确匹配某一个 tag（规范化后） |
| `q` | 子串匹配 `label` / `remote_voice_id` / `provider`（大小写不敏感） |

响应同上一期，每项多 `favorite`、`tags`；另可附：

```json
{
  "status": "ok",
  "profiles": [ "..."],
  "active": { "provider": "dashscope", "voice": "...", "model": "..." },
  "tag_counts": { "denoise": 3, "celebrity": 3 }
}
```

`tag_counts` 基于**过滤前**该 owner 可见集合聚合，供 UI chip 用。

### `PATCH /api/voice/profiles/:id`

Body（字段均可选，至少一项）：

```json
{ "favorite": true, "tags": ["celebrity", "denoise"], "label": "新显示名" }
```

行为：

1. 找到 profile（含 `user_personal`↔`local` 合并规则下的可见项）；找不到 → `404`  
2. 规范化并写入 store；**禁止**调用 `persistCascadeTts` / `restartGateway`  
3. 返回 `{ status: "ok", profile }`

非法 tags / 超限 → `400` + `invalid_tags`。

### `GET /api/voice/capabilities`

```json
{
  "status": "ok",
  "providers": [
    {
      "id": "dashscope",
      "can_enroll": true,
      "can_import_id": true,
      "can_preview": true,
      "needs_public_url": true,
      "sample_hints": { "min_sec": 3, "max_sec": 30, "formats": ["wav", "mp3", "m4a"] },
      "quality_tips": [
        "录 5–15 秒连续自然说话（约 8 秒最佳），不要越长越好",
        "安静近场、无混响无背景音乐；嘈杂样本会克隆出嘈杂音色",
        "单一说话人；语气与目标用途接近（朗读/聊天）"
      ]
    },
    {
      "id": "fish",
      "can_enroll": true,
      "can_import_id": true,
      "can_preview": false,
      "preview_reason": "preview_unsupported",
      "sample_hints": { "...": "..." },
      "quality_tips": ["..."]
    }
  ],
  "preview_text": "大家好，这是音色试听。今天天气不错，我们聊聊生活里的小事。"
}
```

- `can_preview`：一期规则写死为 `provider === 'dashscope'`（与 preview 路由一致）。  
- `quality_tips`：中文短句数组，来自共享常量（可按 provider 微调）。  
- `sample_hints`：对齐 `DEFAULT_SAMPLE_HINTS` / 各 provider `capabilities()`，JSON 用蛇形。

### A/B 试听

不新增 compare 端点。UI：

1. 勾选最多 2 个可 preview 的 profile  
2. 「对比试听」→ 依次 `POST /api/voice/preview`（串行，沿用模块级 preview lock）  
3. 播放时高亮当前槽（A 或 B）；同一 `PREVIEW_TEXT`  
4. 全程不得 confirm / persist

若日后锁竞争或延迟不可接受，再加 `POST /api/voice/preview-compare`（非本期）。

## UI（RuntimeSettings · 音色）

升级现有「已克隆音色」块，不新开顶层 Tab：

1. **顶栏**：搜索框（`q`）、「仅收藏」、标签 chip（来自 `tag_counts`，点选即 `tag` 筛选）  
2. **行**：显示名 / provider / 状态 / 使用中；操作：星标、试听、选用；可选标签编辑（逗号分隔 → PATCH）  
3. **对比模式**：行首勾选（最多 2）；工具条「对比试听」在选满 2 且均可 preview 时启用  
4. **空态 / 不可 preview**：展示 `quality_tips` 与 `preview_reason` 说明（对齐「可行动错误」）  
5. 选用 / 手写 Voice ID +「应用 TTS」路径保持一期行为

## 错误与权限

| 情况 | 表现 |
|---|---|
| 未启用 voice studio | UI 隐藏；API 503 |
| PATCH 未知 id | 404 |
| PATCH 非法 tags | 400 `invalid_tags` |
| 非 dashscope 试听 / 对比槽 | 禁用 + capabilities 原因 |
| preview 失败 | 行内/全局 error，不重启 |
| confirm | 同一期（可重启） |

## 测试

- Store：缺省 favorite/tags；规范化；list 过滤  
- HTTP：profiles query / PATCH / capabilities；PATCH 不触发 restart（mock 断言）  
- Preview 锁：A/B 两次串行仍成功（可沿用现有 preview 测试）  
- UI：筛选、星标、对比勾选上限 — 手测 + 必要时轻量逻辑测  

## 可选种子（实现时）

三人定稿 profile 可补默认 tags：`["celebrity","denoise","zh"]`，不强制改已有本机 JSON（用户可自行标星/打标）。

## 验收

1. 收藏 / 标签 PATCH 后刷新仍在；星标不重启 gateway  
2. `favorite` / `tag` / `q` 筛选结果正确；chip 计数合理  
3. A/B 对比同一短句、两音色可区分；全程不 `persistCascadeTts`  
4. `GET /api/voice/capabilities` 中 dashscope `can_preview=true`，`quality_tips` 中文可读  
5. 一期选用 / 手写 Voice ID 路径不回归  

## 分期

| 期 | 内容 |
|---|---|
| 一期（已完成） | list + preview(dashscope) + confirm + TTS 区 UI |
| **本期（二期）** | Gallery favorite/tags + A/B + capabilities/qualityTips |
| 后置 | 上传 clone UI、preset 一键 enroll、多供应商试听、Voice Design、portable 音色包、长内容多角色 |
