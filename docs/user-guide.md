# Pi Web Seeker 用户指南

本文介绍安装、启动、访问控制、工作区、本地构建和 Docker 部署。功能说明见[功能指南](features.md)。

## 本地源码启动

运行要求 Node.js 22.19.0 或更高版本；项目官方开发和构建环境使用 Node.js 24.18.0。

在本地克隆的仓库目录中安装依赖并启动开发服务器：

```bash
npm install
npm run dev
```

开发服务器默认仅监听 `localhost:30141`。生产构建则先运行 `npm run build`，再运行 `npm run start`。

## 监听地址与访问控制

监听参数通过环境变量配置。开发服务器默认仅监听本机 `localhost:30141`：

- 本机：`http://localhost:30141`
- 局域网：显式设置非 loopback 地址并配置访问令牌

Bash：

```bash
PORT=8080 npm run dev
LAN_IP="<your-lan-ip>"
PI_WEB_BIND_HOST="$LAN_IP" PI_WEB_ACCESS_TOKEN=<long-random-token> npm run dev
```

PowerShell：

```powershell
$env:PORT = "8080"
$env:PI_WEB_BIND_HOST = "<your-lan-ip>"
$env:PI_WEB_ACCESS_TOKEN = "<long-random-token>"
npm run dev
```

cmd.exe：

```bat
set "PORT=8080"
set "PI_WEB_BIND_HOST=<your-lan-ip>"
set "PI_WEB_ACCESS_TOKEN=<long-random-token>"
npm run dev
```

直接绑定非 loopback 地址但未配置非空令牌时，服务会拒绝启动。开发服务器允许常见私网来源；如果局域网仍无法访问，请检查系统防火墙、虚拟机网络和容器端口映射。

需要访问控制时，也可以在 localhost 监听上启用访问令牌：

```bash
PI_WEB_ACCESS_TOKEN=<long-random-token> npm run dev
```

首次打开 `http://<host>:30141/?token=your-long-random-token` 后，服务端写入 HttpOnly cookie 并跳转回普通页面。初始 URL 会短暂携带令牌，可能进入浏览器或反向代理日志；普通 HTTP 也不会加密令牌，请勿在不可信网络直接暴露，局域网部署应使用 HTTPS 反向代理。脚本访问 API 时可以使用：

```text
Authorization: Bearer <token>
x-pi-web-token: <token>
```

## 便携版

