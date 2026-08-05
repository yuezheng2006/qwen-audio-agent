# 微信读书阅读面板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WebUI「阅读」抽屉对接微信读书 skill，面板内用千问峰哥 TTS 直接播金句/书评。

**Architecture:** `voice/reader/weread/*` 接入层 → `capability-routes` 挂 `/api/weread/*` → `WereadReaderPanel` 用 `<audio>` 播 WAV。不改 realtime-gateway / cascade session。

**Tech Stack:** Node ESM、Express、DashScope TTS synthesizer、React WebUI、微信读书 Agent Gateway。

## Global Constraints

- 底座不动：仅 capability HTTP + WebUI
- `WEREAD_API_KEY`；skill_version `1.0.4`
- TTS：`qwen-audio-3.0-tts-flash` + 峰哥 voice；speak **不传 instruction**
- 无整书正文；首版无热门书评、无 Desktop orb
- 不提交 git，除非用户明确要求

## File map

| Path | Responsibility |
|------|----------------|
| `server/src/voice/reader/weread/client.mjs` | Gateway HTTP + shelf/highlights/reviews |
| `server/src/voice/reader/weread/export.mjs` | 拼朗读文案 / 可选 md |
| `server/src/voice/reader/weread/speak.mjs` | TTS → WAV buffer |
| `server/src/voice/reader/weread/wav.mjs` | pcm16 → wav |
| `server/src/app/capability-routes.mjs` | 注册路由 |
| `server/test/weread-*.test.mjs` | 单测 |
| `web/src/WereadReaderPanel.jsx` | UI |
| `web/src/App.jsx` | Header「阅读」 |
| `web/src/styles.css` | 面板样式 |

---

### Task 1: weread client + export

**Files:**
- Create: `server/src/voice/reader/weread/client.mjs`
- Create: `server/src/voice/reader/weread/export.mjs`
- Create: `server/test/weread-client.test.mjs`

**Produces:**
- `createWereadClient({ apiKey, skillVersion, fetchImpl })`
- `client.shelf()` → `{ books, albums, total, recent, mp }`
- `client.highlights(bookId)` → `{ book, chapters, highlights }`
- `client.reviews(bookId)` → `{ bookId, reviews }`
- `buildSpeakScript({ title, mode, highlights, reviews, itemIds, maxChars })` → `{ text, truncated, count }`

- [x] Write failing tests for shelf total口径、highlights mapping、speak script trunc
- [x] Implement client + export
- [x] `npm run test --workspace server -- test/weread-client.test.mjs` PASS

---

### Task 2: speak → WAV

**Files:**
- Create: `server/src/voice/reader/weread/wav.mjs`
- Create: `server/src/voice/reader/weread/speak.mjs`
- Create: `server/test/weread-speak.test.mjs`

**Produces:**
- `pcm16ToWav(pcmBuffer, sampleRate)` → Buffer
- `speakWereadScript({ text, cascadeConfig, createSynthesizer })` → `{ wav, sampleRate, bytes }`
- Speak path forces `cascadeConfig.tts.instruction` cleared / omitted

- [x] Test wav header + fake synthesizer emits wav
- [x] Implement
- [x] Tests PASS

---

### Task 3: HTTP routes

**Files:**
- Modify: `server/src/app/capability-routes.mjs`
- Modify: `server/test/capability-routes.test.mjs`

**Produces:**
- `GET /api/weread/status`
- `GET /api/weread/shelf`
- `GET /api/weread/highlights?bookId=`
- `GET /api/weread/reviews?bookId=`
- `POST /api/weread/speak` → `audio/wav`
- Inject `weread` / `speakWeread` for tests; default from env `WEREAD_API_KEY`

- [x] Route tests with fake weread + fake speak
- [x] Wire routes
- [x] Tests PASS; dependency-boundaries PASS

---

### Task 4: WebUI panel

**Files:**
- Create: `web/src/WereadReaderPanel.jsx`
- Modify: `web/src/App.jsx`（header 按钮 + state，非 orb）
- Modify: `web/src/styles.css`

**Produces:**
- Tabs: 书架 / 金句 / 书评
- Speak via `fetch` blob → `<audio>`
- Stop revokes object URL

- [x] Implement panel + wire App
- [x] `npm run build --workspace web` (or existing web test) succeeds
- [x] Manual: gateway + 阅读抽屉

---

### Task 5: Verify

- [x] `npm run test --workspace server` full green
- [x] Restart gateway; smoke shelf + speak with real key if present
- [x] Update memory vault one line if stable

## Spec coverage

| Spec item | Task |
|-----------|------|
| shelf / highlights / reviews API | 1, 3 |
| speak WAV panel playback | 2, 3, 4 |
| no instruction TTS | 2 |
| no orb / no full book | 4 scope |
| WEREAD key 503 | 3 |
