# cc-connect Profile Manager (ccpm)

> 个人化的 cc-connect 多 profile 工具：暗色 Web UI + CLI，
> 每个 profile = 一个项目 + 一个 AI Provider + 一个移动端入口，
> 互不干扰地共存、按需启停。

它**不会修改 cc-connect 源代码**，也**不替代 cc-connect 内置 Web UI**。
它只是生成标准的 `config.toml` 并以 `cc-connect --config <profile>/config.toml` 启动对应实例。

## 它解决什么

- 不想再为不同项目反复编辑同一份 `config.toml`
- 想给 Codex / Claude Code / Gemini / Cursor 等不同 Agent 各开一个 profile
- 想让 Telegram bot token、飞书 App Secret、Slack token 这种凭据**只录一次**，新建 profile 时挑选即可
- 想给每个实例独立的 `data_dir` / management 端口 / bridge 端口 / 日志目录
- 想直接复用 cc-connect 自带的 `provider-presets.json`（MiniMax / AIHubMix / DMXAPI 等 30+ 推荐供应商）

## 安装与启动

```bash
cd tools/cc-connect-profile-manager
node ccpm.js serve
```

默认监听 `http://127.0.0.1:9876` 并自动打开浏览器。

```bash
node ccpm.js serve --port 9900 --no-browser    # 自定义端口、不弹浏览器
node ccpm.js serve --home /data/ccpm           # 数据目录
node ccpm.js serve --cc-connect-root /opt/cc   # cc-connect 仓库位置（用于读取 provider-presets.json）
```

默认数据目录：`~/.cc-connect-profile-manager/`
默认 cc-connect repo 探测顺序：`--cc-connect-root` → `CC_CONNECT_ROOT` → 自动向上查找。

## Web UI 工作流

主界面是一个深色 Dashboard：

- **左侧 sidebar** — 所有 profile，带状态点（运行中会脉冲）、`agent · platform` 徽章、工作目录预览，⌘ K 聚焦搜索
- **顶部状态卡** — 大号 Running/Stopped pill、PID、Management URL / Bridge URL（一键复制），Start / Restart / Stop / Save / Remove 一组操作
- **Project 卡** — 项目名 + 工作目录（带目录选择 modal）
- **AI Provider 卡** — 三类预设统一选择：
  - cc-connect 自带的 curated presets（按当前 Agent 自动过滤）
  - 本机检测（`~/.codex/config.toml`、`~/.claude.json`、`OPENAI_API_KEY` 等）
  - 你自定义的 Provider 预设
- **Mobile platform 卡** — 选择平台后**自动渲染该平台的专属字段**（不再让你自己写 JSON），高级字段折叠
- **Advanced 卡** — 语言、日志级别、管理端口、Provider env JSON、Management token
- **底部 tab** — `config.toml` 文本预览 + **实时日志流（SSE）**，运行中可暂停/恢复
- **Preset Library 抽屉** — 维护 Provider 预设和平台预设；平台预设按 type 渲染对应字段

### 平台支持

每个平台都有专属字段定义：

| 平台 | 必填字段 | 备注 |
|---|---|---|
| Telegram | `token` | 长轮询，无需公网 |
| Feishu (CN) | `app_id`, `app_secret` | WebSocket，无需公网 |
| Lark (Intl.) | `app_id`, `app_secret` | 同上 |
| Slack | `bot_token`, `app_token` | Socket Mode |
| Discord | `token` | Gateway，无需公网 |
| DingTalk | `client_id`, `client_secret` | Stream 模式 |
| WeChat Work | 模式可选 HTTP / WebSocket | 字段动态切换 |
| QQ (OneBot) | `ws_url` | 需 NapCat / LLOneBot |
| QQ Bot 官方 | `app_id`, `app_secret` | WebSocket |
| LINE | `channel_secret`, `channel_token` | 需公网 webhook |
| Weibo DM | `app_id`, `app_secret` | WebSocket |
| WeChat 个人 (ilink) | `token` | 需 ilink 网关 token |
| MAX | `token` | 长轮询，可切 webhook |
| WPS 协作 | `app_id`, `app_secret` | WebSocket |

