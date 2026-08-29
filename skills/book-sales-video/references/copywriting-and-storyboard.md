# 文案与分镜方法

## 1. 研究卡

先在 `research.md` 保存：

- 书籍：书名、作者、版本、`bookId`、封面 URL。
- 核心事实：简介、分类、评分、目录结构。
- 用户角度：原话与归纳后的创作命题。
- 点评样本：点评 ID、类型、评分、短摘要、可复用洞察；不保存不必要的个人信息。
- 证据边界：哪些是书籍事实，哪些是读者感受，哪些是创作者解释。

## 2. 无角度时的书评采样

推荐使用三个主样本池：

1. 推荐点评：寻找读者真正获得了什么。
2. 最新点评：寻找当前读者的自然语言和现实处境。
3. 全部点评：避免只看正面评价造成偏差。

当候选角度可能夸大功效或回避争议时，再少量查看“不行/一般”点评，用来识别反对意见，不把差评当噱头。目标 20–40 条有效点评；样本不足时如实使用现有数量。

对每条点评只提取以下一种或多种信息：

- `pain`：读者正在经历的具体困境。
- `scene`：可被观众想象或被画面表现的处境。
- `belief`：读前与读后的认识变化。
- `language`：自然、具体、有代入感的表达方式。
- `objection`：读者不认同、觉得空泛或难执行的地方。
- `outcome`：读者认为真正有帮助的变化。

先按点评 ID 和正文去重，再聚类。不要因为一句话写得漂亮就选它；至少需要多个样本或书籍信息支持同一角度。

## 3. 角度选择

每个候选角度写成一句话：

> 给正在【具体处境】的人看，借这本书说明【反直觉认识或变化】，最后让他意识到【为什么值得读】。

综合判断五个维度：

- 受众代入：目标观众能否在前 5 秒认出自己。
- 书籍相关：这个角度是否确实来自本书，而不是任何书都能套用。
- 证据覆盖：是否有书籍信息或多条点评支撑。
- 视觉潜力：能否拆成具体、连贯、不过度重复的画面。
- 购买过渡：结尾推荐是否自然，不需要硬喊“赶紧买”。

只选一个主角度。其他角度留在研究卡，供下一条视频使用。

## 4. 文案骨架

写之前先读 `reference-copy-style.md`。借用参考片的语言机制，不复制它的句子：直接对观众说话、用具体生活场景推进情绪、从困境走向重新理解和行动边界。每个关键判断仍要能回到本书信息或多篇书评，不能套一段与任何书都适配的关系鸡汤。

推荐写成连续口播，不用标题化分段。结构功能如下：

| 位置 | 功能 | 写法 |
|---|---|---|
| 开场 | 固定识别 | “今天分享的是” |
| 轮播 | 视觉蓄力 | 不塞正文；用音效与快速图书卡片建立系列感 |
| 书名揭示 | 报书 | 《书名》，必要时补作者 |
| 代入 | 让观众认出自己 | 一个具体关系、动作、念头或反复发生的场景 |
| 转折 | 给出新的看法 | 说明这本书如何重新定义问题，不先给大道理 |
| 展开 | 提供价值 | 1–3 个相互递进的认识、例子或做法 |
| 收束 | 推荐适配人群 | 说明适合谁、为什么现在值得读，避免夸大承诺 |

写作检查：

- 口语能一遍读顺，没有长串书面从句。
- 先写经历或现象，再提观点；可以使用参考片式的直接提醒，但不要连续堆叠“不要、一定、必须”等命令。
- 至少放入一个能被看见的生活细节或动作，不能只用“内耗、成长、清醒、治愈”等抽象词推进。
- 情绪应有清楚变化：被困住或反复消耗 → 看清问题 → 找回选择或边界。不要突然硬升华。
- 尽量给现象命名，让观众能记住，但名称必须贴合内容。
- 用“关掉聊天框、停止反复解释、把注意力收回来”等动作替代“学会成长”之类空话。
- 不用整齐排比、鸡汤式升华和强行身份总结。
- 不声称一本书能治愈、拯救或保证结果。
- 直接引语必须有可定位来源；否则写成“这本书提醒我们”或“许多读者提到”。

