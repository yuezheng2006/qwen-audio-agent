# VoiceMem 本地桥

这是一个独立的 Python loopback bridge，把 VoiceMem 的外部 ASR 流式接口接到 Cascade 的 `TurnContextRetriever`。Cascade 继续负责 VAD、ASR、Agent 回复和 TTS；本桥只负责当前轮次检索。

## 安装与启动

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

export OPENAI_API_KEY=...
uvicorn app:app --host 127.0.0.1 --port 8765
```

默认使用 DeepSeek，且默认以 `text_mode` 运行，避免和 Cascade 重复加载 ASR/VAD：

```bash
export DEEPSEEK_API_KEY=...
# 可选：deepseek-chat / deepseek-reasoner，或任意 OpenAI-compatible 模型
export VOICEMEM_LLM_MODEL=deepseek-v4-flash
export VOICEMEM_LLM_BASE_URL=https://api.deepseek.com
```

切换到本机 Ollama：

```bash
export VOICEMEM_LLM_PROVIDER=ollama
export VOICEMEM_LLM_MODEL=qwen2.5:7b  # 替换成 ollama list 中的实际模型名
export VOICEMEM_LLM_BASE_URL=http://127.0.0.1:11434/v1
```

Ollama 不需要真实 API key，bridge 会使用占位值 `ollama`。本机已有的 `nomic-embed-text` 不直接用于 VoiceMem 记忆库，避免和已有 E5 记忆向量混用；当前 bridge 统一使用本地 E5 embedding。

记忆向量和 slot 分类默认使用本地 E5，不调用 DeepSeek Embeddings；因此不会把不支持 embeddings 的便宜模型错误地当成向量模型。也可以将 `VOICEMEM_LLM_BASE_URL` 指向自建 vLLM、Ollama OpenAI 兼容端点或其他免费额度服务。

在 qwen-audio-agent 侧启用：

```bash
export CASCADE_TURN_CONTEXT_PROVIDER=voicemem
export CASCADE_TURN_CONTEXT_URL=http://127.0.0.1:8765
```

首次启动只预热本地 E5/slot 分类器，不会重复加载 Cascade 已负责的 ASR/VAD；耗时和模型目录由 VoiceMem 决定。客户端不需要安装 Python；Mac、Windows、Linux 客户端都通过 Gateway 访问同一条能力链路。

本桥不调用 `ingest()`，因此不会自动修改 `USER.md`、`MEMORY.md` 或 episode。持久化策略仍由 qwen-audio-agent 的长期记忆和情节记忆层负责。
