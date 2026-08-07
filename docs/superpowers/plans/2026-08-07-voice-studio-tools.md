# Voice Studio Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Realtime Agent 增加通用 Voice Studio 工具族（预设 / clone / import / confirm / list / status + `audio_transcribe`），云端三家+ListenHub import，确认音色走现有 cascade TTS 持久化缝。

**Architecture:** `VoiceStudioService` 编排；`VoiceProfileStore` 按 owner 落盘；`VoiceCloneProvider` 适配器隔离厂商；工具经 `CapabilityRegistry` 注入（对齐 episode-memory）。详见 `docs/superpowers/specs/2026-08-07-voice-studio-tools-design.md`。

**Tech Stack:** Node ESM、`node:test`、现有 `CapabilityRegistry`、`persistCascadeTts`、DashScope/Fish/MiniMax HTTP。

## Global Constraints

- 工具 schema **禁止**各家专有字段名（只用 `remote_voice_id` / `provider` / `preset_id` 等通用名）
- `voice_confirm` **必须**复用 `persistCascadeTts`；默认重启 gateway（与 RuntimeSettings 一致）；单测 mock，不真重启
- 缺 key / enroll 不支持 → 明确错误码，**不假装成功**
- 预设不预置任何云端 remoteId；不捆绑未授权名人原声
- `VOICE_STUDIO=0` 时不注册工具；默认开启
- 加法：不改 cascade session 主循环；不实现 CosyVoice / 本地 Whisper（二期）
- 频繁小提交；每 Task 末尾 commit（实现 agent 执行时）

## File map

| Path | Responsibility |
|------|----------------|
| `server/src/voice/studio/types.mjs` | 常量、序列化 helpers |
| `server/src/voice/studio/profile-store.mjs` | per-owner JSON store |
| `server/src/voice/studio/preset-catalog.mjs` | 读 `config/voice-presets/catalog.json` |
| `server/src/voice/studio/sample-resolver.mjs` | file/url/preset → enroll sample |
| `server/src/voice/studio/providers/contract.mjs` | 文档化合同 + assert helper |
| `server/src/voice/studio/providers/dashscope.mjs` | enroll + importId |
| `server/src/voice/studio/providers/fish.mjs` | enroll（或 enroll_unsupported）+ importId |
| `server/src/voice/studio/providers/minimax.mjs` | 同上 |
| `server/src/voice/studio/providers/listenhub.mjs` | importId only |
| `server/src/voice/studio/providers/registry.mjs` | 按 config/env 组装 providers |
| `server/src/voice/studio/service.mjs` | clone/import/confirm/list/status/transcribe |
| `server/src/voice/studio/asr.mjs` | 第一期云端文件 ASR（或 `asr_unavailable`） |
| `server/src/capabilities/tools/voice-studio.mjs` | 工具定义 + handlers |
| `config/voice-presets/catalog.json` | 4 条演示预设元数据 |
| `config/voice-presets/samples/.gitkeep` | 样本目录占位 |
| `config/voice-presets/README.md` | license / 放置样本说明 |
| `server/src/core/config.mjs` | `voiceStudioEnabled` / `voiceProfileDir` / `voicePresetsDir` |
| `server/src/capabilities/resolve.mjs` | 注册工具 |
| `.env.example` / `docs/configuration.md` | 文档缝 |
| `server/test/voice-profile-store.test.mjs` | store |
| `server/test/voice-preset-catalog.test.mjs` | catalog |
| `server/test/voice-clone-providers.test.mjs` | mock HTTP adapters |
| `server/test/voice-studio-service.test.mjs` | 状态机 |
| `server/test/voice-studio-tools.test.mjs` | 工具 handler |

**明确不碰：** `cascade/session.mjs` 主循环、CosyVoice Python runner、RuntimeSettings 大改（可读列表后置）。

---

### Task 1: VoiceProfileStore + 配置缝

**Files:**
- Create: `server/src/voice/studio/types.mjs`
- Create: `server/src/voice/studio/profile-store.mjs`
- Create: `server/test/voice-profile-store.test.mjs`
- Modify: `server/src/core/config.mjs`（加 voice studio 字段）
- Modify: `.env.example`

**Interfaces:**
- Produces: `createVoiceProfileStore({ dir })` → `{ upsert, get, list, updateStatus }`
- Produces: profile shape with `remoteId`（存储层）；`serializeProfile(profile)` → 工具字段含 `remote_voice_id`
- Produces config: `voiceStudioEnabled`, `voiceProfileDir`, `voicePresetsDir`

- [ ] **Step 1: Write failing test**

