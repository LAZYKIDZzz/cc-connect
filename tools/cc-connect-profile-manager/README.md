# cc-connect Profile Manager

这是一个 **非侵入式** 的 cc-connect 辅助工具，用来快速创建、切换和启动多套隔离的 `config.toml`。

它不会修改 cc-connect 原项目代码，也不会替代 cc-connect 内置 Web UI。它只是生成标准 cc-connect 配置文件，并通过：

```powershell
cc-connect --config <profile>\config.toml
```

启动对应实例。

## 适合场景

- 你经常为不同项目手动修改 `config.toml`
- 你希望项目目录、AI Provider、移动端平台凭据相互隔离
- 你希望移动端平台凭据一次维护、多次复用
- 你希望日志、语言、端口、Provider env 等默认参数不要干扰日常创建流程
- 你希望必要时同时启动多个 cc-connect 实例

## 快速启动

```powershell
cd tools\cc-connect-profile-manager
node ccpm.js serve
```

默认访问：

```text
http://127.0.0.1:9876
```

指定本工具自己的数据目录：

```powershell
node ccpm.js serve --home D:\ccpm
```

默认数据目录：

```text
%USERPROFILE%\.cc-connect-profile-manager
```

## Web UI 工作流

主界面按高频使用路径设计成三步：

1. **项目**
   - 填写 Profile 名称
   - 填写 cc-connect 项目名
   - 通过目录浏览器选择项目路径

2. **AI Provider**
   - 选择 Agent：`codex`、`claudecode`、`gemini` 等
   - 可从本机配置或环境变量中检测 Provider
   - 也可以从预设库一键套用 API Key、Base URL、Model

3. **移动端平台**
   - 选择 Telegram、Feishu、Slack、Discord 等平台
   - 平台 token、app_id、app_secret 等凭据建议先放入预设库
   - 创建 profile 时只选择对应平台预设

日志级别、语言、Provider env、Platform options JSON 被收纳在 **高级选项** 中。正常新增项目时通常不需要展开。

## 预设库

点击左侧 **预设库** 可以维护两类信息：

- **Provider 预设**
  - 显示名称
  - Agent 类型
  - Provider 名称
  - API Key
  - Base URL
  - Model

- **移动端平台预设**
  - 显示名称
  - 平台类型
  - Options JSON

例如 Telegram：

```json
{
  "token": "123456:abcdef"
}
```

例如 Feishu：

```json
{
  "app_id": "cli_xxx",
  "app_secret": "sec_xxx",
  "allow_from": "*"
}
```

预设会保存到：

```text
<home>\presets.json
```

## 本机 Provider 检测

工具会尝试读取以下信息作为候选 Provider：

- `%USERPROFILE%\.codex\config.toml`
- `%USERPROFILE%\.claude.json`
- 环境变量 `OPENAI_API_KEY`
- 环境变量 `ANTHROPIC_API_KEY`
- 环境变量 `GEMINI_API_KEY`

如果你不希望 API Key 出现在本工具生成的 profile 中，可以只保存 Agent/Model/Base URL，在启动 cc-connect 的 shell 环境里继续使用原有环境变量。

## 命令行用法

创建 profile：

```powershell
node ccpm.js create --name app --work-dir D:\dev\app --agent codex --platform telegram --platform-token "123:abc"
```

启动 profile：

```powershell
node ccpm.js start app
```

如果 `cc-connect` 不在 `PATH` 中，可以显式指定二进制路径：

```powershell
node ccpm.js start app --bin D:\tools\cc-connect.exe
```

常用命令：

```powershell
node ccpm.js list
node ccpm.js status app
node ccpm.js logs app
node ccpm.js config app
node ccpm.js stop app
node ccpm.js restart app
```

## 生成目录

每个 profile 都会生成独立目录：

```text
<home>\profiles\<name>\
  profile.json
  config.toml
  cc-connect.pid
  data\
  logs\cc-connect.log
```

其中：

- `profile.json` 是本工具自己的元数据
- `config.toml` 是标准 cc-connect 配置文件
- `data\` 是该 profile 独立的 cc-connect 数据目录
- `logs\cc-connect.log` 是该实例日志
- `cc-connect.pid` 记录由本工具启动的进程 PID

## 生成的 config.toml

每个 profile 都包含独立的：

- `data_dir`
- `[management]`
- `[bridge]`
- `[[providers]]`
- `[[projects]]`
- `[projects.agent]`
- `[projects.agent.options]`
- `[[projects.platforms]]`

示例：

```toml
data_dir = "D:\\ccpm\\profiles\\app\\data"
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
cors_origins = ["*"]

[[providers]]
name = "primary"
api_key = "sk-xxx"
model = "gpt-5.3-codex"

[[projects]]
name = "app"

[projects.agent]
type = "codex"
provider_refs = ["primary"]

[projects.agent.options]
work_dir = "D:\\dev\\app"
mode = "default"
provider = "primary"

[[projects.platforms]]
type = "telegram"

[projects.platforms.options]
token = "123:abc"
```

## 多实例建议

可以同时启动多个 profile。工具会为每个 profile 自动分配独立的：

- `data_dir`
- management 端口
- bridge 端口
- token
- 日志目录

但要注意：

- 不建议多个运行中的 profile 复用同一个 Telegram bot token、Feishu app、Slack app 等平台凭据
- 同一平台凭据被多个实例同时使用时，可能出现消息重复、事件被抢占或 webhook 冲突
- 如果只是切换项目，通常启动一个 profile 即可
- 如果确实需要多个项目并行在线，建议为每个实例准备独立移动端入口

## 和 cc-connect 内置 Web UI 的关系

cc-connect 内置 Web UI 更适合管理单个运行中的实例。

本工具更偏向：

- profile 编排
- 多配置切换
- 多实例启停
- 强隔离使用习惯

两者可以并存。本工具生成的 profile 会启用独立 `[management]`，因此实例启动后仍然可以访问该实例自己的 cc-connect Web UI。

## 自检

语法检查：

```powershell
node --check ccpm.js
```

Smoke test：

```powershell
node smoke-test.js
```

或：

```powershell
npm run check
```

在某些 sandbox 环境里，`npm run check` 可能因为 npm/Node 访问用户目录被拒绝而失败。这种情况下直接运行 `node --check ccpm.js` 和 `node smoke-test.js` 即可。
