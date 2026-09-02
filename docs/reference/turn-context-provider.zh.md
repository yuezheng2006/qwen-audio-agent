# 当前轮次记忆检索

当前轮次检索（Turn Context Retrieval）是 Cascade 的实时运行时扩展点，负责在用户仍然说话时，基于 ASR partial 预取本轮可能相关的事实、关系和情绪上下文。

它与现有三类能力保持边界：

- `MemoryProvider`：读取稳定的 `USER.md`、`MEMORY.md`，用于 instructions 前缀缓存。
- episode memory：记录最近发生过的对话和事件。
- `TurnContextRetriever`：只服务当前轮次，不修改稳定 instructions，也不替代 episode 持久化。

## Provider 合同

Cascade 通过 `createTurnContextRetriever(config, { log })` 注入 provider。provider 应提供：

```js
{
  describe() {},
  openTurn({ sessionId, turnId }) {
    return {
      partial({ text, audioFrame, atMs }) {},
      snapshot() {},
      async final({ transcript, deadlineMs }) {},
      cancel() {},
    }
  },
}
```

`partial()` 必须非阻塞，可以取消旧查询并启动新的 speculative retrieval。`snapshot()` 必须同步，不能触发 I/O。`final()` 应优先复用已完成或正在进行的预取，只允许在有限 deadline 内等待，不应在 VAD 结束后重新发起无界检索。`cancel()` 用于 barge-in、无效 turn 和连接关闭。

结果是短生命周期的当前轮次上下文，例如：

```js
{
  facts: ['用户喜欢茶'],
  relationship: ['这是用户熟悉的话题'],
  affect: ['用户可能感到疲惫'],
}
```

结果会作为本次响应的独立 context message 传给 Agent，不会写入 `session.instructions`，也不会通过 `MemoryProvider.list()` 注入。VoiceMem 可以作为该合同的一个插件实现，但核心代码不依赖 VoiceMem 的内部存储或模型。

## VoiceMem loopback bridge

启用内置适配器：

```bash
CASCADE_TURN_CONTEXT_PROVIDER=voicemem
CASCADE_TURN_CONTEXT_URL=http://127.0.0.1:8765 \
  npm run gateway:start
```

适配器向 `${CASCADE_TURN_CONTEXT_URL}/v1/turn/partial` 发送：

```json
{"session_id":"...","turn_id":"...","text":"用户当前的 partial transcript"}
```

bridge 应返回 JSON，支持 `facts`、`relationship`、`affect`，也兼容 VoiceMem 风格的 `left_hits`、`rightbrain`、`emotion` 等字段。该 HTTP bridge 是跨平台边界；VoiceMem 的 Python runtime 可以在本机作为 bridge 运行，Mac、Windows、Linux、Android 或 iOS 客户端不需要直接依赖 Python。