```js
// server/test/voice-profile-store.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createVoiceProfileStore } from '../src/voice/studio/profile-store.mjs'
import { serializeProfile } from '../src/voice/studio/types.mjs'

test('voice profile store upsert list and serialize remote_voice_id', () => {
  const dir = mkdtempSync(join(tmpdir(), 'voice-profiles-'))
  try {
    const store = createVoiceProfileStore({ dir })
    const row = store.upsert('owner', {
      label: '沉稳男声',
      source: 'preset',
      presetId: 'demo-calm-male',
      provider: 'dashscope',
      remoteId: 'voice-abc',
      status: 'ready',
    })
    assert.ok(row.id)
    assert.equal(store.list('owner').length, 1)
    assert.equal(store.get('owner', row.id).remoteId, 'voice-abc')
    const json = serializeProfile(row)
    assert.equal(json.remote_voice_id, 'voice-abc')
    assert.equal('remoteId' in json, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
node --test server/test/voice-profile-store.test.mjs
```

Expected: FAIL module not found

- [ ] **Step 3: Implement types + store**

`types.mjs`：导出 `VOICE_PROFILE_STATUSES`、`serializeProfile`（把 `remoteId` → `remote_voice_id`，剥离 `providerPayload` 或标为省略）。

`profile-store.mjs`：对齐 `createLocalEpisodeStore` 模式——`~/.config/.../voice-profiles/<owner>.json`，结构 `{ version: 1, profiles: [] }`，`upsert` 合并按 `id`，缺省 `randomUUID` + timestamps。

`config.mjs` 增加：

```js
voiceStudioEnabled: !['0', 'false', 'off', 'no'].includes(
  String(process.env.VOICE_STUDIO ?? '1').trim().toLowerCase(),
),
voiceProfileDir: process.env.VOICE_PROFILE_DIR
  ? resolve(process.env.VOICE_PROFILE_DIR)
  : resolve(runtimeEnvironment.configDirectory, 'voice-profiles'),
voicePresetsDir: process.env.VOICE_PRESETS_DIR
  ? resolve(process.env.VOICE_PRESETS_DIR)
  : resolve(config.root || process.cwd(), 'config/voice-presets'),
```

（若 `config.root` 已有则用之；否则用仓库根解析方式与现有 `knowledgeDir` 一致。）

`.env.example` 在 EPISODE 附近加：

```bash
# VOICE_STUDIO=1
# VOICE_PROFILE_DIR=
# VOICE_PRESETS_DIR=
```

- [ ] **Step 4: Run test — expect PASS**

```bash
node --test server/test/voice-profile-store.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add server/src/voice/studio/types.mjs server/src/voice/studio/profile-store.mjs \
  server/test/voice-profile-store.test.mjs server/src/core/config.mjs .env.example
git commit -m "$(cat <<'EOF'
feat(voice-studio): add VoiceProfile store and config flags

EOF
)"
```

---

### Task 2: Preset catalog（4 条演示元数据）

**Files:**
- Create: `config/voice-presets/catalog.json`
- Create: `config/voice-presets/samples/.gitkeep`
- Create: `config/voice-presets/README.md`
- Create: `server/src/voice/studio/preset-catalog.mjs`
- Create: `server/test/voice-preset-catalog.test.mjs`

**Interfaces:**
- Produces: `loadPresetCatalog(dir)` → `{ list({ query? }), get(id), resolveSamplePath(id) }`
- Public list items: `{ id, label, locale, tags, durationSec, license }` — **无绝对路径**

- [ ] **Step 1: Write failing test**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import { loadPresetCatalog } from '../src/voice/studio/preset-catalog.mjs'

const dir = join(process.cwd(), 'config/voice-presets')

