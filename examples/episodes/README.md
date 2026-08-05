# 情节记忆 examples

手验 / 离线冒烟用样例。正式落盘默认在 `~/.config/qwaudio/episodes/`（不在本仓库）。

## 文件

| 路径 | 说明 |
| --- | --- |
| `demo.json` | 与 local-store 同形的样例（owner=`demo`） |
| `smoke.mjs` | 离线召回冒烟：拷到 `local/` → filter → recall → 打印 `## Recent Episodes` |
| `local/` | **gitignore**；smoke 与本地手验临时目录 |

## 离线冒烟

```bash
node examples/episodes/smoke.mjs
EPISODE_SMOKE_QUERY=绿茶 node examples/episodes/smoke.mjs
```

## Gateway / Cascade 手验

Cascade 经 Gateway 自动走情节记忆（无需改 cascade session）。

```bash
# 可选：预置样例（personal 模式 ownerId 以实际为准，常见为 default）
mkdir -p examples/episodes/local
cp examples/episodes/demo.json examples/episodes/local/default.json
EPISODE_DIR="$PWD/examples/episodes/local" npm run gateway:start
```

多会话清单见 `docs/superpowers/specs/2026-08-05-episode-memory-design.md`。

## 单测

```bash
node --test server/test/episode-*.test.mjs
```
