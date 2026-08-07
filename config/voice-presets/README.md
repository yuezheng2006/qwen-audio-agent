# Voice Presets

Voice Studio 演示音色：元数据在 `catalog.json`，参考音频在 `samples/`。

## 预设列表（第一期 4 条）

| id | 说明 | 样本文件 |
| --- | --- | --- |
| `demo-calm-male` | 沉稳男声 | `samples/demo-calm-male.wav` |
| `demo-warm-female` | 温暖女声 | `samples/demo-warm-female.wav` |
| `demo-bright-female` | 明快女声 | `samples/demo-bright-female.wav` |
| `demo-story-male` | 叙事男声 | `samples/demo-story-male.wav` |

建议样本：干净人声、约 8–12 秒、wav 或 mp3。仓内可不捆绑真实 wav，由使用者自行放置。

## 放入样本

1. 准备一条短时参考音频（例如 8–12 s 单声道 wav）。
2. 按上表文件名保存到 `samples/`，与 `catalog.json` 中 `sample.relativePath` 一致。
3. 可选：更新 `durationSec` 为实际时长。
4. 启动 Gateway 后，语音说「列出声音预设」→ Agent 调用 `voice_list_presets` 应能看到对应条目。
5. 克隆示例：「用沉稳男声克隆」→ `voice_clone`（需已配置 dashscope / fish / minimax 等 Key）。

示例（仅演示一条）：

```bash
cp /path/to/your-authorized-sample.wav config/voice-presets/samples/demo-calm-male.wav
```

自定义预设目录时设置 `VOICE_PRESETS_DIR` 指向含 `catalog.json` 与 `samples/` 的目录。

## 授权（license）

- `catalog.json` 中每条预设的 `sample.license` **必填**；第一期种子均为 `demo`。
- **仅供个人学习与功能演示**；不得将未授权音频当作可再分发素材。
- 商用、对外产品或公开 demo 请使用**你已获得授权**的参考音频，并在 `license` 字段写明来源与用途（例如 `self-recorded`、`licensed-2026-01`）。

## 相关文档

- 设计规格：`docs/superpowers/specs/2026-08-07-voice-studio-tools-design.md`
- 配置说明：`docs/configuration.md`（Voice Studio 小节）
