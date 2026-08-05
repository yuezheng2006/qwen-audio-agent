# Android Voice Agent Demo

演示用 Android 工程：**`:sdk`**（可复用 Realtime 客户端）+ **`:app`**（薄 Compose GUI）。

对接本仓 Gateway，**不改服务端协议**。设计见  
`docs/superpowers/specs/2026-08-05-android-demo-design.md`。

## 结构

```text
examples/android-demo/
  :sdk   VoiceAgentClient — WS + PCM 采播
  :app   单屏演示：连接 / 按住说话 / 文本 / 打断 / 字幕
```

## 准备

1. 安装 Android Studio（或 SDK + JDK 17）与 `adb`。
2. 本机启动 Gateway（cascade）：

```bash
# 仓库根目录
npm run gateway:start
```

### 推荐：USB + adb reverse（免改防火墙 / origin）

手机 USB 调试连接后：

```bash
adb reverse tcp:3101 tcp:3101
cd examples/android-demo
./gradlew :app:installDebug
adb shell am start -n com.qwenaudio.agent.demo/.MainActivity
```

App 默认 URL：`http://127.0.0.1:3101`（经 reverse 打到 Mac 上的 Gateway）。

### 备选：同一 Wi‑Fi 直连局域网 IP

Gateway 默认只接受 loopback 无 Origin 请求；直连 `http://192.168.x.x:3101` 会被 `origin not allowed` 拦住。  
需 `HOST=0.0.0.0` **且**扩展 allowlist（尚未做成一键配置）。USB reverse 演示请优先用上一节。

## 构建与安装

用 Android Studio 打开本目录 `examples/android-demo/`，Sync → Run。

或命令行（需已配置 `ANDROID_HOME`）：

```bash
cd examples/android-demo
./gradlew :app:installDebug
```

## 手验清单

1. App 填 `http://<电脑局域网IP>:3101` → **连接**（状态到 `connected`）
2. **按住说话** → 用户字幕 → 听到 TTS，助手字幕更新
3. 文本框发送一轮
4. 播放中点 **打断** → 停播，可继续说
5. 关 Gateway / 断网 → 显示断开；恢复后可重连

## 说明

- Demo 开启 cleartext（`ws://` / `http://`）仅供局域网演示；生产请用 `wss://`。
- `authToken` 已在 SDK 预留，personal 模式第一期不用。
- 第一期不做任务卡 / 权限 UI；`task.*` 事件可忽略。

## SDK 用法摘要

```kotlin
val client = VoiceAgentClient(
  VoiceAgentConfig(baseUrl = "http://192.168.1.8:3101"),
)
client.connect()
client.startListening() // PTT down
client.stopListening()  // PTT up
client.sendText("你好")
client.interrupt()
client.events.collect { /* ConnectionChanged / Transcript / Error … */ }
```