### Agent 支持

`claudecode`, `codex`, `cursor`, `gemini`, `iflow`, `opencode`, `qoder`, `kimi`, `devin`, `acp`, `tmux`, `pi`，每个有自己的 mode 枚举（如 codex: `suggest / auto-edit / full-auto / yolo`）。

## CLI 速查

```bash
ccpm create --name app --work-dir /path/to/app \
            --agent codex --mode suggest \
            --platform telegram --platform-token 123:abc \
            --api-key sk-xxx --model gpt-5.4
ccpm list
ccpm status app
ccpm start app [--bin /path/to/cc-connect] [--timeout 6000]
ccpm restart app
ccpm stop app
ccpm logs app [--follow] [-n 200]
ccpm config app
ccpm remove app
ccpm serve  [--port 9876] [--no-browser] [--cc-connect-root DIR]
```

`start` 会等 cc-connect 的 management API（默认 ≤6s）可达再返回，超时会自动打印最近 30 行日志，比旧版"立即 detach 看不到反馈"友好得多。

## 数据布局

```
<home>/                                # 默认 ~/.cc-connect-profile-manager
  presets.json                         # 自定义 Provider + 平台预设
  profiles/
    <name>/
      profile.json                     # ccpm 内部元数据
      config.toml                      # 标准 cc-connect 配置
      cc-connect.pid                   # 运行中由 ccpm 启动的进程 PID
      started_at                       # ISO 时间戳
      data/                            # 该 profile 独立的 cc-connect 数据目录
      logs/cc-connect.log              # 该实例日志
```

## 生成的 config.toml 示例

```toml
data_dir = "/home/me/.cc-connect-profile-manager/profiles/app/data"
language = "zh"

[log]
level = "info"

[management]
enabled = true
port = 10141
token = "..."
cors_origins = ["*"]

[bridge]
enabled = true
port = 11141
token = "..."
path = "/bridge/ws"
cors_origins = ["*"]

[[providers]]
name = "primary"
api_key = "sk-xxx"
model = "gpt-5.4"

[[projects]]
name = "app"

[projects.agent]
type = "codex"
provider_refs = ["primary"]

[projects.agent.options]
work_dir = "/path/to/app"
mode = "suggest"
provider = "primary"

[[projects.platforms]]
type = "telegram"

[projects.platforms.options]
token = "123:abc"
```

## 多实例提示

可以并行启动多个 profile —— 端口、token、日志、data_dir 都按 profile 自动隔离。
但**别让多个运行中的 profile 复用同一个 Telegram bot token / 飞书 App / Slack app**，
否则会出现消息重复、事件被抢占、webhook 冲突。

## 代码结构

```
tools/cc-connect-profile-manager/
├── ccpm.js                  # 薄 CLI 入口
├── package.json
├── smoke-test.js            # 端到端冒烟测试（CLI + HTTP）
├── src/
│   ├── agents.js            # Agent 元数据（type / modes / default_mode）
│   ├── cli.js               # 子命令调度
│   ├── config.js            # TOML 渲染
│   ├── discovery.js         # 本机 Provider 检测 + 目录浏览
│   ├── platforms.js         # 13 个平台的字段 schema
│   ├── presets.js           # 读取 cc-connect provider-presets.json
│   ├── runtime.js           # spawn / wait_for_management / SSE 增量 tail
│   ├── server.js            # HTTP + SSE 路由
│   └── store.js             # Profile / Preset CRUD
└── public/
    ├── index.html
    ├── styles.css           # Linear/Vercel 风深色设计系统
    └── app.js               # 前端 SPA（vanilla ES Module）
```

零运行时依赖，纯 Node `>= 18`。

## 自检

```bash
node --check ccpm.js                       # 语法
node smoke-test.js                         # CLI + HTTP 烟测
npm run check                              # 上面两步
```

如果在 sandbox 环境里 npm 无法写 `~/.npm`，直接 `node smoke-test.js` 即可。