[GitHub Releases](https://github.com/linky-fan/pi-web-seeker/releases) 提供以下便携包：

- Windows x64
- macOS Apple Silicon
- macOS Intel

解压后运行 `start-pi-web.cmd`、`start-pi-web.ps1` 或 `start-pi-web.command`。便携包内置 Node.js 和生产依赖，默认打开 `http://localhost:30141`。

便携包不包含用户数据、API key、会话、`.env*` 或本地工作区文件。

## 工作区选择

侧边栏顶部的项目目录下拉用于选择新会话和 Explorer 的工作区。

在 Windows 或 macOS 本机通过 `localhost` 或 `127.0.0.1` 访问时，可以使用系统原生目录选择器。选择完成后，服务端会验证目录并临时登记为允许的 workspace root。

Docker、Linux/headless 或局域网远程访问时，页面使用网页目录浏览器，从 home、默认目录和最近会话目录等允许范围逐级选择。Docker Compose 默认只暴露 `/workspace`。

手动输入路径也会先通过服务端验证目录存在且可访问，避免发送首条消息时才遇到 `Access denied`。

## 语言检查器

在右侧 Inspector 中打开“代码检查”，面板会扫描当前工作区并显示 Python、Java、C/C++、Go 和 Rust 项目。它只使用运行 Pi Web 的环境中已经安装的工具；Python 项目也会查找项目根目录下 `.venv` 或 `venv` 中的 Ruff/mypy。Docker 环境需要在容器内提供工具。Checkstyle 还可以通过 `PI_WEB_CHECKSTYLE_JAR` 指定可信的 JAR。

选择检查器后，必须勾选面板中的确认框才能启动。检查进程有超时、并发和输出上限，但不是 sandbox；只对可信工作区执行。子进程只接收运行工具链所需的最小环境，不会继承 Pi Web 的 API key 或访问令牌。Pi Web 不会自动安装工具/依赖或启用检查器的自动修复；工具可能更新自己的缓存。Cargo 离线检查可能执行项目构建脚本。Go 和 Rust 检查在离线/只读依赖模式下运行，因此未缓存的依赖可能导致检查失败。C/C++ 检查需要项目内部有效的 `compile_commands.json`。

## 本地开发与构建

```bash
git clone git@github.com:linky-fan/pi-web-seeker.git
cd pi-web-seeker
npm install
npm run dev
```

开发服务器默认仅监听 `localhost:30141`。若需局域网访问，设置 `PI_WEB_BIND_HOST=<局域网 IP>` 和 `PI_WEB_ACCESS_TOKEN=<长随机令牌>`。常用检查：

```bash
node_modules/.bin/tsc --noEmit
npm run typecheck
npm run lint
npm test
npm run test:remote
node scripts/agents-md.mjs check --path AGENTS.md
```

正式构建入口：

```bash
npm run build
```

`scripts/next-build.mjs` 使用当前 Node.js 直接启动 Next.js CLI，减少 Windows `.cmd`、符号链接和含空格路径造成的差异。默认构建器为：

- Windows：Turbopack
- macOS / Linux：webpack

也可以显式选择：

```bash
npm run build -- --turbo
npm run build -- --webpack

PI_WEB_BUILD_ENGINE=turbo npm run build
PI_WEB_BUILD_ENGINE=webpack npm run build
```

Windows 默认避开 webpack 扫描用户 profile 中兼容 junction 可能产生的权限错误。普通开发不要额外运行 `next build`，以免污染 `.next` 并影响开发服务器。

## Docker

Docker 在容器网络内监听，因此必须提供非空访问令牌：

```bash
PI_WEB_ACCESS_TOKEN=your-long-random-token docker compose up --build
```

启动后打开 `http://localhost:30141`。默认挂载：

| 宿主机 | 容器 | 用途 |
| --- | --- | --- |
| `.pi-web-data` | `/home/piweb/.pi` | 会话、模型、凭据、settings、skills、prompts 和 themes |
| `.pi-web-workspace` | `/workspace` | 默认单工作区 |
| `~/.ssh` | `/home/piweb/.ssh:ro` | 只读 SSH 配置和密钥 |

未设置 `PI_WEB_ACCESS_TOKEN` 时，Compose 和容器入口都会拒绝启动。健康检查会通过 Bearer 请求头携带该令牌。

使用外部数据目录或工作区：

```bash
PI_WEB_DATA_DIR=/opt/pi-web-seeker/data docker compose up --build
PI_WEB_WORKSPACE=/path/to/project docker compose up --build
```

默认会修正 `/workspace` 和 `/home/piweb/.pi` 的权限。大型外部工作区不希望递归修改宿主机所有权时：

```bash
PI_WEB_CHOWN_WORKSPACE=0 docker compose up --build
```

宿主机 UID/GID 不是 1000 时建议对齐运行用户：

```bash
PI_WEB_UID=$(id -u) PI_WEB_GID=$(id -g) docker compose up --build
```

只使用 Docker CLI：

```bash
docker build -t pi-web-seeker:local .
docker run --rm -it \
  -p 30141:30141 \
  -e PI_WEB_ACCESS_TOKEN=your-long-random-token \
  -v "$PWD/.pi-web-data:/home/piweb/.pi" \
  -v "$PWD:/workspace" \
  -v "$HOME/.ssh:/home/piweb/.ssh:ro" \
  pi-web-seeker:local
```

Compose 默认使用单工作区模式。宿主机与容器路径不同，旧会话可能仍显示原宿主机路径。

## 数据与安全

模型、认证和会话数据位于智能体数据目录。Docker Compose 默认持久化到 `.pi-web-data/agent/`：

- `models.json`：模型配置
- `auth.json`：API key 和认证信息
- `settings.json`：用户设置与扩展路径
- `sessions/`：会话历史
- `skills/`：全局 skills

这些内容、`.env*`、Remote 捕获和私有路径都不应提交到仓库或出现在截图中。
