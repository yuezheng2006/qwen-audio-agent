# 微软与国内实时语音 Agent 建设参考

更新时间：2026-08-30

## 关键观察

### 微软 Azure Voice Live

微软把实时语音 Agent 收敛成统一 Voice Live API：客户端提供音频，服务返回音频、事件和可选 avatar；接口支持 WebSocket，客户端场景推荐 WebRTC。其能力包含语义 VAD、回声消除、降噪、打断、自动截断、函数调用、异步函数调用、MCP/Foundry Agent 集成和电话/Avatar 扩展。

参考：

- <https://learn.microsoft.com/en-us/azure/ai-services/speech-service/voice-live>
- <https://learn.microsoft.com/en-us/azure/ai-services/speech-service/voice-live-how-to>
- <https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-voice-live-auto-truncation>

### 国内方案

- 阿里百炼 Qwen-Omni-Realtime 同时支持 WebSocket、WebRTC、AOQ；WebRTC 面向浏览器低延迟场景，AOQ 面向更稳定的双工、弱网和端侧音频链路。事件层提供文本 delta、音频 delta、VAD 提交和 Function Calling。
- Qwen3.5-Omni / Qwen3-Omni 把音频、图片、视频理解和实时语音输出放在同一模型路线；但不同模型对联网搜索、思考模式和 Function Calling 的支持有差异，不能只看“支持实时语音”这一项。
- 阿里 Qwen-TTS/CosyVoice 的声音复刻支持 Data URL 或公开音频 URL，并可传 transcript、language hints 和目标模型；这与我们的录音裁剪后直接提交 clone 的流程匹配。
- 腾讯云提供 RTC、WebSocket 和 STS 链路：上行音频经过 ASR、LLM、TTS 后下行音频；同时支持 VAD、流式识别、热词和自定义大模型接入。
- 火山引擎已经提供端到端语音模型与混合编排模式：闲聊走端到端低延迟，识别到 Function Calling 等复杂意图后切换到外部 LLM/工具链；同时将长期记忆接入语音 Agent。

参考：

- <https://help.aliyun.com/zh/model-studio/realtime>
- <https://help.aliyun.com/zh/model-studio/s2s-model>
- <https://help.aliyun.com/en/model-studio/voice-clone-design-http-api>
- <https://cloud.tencent.com/document/product/862/135068>
- <https://www.volcengine.com/docs/6348/1544162?lang=zh>

## 对当前流程的优化

当前流程应从“录音 → clone → TTS”升级为双路径：

```text
实时对话：采集 → 回声消除/降噪 → VAD → ASR/Omni → Agent 工具 → 流式 TTS → 播放
                              ↑                         ↓
                         partial/final             barge-in + truncate

声音资产：录音 → 格式/响度/单人/噪声检查 → 裁剪 → transcript/language hints
       → provider clone → Voice Profile → A/B 试听 → 绑定 Agent → 版本管理
```

### P0：实时交互正确性

1. 把 `partial`、`final`、`audio.delta`、`audio.done`、`speech_started`、`speech_stopped` 纳入统一事件协议。
2. 播放时用户说话必须立即停止当前音频；同时将会话中的 assistant 音频按实际播放进度截断，避免 Agent 记住“说完了但用户没听到”的内容。
3. Web 端优先补 WebRTC 传输抽象；当前 WebSocket/PCM 保留为服务端、TUI 和调试 fallback。
4. Echo cancellation、noise suppression、VAD 参数进入能力协商，而不是散落在 provider 配置里。

### P1：Agent 与语音解耦

1. Voice Runtime 只负责音频与语音事件，Agent Core 负责会话、工具调用、记忆和权限。
2. 端到端 Omni provider 和 Cascade provider 都实现同一个 `VoiceSession` contract。
3. 端到端模型用于低延迟闲聊；需要搜索、知识库、日程、文件操作时切换或桥接到 Agent Core 的工具执行。
4. 所有 provider 声明是否支持 Function Calling、联网搜索、图片输入、打断、音色克隆和流式输出。

### P1：声音克隆可信链路

1. 录音完成后自动检测时长、音量、静音占比、单人概率、SNR 和格式。
2. 默认推荐 5–15 秒干净单人语音；保留用户手动调整范围。
3. clone 请求携带 transcript、language hints、provider、target model 和 consent 状态。
4. Provider 不支持 enroll 时明确提示 import Voice ID，不要静默降级。
5. Voice Profile 记录 provider、model、sample hash、创建时间、版本和是否当前使用，绝不在前端暴露原始本地路径或 provider payload。

### P2：插件与跨端

插件最小契约建议包含：

```text
id / version / license
capabilities()
platforms()
health()
startSession()
sendAudio() / sendText()
abort()
close()
```

插件运行位置分三档：浏览器/移动端轻量采集、Gateway 本机 sidecar、本地或远程 GPU worker。主 Agent 不直接依赖某个模型 SDK。

## 产品取舍

- 第一阶段只保证中文/英文：实时聊天、文字朗读、录音转写、个人音色克隆。
- 保留 DashScope、VoiceBox、Fish、MiniMax、faster-whisper 等 provider，但统一能力矩阵和错误码。
- 先做真实的打断、播放进度截断、重连与任务恢复，再扩展 Avatar、视频配音和大规模模型目录。
- 对远程 provider 在 UI 显示“音频是否离开本机”；默认本地优先，用户显式授权后才上传。

