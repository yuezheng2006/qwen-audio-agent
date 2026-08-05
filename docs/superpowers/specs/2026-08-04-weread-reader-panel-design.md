# 微信读书「小说阅读」面板设计

日期：2026-08-04  
状态：已口头批准（方案 B + 面板内直接播）  
范围：全量 WebUI 独立阅读抽屉；微信读书 skill 接入；千问 TTS 朗读金句/书评

## 目标

在语音前台旁提供独立「阅读」入口，用户可：

1. 浏览个人书架（最近在读优先）
2. 查看并朗读某书的**划线/金句**
3. 查看并朗读某书的**个人想法/书评**
4. **不依赖语音会话是否开启**，在面板内直接播放音频

不做（首版）：整本版权正文、Desktop 浮球内嵌、热门书评、改 realtime-gateway / cascade 内核。

## 约束

- **底座不动**：不改 `realtime-gateway`、cascade session 主循环；仅 capability HTTP + WebUI 组件。
- **成熟开源/官方 skill**：微信读书走 [Agent Gateway](https://weread.qq.com/r/weread-skills)（`WEREAD_API_KEY`，skill ≥ 1.0.4）。
- **TTS**：DashScope `qwen-audio-3.0-tts-flash` + 峰哥复刻 voice；**不传 `CASCADE_TTS_INSTRUCTION`**（与已确认音色一致）。
- **无版权整书**：只朗读用户划线原文与个人想法/书评内容。

## 方案选择

| 方案 | 结论 |
|------|------|
| A 塞进设置抽屉 | 否：与配置混杂 |
| **B Header「阅读」抽屉 + `/api/weread/*`** | **采用** |
| C 整页阅读器 | 否：改布局过大 |

播放：面板内直接播（用户选择 2），不依赖 `content_control` / 开麦。

## 架构

```text
WebUI WereadReaderPanel
    │  fetch JSON / audio
    ▼
capability-routes  /api/weread/*
    │
    ├─ weread-client  → i.weread.qq.com/api/agent/gateway
    ├─ export-md      → 划线/书评 Markdown（可选落盘）
    └─ speak          → createSynthesizer(cascadeConfig) → audio/wav
```

层边界：

- `server/src/voice/reader/weread/`：微信读书客户端、导出、speak 编排（接入层）
- `server/src/app/capability-routes.mjs`：注册 HTTP，不塞业务细节
- `web/src/WereadReaderPanel.jsx`：UI + `<audio>` 播放
- TTS 复用 `server/src/voice/cascade/adapters/tts.mjs` + `resolveCascadeConfig`

## HTTP API

鉴权：与现有 capability 路由一致（个人模式本机）；`WEREAD_API_KEY` 缺失时返回 503 + 中文说明。

### `GET /api/weread/shelf`

- 调 `/shelf/sync`
- 返回：`{ books, albums, total, recent[] }`  
  - `total = books.length + albums.length + (mp ? 1 : 0)`（skill 口径）
  - `recent`：电子书按 `readUpdateTime` 降序，默认前 30

### `GET /api/weread/highlights?bookId=`

- 调 `/book/bookmarklist`
- 返回：`{ book, chapters, highlights[] }`  
  - `highlights[].markText`、`chapterUid`、`chapterTitle`、`createTime`（YYYY-MM-DD）、`range`

### `GET /api/weread/reviews?bookId=`

- 调 `/review/list/mine`（分页拉齐到 `hasMore=0`，单书上限 200 条）
- 返回：`{ bookId, reviews[] }`（`content`、`chapterName`、`createTime`、`star`）
- 首版**不含**热门公开点评

### `POST /api/weread/speak`

Body：

```json
{
  "bookId": "string",
  "mode": "highlights" | "reviews" | "mixed",
  "itemIds": ["optional subset"],
  "persistContent": false
}
```

行为：

1. 拉取对应划线/想法，拼朗读文案（书名开场 + 条目，条目间短停顿由句号/换行承担）
2. 用当前 cascade TTS 配置合成 PCM，包装为 **WAV**（24 kHz mono s16le）
3. 响应：`Content-Type: audio/wav`（或 `application/json` 错误）
4. 若 `persistContent: true`：同时写入 `CONTENT_DIR`（`微信读书·{title}`）并可选 knowledge 扁平镜像；不阻塞音频返回

限流：单次 speak 文本上限约 4k 汉字；超出截断并在 JSON 错误或响应头 `X-Weread-Truncated: 1` 标明。

### `GET /api/weread/status`

- `{ configured: boolean, skillVersion: "1.0.4" }`（不回传 key）

## UI

### 入口

- 全量 WebUI `App.jsx` header：「阅读」按钮（与「设置」并列）
- `?desktop=orb` **不展示**（首版）

### `WereadReaderPanel`

抽屉结构（复用 settings-drawer 模式）：

1. **书架**：列表（书名、作者、最近阅读日）；点击选中 `bookId`
2. **金句**：当前书划线；多选；「朗读全部」「朗读选中」「停止」
3. **书评**：当前书个人想法；同样朗读控件

播放：

- 隐藏或可见的 `<audio controls>`，`src` 为 speak 返回的 blob URL
- 「停止」= `audio.pause()` + `audio.removeAttribute('src')` + revokeObjectURL
- 合成中按钮 loading；失败 toast/行内错误（缺 key、网络、空内容）

空态：

- 未配置 key → 链到微信读书 skill 说明 + 提示写 `~/.config/qwaudio/config.env`
- 无划线/无书评 → 明确文案，不调用 speak

## 数据与文案

朗读开场固定模板（可本地化字符串常量）：

```text
峰哥为你读《{title}》的{金句|想法}。
```

单条划线：直接读 `markText`。  
单条想法：若有章节名先读章节名，再读 `content`。

时间戳展示：Unix → `YYYY-MM-DD`。阅读时长仅书架详情需要时再拉 `/book/getprogress`（首版书架列表可不显进度百分比，选中后再拉一次 info/progress 显示即可）。

## 错误处理

| 情况 | 行为 |
|------|------|
| 无 `WEREAD_API_KEY` | 503，`请配置 WEREAD_API_KEY` |
| skill `upgrade_info` | 503，附官方升级说明（服务端可尝试记录 latest_version） |
| 空划线/书评 speak | 400 |
| TTS 失败 | 503，透传简短错误 |
| 微信读书 errcode | 503 + errmsg |

## 测试

- **单元**：weread-client 对 mock fetch（shelf 计数口径、highlights 映射、reviews 分页）
- **单元**：speak 文案拼接与截断；TTS 用 fake synthesizer 收 PCM → WAV header
- **路由**：capability-routes 注册 weread；缺 key / 成功 speak content-type
- **前端**：面板状态机轻测（选书 → 拉划线）；可选 jsdom audio mock
- **手工**：真 key 拉一本有划线的书，面板内播放确认峰哥音色

## 文件预期

```text
docs/superpowers/specs/2026-08-04-weread-reader-panel-design.md
server/src/voice/reader/weread/client.mjs
server/src/voice/reader/weread/export.mjs
server/src/voice/reader/weread/speak.mjs
server/src/app/capability-routes.mjs          # 挂路由
server/test/weread-*.test.mjs
web/src/WereadReaderPanel.jsx
web/src/App.jsx                              # header 入口
web/src/styles.css                           # 面板样式（克制扩展）
docs/content-ingest-rag.md                   # 链到本面板（可选一句）
```

## 成功标准

1. 浏览器打开 gateway WebUI，点「阅读」能看到书架  
2. 选有划线的书，点朗读，**不开麦**也能听到千问峰哥复刻  
3. 书评 Tab 同理  
4. 停止按钮立即停播  
5. server 相关测试通过；dependency-boundaries 不破（weread 挂在 voice/reader 下）

## 非目标（明确）

- 不替换 Fish/ListenHub；本面板固定走当前 cascade DashScope TTS 配置  
- 不在首版做「朗读时同步进连麦会话」  
- 不把 WEREAD key 暴露给前端
