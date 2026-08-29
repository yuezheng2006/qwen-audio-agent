# Voice Studio GUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** RuntimeSettings TTS 区可列出本机克隆音色、DashScope 试听（不重启）、选用并 `voice_confirm` 重启 gateway。

**Architecture:** 薄 HTTP `/api/voice/*` 包一层已有 `VoiceStudioService`；`preview` 用 cascade DashScope TTS WS 合成固定短句返回 `audio/wav`；UI 嵌在现有 TTS section。

**Tech Stack:** Express、现有 `createSynthesizer`、React RuntimeSettings、`node:test`。

## Global Constraints

- 试听**不得**调用 `restartGateway` / `persistCascadeTts`
- 试听一期仅 `provider === 'dashscope'`；其它禁用按钮
- 试听文案固定：`大家好，这是音色试听。今天天气不错，我们聊聊生活里的小事。`
- confirm 复用 `VoiceStudioService.confirm`（与工具同缝）
- `voiceStudioEnabled=false` → API 503，UI 隐藏块
- 前端不硬编码三人 remote id
- TDD：先测 HTTP，再 UI 手测

## File map

| Path | Responsibility |
|------|----------------|
| `server/src/voice/studio/preview.mjs` | DashScope 短句 → wav Buffer |
| `server/src/app/voice-routes.mjs` | GET profiles / POST preview / POST confirm |
| `server/src/app/bootstrap.mjs` | 注册 routes，注入 service + cascade config |
| `server/src/app/capability-routes.mjs` | 可选：仅改 bootstrap 注册，不塞进 capability-routes 亦可 |
| `web/src/RuntimeSettings.jsx` | TTS 区「已克隆音色」列表 |
| `web/src/styles.css` | 列表/按钮小样式 |
| `server/test/voice-preview.test.mjs` | pcm→wav + preview helper mock |
| `server/test/voice-routes.test.mjs` | HTTP 行为 |

---

### Task 1: preview helper（PCM → WAV + synthesizer seam）

**Files:**
- Create: `server/src/voice/studio/preview.mjs`
- Create: `server/test/voice-preview.test.mjs`

**Interfaces:**
- Produces: `PREVIEW_TEXT` 常量
- Produces: `pcm16ToWav(pcmBuffer, sampleRate)` → `Buffer`
- Produces: `synthesizeVoicePreview({ apiKey, model, voice, sampleRate, createSynthesizer, text? })` → `Promise<Buffer>` (wav)

- [x] **Step 1: Write failing tests** for `pcm16ToWav` header + duration math；mock synthesizer 收集 onAudio
- [x] **Step 2: Implement `preview.mjs`**
- [x] **Step 3: `node --test server/test/voice-preview.test.mjs`** → PASS
- [x] **Step 4: Commit** `feat(voice-studio): add dashscope preview synthesizer helper`

---

### Task 2: HTTP `/api/voice/*`

**Files:**
- Create: `server/src/app/voice-routes.mjs`
- Create: `server/test/voice-routes.test.mjs`
- Modify: `server/src/app/bootstrap.mjs`（`registerVoiceRoutes`）

**Interfaces:**
- Consumes: `voiceStudioService.list/status/confirm`；`synthesizeVoicePreview`
- Produces routes:
  - `GET /api/voice/profiles` → `{ status, profiles, active }`
  - `POST /api/voice/preview` body `{ profile_id }` → `audio/wav` 或 JSON error
  - `POST /api/voice/confirm` body `{ profile_id, restart? }` → service confirm JSON
- In-flight preview：模块级 Promise 链或 flag，第二请求 `429 preview_busy`

- [x] **Step 1: Failing HTTP tests**（express + mock service + mock preview）
- [x] **Step 2: Implement `voice-routes.mjs` + wire bootstrap**
- [x] **Step 3: Tests PASS**
- [x] **Step 4: Commit** `feat(voice-studio): expose /api/voice profiles preview confirm`

---

### Task 3: RuntimeSettings UI

**Files:**
- Modify: `web/src/RuntimeSettings.jsx`
- Modify: `web/src/styles.css`

**Interfaces:**
- Consumes: `/api/voice/profiles`、`/preview`、`/confirm`
- UI：TTS section 顶部「已克隆音色」；试听用 `Audio`；选用走 confirm + `waitForHealth`

- [x] **Step 1: 拉 profiles；渲染列表 + 使用中标记**
- [x] **Step 2: 试听 / 停止；非 dashscope disabled**
- [x] **Step 3: 选用 → confirm → 刷新 health + profiles**
- [x] **Step 4: Commit** `feat(web): add cloned voice list preview and confirm in settings`

---

### Task 4: 手测清单 + 记忆收尾

- [x] cascade 模式打开设置 → 看到三人·降噪
- [x] 试听不重启；选用后 voice 生效
- [x] 更新 vault open loop（GUI 已接）
- [x] Commit docs if needed（spec 已存在则只改 plan checkboxes）

---

## Execution note

实现时用 `executing-plans` 或本会话直接按 Task 顺序 TDD；每 Task 末 commit（用户未禁止时可提交；若用户规则要求先问 commit，则攒到用户说 commit）。