test('preset catalog lists four demo voices without absolute paths', () => {
  const catalog = loadPresetCatalog(dir)
  const items = catalog.list()
  assert.equal(items.length, 4)
  assert.ok(items.every(i => i.id && i.label && i.license === 'demo'))
  assert.ok(items.every(i => !('path' in i) && !('relativePath' in i)))
  const hit = catalog.list({ query: '沉稳' })
  assert.equal(hit[0].id, 'demo-calm-male')
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
node --test server/test/voice-preset-catalog.test.mjs
```

- [ ] **Step 3: Add catalog.json + loader**

`catalog.json` 四条：`demo-calm-male` / `demo-warm-female` / `demo-bright-female` / `demo-story-male`；每条 `sample.relativePath` 如 `samples/demo-calm-male.wav`，`license: "demo"`。样本文件可暂缺；`resolveSamplePath` 返回绝对路径，文件不存在时由 service 报 `sample_missing`。

README 说明：仅演示；用户可自行放入 wav；商用需自备授权音频。

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(voice-studio): add demo voice preset catalog

EOF
)"
```

---

### Task 3: Provider 合同 + ListenHub / DashScope adapters

**Files:**
- Create: `server/src/voice/studio/providers/contract.mjs`
- Create: `server/src/voice/studio/providers/listenhub.mjs`
- Create: `server/src/voice/studio/providers/dashscope.mjs`
- Create: `server/test/voice-clone-providers.test.mjs`

**Interfaces:**
- Produces: provider object with `id`, `capabilities()`, `enroll()`, `importId()`, `normalizeError()`
- DashScope enroll：`POST https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization`，body 使用 `voice-enrollment` + `create_voice`（或当前文档的 `qwen-voice-enrollment`/`create`——**以官方文档为准，实现时用 mock 固定请求形状**）
- ListenHub：`canEnroll: false`；`enroll` 抛/返回 unsupported；`importId` 原样登记

- [ ] **Step 1: Write failing tests（mock fetch）**

```js
test('listenhub cannot enroll but can import id', async () => {
  const p = createListenHubCloneProvider()
  assert.equal(p.capabilities().canEnroll, false)
  assert.equal(p.capabilities().canImportId, true)
  await assert.rejects(
    () => p.enroll({ label: 'x', sample: { kind: 'url', url: 'https://x' } }),
    /enroll_unsupported|cannot enroll/i,
  )
  const imported = await p.importId({ label: 'x', remoteId: 'speaker-1' })
  assert.equal(imported.remoteId, 'speaker-1')
})

test('dashscope enroll posts customization and returns remoteId', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) })
    return {
      ok: true,
      status: 200,
      json: async () => ({ output: { voice: 'fenggetts-demo-001' } }),
    }
  }
  const p = createDashScopeCloneProvider({
    apiKey: 'sk-test',
    fetchImpl,
    targetModel: 'qwen-audio-3.0-tts-flash',
  })
  const out = await p.enroll({
    label: 'demo',
    sample: { kind: 'url', url: 'https://example.com/a.wav' },
  })
  assert.equal(out.remoteId, 'fenggetts-demo-001')
  assert.ok(String(calls[0].url).includes('customization'))
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
node --test server/test/voice-clone-providers.test.mjs
```

- [ ] **Step 3: Implement ListenHub + DashScope**

DashScope `needsPublicUrl: true` **或** 支持 `sample.kind==='data_uri'` 时设 `needsPublicUrl: false`（优先 data URI，减少公网依赖）。`importId` 只校验非空并返回。

`normalizeError`：HTTP 非 2xx → `{ error_code: 'enroll_failed', user_message: '音色克隆失败。', retryable: true/false }`。

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(voice-studio): add ListenHub and DashScope clone providers

EOF
)"
```

---

### Task 4: Fish + MiniMax adapters + provider registry

**Files:**
- Create: `server/src/voice/studio/providers/fish.mjs`
- Create: `server/src/voice/studio/providers/minimax.mjs`
- Create: `server/src/voice/studio/providers/registry.mjs`
- Modify: `server/test/voice-clone-providers.test.mjs`（追加用例）

**Interfaces:**
- Produces: `createVoiceCloneProviders(config, { fetchImpl })` → `Map<string, provider>`
- Fish/MiniMax：有可用 enroll API + key → `canEnroll: true`；否则 `canEnroll: false`，`enroll` → throw/reject with `enroll_unsupported`（**不得假造 remoteId**）
- `importId` 两家均可用

- [ ] **Step 1: Write failing tests**

```js
test('fish importId works; enroll unsupported when disabled', async () => {
  const p = createFishCloneProvider({ apiKey: 'k', enrollEnabled: false })
  assert.equal(p.capabilities().canEnroll, false)
  const imported = await p.importId({ label: 'f', remoteId: 'ref-1' })
  assert.equal(imported.remoteId, 'ref-1')
})

test('registry exposes dashscope fish minimax listenhub', () => {
  const map = createVoiceCloneProviders({
    dashscopeApiKey: 'k',
    fishApiKey: 'k',
    minimaxApiKey: 'k',
  })
  for (const id of ['dashscope', 'fish', 'minimax', 'listenhub']) {
    assert.ok(map.get(id))
  }
})
```

- [ ] **Step 2–4: Implement + pass tests**

实现期查阅各家最新 clone HTTP；若合同不清，保持 `enrollEnabled: false` 默认，仅测试 importId；DashScope 为第一期必通 enroll。

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(voice-studio): add Fish MiniMax providers and registry

EOF
)"
```

---

### Task 5: SampleResolver + VoiceStudioService（clone/import/confirm）

**Files:**
- Create: `server/src/voice/studio/sample-resolver.mjs`
- Create: `server/src/voice/studio/service.mjs`
- Create: `server/test/voice-studio-service.test.mjs`

**Interfaces:**
- Consumes: store, catalog, providers map, `persistCascadeTts`, `restartGateway?`
- Produces:

```js
createVoiceStudioService({
  store,
  catalog,
  providers,
  getActiveCascade: () => ({ provider, voice, model }),
  persistCascadeTts,
  restartGateway, // (opts) => void; 单测传 no-op / spy
  defaultProvider, // 当前 cascade provider
})
// methods:
// listPresets({ query })
// clone(ownerId, { provider?, preset_id?, sample_url?, sample_path?, label?, target_model? })
// importVoice(ownerId, { provider, remote_voice_id, label?, target_model? })
// confirm(ownerId, { profile_id?, provider?, remote_voice_id?, restart? })
// list(ownerId, { status? })
// status(ownerId)
```

- [ ] **Step 1: Write failing service tests**

```js
test('clone preset with mock provider then confirm persists voice', async () => {
  // tmp store + catalog pointing at fixture wav OR mock resolver
  // provider.enroll returns remoteId 'v1'
  // confirm calls persistCascadeTts({ provider:'dashscope', voice:'v1' })
  // restartGateway called once when restart!==false
  // profile.status === 'confirmed'
})

test('clone listenhub returns enroll_unsupported guidance', async () => {
  // expect error_code enroll_unsupported / user_message 提到 voice_import
})

test('default provider listenhub without explicit provider fails', async () => {
  // getActiveCascade.provider === 'listenhub'
  // clone without provider → error_code provider_required
})
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement resolver + service**

`sample-resolver.mjs`：

- `preset` → catalog path；不存在 → `sample_missing`
- `path` → 绝对/相对（限制在 presets dir 或 tmp；**禁止**任意路径穿越）
- `url` → 校验 http(s)
- 若 provider `needsPublicUrl` 且只有本地 file：优先转 `data:` URI（读文件 base64）；仍不行再报 `sample_url_required`

`clone` 状态机：创建 `draft` → `cloning` → `ready`/`failed`。

`confirm`：找 profile → 校验 `ready|confirmed` + remoteId → `persistCascadeTts` → 可选 `restartGateway` → `confirmed`。

- [ ] **Step 4: Run — expect PASS**

```bash
node --test server/test/voice-studio-service.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(voice-studio): add sample resolver and studio service

EOF
)"
```

---

### Task 6: Capability 工具 + resolve 接线

**Files:**
- Create: `server/src/capabilities/tools/voice-studio.mjs`
- Create: `server/test/voice-studio-tools.test.mjs`
- Modify: `server/src/capabilities/resolve.mjs`
- Modify: `server/src/app/bootstrap.mjs`（构造 service 并传入 resolve）
- Modify: `docs/configuration.md`（简短一节）

**Interfaces:**
- Produces tools: `voice_list_presets`, `voice_clone`, `voice_import`, `voice_confirm`, `voice_list`, `voice_status`
- `createVoiceStudioTools({ service })` → registry entries（同 episode 模式）
- `resolveCapabilityRegistry(config, { episodeStore, voiceStudioService })`
- `VOICE_STUDIO=0` 或无 service → 不注册

- [ ] **Step 1: Write failing tool tests**

```js
test('voice tools list presets and clone via service', async () => {
  const tools = createVoiceStudioTools({ service: fakeService })
  const list = tools.find(t => t.name === 'voice_list_presets')
  const out = await list.handler({ query: '沉稳' }, { ownerId: 'o' })
  assert.equal(out.status, 'ok')
  assert.ok(Array.isArray(out.presets))
  // 断言 presets 项无 path 字段
})

