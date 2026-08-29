# OpenChatCut 本地初稿执行说明

本文件只描述已验证的本地路线。OpenChatCut Desktop 每次启动会绑定随机 localhost 端口，所有调用必须经 `scripts/openchatcut_mcp.py` 动态发现，不保存旧端口，不连接旧 ChatCut 云端 MCP。

## 1. 连接与项目

```bash
python3 "${CODEX_HOME:-$HOME/.codex}/skills/book-sales-video/scripts/openchatcut_mcp.py" status
python3 "${CODEX_HOME:-$HOME/.codex}/skills/book-sales-video/scripts/openchatcut_mcp.py" list-tools
```

桥接会按需启动 `/Applications/OpenChatCut.app`，验证服务名为 `openchatcut`。调用工具的统一形式：

```bash
python3 "${CODEX_HOME:-$HOME/.codex}/skills/book-sales-video/scripts/openchatcut_mcp.py" \
  call TOOL_NAME --args-file request.json
```

1. `create_project` 明确指定名称、1080×1920 和 30fps；保存返回的 `projectId`、`timelineId`。
2. 非平凡编辑前调用 `read_project` 和 `read_timeline`，以读回的 fps、轨道和 item 为准。
3. 对已有复杂初稿做三轨以上重排前先复制 timeline；新建空项目无需快照。
4. `edit_item` 的外部 MCP 参数直接使用 `adds`、`updates`、`deletes` 数组，不套旧版 `json` 字符串。复杂事务先传 `validateOnly=true`，通过后原子提交。
5. `edit_track action=create` 的轨道定义放在 `json` 字符串中，例如 `{"trackType":"audio","name":"A1 Narration"}`。具体字段始终以当前 `list-tools` 返回为准。

## 2. 本地素材导入

本机文件不经云端上传：

1. 调用 `import_media action=register_placeholder` 建立资产占位，记录返回的 asset ID。
2. 调用 `import_media action=create_session` 取得当前本地服务的直传 URL。
3. 从宿主机把文件字节上传到该 localhost URL；不得把路径字符串误当成媒体内容。
4. 用 `read_assets` 或 `import_media` 状态读回，确认资产可预览、时长/尺寸正确后才放入时间线。
5. 同一内容用指纹去重；未知结果先读回，不重复创建会话或资产。

Pexels 视频先下载到任务目录并记录来源，再走相同本地导入。微信读书主封面、轮播封面、正文图、完整旁白和本地 BGM 都是独立资产。

## 3. 轨道与装配顺序

- V1：开场、轮播封面、揭示背景、正文主视觉。
- V2：真实主书封，且必须是一条普通 `image` 片段，可在时间线上直接选中、拖动和调整。
- V3：开场标题、书名、作者和唯一可见的中英双语可编辑字幕层。
- A1：唯一完整 `narration.wav`。
- A2：BGM，从第 0 帧开始。
- A3：`library:sound:mechanical-clicking-loop`，一段连续资产。
- A4：`library:sound:cash-register-success`，只出现一次。

推荐顺序：

1. 先导入并放置 A1，从真实可听区间生成 `voice-timeline.json`。
2. 放开场视频和居中双语标题。
3. 读取机械音效真实波形/峰值，按峰值在 V1 硬切不同封面。
4. 最后一张轮播封面经约 0.10 秒光溶进入揭示背景；把微信读书真实封面以 `type:"image"` 放入 V2，绝不以全画布 Motion Graphic 承载这张图片。以实际渲染为准，将其调为约 52%–60% 画幅宽、水平居中、书名下方、左右留白；收银成功音的重音与该 V2 图片的入场同步。当前已验证的竖屏封面可从 `x=0`、`y≈8`、`scale≈0.56` 起调。
5. 按语义配音区间放正文图片。
6. 每张正文图加 `builtin:zoom` 的慢推近/轻呼吸效果或等价关键帧；相邻图片加约 0.20 秒 `builtin:tr-cross-dissolve`。轮播内部不加转场。
7. 添加白字黑描边的中英双语字幕；OpenChatCut 原生字幕无法精确实现时使用一个可复用的双语 Motion Graphic 组件。
8. 从第 0 帧加入 BGM，降低音量或设置 duck。

主书封的出场只做一次，约 0.23 秒：`opacity 0→1`、`scale 0.42→0.60→最终值`，并从略低的 `y≈16` 落到最终 `y≈8`。结束后所有数值保持不动。不要给主书封加持续呼吸、横移、旋转或画中画 Motion Graphic。

已在本机 OpenChatCut 0.1.1 实测可用的资产/效果：

- `library:sound:mechanical-clicking-loop`
- `library:sound:cash-register-success`
- `builtin:tr-cross-dissolve`
- `builtin:zoom`（`shape=slow-push` 可用于轻微推近）

这些 ID 仍需在每次软件升级后通过 `browse_library` 或 `list-tools` 相关工具读回验证，不能只因旧状态文件存在就假定可用。

## 4. 字幕与时间

完整旁白只有一个资产。字幕卡和视觉段优先从同一次 `doubao_tts.py` 生成的句段时间账本派生；账本中的修剪后 PCM 时长与拼接静音构成明确对齐证据。只有账本缺失且配置获授权时才调用 OpenChatCut 转录或本机 ASR。没有可靠账本或词时间就停止字幕装配，不能平均分配句子冒充对齐。

全部时间先以毫秒保存，再用当前 timeline fps 转帧。修剪旁白静音后，必须同步重排 V1/V2、字幕、转场、A2/A3/A4；单轨 ripple 不能证明多轨已经同步。

## 5. 验证和导出

1. `read_project`、`read_timeline` 检查画布、fps、轨道、资产、间隙、重叠和总长。
2. 用时间线帧查看能力检查开场、轮播中点、主书封入场/中段/稳定帧、每个正文边界和末帧；不得只查看一个接触表缩略图就判定主书封尺寸正确。
3. 读回 V2，确认主书封为 `kind:"image"` 而非 Motion Graphic，且可在时间线上直接选中；逐张读回正文动效；逐边界读回转场；读回 A3/A4 的资产 ID、位置和次数。
4. 检查字幕为单套可见层，中英文均白字黑描边且无溢出。
5. 试听开头、最长停顿、正文段落边界和结尾，确认 BGM 不盖人声。
6. 写入 `quality_check.json`，运行 `validate_delivery_state.py` 后才可标记为可审核。

默认保留本机可编辑项目。用户要求导出时调用 `submit_export`，然后读取导出状态/历史，确认视频编码、尺寸、fps 和实际保存文件。点击过导出或出现系统保存框都不等于文件已经落盘。

## 6. 超时与恢复

- 端口变化：重新运行桥接发现，禁止复用旧 URL。
- 写入超时：先读回目标 item/effect，确认未写入后才重试。
- 导入超时：检查资产列表和上传会话状态，不重复传同一内容。
- 应用崩溃：重启后重新发现端口、读取项目并校验状态版本；不创建第二个项目掩盖问题。
- 本地工具缺能力：准确记录阻塞，不切换到旧云端 ChatCut，也不把扁平 ffmpeg 成片冒充可编辑项目。
