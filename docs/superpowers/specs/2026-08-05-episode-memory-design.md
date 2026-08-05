# 情节记忆 + 主动召回（P0）

日期：2026-08-05  
定位：智能 + 陪伴 + 个性 + **懂你**  
约束：在 upstream 上做加法；原文件只薄接线。

## 目标

跨会话记住用户说过的互动事实（粗粒度情节），在 prompt 中主动召回，支撑「第 N 次还懂你」。  
纠正 / 遗忘走工具；不默认写入 `long_term`。

## 非目标

- 完整 memory consolidation 写回 long_term
- 人格回归 harness / 风格判别
- WebUI 情节管理面
- 改 `user_memory` 协议或 `memory-scopes`

## 数据流

1. 用户 turn final transcript → `shouldCaptureTurn` → `episodeStore.append`（`source=auto`）
2. connect / 刷新 → `selectEpisodesForPrompt` → `agentContext.recalledEpisodes`
3. `buildFrontendContext` → `## Recent Episodes`（数据段，非指令）
4. `episode_correct` / `episode_forget`（CapabilityRegistry）→ 更新 store → 刷新召回
5. `consolidateEpisodes` stub：仅日志 / 空 proposed

## 加法边界

| 新模块 | 薄接线 |
|--------|--------|
| `server/src/conversation/episode/*` | `bootstrap` DI |
| `capabilities/tools/episode-memory.mjs` | `capabilities/resolve` register |
| | `frontend-agent-context` 可选段 |
| | `realtime-gateway` append + recall |
| | `config` / `.env.example` / runtime-environment |

## 字段

`id, at, role, content, source, confidence, ttlDays`

- auto：`confidence=0.5`；correct 后 `source=user`、`confidence=0.9`
- 每 owner 最多 200 条 FIFO
- prompt Top-K 默认 5（`EPISODE_PROMPT_LIMIT`）

## 开关

`EPISODE_MEMORY=0` → noop store，行为与现网一致。

## 召回坑（已修）

连接时若只按「最近 N 条」灌 prompt，环境闲聊会把真实事实挤掉；Cascade 还会在 refresh 前开跑本轮 LLM。  
对策：收紧 `shouldCaptureTurn`（裸问句 / 低信息 ASR）；无 query 时优先 `isMemorableFact` 再取 Top-K。

## Cascade 路径说明

日常 `npm run gateway:start`（cascade）**不需要改** `cascade/session.mjs`：

- Cascade 是 Gateway 背后的 Realtime Provider。
- 写入：`transcription.completed` → Gateway `noteUserEpisode` → episode store。
- 召回：connect / refresh → `recalledEpisodes` → `buildFrontendInstructions` → cascade `session.instructions`。
- 工具：Capability registry → `getRealtimeTools()` → cascade `session.tools`。

契约单测：`server/test/episode-cascade-contract.test.mjs`。

## 手验清单（多会话召回）

主路径用 cascade（`gateway:start` / `gateway:cascade`）：

1. 会话 A：说一句可检索事实（如「我下周要去上海出差」）→ 确认不过滤（非嗯啊/过短）。
2. 断开后开会话 B（同 `ownerId`）：助手应能用上该事实（instructions 含 `## Recent Episodes`）。
3. 工具：让模型 `episode_correct` / `episode_forget` → 下一轮召回更新。
4. `EPISODE_MEMORY=0` 重启后：不落盘、不注入、无情节工具副作用。
5. 落盘：`~/.config/qwaudio/episodes/<owner>.json`（或 `EPISODE_DIR`）。

单测：`node --test server/test/episode-*.test.mjs`。

离线冒烟：`node examples/episodes/smoke.mjs`（`local/` 已 gitignore）。