test('voice_confirm without owner fails', async () => {
  const confirm = tools.find(t => t.name === 'voice_confirm')
  const out = await confirm.handler({ profile_id: 'x' }, {})
  assert.equal(out.error_code, 'missing_owner')
})
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement tools + wire**

工具 description 用中文口语场景（对齐 web_search / episode）。

`bootstrap.mjs`：

```js
const voiceStudioService = config.voiceStudioEnabled
  ? createVoiceStudioService({ /* store, catalog, providers, persistCascadeTts, restartGateway */ })
  : null
const capabilityRegistry = await resolveCapabilityRegistry(config, {
  episodeStore,
  voiceStudioService,
})
```

`restartGateway`：抽取与 `app.post('/api/runtime/cascade-tts')` 相同的 `spawn(start-gateway.mjs)` 逻辑为小函数（可放 `scripts/lib/runtime-config-file.mjs` 旁或 `server/src/app/restart-gateway.mjs`），HTTP 与 tool 共用。

- [ ] **Step 4: Run tests**

```bash
node --test server/test/voice-studio-tools.test.mjs server/test/capability-tools.test.mjs
```

Expected: PASS（若 `capability-tools.test.mjs` 断言工具列表，更新期望含 voice_* 或保持 mock registry）

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(voice-studio): register realtime voice studio tools

