# 大文件 / 播小说：叙事 RAG 与 MinerU 接入

## 原则

- **底座不动**：Gateway / cascade / TTS / ReaderSession 只消费已落盘的 `.md`。
- **成熟开源解析**：PDF / Office / 扫描件优先走 [MinerU](https://github.com/opendatalab/MinerU)（CLI 或 `mineru-api`），不自研版面引擎。
- **两模式分流**：
  - 顺序播报 → `CONTENT_DIR` + `content_control`（游标 Reader）
  - 设定/回忆问答 → 可选同步到 `KNOWLEDGE_DIR` + `knowledge_search`

```text
大文件(PDF/DOCX/…)
    │
    ▼
 MinerU（解析 → Markdown）
    │
    ▼
 分章（标题 /「第X章」）
    │
    ├─► CONTENT_DIR/<book>/ch-NN-*.md   ← 朗读
    ├─► CONTENT_DIR/<book>/CATALOG.json ← 目录
    └─►（可选）KNOWLEDGE_DIR/<book>--ch-*.md  ← 检索（扁平，进 default kb）
```

## 用法

环境变量：

```dotenv
# MinerU HTTP（推荐常驻）：mineru-api --host 127.0.0.1 --port 8000
MINERU_API_URL=http://127.0.0.1:8000
# 未设置时尝试本机 `mineru` CLI
# CONTENT_DIR=   # 默认 ~/.config/qwaudio/content
# KNOWLEDGE_DIR= # 默认 ~/.config/qwaudio/knowledge
```

CLI：

```bash
npm run content:import -- ./小说.pdf --title 某书 --index-knowledge
npm run content:import -- ./讲稿.docx
npm run content:import -- ./已有.md   # 纯文本/Markdown 不调 MinerU
```

HTTP（本机路径，个人模式）：

```http
POST /api/content/import
Content-Type: application/json

{
  "sourcePath": "/absolute/path/to/book.pdf",
  "title": "某书",
  "indexKnowledge": true
}
```

导入后语音侧：`content_control` → `list` → `start_read`（`content_id` 用章节文件名或 `doc_*`）。

## 边界

| 做 | 不做 |
|---|---|
| MinerU 出 Markdown | 自研 OCR / 版面 |
| 分章写盘 + CATALOG | 改 realtime-gateway |
| 可选 knowledge 镜像 | 把整本塞进 LLM 上下文 |
| txt/md 直通 | 强依赖 epub（可先转 PDF/DOCX） |

标签与 Plus/Flash 仍走现有 TTS 插件；播长篇默认 Flash，情绪标签少用。

## 与 WeKnora 的分工

- **MinerU / `CONTENT_DIR`**：个人机大文件进朗读管道（`content_control`）。
- **WeKnora**：企业/飞书素材的权威检索；语音只走 `knowledge_search`。
- **本地 `KNOWLEDGE_DIR`**：可读备份与离线兜底（`WEKNORA_FALLBACK_LOCAL=1`）。
- 双库短暂不一致时，在线以 WeKnora 为准。管理台不进本仓 WebUI。

旁路 PoC 与 document-buddy 只读投影见 [examples/knowledge/README.md](../examples/knowledge/README.md)。

## 参考

- MinerU：https://github.com/opendatalab/MinerU
- 快速用法：`mineru -p <input> -o <output>` / `mineru-api`
- 本仓实现：`server/src/voice/reader/ingest/`
