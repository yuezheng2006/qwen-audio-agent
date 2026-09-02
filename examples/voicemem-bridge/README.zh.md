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

在 qwen-audio-agent 侧启用：

```bash
export CASCADE_TURN_CONTEXT_PROVIDER=voicemem
export CASCADE_TURN_CONTEXT_URL=http://127.0.0.1:8765
```

首次启动会按 VoiceMem 的实现加载本地模型，耗时和模型目录由 VoiceMem 决定。客户端不需要安装 Python；Mac、Windows、Linux 客户端都通过 Gateway 访问同一条能力链路。

本桥不调用 `ingest()`，因此不会自动修改 `USER.md`、`MEMORY.md` 或 episode。持久化策略仍由 qwen-audio-agent 的长期记忆和情节记忆层负责。
