# WeKnora + document-buddy 知识增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 语音 Agent 以薄工具调用接入 WeKnora 素材检索与 document-buddy 项目 wiki 纪律；不做 WebUI 知识 CMS；默认可降级到现网 local md。

**Architecture:** WeKnora 作旁路检索中台（`KnowledgeProvider` 加法）；document-buddy 作 MCP 只读投影；MinerU / `KNOWLEDGE_DIR` 保留 MD-first 备份与离线兜底。详见 `docs/superpowers/specs/2026-08-05-weknora-document-buddy-knowledge-design.md`。

**Tech Stack:** Node ESM、现有 `KnowledgeProvider` 契约、CapabilityRegistry MCP 投影、WeKnora REST（实现期）、document-buddy stdio MCP。

## Global Constraints

- 在 upstream 上加法；不改 cascade session / realtime-gateway 主路径知识逻辑
- 不嵌入两套管理台到 WebUI
- 不提交密钥；document-buddy 侧不存飞书 token / LLM key
- **本计划文档阶段不写业务代码**；下列 checkbox 供后续实现 agent 勾选
- 第一步必须是**可独立验证的旁路 PoC**（不依赖语音 UI / 不依赖本仓大改）

## File map（实现期预期）

| Path | Responsibility |
|------|----------------|
| `server/src/knowledge/weknora-provider.mjs` | WeKnora HTTP → KnowledgeProvider |
| `server/src/knowledge/resolve.mjs` / `provider.mjs` | 注册 `weknora` kind |
| `server/src/core/config.mjs` / `.env.example` | env 缝 |
| `docs/configuration.md` | 文档 |
| `config/frontend-agent/PROMPT.md` | 检索/引用纪律 |
| `~/.config/qwaudio/capabilities/mcp/document-buddy.json`（或 `MCP_SERVERS_JSON`） | 只读白名单 |
| `server/test/weknora-provider.test.mjs` | mock 契约测 |
| `examples/knowledge/weknora-smoke.mjs`（可选） | 旁路 smoke |
| `docs/content-ingest-rag.md` | 补一句与 WeKnora 分工（可选薄改） |

**明确不碰：** `realtime-gateway.mjs` 大改、`cascade/**` 主循环、WebUI CMS、WeKnora/document-buddy 上游源码。

---

### Task 0: 旁路 PoC（第一步，可独立验收）

> 不改本仓业务代码也可做前半段；后半段再接 provider。目标：证明「材料在 WeKnora → 检索命中」链路，与语音解耦。

**Produces:**

- 一份本地 runbook 笔记（可放 `examples/knowledge/README.md`）记录 `WEKNORA_BASE_URL`、测试 KB id、scoped API Key（不入库）
- curl / 脚本输出：health + search hits（含 source/snippet）

**Commands（实现期参考；按 WeKnora 当时 OpenAPI 微调路径）：**

```bash
# 0a. （仅实现期）按官方文档私有化拉起 WeKnora —— 本设计任务刻意不执行
# 参见 https://github.com/Tencent/WeKnora README_CN「快速开始」

# 0b. 健康检查（路径以实际部署为准）
curl -sS -o /tmp/weknora-health.json -w "%{http_code}\n" \
  "$WEKNORA_BASE_URL/health"
# 期望：HTTP 200，body 表示服务可用

# 0c. 混合检索（Header / path 以官方 API 文档为准；以下为占位）
curl -sS "$WEKNORA_BASE_URL/api/v1/knowledge-bases/$WEKNORA_KB_ID/search" \
  -H "Authorization: Bearer $WEKNORA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"验收用关键词","top_k":5}'
# 期望：JSON 含 ≥1 条 hit，字段可映射到 { title, snippet, sourceId/url, score }
```

**验收：**

- [ ] WeKnora 对测试语料返回可映射的检索命中（人工看一眼 snippet 相关）
- [ ] 全程不打开本仓 WebUI、不改 `realtime-gateway`
- [ ] 失败时能说清是「服务未起 / Key / KB 空」中的哪一类

**本仓零依赖预检（设计已满足，实现前可再跑）：**

```bash
# 确认现网 local knowledge 契约仍在
node --test server/test/content-ingest.test.mjs 2>/dev/null || true
grep -n "KNOWLEDGE_PROVIDER_KINDS" server/src/knowledge/provider.mjs
grep -n "knowledge_search" server/src/voice/frontend-tools.mjs
```

- [ ] 确认 `KnowledgeProvider` 契约与 `knowledge_search` 入口仍存在（无需改代码）

---

### Task 1: weknora KnowledgeProvider（加法）

**Files:**

- Create: `server/src/knowledge/weknora-provider.mjs`
- Modify: `server/src/knowledge/provider.mjs`（kinds）
- Modify: `server/src/knowledge/resolve.mjs`
- Create: `server/test/weknora-provider.test.mjs`

**Produces:**

