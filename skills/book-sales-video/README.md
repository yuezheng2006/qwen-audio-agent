# 图书带货视频 Skill（作者配音）

本仓自研 Codex/Agents Skill：参考 [Kianzzz/book-sales-video](https://github.com/Kianzzz/book-sales-video)（MIT）的流程与 OpenChatCut 交付契约，**配音改为 qwen-audio-agent Voice Studio**，并按书作者自动选声（例如《一句顶一万句》→ 刘震云·北大·降噪）。

上游视觉规范、校验脚本与部分资源以 MIT 适配纳入；见 [THIRD_PARTY_LICENSE_upstream-book-sales-video.txt](THIRD_PARTY_LICENSE_upstream-book-sales-video.txt)。

## 安装

在 **qwen-audio-agent 仓库根目录**执行（推荐 symlink，便于配音脚本 `import` 本仓 `server/src/voice/studio/*`）：

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
ln -sfn "$(pwd)/skills/book-sales-video" \
  "${CODEX_HOME:-$HOME/.codex}/skills/book-sales-video"
```

若 Skill 被复制到别处，需设置：

```bash
export QWAUDIO_ROOT="/path/to/qwen-audio-agent"
```

## 触发示例

```
使用 $book-sales-video，根据《一句顶一万句》制作一条图书带货短视频。
```

```
使用 $book-sales-video，读取我提供的飞书多维表格文案制作视频。
```

## 预检

```bash
python3 "${CODEX_HOME:-$HOME/.codex}/skills/book-sales-video/scripts/check_environment.py" --json
```

配音 gate：`gates.qwaudioVoiceReady`（Node + DashScope Key + Voice Studio profiles + 本仓根目录）。

## 作者选声

```bash
node scripts/resolve_author_voice.mjs --author "刘震云"
```

规则：匹配 profile `label` 前缀（`刘震云·…`），优先降噪 / favorite / ready|confirmed；无命中则使用 `BOOK_SALES_FALLBACK_VOICE` 或 `CASCADE_TTS_VOICE`，并在输出里标明 `fallback: true`。

## 配音

```bash
node scripts/qwaudio_narrate.mjs \
  --text-file audio/narration.txt \
  --output audio/narration.wav \
  --report audio/narration.wav.json \
  --author "刘震云"
```

产出与上游兼容的 `alignment.segments`（句级 PCM 时长 + 固定 join pause），供 `voice-timeline.json` 使用。

## 依赖

| 能力 | 要求 |
|---|---|
| 配音 | Node、`DASHSCOPE_API_KEY`、`~/.config/qwaudio/voice-profiles/` |
| 研究 | weread-skills、`WEREAD_API_KEY` |
| 开场 | `PEXELS_API_KEY` |
| 装配 | OpenChatCut Desktop、FFmpeg |
| 飞书（可选） | lark-cli |

密钥勿写入任务目录或对话。

## 非目标

- WebUI Launchpad「视频配音」GUI（磁贴仍为 soon）
- 豆包 TTS / `DOUBAO_*`

## 目录

- `SKILL.md` — 主流程
- `scripts/qwaudio_narrate.mjs` — 配音
- `scripts/resolve_author_voice.mjs` — 作者 → 音色
- `scripts/check_environment.py` — 预检
- `references/` / `assets/` — 文案、画面与剪辑规范（上游适配）
