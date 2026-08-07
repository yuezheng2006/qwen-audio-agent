# Task 7 Report: `audio_transcribe`

## Status

已完成。Voice Studio 现在注册第七个工具 `audio_transcribe`；默认没有 ASR 后端时返回明确的 `asr_unavailable`，后续可通过注入 backend 替换实现。

## 实现

- 新增 `server/src/voice/studio/asr.mjs`，提供 ASR 不可用结果和 backend seam。
- `VoiceStudioService` 新增 `transcribe(ownerId, input)`。
- 新增 `audio_transcribe` 通用 schema 与 owner-aware handler。
- 更新工具数量断言，并覆盖无 backend 和 handler 委托测试。

## 验证

- `node --test server/test/voice-studio-service.test.mjs server/test/voice-studio-tools.test.mjs`：15/15 通过。
- 相关文件 Lint：无错误。
- `node --test server/test/voice-*.test.mjs`：25/26 通过；唯一失败是既有的 `server/config/voice-presets/catalog.json` 缺失。
- `npm test` 已通过大量前置测试，但随后命中既有失败/长时间挂起，已停止；Task 7 相关测试不受影响。

## Concern

当前没有接入 DashScope 文件 ASR；调用会诚实返回 `asr_unavailable`，不会生成伪造转写文本。
