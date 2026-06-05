# Pi Web Seeker

[pi 编程智能体](https://github.com/earendil-works/pi) 的网页界面。在浏览器中浏览会话、与智能体对话、分叉对话、切换消息分支。

仓库地址：[linky-fan/pi-web-seeker](https://github.com/linky-fan/pi-web-seeker)

## 界面预览

Pi Web Seeker 内置多套 theme，可在左下角或顶部工具栏快速切换。下面是几套代表性配色：

| Rose | Solarized |
| --- | --- |
| ![Rose theme preview](docs/screenshots/theme-rose.png) | ![Solarized theme preview](docs/screenshots/theme-solarized.png) |
| 柔和明亮，适合长时间阅读。 | 低对比暖色，代码和文档都清爽。 |

| Tokyo Night | Gruvbox |
| --- | --- |
| ![Tokyo Night theme preview](docs/screenshots/theme-tokyo.png) | ![Gruvbox theme preview](docs/screenshots/theme-gruvbox.png) |
| 深色蓝紫，适合夜间编码。 | 复古暖色终端风，辨识度高。 |

## 快速开始

**无需安装，直接从当前仓库运行：**

```bash
npx github:linky-fan/pi-web-seeker
```

首次从 GitHub 运行时，npm 会自动构建一次 Next.js 生产产物；之后 `pi-web` 会直接用构建好的产物启动。本地开发目录里执行 `npm install` 不会自动构建，仍按下方开发流程使用 `npm run dev`。

**或全局安装后使用：**

```bash
npm install -g github:linky-fan/pi-web-seeker
pi-web
```

默认监听 `0.0.0.0`，本机打开 [http://localhost:30141](http://localhost:30141)，局域网设备可访问 `http://<你的局域网 IP>:30141`。

开发模式也已放行常见私网来源：`127.*.*.*`、`10.*.*.*`、`172.16.*.*` 到 `172.31.*.*`、`192.168.*.*`。如果浏览器仍无法访问，请确认系统防火墙和虚拟机/容器端口映射允许 `30141` 入站。

如果机器所在局域网并不完全可信，建议开启访问令牌：

```bash
PI_WEB_ACCESS_TOKEN=your-long-random-token pi-web
```

首次访问时打开 `http://<host>:30141/?token=your-long-random-token`，服务端会写入 HttpOnly cookie 并跳转回普通页面。设置后页面入口和 `/api/*` 都需要这个 cookie；脚本调用 API 时也可以使用 `Authorization: Bearer <token>` 或 `x-pi-web-token: <token>`。

**可选参数：**

```bash
pi-web --port 8080               # 自定义端口
pi-web --hostname 127.0.0.1      # 仅本机访问
pi-web --hostname 0.0.0.0        # 允许局域网访问（默认）
pi-web -p 8080 -H 127.0.0.1     # 组合使用

PORT=8080 pi-web                 # 也支持环境变量
PI_WEB_BIND_HOST=127.0.0.1 pi-web # 环境变量指定绑定地址
```

## Docker

本机个人使用可以直接用 Docker Compose：

```bash
docker compose up --build
```

启动后打开 [http://localhost:30141](http://localhost:30141)。

默认会挂载：

- `.pi-web-data` → `/home/piweb/.pi`，保留会话、模型、登录凭据、settings、skills、prompts、themes 等用户数据
- `.pi-web-workspace` → `/workspace`，作为容器内默认工作目录
- `~/.ssh` → `/home/piweb/.ssh:ro`，方便智能体读取私有仓库

Docker Compose 默认启用单工作区模式：页面会自动选择 `/workspace`，Explorer 只显示 `.pi-web-workspace` 这个独立工作目录里的文件，不会把 pi-web-seeker 仓库源码目录混进去。

内网部署建议同时设置访问令牌：

```bash
PI_WEB_ACCESS_TOKEN=your-long-random-token docker compose up --build
```

容器启动时会默认把 `/workspace` 和 `/home/piweb/.pi` 的权限修正给运行用户，确保 agent 可以在工作目录内写文件。如挂载大型外部项目且不希望递归修改宿主机文件所有者，可关闭工作目录权限修正：

```bash
PI_WEB_CHOWN_WORKSPACE=0 docker compose up --build
```

用户数据默认会保存在宿主机当前目录的 `.pi-web-data/agent/` 下，例如：

- `.pi-web-data/agent/models.json` — 模型配置
- `.pi-web-data/agent/auth.json` — 登录凭据/API key
- `.pi-web-data/agent/settings.json` — 用户设置与 skill 路径配置
- `.pi-web-data/agent/sessions/` — 会话历史
- `.pi-web-data/agent/skills/` — 全局 skills

如需把数据放到固定目录：

```bash
PI_WEB_DATA_DIR=/opt/pi-web-seeker/data docker compose up --build
```

如需换一个项目目录：

```bash
PI_WEB_WORKSPACE=/path/to/project docker compose up --build
```

如果宿主机用户不是 UID/GID 1000，建议对齐容器运行用户，避免模型配置或工作区文件写入失败：

```bash
PI_WEB_UID=$(id -u) PI_WEB_GID=$(id -g) docker compose up --build
```

也可以只用 `docker run`：

```bash
docker build -t pi-web-seeker:local .
docker run --rm -it \
  -p 30141:30141 \
  -v "$PWD/.pi-web-data:/home/piweb/.pi" \
  -v "$PWD:/workspace" \
  -v "$HOME/.ssh:/home/piweb/.ssh:ro" \
  pi-web-seeker:local
```

## 功能介绍

- **主题与语言** — 内置多套 theme，可在左下角或顶部工具栏切换；界面语言支持 English / 简体中文，英文作为兜底语言
- **会话浏览器** — 按工作目录分组展示所有 pi 会话，支持选择默认 / 自定义工作目录、重命名和删除会话
- **实时对话** — 通过 SSE 流式输出与智能体实时交互，刷新页面后可自动重连仍在运行的会话
- **会话分叉** — 从任意用户消息创建独立的新会话分支
- **会话内分支** — 回退到任意节点继续对话，在同一文件内创建分支
- **分支导航器** — 可视化切换同一会话内的各个分支
- **消息操作** — 支持复制消息、从历史用户消息新建独立会话、从历史节点继续分支
- **输入增强** — 支持图片上传 / 粘贴、提示词片段、输入历史、草稿保留和完成提示音
- **模型管理** — 对话中途可切换模型；在「Models」面板中编辑 provider / model、base URL、API 类型、上下文窗口、最大输出、费用和 Thinking level map，并管理 API key / OAuth 登录
- **模型配置测试** — 在「Models」面板中测试单个模型连通性，查看延迟、HTTP 状态和简短响应
- **工具与推理控制** — 控制智能体可使用的工具预设，按模型能力切换 thinking level
- **压缩会话** — 对长会话进行摘要，节省上下文窗口
- **状态统计** — 顶部栏显示 input / output / cache tokens、费用和上下文使用率，并可查看当前 system prompt
- **Skills 管理** — 在「Skills」面板中查看项目 / 全局 skills，搜索安装 skills，并控制 skill 是否进入模型提示词
- **文件浏览器** — 在侧边栏搜索文件、查看最近文件、切换 Git tracked-only 模式、下载文件，或把文件路径插入到输入框
- **文件查看器** — 标签页内查看代码、Markdown + KaTeX 数学公式、HTML、图片和音频，支持自动同步、变更 diff、换行和大文件保护
- **聊天 Minimap** — 长会话右侧显示消息缩略导航，方便快速定位历史节点
- **性能优化** — Web 层缓存 session list index、parent session 映射和 cwd roots；Docker 单工作区优先使用显式 workspace roots；长会话历史消息按需懒渲染，减少 streaming 时的历史消息重绘
- **Subagent 通知渲染** — 自动识别 `subagent-notification` / `<task-notification>`，用紧凑卡片展示子智能体状态、结果、tokens、工具调用次数和 transcript
- **运行时系统提示词上下文** — 新建会话时自动注入当前设备的 OS、shell、路径风格和包管理器线索，帮助智能体选择更合适的命令
- **引导 / 追加** — 打断正在运行的智能体，或在其完成后追加消息

## Subagents

Pi Web Seeker 不负责启动或管理子智能体本身；它负责把会话文件中的 subagent 通知渲染成更清晰的网页卡片。要实际使用子智能体，请先在 pi 中安装扩展：

```bash
pi install npm:@tintinweb/pi-subagents
```

如果本机提示 `pi: command not found`，可以使用本仓库依赖里的 pi CLI：

```bash
cd pi-web-seeker
npx --no-install pi install npm:@tintinweb/pi-subagents
```

或直接调用本地 bin：

```bash
cd pi-web-seeker
./node_modules/.bin/pi install npm:@tintinweb/pi-subagents
```

如果希望任何目录都能直接使用 `pi`：

```bash
npm install -g @earendil-works/pi-coding-agent
pi install npm:@tintinweb/pi-subagents
```

Docker Compose 环境需要在容器内安装，而不是在宿主机安装：

```bash
docker compose exec pi-web-seeker node_modules/.bin/pi install npm:@tintinweb/pi-subagents
docker compose restart pi-web-seeker
```

Compose 默认把 `./.pi-web-data` 挂载到容器的 `/home/piweb/.pi`，所以扩展配置会保存在宿主机的 `./.pi-web-data/agent/settings.json`，重建容器不会丢失。

安装完成后，刷新页面或重启本地 dev server，然后在左下角打开「智能体」面板确认状态是否变为 `Loaded`。扩展是在新的 AgentSession 启动时加载的；如果安装前已经打开了会话，建议新建会话再测试。

Subagent 依赖 `Agent` / `get_subagent_result` / `steer_subagent` 这些扩展工具。Pi Web Seeker 的工具预设中，`Low` 和 `High` 会保留已启用的扩展工具；只有 `Off` 会关闭全部工具。如果测试时模型说没有 `Agent` 工具，请确认工具预设不是 `Off`，并新建一个会话。

测试提示词示例：

```text
请使用 Agent 工具启动一个 Explore 子智能体，后台运行：
任务是检查当前项目的目录结构，并总结主要模块。
description: Explore repo
run_in_background: true
```

安装后，`@tintinweb/pi-subagents` 会通过 `customType: "subagent-notification"` 和结构化 `<task-notification>` 把后台 agent 的完成通知写回主会话。Pi Web Seeker 会自动识别这些消息，并显示：

- subagent 标识、agent 类型 / id、完成状态
- turns、tool uses、tokens、context 使用率、compaction 次数、耗时
- 可展开的 Result / Error 区块
- transcript 路径和关联 tool call id

分组完成通知也会按单个 agent 拆成多张卡片显示。

## 运行时系统提示词上下文

`runtime-system-prompt-context` 会在每次创建 AgentSession 时动态检测当前运行环境，并把一小段上下文追加到默认 system prompt 中。它不是在构建阶段写死的配置，因此同一份代码下载到 macOS、Linux、Windows 或 Docker 环境后，会按实际执行命令的环境生成提示。

当前注入的信息包括：

- 操作系统名称与 `process.platform`
- 当前 shell（例如 zsh、bash、PowerShell 或 cmd）
- 当前工作目录
- 路径分隔符与当前 shell 约定。Windows 上很多 API 和现代工具同时接受 `/` 与 `\`，但 cmd/PowerShell 原生命令优先 `\`，Git Bash/MSYS/WSL 等 POSIX-like shell 优先 `/`
- 包管理器线索（`package-lock.json`、`bun.lock`、`pnpm-lock.yaml`、`yarn.lock`）

这段提示还会提醒智能体优先使用当前 OS/shell 兼容的命令、遇到跨平台路径分隔符或 shell 语法差异时按当前 shell 约定处理并先检查环境、优先使用项目已有 package scripts，并避免打印环境变量、鉴权文件或本地配置里的敏感信息。

如果用户在新会话中选择关闭全部工具，pi-web 仍会保持空 system prompt，不会强行注入运行时上下文。

## 注意事项

- **数据目录** — 默认读取 `~/.pi/agent/sessions` 下的会话文件。可通过环境变量 `PI_CODING_AGENT_DIR` 指定其他目录。
- **模型配置** — 从智能体数据目录下的 `models.json` 读取可用模型，可在侧边栏的「Models」面板中编辑。`models.json` 适合保存 provider、base URL、API 类型、模型 ID、上下文窗口等非密钥配置。
- **API key** — 不要写进仓库。推荐在「Models」面板中选择对应 provider 后保存 API key，例如 MiniMax 中国区应配置 `MiniMax (China)` / `minimax-cn`。这些密钥会保存到智能体数据目录下的 `auth.json`；Docker Compose 默认持久化到宿主机 `.pi-web-data/agent/auth.json`。也可以用环境变量提供，例如 `MINIMAX_CN_API_KEY=...`、`DEEPSEEK_API_KEY=...`。模型详情页的「Test」按钮会发送一次真实的轻量请求，用于验证 API key、base URL、模型 ID 和接口兼容性，可能产生少量 token 消耗。
- **访问保护** — 默认不启用登录，适合可信本机/可信内网使用。设置 `PI_WEB_ACCESS_TOKEN` 后，页面入口和所有 `/api/*` 请求都需要同源 cookie 或 Bearer/header token。
- **文件浏览** — 侧边栏内置文件浏览器，可在标签页中查看当前工作目录下的文件；Docker Compose 默认只暴露 `/workspace` 单工作区。文件 API 会用真实路径校验 allowed roots，避免通过符号链接读取工作区外文件。
- **缓存行为** — session list index 和 allowed roots 使用短 TTL 缓存，并在新建、分叉、重命名、删除会话时失效。Docker 单工作区模式会优先使用 `PI_WEB_ALLOWED_ROOTS` / `PI_WEB_DEFAULT_CWD`，避免 Explorer 权限检查频繁扫描历史会话。
- **Docker 路径** — 容器内默认项目目录是 `/workspace`。宿主机路径和容器路径不同，已有旧会话仍会显示原来的宿主机路径；新会话建议在 `/workspace` 下创建。

## 开发

```bash
git clone git@github.com:linky-fan/pi-web-seeker.git
cd pi-web-seeker
npm install
npm run dev   # 端口 30141
```

## 项目结构

```
app/
  api/
    sessions/      # 读写会话文件
    agent/         # 发送命令、SSE 事件流
    files/         # 文件内容读取
    models/        # 可用模型列表与默认模型
    models-config/ # 读写 models.json 与测试模型连接
components/        # UI 组件
lib/
  session-reader.ts  # 解析 .jsonl 会话文件
  rpc-manager.ts     # 管理 AgentSession 生命周期
  normalize.ts       # 规范化 toolCall 字段名
  types.ts
```

会话文件存储路径：`~/.pi/agent/sessions/<编码后的工作目录>/<时间戳>_<uuid>.jsonl`