EOF
)"
```

---

### Task 7: `audio_transcribe` 工具（云端或明确不可用）

**Files:**
- Create: `server/src/voice/studio/asr.mjs`
- Modify: `server/src/voice/studio/service.mjs`（`transcribe`）
- Modify: `server/src/capabilities/tools/voice-studio.mjs`
- Modify: `server/test/voice-studio-service.test.mjs` / `voice-studio-tools.test.mjs`

**Interfaces:**
- Produces: `transcribe({ source, language, provider })` → `{ status, segments, text, provider }` 或 `{ error, error_code: 'asr_unavailable', ... }`
- 第一期：若实现 DashScope 文件 ASR，用 mock 测；否则 `auto` 直接 `asr_unavailable` 且 `user_message` 说明暂不可用——**schema 仍注册**，保证二期只换实现

- [ ] **Step 1: Write failing test**

```js
test('audio_transcribe returns asr_unavailable when no backend', async () => {
  const out = await service.transcribe('owner', {
    source: { kind: 'url', url: 'https://example.com/a.wav' },
    language: 'zh',
    provider: 'auto',
  })
  // 若未配置 ASR：
  assert.equal(out.error_code, 'asr_unavailable')
})
```

若实现了 DashScope 文件 ASR，另加 mock 成功用例：`segments[0].text` 非空。

- [ ] **Step 2–4: Implement + pass**

工具名：`audio_transcribe`；parameters：`source`（object）、`language`、`provider`。

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(voice-studio): add audio_transcribe tool schema and cloud/stub ASR

EOF
)"
```

---

### Task 8: 文档收尾 + 冒烟清单

**Files:**
- Modify: `docs/configuration.md`
- Modify: `config/voice-presets/README.md`（若需补放置样本步骤）
- Optional: `docs/superpowers/specs/2026-08-07-voice-studio-tools-design.md` 链到本 plan

- [ ] **Step 1: 文档写清**

- `VOICE_STUDIO` / 目录 env
- 工具名列表与「confirm 会重启 gateway」
- 预设 license
- ListenHub 仅 import

- [ ] **Step 2: 跑相关测试**

```bash
node --test server/test/voice-*.test.mjs server/test/runtime-config-file.test.mjs
```

Expected: PASS

- [ ] **Step 3: 手工冒烟（有 DashScope key 时）**

1. 放入一条短 wav 到 `config/voice-presets/samples/demo-calm-male.wav`
2. 语音说「列出声音预设」→ `voice_list_presets`
3. 「用沉稳男声克隆」→ `voice_clone`
4. 「确认用这个音色」→ `voice_confirm` → gateway 重启 → 新会话音色生效

- [ ] **Step 4: Commit docs**

```bash
git commit -m "$(cat <<'EOF'
docs(voice-studio): document voice studio tools and presets

EOF
)"
```

---

## Spec coverage checklist

| Spec 项 | Task |
|---------|------|
| VoiceProfile store | 1 |
| 通用工具字段 / remote_voice_id | 1, 6 |
| Preset catalog 4 demo | 2 |
| DashScope enroll | 3 |
| Fish/MiniMax/ListenHub | 3, 4 |
| enroll_unsupported 不假装成功 | 3–5 |
| SampleResolver | 5 |
| clone/import/confirm/list/status | 5, 6 |
| persistCascadeTts + restart | 5, 6 |
| VOICE_STUDIO=0 | 1, 6 |
| audio_transcribe schema + asr_unavailable/cloud | 7 |
| 文档 | 8 |
| CosyVoice / 本地 ASR / 多角色 workspace | 明确不做 |

## Plan self-review

- 无 TBD 占位步骤；Fish/MiniMax enroll 允许降级为 import-only，但有明确错误码
- 命名统一：`remoteId` 存储 / `remote_voice_id` 工具
- HTTP `/api/voice/*` 按 YAGNI 未列入；需要公网 URL 时优先 data URI
