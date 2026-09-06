# VoiceStudio UI 深度对标与 Lingora 质感规范

更新时间：2026-09-06

参考仓库：[debpalash/VoiceStudio](https://github.com/debpalash/VoiceStudio)

## 结论

VoiceStudio 的优势不是“黑色背景 + 粉色按钮”，而是把语音工具做成了一个稳定的工作台：

1. 工作区是主导航，语音模式通过可访问的 tabs 进入；不是把所有功能堆在一个 launchpad 里。
2. 表单可以滚动，但核心 CTA（生成/试听/停止）固定在用户可见位置。
3. 录音、上传、设计、转换是渐进展开的互斥路径；不相关的设备、采样和元数据不会一开始全部出现。
4. 音色选择、试听、历史播放共享组件和单一播放仲裁，不让每个页面各自实现一套 audio 控件。
5. GPU、模型、后端启动、生成失败和恢复是 UI 的一等状态，而不是把错误丢到日志里。
6. 组件有明确的设计 token：4px 间距基线、小圆角、温暖低对比色、语义色、focus ring、短动效和 z-index 层级。

## 参考实现中值得借鉴的组件

| 组件 | 解决的问题 | Lingora 的独立实现 |
| --- | --- | --- |
| Header / NavRail | 在不拥挤的情况下切换工作区，状态跟随当前模式 | Rust/Web 共用工作区协议；顶部只放品牌、当前状态和必要动作 |
| CloneDesignTab | 把 From audio / By design / Convert 统一成一个工作区 | `VoiceStudioPanel` 的工作区 tabs；后续将三种流程统一到同一状态机 |
| AudioMethodPanel + MicButton | 上传与录音二选一，录音中锁定设备设置并展示输入电平 | 录音页采用 source mode；录音、裁剪、提取阶段分别表达状态 |
| ScriptPanel | 文稿输入、插入表达式 token、demo coachmark | 保留极简文稿区；插件提供 token schema，不把插件细节写死在 UI |
| ActionBar | 日常控制与高级采样参数分层，生成按钮保持可达 | 生成控制固定在工作区底部，高级参数折叠且可被插件扩展 |
| VoiceSelector | 搜索、分组、最近使用、试听、创建和真实 profile ID 的统一契约 | `voice.profile.*` 协议只传 profile ID；gallery/archetype 由 adapter 物化 |
| WaveformPlayer | 播放、波形、时间、失效 fallback 和跨页面单播放 | 统一 `VoicePreviewPlayer`；Web、Tauri、移动端共享播放协议 |
| Settings primitives | 让大规模设置仍然可读、可搜索、可恢复 | `settings.*` 插件 schema + capability guard，避免平台分支污染工作区 |

## VoiceStudio 的设计设定

- 底色：`#1d2021` / `#0f1011`，黑但不纯黑，给层级留出空间。
- 主文字：温暖米色 `#ebdbb2`；次文字 `#a89984`；弱文字 `#7c6f64`。
- 品牌色：柔和粉 `#d3869b`，只用于 active、CTA、播放进度和焦点，不铺满表面。
- 语义色：成功绿 `#8ec07c`、警告橙 `#fe8019`、危险红 `#fb4934`、信息蓝 `#83a598`。
- 间距：2 / 4 / 6 / 8 / 12 / 16 / 24 / 32 / 44px；默认 4px 基线。
- 圆角：2 / 3 / 4 / 6 / 10px；避免“卡片应用”的大圆角泛滥。
- 动效：80ms / 120ms / 200ms / 300ms，默认 ease-out；只为状态变化服务。
- 交互：所有按钮有 keyboard focus、禁用态、加载态和可恢复错误；短屏幕优先验证 390px 与 600px 高度。

## Lingora 要超过它的地方

### 1. 设计 token 跨端化

VoiceStudio 的 token 主要服务 Web/Tauri。Lingora 应将颜色、间距、状态和动效抽成跨端 schema：

```text
ui.theme.surface.canvas
ui.theme.surface.panel
ui.theme.accent.brand
ui.state.connection.ready
ui.state.connection.reconnecting
ui.state.generation.running
ui.state.generation.recoverable
ui.motion.transition.fast
```

Web、Tauri、iOS、Android 只实现渲染，不各自发明语义。

### 2. 状态优先于装饰

每个语音工作流必须能回答：当前阶段、输入是否可用、输出是否可播放、下一步是什么、失败是否可重试。UI 不显示“看起来像完成”的静态卡片。

### 3. 插件不污染主画布

插件只提供 capability、form schema、执行句柄和结果 artifact；主工作区只渲染通用 slot：`source`、`script`、`controls`、`result`、`history`。这样接入 Whisper、faster-whisper、云端 TTS 或本地 Ollama 不会复制页面。

### 4. 更强的音频体验

统一 waveform / playback manager，支持试听、停止、拖拽定位、失效文件提示、Tauri WebKit fallback、全局单播放和录音输入电平。声音库、克隆、配音、朗读全部复用。

### 5. 新手路径更短，专家路径可展开

默认只显示“选择声音 → 写文稿 → 生成”；上传/录音、设计属性、采样参数、设备选择、插件参数按需展开，并在每一步给出可理解的下一动作。

## 当前差距与实施顺序

1. 已完成：VoiceStudio 三栏主工作台、统一滚动容器、profile 真实选择、`voice/narrate` 生成、试听和 Gateway 连接隔离。
2. 当前优先：把克隆页改造成 Upload / Record 二选一，加入录音输入电平、波形预览、裁剪状态和固定提取 CTA。
3. 下一步：让声音库/工作台共享同一个 preview/playback manager，并将“选用”结果广播到 Web/Tauri 会话。
4. 再下一步：把工作区 controls/result/history 抽成插件 slot，形成跨端 UI protocol。

## 约束

- 参考 VoiceStudio 的交互原则，不复制名称、品牌、代码或素材。
- 保持 agent、Gateway、平台 UI、插件 adapter 分层；视觉组件不得直接读取 provider secret 或启动进程。
- 所有 UI 改动必须通过 Web build、Web tests、Tauri check/build 和浏览器短屏验证。