## 5. 分镜决策

先标注口播中的“视觉动词”和“情绪状态”：离开、等待、解释、回头、独处、整理、重新开始等。出现以下变化之一时才切新图：

- 地点或时间变化。
- 主体或动作变化。
- 观点从问题转为解释、从解释转为行动。
- 情绪明显升高、下降或转向。
- 当前视觉已无法继续承载下一段口播，或在实际配音节奏中明显失去信息推进。

同一画面可以覆盖多个短句。避免一句一图，也避免一张图机械撑完整正文。图片数量由这些真实变化点决定，不根据参考片张数或固定秒数反推。

本阶段只确定“需要几个视觉段、每段表达什么”，不为每张图独立写最终提示词。全部视觉段确定后，必须转入 `shot-planning.md`，从整组节奏统一规划景别、视角、构图和展示形式。

## 6. `script.md` 建议结构

```markdown
# 《书名》图书视频文案

## 创作角度
一句可检查的创作命题。

## 口播稿
今天分享的是……

## 事实与来源
- 书籍事实：……
- 读者观点归纳：……
- 直接引语：无 / 来源位置

## 审阅备注
- 时长目标：用户指定 / 未指定，按实际配音确定
- 默认音色：qwen-audio-agent Voice Studio（按书作者匹配 clone；无命中时用 BOOK_SALES_FALLBACK_VOICE / CASCADE_TTS_VOICE，须向用户声明）
- 默认字幕：中英文双语，中文主字幕、英文副字幕
- 仍需确认：……
```

## 7. `storyboard.json` 最小结构

```json
{
  "book": {
    "bookId": "",
    "title": "",
    "author": "",
    "coverUrl": ""
  },
  "angle": "",
  "target": {
    "platform": "douyin",
    "ratio": "9:16",
    "width": 1080,
    "height": 1920,
    "fps": 30,
    "subtitleMode": "zh-en-bilingual",
    "durationPolicy": "derive-from-approved-script-and-actual-voice",
    "userTargetSeconds": null
  },
  "segments": [
    {
      "id": "intro",
      "kind": "stock-intro",
      "narration": "今天分享的是",
      "visualIntent": "",
      "durationPolicy": "match-actual-narration",
      "source": "pexels"
    },
    {
      "id": "carousel",
      "kind": "cover-carousel",
      "narration": "",
      "beatDriven": true,
      "durationPolicy": "derive-from-selected-sound-peaks"
    },
    {
      "id": "book-reveal",
      "kind": "book-reveal",
      "narration": "《书名》",
      "visualIntent": "真实书封叠加在主题主视觉上"
    },
    {
      "id": "body-01",
      "kind": "generated-still",
      "narration": "",
      "visualIntent": "",
      "emotion": "",
      "durationPolicy": "match-associated-voice-segment",
      "sourceEvidence": []
    }
  ]
}
```

在 `qwaudio_narrate.mjs` 一次配音完成并由本机 OpenChatCut 导入后，为每个语义单元补入同一个 `audioAssetId`，并分别记录 `voiceUnitId`、资产内起止时间、`actualAudioSeconds`、`timelineStartFrame`、`durationInFrames` 和 `fitStatus`。同时在 `asset-manifest.json` 记录本地 JSON 报告路径、音色 label / remote_voice_id、作者匹配结果和导入证据，不记录密钥。如果文案或画面时序改变，相关行标记为 stale 并重新计算。`userTargetSeconds` 只有用户明确给出时才填写。

这里的帧字段只是由 `voice-timeline.json` 派生的装配结果。配音可听区间以毫秒保存，帧数必须使用当前 timeline 的真实 fps 在装配时计算，不能从源音频 fps、抽帧服务 fps 或旧项目计划换算。

