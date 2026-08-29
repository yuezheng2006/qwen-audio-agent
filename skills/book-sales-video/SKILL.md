---
name: book-sales-video
description: 从书名或飞书多维表格中的成稿文案出发，结合微信读书资料与公开点评创作图书带货/书评短视频；配音使用 qwen-audio-agent Voice Studio 名人 clone（按书作者自动选声，如刘震云书→刘震云音色），再用 Pexels、Codex 生图和本机 OpenChatCut 完成配图、双语字幕、音效、动效、BGM、可编辑初稿与按需导出。用户提出“根据一本书做带货视频”“读取飞书文案制作图书视频”“用作者的声音配书评口播”“仿参考样式做图书推荐短视频”时使用；仅查书、仅写普通书评或无关剪辑不触发。
---

# 图书带货视频创作（作者配音）

从书籍研究到本地可编辑初稿的一体化流程。流程与交付契约参考 [Kianzzz/book-sales-video](https://github.com/Kianzzz/book-sales-video)（MIT），**配音改为本仓 Voice Studio**，并在研究阶段按作者匹配音色。

只设置一次正常审核：先自动选择最佳角度并完成口播和语义分镜，用户确认后自动完成配音、画面、字幕、音效、动效、BGM、时间线和质检，不再逐项确认。

## 不可退让的完成线

- 书籍事实来自微信读书；公开点评只用于理解读者视角，不冒充原书内容。
- 用户指定从飞书多维表格读取文案时，目标记录中由用户确认的文案字段是权威口播源；除清理首尾空白和统一换行外保持原文，不擅自改写、拼接其他记录或用研究稿覆盖。
- 用户提供个人风格档案和禁用表达清单时，创作口播前必须读取；未提供时使用本 Skill 自带的口播参考，不猜测用户的私有路径或风格规则。
- 默认自动形成 2–3 个候选角度并评分，直接采用综合最优角度写成完整文案；不在前期让用户选角度。
- 唯一正常审核点位于完整口播与语义分镜之后。若用户打回，才展示候选角度供选择；选定后重写并直接进入制作，不新增第二次确认。
- 研究得到作者后，**必须**运行 `scripts/resolve_author_voice.mjs`，向用户展示「将用某某音色配音」；无命中须说明回退音色，**禁止**静默假称作者声，也**禁止**调用豆包 TTS。
- 对已确认全文只运行一次 `scripts/qwaudio_narrate.mjs`，最终只产生一个 `audio/narration.wav`。长稿允许脚本内部按句界请求并合并，但不能按镜头人工生成多份配音。
- 必须检查开头、结尾和所有句间静音：普通句间不超过 0.45 秒，段落/视觉转折不超过 0.70 秒；唯一允许的 0.80–1.20 秒无旁白区是有连续轮播音效覆盖的模板轮播。
- 最终配音的真实可听毫秒是全部画面、字幕、音效和转场的唯一时间依据；帧位用 OpenChatCut 当前项目的 timeline fps 换算。
- 开场动态视频固定通过 Pexels API 搜索 `book`，不根据书名或文案改关键词。
- 轮播使用 OpenChatCut 本地库 `library:sound:mechanical-clicking-loop`，每个有效峰值硬切一张不同封面；最后经短光溶进入主书揭示。
- 主书封弹出使用 OpenChatCut 本地库 `library:sound:cash-register-success`，视觉重音与音效锚点对齐。
- 正文每张图片必须有轻微呼吸/推近动效，相邻图片必须有转场；不能只把静态图片首尾拼接。
- 中文字幕与英文字幕均为白字、清晰黑描边；中文在上、英文在下，只保留一套可见字幕。
- 正文锁定“粗纸油画画外留白 v3”：油画叙事场景占画幅至少 70%（默认 70%–80%），横向一直铺到左右边缘；未上色粗纸只允许在上方、下方或上下两端，总占比 20%–30%。每次以 `assets/visual-style/approved-rough-paper-oil-v3.png` 为主锚点。
- 所有素材以独立可编辑项进入本机 OpenChatCut；不以本地预合成扁平视频冒充可编辑初稿。
- 本 Skill 禁用旧 ChatCut 云端 MCP、账号登录、云端项目链接和积分生成路线。本地 OpenChatCut 可用时不得回退云端。

## 首次使用与预检

每个新环境第一次触发本 Skill 时，先读取当前项目的 `AGENTS.md`，再运行只读预检；使用飞书路线时把用户提供的 Base URL 一并传入：

```bash
python3 "${CODEX_HOME:-$HOME/.codex}/skills/book-sales-video/scripts/check_environment.py" --json
python3 "${CODEX_HOME:-$HOME/.codex}/skills/book-sales-video/scripts/check_environment.py" \
  --json --base-url "<用户提供的飞书 Base URL>" \
  --lark-profile "<profile>" --script-field "<文案字段名>"
python3 "${CODEX_HOME:-$HOME/.codex}/skills/book-sales-video/scripts/openchatcut_mcp.py" status
```

读取预检输出中的 `checks`、`gates` 和 `actions`。对应 gate 未通过前不得进入该阶段。飞书路线还需确认 `larkBase.status` 为 `ready`。

### 缺失项安装与授权指引

- Python 依赖：`python3 -m pip install requests`
- Node.js：配音脚本需要 `node`
- FFmpeg：macOS 使用 `brew install ffmpeg`
- 本 Skill：从 qwen-audio-agent 仓库 symlink 到 `$CODEX_HOME/skills/book-sales-video`（见 README）
- Voice Studio：在本仓 WebUI「语音工作室」准备音色；名人定稿示例 `刘震云·北大·降噪`、`罗永浩·大连·降噪`（目录默认 `~/.config/qwaudio/voice-profiles/`）
- DashScope：配置 `DASHSCOPE_API_KEY` 或 `CASCADE_TTS_API_KEY`
- 飞书 / 微信读书 / Pexels / OpenChatCut：与上游相同（见预检 `actions`）

按阶段处理缺失项：

| 阶段 | 必需 | 缺失时处理 |
|---|---|---|
| 飞书文案 | `lark-cli`、Base 只读权限 | 停止读取 |
| 研究 | `weread-skills`、`WEREAD_API_KEY` | 停止事实研究 |
| 配音 | Node、`DASHSCOPE_API_KEY`、Voice Studio profiles、`qwaudioVoiceReady` | 停止配音，不回退编辑器音色，不调用豆包 |
| 开场 | `PEXELS_API_KEY` | 不得伪装已取得视频 |
| 配图 | Codex `image_gen` | 保存分镜与提示词 |
| 本地初稿 | OpenChatCut Desktop | 不回退云端 |

密钥只从安全环境读取。配音相关：`DASHSCOPE_API_KEY` / `CASCADE_TTS_API_KEY`；可选回退音色 `BOOK_SALES_FALLBACK_VOICE` 或 `CASCADE_TTS_VOICE`。

## 工作目录

使用项目 `AGENTS.md` 的 `work/` 约定，单次任务目录至少包含：

```text
research.md              script.md
storyboard.json          shot-plan.json
visual-style.json        voice-timeline.json
timeline-plan.json       subtitle-pairs.json
asset-manifest.json      quality_check.json
review_report.md         visuals/
audio/
```

## 飞书多维表格文案输入

当用户提供飞书 Base 链接或明确要求“读取飞书文案制作”时，先读取文案，再进入书籍事实核对和分镜。规则与上游一致：`base +url-resolve` → field-list → record-list；同书多条必须让用户选择；文案字段原文写入 `script.md`。

## 阶段一：确认书籍与研究

1. 加载 `weread-skills`，搜索并定位书籍。
2. 获取书名、作者、简介、分类、评分、封面、目录和 `bookId`，写入 `research.md`；`storyboard.json` 记录 `book.author`。
3. 收集点评样本，提炼痛点与候选角度（飞书路线不重写已读文案）。
4. **作者音色预匹配（本仓差异）：**

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/book-sales-video/scripts/resolve_author_voice.mjs" \
  --author "<research.md / storyboard 中的作者>"
```

向用户展示 `message` / `friendly_name` / `label`。`fallback: true` 时必须明确说「将使用回退音色，不是作者本人声线」。

此阶段读取 [references/copywriting-and-storyboard.md](references/copywriting-and-storyboard.md)。

## 阶段二：文案、分镜与唯一审核

严格读取 [references/reference-copy-style.md](references/reference-copy-style.md) 和 [references/copywriting-and-storyboard.md](references/copywriting-and-storyboard.md)。

默认结构：开场「今天分享的是」→ 无正文口播的封面轮播 → 揭示《书名》→ 正文处境与认识 → 适合谁。飞书路线保留原文。

完成 `script.md`、`storyboard.json` 和 draft `subtitle-pairs.json`，一次性交给用户审核。用户确认后授权完整本地制作。

## 阶段三：一次生成完整配音

1. 新任务且状态中没有项目时，才用本地桥接调用一次 `create_project`（1080×1920、30fps）；继续已有任务时重连同一工程。
2. 将确认稿保存为 `audio/narration.txt`，只运行一次：

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/book-sales-video/scripts/qwaudio_narrate.mjs" \
  --text-file audio/narration.txt \
  --output audio/narration.wav \
  --report audio/narration.wav.json \
  --author "<storyboard.json.book.author>"
```

3. 用 ffmpeg/ffprobe 与试听检查首尾与句间停顿；异常时重跑这一条完整配音。
4. 通过 OpenChatCut 导入唯一 WAV 到 A1。不得调用编辑器 TTS，也不得拆成多条旁白。
5. 优先读取 `qwaudio_narrate.mjs` 生成的句段时间账本（`alignment.segments`），生成 `voice-timeline.json`；不能伪造词时间。

读取 [references/openchatcut-build.md](references/openchatcut-build.md)。

## 阶段四：按配音生成全部视觉

### 开场与封面

- `scripts/search_pexels_videos.py --page 1 --per-page 20`，固定 `book`、竖屏。
- 开场中央「今天分享的是 / Today, I'd like to share」。
- 主书封用微信读书真实封面放在 V2；揭示时 V3 持续显示 `《书名》` 与 `作者 / 著` 直至结束。

### 正文图

读取 [references/body-visual-style.md](references/body-visual-style.md) 与 [references/shot-planning.md](references/shot-planning.md)，生成并校验 `shot-plan.json` 后再 `image_gen`。

## 阶段五：本地 OpenChatCut 自动装配

执行前读取 [references/openchatcut-build.md](references/openchatcut-build.md)、[references/editing-effects-and-rhythm.md](references/editing-effects-and-rhythm.md) 和 [references/bilingual-subtitles.md](references/bilingual-subtitles.md)。

轨道：V1 开场/轮播/揭示背景/正文；V2 主书真实封面；V3 书名作者与字幕；A1 完整配音；A2 BGM；A3 机械轮播；A4 揭示音效。所有 MCP 经 `scripts/openchatcut_mcp.py`。

## 阶段六：质检与交付

`quality_check.json` 至少包含并通过：`bookFacts`、`voiceContinuity`、`timelineStructure`、`carouselRhythm`、`bookReveal`、`bodyMotion`、`transitions`、`subtitles`、`bgmMix`、`visualStyle`、`frameReview`。另确认配音 report 中的 `voice_match` 与研究作者一致或已声明 fallback。

```bash
python3 scripts/validate_subtitle_cards.py subtitle-pairs.json --voice-timeline voice-timeline.json --strict
python3 scripts/validate_delivery_state.py .
```

默认停在可编辑初稿；用户明确要求后才本地导出。

## 失败处理

- OpenChatCut / Pexels / 微信读书 / 图像生成失败：保留已完成状态和准确缺口。
- 音色未解析（`voice_unresolved`）：停止配音，引导在 Voice Studio 克隆或设置 `BOOK_SALES_FALLBACK_VOICE`。
- 缺一项音效/动效/字幕/BGM 检查时状态为 `blocked-not-deliverable`。

## 资源路由

- 口播与分镜：[references/copywriting-and-storyboard.md](references/copywriting-and-storyboard.md)
- 正文视觉 / 镜头 / 字幕 / 动效 / OpenChatCut：见 `references/`
- 环境检查：`scripts/check_environment.py`
- 作者选声：`scripts/resolve_author_voice.mjs`
- 完整配音：`scripts/qwaudio_narrate.mjs`
- Pexels：`scripts/search_pexels_videos.py`
- 校验：`scripts/validate_shot_plan.py`、`scripts/validate_subtitle_cards.py`、`scripts/validate_delivery_state.py`

## 非目标

- 本期不实现 WebUI Launchpad「视频配音」磁贴（仍为 soon）。
- 不使用豆包 TTS，不依赖 `DOUBAO_*` 环境变量。
