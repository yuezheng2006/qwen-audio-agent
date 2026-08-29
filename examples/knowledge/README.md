# 知识旁路（WeKnora + document-buddy）

本仓不嵌知识 CMS。飞书/PDF 入库与项目管理仍在 WeKnora 或 document-buddy 原界面完成。语音侧只调用 `knowledge_search`，项目 wiki 只投影只读 MCP。

## WeKnora 旁路 PoC

不打开本仓 WebUI。先确认旁路服务自己能检索：

```bash
curl -sS -o /tmp/weknora-health.json -w "%{http_code}\n" \
  "$WEKNORA_BASE_URL/health"
# 部分部署用 /api/health 或 /api/v1/health；本仓会依次探测。

curl -sS "$WEKNORA_BASE_URL/api/v1/knowledge-bases/$WEKNORA_KB_ID/search" \
  -H "Authorization: Bearer $WEKNORA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"验收用关键词","top_k":5}'
```

期望：HTTP 200，且至少一条可映射到 `title` / `snippet` / `source` 的命中。失败时先区分「服务未起 / Key / KB 空」。

本仓接线：

```dotenv
KNOWLEDGE_PROVIDER=weknora
WEKNORA_BASE_URL=http://127.0.0.1:8080
WEKNORA_API_KEY=
WEKNORA_KB_IDS=
WEKNORA_TIMEOUT_MS=8000
WEKNORA_FALLBACK_LOCAL=1
```

`WEKNORA_FALLBACK_LOCAL=1` 时远端失败回落 `KNOWLEDGE_DIR` 本地 Markdown。权威检索仍以 WeKnora 为准。

## document-buddy（飞书项目 wiki）

把 [document-buddy.example.json](../../config/capabilities/mcp/document-buddy.example.json) 复制到用户配置目录 `capabilities/mcp/document-buddy.json`，或写入 `MCP_SERVERS_JSON`。只投影 `query_project_wiki` / `get_cited_context` / `list_review_items`。不要提交飞书 token 或 LLM key。
