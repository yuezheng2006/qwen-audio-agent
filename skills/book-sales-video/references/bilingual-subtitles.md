# 中英文双语字幕

`subtitle-pairs.json` 是唯一字幕账本。时间来自最终旁白的真实词边界或可复核对齐证据，不按字数平均分配。

## 制作顺序

1. 用户确认中文口播。
2. 一次生成并修整完整中文配音，导入本机 OpenChatCut。
3. 以毫秒记录语义配音单元，再按当前 timeline fps 派生帧位。
4. 先按标点锁定句子和分句边界，再按完整中文意群分卡；长度限制只用于继续拆分过长意群，禁止按固定字数从头到尾硬切。逐卡翻译简洁自然的英文。
5. 运行严格校验后写入唯一可编辑字幕层，并用真实合成帧验证。

状态为 `draft → aligned → translated → laid-out → verified`。中文、配音、fps、镜头、字幕框或英文任一变化，都把对应下游状态和证据标为 `stale`，递增 `stateRevision`。

## 字幕卡规则

- 每卡记录 `voiceUnitId`、`zhText`、`enText`、`startFrame`、`endFrame`、`captionBox`、实现路线和证据。
- 时间使用半开区间 `[startFrame, endFrame)`，不得越过所属可听语音单元，默认不跨主视觉切点。
- 中文每卡最多 11 个有效字符，按完整意群断句；1–2 字短卡仅允许有明确强调理由。
- 句号、问号、叹号和分号后必须新开字幕卡；逗号后的内容若开启新动作、转折、条件或结论，也必须新开卡。上一卡不得携带下一分句的开头词。
- 中英文含义一致、同时进入退出。英文不逐字硬译，过宽时先压缩或重分整组卡。

## 固定样式

- 中文在上、英文在下，均白色填充、清晰黑色描边、单行。
- 1080×1920 起始值：中文 76px/800，英文 42px/600。
- 整组使用 `shot-plan.json` 指定的统一纸面字幕框；字符数不能替代真实宽度、遮挡与平台安全区检查。
- 优先使用 OpenChatCut 可精确控制样式和审核版英文的原生字幕能力；若无法同时满足，则整段使用一个可复用双语 Motion Graphic。任何时候只保留一套可见正文字幕。

写入前运行：

```bash
python3 "${CODEX_HOME:-$HOME/.codex}/skills/book-sales-video/scripts/validate_subtitle_cards.py" subtitle-pairs.json \
  --voice-timeline voice-timeline.json --strict
```

写入后读回页面/实例、时间线和合成帧。只有语义、时序、样式、单行宽度、遮挡和唯一层全部通过，才能把字幕状态标为 `verified`。
