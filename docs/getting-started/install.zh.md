# 安装

需要 Node.js ^22.22.2、^24.15.0 或 >=26.0.0，npm 10+。使用默认的 DashScope
实时语音前台时，还需要 DashScope API Key。
仓库提供 `.nvmrc` 和 `.node-version`；使用 nvm 时可直接运行 `nvm use`。

## 一键安装

推荐从 npm 安装：

```bash
npm install -g qwen-audio-agent
```

也可以直接从 GitHub 安装最新代码：

```bash
npm install -g git+https://github.com/QwenAudio/qwen-audio-agent.git
```

## 从源码安装

```bash
git clone https://github.com/QwenAudio/qwen-audio-agent.git
cd qwen-audio-agent
npm install
npm run install:global
```

## 升级

升级到最新 npm 版本：

```bash
npm install -g qwen-audio-agent@latest
```

升级到 GitHub 最新代码：

```bash
npm install -g git+https://github.com/QwenAudio/qwen-audio-agent.git
```

升级后如果以后台服务方式运行 Gateway，需执行 `qwenaudio gateway restart` 让新版本生效。

## 验证安装

查看配置文件的准确位置并确认安装就绪：

```bash
qwenaudio config
```

配置后台 Agent 后，可运行只读检查确认后台可执行文件、ACP 接入和适配器是否就绪：

```bash
qwenaudio setup
```

## 配置文件位置

CLI 与桌面版共享 `~/.config/qwaudio/config.env`（设置、身份、记忆与共享 workspace
都在同一个用户目录下）。只有运行时状态——Gateway 进程、锁、日志与皮肤——存放在桌面版
自己的应用数据目录（macOS 为 `~/Library/Application Support/Qwen Audio Agent`），两者可以同时运行。设置 `QWAUDIO_CONFIG_DIR` 或
`XDG_CONFIG_HOME` 可以更改配置目录。详见[配置说明](../configuration.zh.md)。

## 获取 DashScope API Key

阿里云百炼为 Qwen Audio 3.0 Realtime 提供
[新人免费额度](https://help.aliyun.com/zh/model-studio/new-free-quota)，创建 API Key 后
即可免费开始使用 qwen-audio-agent。

1. 打开百炼控制台的 [API Key 页面](https://bailian.console.aliyun.com/?tab=model#/api-key)，
   登录账号，单击**创建 API Key**。
2. 复制生成的 Key，稍后填入 `config.env`。请勿公开或提交 API Key。

详细说明见[百炼官方文档](https://help.aliyun.com/zh/model-studio/get-api-key)。

## 云主机 15 分钟（自托管 Docker）

第一期默认**仅前台**：容器里不装 OpenCode / Claude。桌面版继续本机运行；网站走 HTTPS 反代。

1. 准备一台能出网的云主机，装好 Docker 与 Compose，解析域名到该主机。
2. 在仓库里复制环境文件并填写 Key、公开 Origin、进线令牌：

```bash
cp deploy/.env.example deploy/.env
# 编辑 deploy/.env：
#   SITE_ADDRESS=voice.example.com
#   DASHSCOPE_API_KEY=...
#   QWEN_AUDIO_AGENT_ALLOWED_ORIGINS=https://voice.example.com
#   SUPPORT_INBOUND_TOKEN=...
#   BASIC_AUTH_USER=operator
#   BASIC_AUTH_HASH=$(docker run --rm caddy:2.10-alpine caddy hash-password --plaintext 'your-password')
```

3. 启动 Gateway + Caddy（只对外暴露 80/443，不要映射 3101）：

```bash
cd deploy
docker compose up -d --build
curl -fsS https://voice.example.com/livez
```

4. 浏览器打开 `https://voice.example.com` 说话（运营台走 Caddy basic auth）。
   客服进线 `https://voice.example.com/support?token=<SUPPORT_INBOUND_TOKEN>`
   不经过运营登录；WebSocket 带 `workspace=support`，Gateway 再验进线令牌。
   `BASIC_AUTH_HASH` 留空时 Caddy 不设运营登录，只适合本机试跑。
5. 数据在 Docker 卷 `qwaudio-data`（对应容器内 `QWAUDIO_CONFIG_DIR=/data`）。
   `QWEN_AUDIO_AGENT_AUTH_SECRET` 不是远程密码，远程认证只认 Caddy basic auth。

飞书知识旁路（可选）：把 `KNOWLEDGE_PROVIDER=weknora` 与 WeKnora 地址写进
`deploy/.env`，或把 `config/capabilities/mcp/document-buddy.example.json`
复制到数据卷的 `capabilities/mcp/`。管理台仍在 WeKnora / 飞书，本仓不做 CMS。
详见 [examples/knowledge/README.md](../../examples/knowledge/README.md)。