- `createWeknoraKnowledgeProvider({ baseUrl, apiKey, kbIds, timeoutMs, fetchImpl, fallbackLocal? })`
- `search` → hits 对齐 local 形状（至少 `text`/`title`/`score`/`source`）
- `health` → reachable + latency
- `ingest` / `listSources`：远端语义（list 调 WeKnora；ingest 可为 no-op 或触发 reindex API）
- `KNOWLEDGE_PROVIDER=weknora` 时 bootstrap 自动注入

- [ ] 写失败单测（mock fetch：命中映射、超时、401）
- [ ] 实现 provider + resolve
- [ ] `node --test server/test/weknora-provider.test.mjs` PASS
- [ ] `KNOWLEDGE_PROVIDER=local` 既有测试不回归

---

### Task 2: 配置与文档缝

**Files:**

- Modify: `server/src/core/config.mjs`
- Modify: `.env.example`
- Modify: `docs/configuration.md`
- Optional: `shared/runtime-environment.mjs`（若 UI 要暴露 health 字段）

**Env：**

| 变量 | 默认 | 说明 |
|------|------|------|
| `KNOWLEDGE_PROVIDER` | `local` | `local\|none\|weknora` |
| `WEKNORA_BASE_URL` | 空 | 如 `http://127.0.0.1:8080` |
| `WEKNORA_API_KEY` | 空 | scoped Key |
| `WEKNORA_KB_IDS` | 空 | 逗号分隔；空则用账号默认 |
| `WEKNORA_TIMEOUT_MS` | `8000` | 语音友好超时 |
| `WEKNORA_FALLBACK_LOCAL` | `0` | `1` 时远端失败回落 `KNOWLEDGE_DIR` |

- [ ] 文档写清：管理仍在 WeKnora UI；本仓无 CMS
- [ ] `.env.example` 无真实密钥

---

### Task 3: HTTP / 语音薄验收

**Files:**

- 通常**不改** `capability-routes.mjs`（已吃 store 契约）
- 必要时补 `server/test/capability-routes.test.mjs` mock weknora store

**验收：**

```bash
# Gateway 已起且 KNOWLEDGE_PROVIDER=weknora 时
curl -sS -X POST http://127.0.0.1:${PORT:-8787}/api/knowledge/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"验收用关键词","limit":5}'
```

- [ ] `/api/knowledge` health 反映 weknora
- [ ] cascade 一轮语音问素材题，模型调用 `knowledge_search` 且答案贴命中
- [ ] WeKnora 停掉 + `WEKNORA_FALLBACK_LOCAL=1` → 仍能搜本地 md（若已镜像）

---

### Task 4: document-buddy MCP 投影（P1）

**Files / config:**

- User config: `MCP_SERVERS_JSON` 或 `capabilities/mcp/document-buddy.json`
- Modify: `config/frontend-agent/PROMPT.md`（纪律段）
- Optional test: MCP whitelist 投影单测（已有 project-tools 则复用模式）

**示例配置（实现期写入用户 config，勿提交密钥）：**

```json
[
  {
    "name": "document_buddy",
    "command": "python",
    "args": ["-m", "work_memory.mcp_server"],
    "env": {
      "WORK_MEMORY_DATA_DIR": "/path/to/document-buddy-data"
    },
    "whitelist": [
      "query_project_wiki",
      "get_cited_context",
      "list_review_items"
    ],
    "allowDangerous": false
  }
]
```

**验收：**

- [ ] `GET /api/capabilities` 见 `mcp__document_buddy__query_project_wiki`（命名以投影规则为准）
- [ ] 项目问题：有 citations 才作答；无证据明确说没有
- [ ] 写入类工具（`ingest_text` 等）**未**投影到语音前台
- [ ] 素材问题仍走 `knowledge_search`，不误用 wiki

---

### Task 5: MD-first 备份约定（P1 运维，可选代码）

**Produces:**

- runbook：哪些语料只进 WeKnora、哪些 `npm run content:import -- --index-knowledge`
- 可选脚本：从 WeKnora 导出 md → `KNOWLEDGE_DIR`（若官方 API 支持；否则人工导出）

- [ ] `docs/content-ingest-rag.md` 增加与 WeKnora 分工小节（MinerU=朗读管道；WeKnora=企业检索）
- [ ] 双库不一致策略写进配置文档（online 以 WeKnora 为准）

---

### Task 6: 回归与收尾

- [ ] `node --test server/test/weknora*.test.mjs server/test/content-ingest.test.mjs`（及 capability 相关）PASS
- [ ] `KNOWLEDGE_PROVIDER` 缺省 / `local` / `none` / `weknora` 四种行为手验或单测覆盖
- [ ] 确认未改 realtime-gateway / cascade 主循环
- [ ] 更新记忆库项目笔记（若实现完成）：接线缝 + 未决 API 字段结论

---

## 建议实施顺序

1. **Task 0** 旁路 curl PoC（阻塞后续真实联调）
2. Task 1–3 WeKnora → `knowledge_search`
3. Task 4 document-buddy 纪律
4. Task 5–6 备份约定与回归

## 非目标（计划内不做）

- Docker Compose 并进本仓默认启动脚本
- WebUI 双管理台
- 语音路径调用 WeKnora ReAct Agent
- 把 episode / user_memory 迁入 WeKnora
