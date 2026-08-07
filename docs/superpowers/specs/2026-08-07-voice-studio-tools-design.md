# Voice Studio 工具能力（通用 VoiceProfile + 云端 Clone）

日期：2026-08-07  
参考：[6174/recut-audio-studio](https://github.com/6174/recut-audio-studio)（转写 / 声音角色 / 配音契约）  
约束：工具与存储尽量通用；厂商差异关在 adapter；**不破**现有 cascade TTS 重启切换协议。

## 目标（第一期）

- Realtime Agent 可通过工具完成：列预设 → 云端 clone / 导入已有音色 ID → 确认生效 → 查询状态。
- 统一抽象多家 TTS enrollment：`dashscope` / `fish` / `minimax`；`listenhub` 至少支持导入已有 speaker_id。
- 仓内附带少量可再分发的演示参考音预设（元数据 + 样本文件）。
- `voice_confirm` 复用与 RuntimeSettings 相同的 cascade TTS 持久化缝（**重启 gateway 生效**）。
- `audio_transcribe` 工具 schema 先通用落地；第一期云端 ASR（不可用则明确失败），第二期接本地 Whisper / Qwen3-ASR 时不换 schema。

## 非目标（第一期）

- CosyVoice2 / 本地 Whisper·Qwen3-ASR runner（**第二期**）
- 多角色 workspace 隔离（另有决策；本期只落音色 profile）
- 热切换 TTS 且不重启 gateway
- 转写结果自动导入「素材库」式 Asset
- 工具 schema 暴露各家专有字段名（`reference_id` / `speaker_id` 等）

## 架构

```
Realtime tools (CapabilityRegistry)
  → VoiceStudioService
      → VoiceCloneProvider[dashscope|fish|minimax|listenhub|…]
      → VoiceProfileStore (per owner)
      → PresetCatalog (config/voice-presets)
      → SampleResolver (file/url → enroll 可用形态)
  → voice_confirm → persistCascadeTts(+ restart)  // 与 /api/runtime/cascade-tts 同缝
```

加法边界（参考 episode-memory 模式）：

| 新模块 | 薄接线 |
|--------|--------|
| `server/src/voice/studio/*`（service / store / providers / presets） | `capabilities/resolve` 注册工具 |
| `server/src/capabilities/tools/voice-studio.mjs` | CapabilityRegistry |
| `config/voice-presets/` | 预设目录 |
| 可选 HTTP：`/api/voice/*`（与工具共用 service） | `capability-routes` 或独立 routes |
| | RuntimeSettings 可读 profile 列表（可后置） |

## VoiceProfile（存储）

```text
VoiceProfile {
  id              // 本仓稳定 ID
  ownerId
  label
  source          // preset | upload | url | import_id
  presetId?
  sampleRef       // { kind: 'file'|'url', path|url } | null
  provider        // dashscope | fish | minimax | listenhub | <future>
  remoteID        // 统一云端音色句柄（工具参数名 remote_voice_id）
  targetModel?
  status          // draft | cloning | ready | confirmed | failed
  error?
  providerPayload // opaque；各家原始字段
  createdAt, updatedAt, confirmedAt?
}
```

说明：

- 字段名在存储层用 `remoteId`；工具 JSON 用 `remote_voice_id`（蛇形）。
- **当前生效音色**以 cascade 已持久化的 `provider + voice` 为准，不另维护全局 singleton；`status=confirmed` 表示曾通过本工具确认并写过 runtime。
- Store 按 `ownerId` 隔离；实现可用 JSON 文件或 SQLite（与现有 owner 数据目录一致即可）。

## VoiceCloneProvider 合同

```text
capabilities(): {
  canEnroll: boolean
  canImportId: boolean
  needsPublicUrl: boolean
  sampleHints: { minSec, maxSec, formats[] }
}

enroll({ label, sample, targetModel? })
  → { remoteId, targetModel?, providerPayload }

importId({ label, remoteId, targetModel? })
  → { remoteId, targetModel?, providerPayload }

listRemote?(query) → []   // 可选

normalizeError(err) → { error_code, user_message, retryable }
```

返回的 `remoteId` 写入 `VoiceProfile.remoteId`；工具对外一律序列化为 `remote_voice_id`。

| Provider | enroll | importId |
|----------|--------|----------|
| dashscope | 是（`voice-enrollment` / `create_voice`） | 是 |
| fish | 是（Fish 创建 reference / model 的公开 API；若 key 权限不足则 `enroll_unsupported`） | 是 |
| minimax | 是（MiniMax voice clone API；同上降级） | 是 |
| listenhub | 否（`canEnroll=false`） | 是（已有 speaker_id） |
| cosyvoice（二期） | 本地角色 ID 作 `remoteId` | 是 |

某家 enroll HTTP 合同未就绪或账号无权限时：**不得假装成功**；`capabilities().canEnroll=false` 或 clone 返回 `enroll_unsupported`，引导 `voice_import`。

`SampleResolver`：

1. preset / 本地 file → 若 `needsPublicUrl`，生成短期可访问 URL（本机静态或临时上传位）
2. 已是 URL → 直通
3. 解析失败 → 工具返回明确错误，不编造 remoteId

## Realtime 工具契约

原则：参数通用；禁止各家专有字段进入 schema。

| 工具 | 作用 | 关键参数 |
|------|------|----------|
| `voice_list_presets` | 列名人/演示预设 | `query?` |
| `voice_clone` | 样本 → enrollment → profile(`ready`) | `provider?`, `preset_id?` **或** `sample_url?`/`sample_path?`, `label?`, `target_model?` |
| `voice_import` | 登记已有 remote id | `provider`, `remote_voice_id`, `label?`, `target_model?` |
| `voice_confirm` | 写 cascade TTS 并重启 | `profile_id`（或 `provider`+`remote_voice_id`）, `restart` 默认 true |
| `voice_list` | 本 owner 的 profiles | `status?` |
| `voice_status` | 当前 cascade provider/voice + 最近 confirmed | 无 |
| `audio_transcribe` | 文件/URL 转写 | `source`, `language?`, `provider?` |

工具返回约定：

- 成功：`status` + 口语友好摘要字段（如 `label`, `remote_voice_id`, `provider`）；Agent 勿朗读内部路径 / opaque payload。
- 失败：`error: true`, `error_code`, `user_message`, `retryable`（对齐现有 capability 工具）。

`voice_confirm` 行为：

1. 校验 profile `ready|confirmed` 且 `remoteId` 非空
2. 调用与 `POST /api/runtime/cascade-tts` 相同的 `persistCascadeTts({ provider, model?, voice: remoteId })`
3. 默认触发 gateway 重启；返回 `switching: true` 与即将生效的 provider/voice
4. 更新 profile → `confirmed` + `confirmedAt`

## 预设目录

```text
config/voice-presets/
  catalog.json
  samples/<id>.wav|mp3
```

`catalog.json` 条目：

```text
{
  id, label, locale?, tags[],
  sample: { relativePath, durationSec?, license },
  notes?
}
```

约束：

- **不预置**任何云端 `remoteVoiceId`（账号间不可复用）。
- 第一期种子固定 **4** 条中性演示音色（非真实名人姓名，避免授权风险）：
  - `demo-calm-male` 沉稳男声
  - `demo-warm-female` 温暖女声
  - `demo-bright-female` 明快女声
  - `demo-story-male` 叙事男声  
  样本为短时干净人声（约 8–12s）；若仓内暂无真实 wav，可用脚本从已授权素材生成，或 CI/文档说明「用户放入 `samples/`」。**不**捆绑未授权名人原声。
- `catalog.json` 每条必填 `license`（第一期用 `demo`）；README 一句说明：仅供个人/演示，商用须自备授权音频。
- `voice_list_presets` 只暴露 `id/label/tags/duration` 等，不暴露绝对路径。

## audio_transcribe（第一期）

```text
audio_transcribe({
  source: { kind: 'url'|'path'|'preset_sample', ... },
  language?: 'auto'|'zh'|'en',
  provider?: 'auto' | <asr provider id>
}) → {
  status,
  segments: [{ start, end, text }],
  text,
  provider,
  srt?          // 可选
}
```

- `provider=auto`：使用已配置的云端 ASR；不可用 → `asr_unavailable`，不假装成功。
- 分段形状对齐声音工坊，便于二期本地 ASR 无缝替换实现。

## 第二期（预留，本 spec 不实现）

- CosyVoice2 cascade TTS 插件 + 本地 `VoiceCloneProvider`
- 本地 Whisper / Qwen3-ASR 作为 `audio_transcribe` 后端
- 声音角色 `promptText` + 情绪 style 合成（对齐 recut `audio.synthesize`）
- RuntimeSettings 完整 Voice Studio 面板（若工具优先足够，可继续后置）

## 测试要点

- Provider adapter：mock HTTP；enroll / importId / normalizeError
- VoiceStudioService：preset → clone → confirm 状态机
- 工具 handler：参数校验、失败码、不泄漏绝对路径
- confirm 调用 persist 缝（可 mock），不在单测里真重启进程
- ListenHub：`voice_clone` 拒绝 enroll，引导 `voice_import`

## 开关与配置

- **`VOICE_STUDIO`**：默认 `1`（开启）。设为 `0` 时不注册 Voice Studio 工具族，行为与现网一致。
- 缺某家 API key：该 provider `canEnroll=false`（或 enroll 返回 `provider_unconfigured`）；其它已配置 provider 仍可用。
- 默认 clone `provider`：若参数省略，使用当前 cascade TTS provider；若当前为不可 enroll 的 listenhub，则要求显式传入 `provider`。

## 相关记忆 / 决策

- 多角色音色 + workspace：后续专项；本 spec 只提供可绑定的 `VoiceProfile`。
- 本地 CosyVoice / Qwen3-TTS 候选：二期接到同一 Provider 合同。
