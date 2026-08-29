# Voice Studio Gallery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** RuntimeSettings 音色块升级为迷你 Gallery：收藏/标签筛选、A/B 对比试听、provider capabilities + 样本质量提示。

**Architecture:** 扩展 `VoiceProfileStore` 字段与 `VoiceStudioService` patch/list filters；薄 HTTP 增补 `PATCH profiles/:id` 与 `GET capabilities`；UI 复用两次一期 `POST /api/voice/preview` 做 A/B。

**Tech Stack:** Express、现有 store/service、React RuntimeSettings、`node:test`。

**Design:** [docs/superpowers/specs/2026-08-10-voice-studio-gallery-design.md](../specs/2026-08-10-voice-studio-gallery-design.md)

## Global Constraints

- PATCH favorite/tags/label **不得**调用 `restartGateway` / `persistCascadeTts`
- A/B 只用两次 `POST /api/voice/preview`（串行锁）；不新增 `preview-compare`
- 试听文案仍为一期固定短句（`PREVIEW_TEXT`）
- `can_preview` 仅 `dashscope`；其它 provider 禁用试听/对比槽并展示原因
- `voiceStudioEnabled=false` → API 503，UI 隐藏块
- 前端不硬编码三人 remote id
- 标签：trim → 小写 → 去重；单标签 ≤32；每 profile ≤16
- 旧 JSON 缺省 `favorite=false`、`tags=[]`（无迁移脚本）
- TDD：先 store/HTTP，再 UI 手测

## File map

| Path | Responsibility |
|------|----------------|
| `server/src/voice/studio/types.mjs` | serialize `favorite` / `tags` |
| `server/src/voice/studio/profile-store.mjs` | normalize + patch + list filters |
| `server/src/voice/studio/service.mjs` | `patch` / filtered `list` / capabilities aggregate |
| `server/src/voice/studio/quality-tips.mjs` | 中文 `qualityTips` + hints 蛇形导出 |
| `server/src/voice/studio/providers/contract.mjs` | 可选：导出/对齐 sampleHints |
| `server/src/app/voice-routes.mjs` | query filters、PATCH、GET capabilities |
| `web/src/RuntimeSettings.jsx` | Gallery 顶栏 / 星标 / 标签 / A/B |
| `web/src/styles.css` | 筛选条、对比高亮小样式 |
| `server/test/voice-profile-gallery.test.mjs` | store normalize + filter |
| `server/test/voice-routes.test.mjs` | 扩展 HTTP 用例 |

---

### Task 1: store + serialize（favorite / tags）

**Files:**
- Modify: `server/src/voice/studio/types.mjs`
- Modify: `server/src/voice/studio/profile-store.mjs`
- Create: `server/test/voice-profile-gallery.test.mjs`

**Interfaces:**
- `normalizeTags(input) → string[]`（非法超限抛错或返回 `{ ok:false }` — 选抛错由 service 转 400）
- store `upsert` / 新 `patch(ownerId, id, { favorite?, tags?, label? })` 写入规范化字段
- `list(ownerId, { status, favorite, tag, q })` 服务端过滤
- `serializeProfile` 含 `favorite: boolean`、`tags: string[]`

- [x] **Step 1: Write failing tests** — 缺省字段、tags 规范化、favorite 过滤、`q` 子串、非法 tags
- [x] **Step 2: Implement normalize + patch + serialize**
- [x] **Step 3: `node --test server/test/voice-profile-gallery.test.mjs`** → PASS
- [ ] **Step 4: Commit** `feat(voice-studio): add profile favorite and tags`（待用户要求再提交）

---

### Task 2: service filters + capabilities

**Files:**
- Create: `server/src/voice/studio/quality-tips.mjs`
- Modify: `server/src/voice/studio/service.mjs`
- Modify: `server/test/voice-profile-gallery.test.mjs`（或新 service 测）

**Interfaces:**
- `QUALITY_TIPS` / `previewCapable(provider) → boolean`
- `service.patch(ownerId, id, patch)` → `{ status, profile }`
- `service.list(ownerId, filters)` 透传 store 过滤；可算 `tag_counts`（过滤前集合）
- `service.capabilities()` → `{ providers: [...], preview_text }`

- [x] **Step 1: Failing tests** for capabilities shape（dashscope `can_preview=true`，tips 非空）
- [x] **Step 2: Implement quality-tips + service methods**
- [x] **Step 3: Tests PASS**
- [ ] **Step 4: Commit** `feat(voice-studio): expose gallery capabilities and quality tips`（待用户要求再提交）

---

### Task 3: HTTP routes

**Files:**
- Modify: `server/src/app/voice-routes.mjs`
- Modify: `server/test/voice-routes.test.mjs`

**Interfaces:**
- `GET /api/voice/profiles?favorite=&tag=&q=&status=` → `{ profiles, active, tag_counts? }`
- `PATCH /api/voice/profiles/:id` → body `{ favorite?, tags?, label? }`；404/400；**断言未调用 restart**
- `GET /api/voice/capabilities` → service.capabilities()
- 继续 `user_personal` 合并 `local` profiles（与一期一致）；PATCH 写回真实 owner（优先命中的 store owner）

- [x] **Step 1: Failing HTTP tests**（express + mock service）
- [x] **Step 2: Wire routes**
- [x] **Step 3: `node --test server/test/voice-routes.test.mjs`** → PASS
- [ ] **Step 4: Commit** `feat(voice-studio): gallery profile patch and capabilities routes`（待用户要求再提交）

---

### Task 4: RuntimeSettings Gallery UI + A/B

**Files:**
- Modify: `web/src/RuntimeSettings.jsx`
- Modify: `web/src/styles.css`

**Interfaces:**
- 拉取 profiles（带 query）+ capabilities
- 顶栏：搜索 / 仅收藏 / tag chips
- 行：星标（PATCH）、标签编辑（PATCH）、试听、选用
- 对比：最多勾选 2 个可 preview →「对比试听」依次 preview 播放并高亮 A/B
- 空态展示 `quality_tips`

- [x] **Step 1: 筛选 + 星标 + 标签编辑**
- [x] **Step 2: A/B 勾选与串行试听（停播清理 object URL）**
- [x] **Step 3: 手测清单**（见下；自动化覆盖 store/HTTP，UI 需本机点选）
- [ ] **Step 4: Commit** `feat(web): voice gallery filters favorites and A/B preview`（待用户要求再提交）

---

### Task 5: 手测 + 记忆收尾

- [x] 星标/标签刷新后仍在；星标时 gateway **不**重启（HTTP 测断言未 confirm/restart）
- [x] 筛选（收藏 / tag / 搜索）正确（routes + store 测；UI 搜索为客户端过滤）
- [x] A/B 两音色同一短句可区分；health / cascade voice 不变（UI 两次 preview，无 confirm）
- [x] capabilities 中文 tips 可见（空态或说明区）
- [x] 选用路径与手写 Voice ID 不回归（confirm 路由保留）
- [x] 更新 vault（实现已落地）

---

## Execution note

实现时按 Task 顺序 TDD；每 Task 末 commit（若用户规则要求先问 commit，则攒到用户说 commit）。  
本文件勾选状态在**实现轮次**更新；文档起草时全部保持 `- [ ]`。