## 8. `subtitle-pairs.json`：最终字幕卡片账本

中文口播稿确认后可以先生成 `draft` 字幕卡，但时间字段保持空值。`qwaudio_narrate.mjs` 完成最终 TTS、音频导入本机 OpenChatCut、裁切异常静音并建立 `voice-timeline.json` 后，再把它升级为最终字幕账本。英文只用于字幕，不生成英文配音。

字幕账本必须与 OpenChatCut 实际页面一致，不能出现“文件里是一段 35 字长句，时间字段为空，但项目里已经显示为多张字幕”的情况。每张可见字幕卡对应一条 `cards` 记录；原生字幕通过当前本地工具保存页面词键，Motion Graphic 路线保存实例 ID 和人工/画面证据。

```json
{
  "version": 3,
  "mode": "zh-en-bilingual",
  "status": "verified",
  "stateRevision": "rev-0004",
  "canvas": {"width": 1080, "height": 1920},
  "timelineBasis": {
    "projectId": "<project-id>",
    "timelineId": "<timeline-id>",
    "fps": 30,
    "readAt": "2026-07-17T12:00:00+08:00",
    "voiceTimelineRevision": "rev-0004"
  },
  "implementation": {
    "route": "openchatcut-native-bilingual",
    "captionsItemId": "",
    "visibleLayerCount": 1
  },
  "cards": [
    {
      "id": "caption-001",
      "voiceUnitId": "voice-body-01",
      "segmentId": "body-01",
      "visualShotIds": ["shot-01"],
      "zhText": "",
      "enText": "",
      "sourceWordKeys": ["<source-item-prefix>:<word-prefix>"],
      "startFrame": 300,
      "endFrame": 360,
      "captionLane": "paper-lower",
      "captionSurface": "unpainted-paper",
      "contrastMode": "white-black-stroke",
      "captionBox": {
        "left": 120,
        "top": 1250,
        "width": 800,
        "height": 240
      },
      "translationStatus": "verified",
      "alignmentStatus": "verified",
      "layoutStatus": "verified",
      "evidenceStatus": "verified",
      "alignmentEvidence": "read_captions-word-keys",
      "evidenceFrames": [330]
    }
  ]
}
```

字段规则：

- 时间区间使用半开范围 `[startFrame, endFrame)`；必须落在所属 `voiceUnitId` 的可听区间内。
- `visualShotIds` 可以包含一张或多张画面；默认字幕不跨主视觉切点。确实跨越时增加 `crossesVisualCutReason`，不能静默延伸。
- `captionLane`、`captionBox`、`captionSurface` 和 `contrastMode` 来自 `shot-plan.json`。默认原生字幕整组使用同一位置和样式，避免逐镜跳动。
- 中文每卡最多 11 个有效字符，不把标点和空格算入；一到两个字的卡片仅在明确强调时使用 `allowShortCard: true` 并写 `shortCardReason`。
- 不能用字符数代替画面宽度判断。`layoutStatus=verified` 必须有真实合成帧证据；英文超宽时先压缩翻译或重新拆卡，不自动换行、不无限缩小字号。
- `sourceWordKeys` 只记录 OpenChatCut 实际返回的词键。没有词键时必须写清 `alignmentEvidence`，不能伪造。
- 英文应简洁、自然、与中文含义等价，不逐字硬译，也不增加中文没有的承诺。中文变化时，相关 `translationStatus`、`layoutStatus` 和 `evidenceStatus` 全部改为 `stale`。
- 改配音、删静音、改 timeline fps、移动配音或字幕时，相关 `alignmentStatus` 与 `evidenceStatus` 改为 `stale`，并递增整个任务的 `stateRevision`。

进入 OpenChatCut 字幕装配前运行：

```bash
python3 "${CODEX_HOME:-$HOME/.codex}/skills/book-sales-video/scripts/validate_subtitle_cards.py" subtitle-pairs.json \
  --voice-timeline voice-timeline.json --strict
```
