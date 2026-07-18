# Pi Web Seeker 用户指南

本文介绍安装、启动、访问控制、工作区、本地构建和 Docker 部署。功能说明见[功能指南](features.md)。

## 安装与启动

npm 包要求 Node.js 22.19.0 或更高版本，项目官方开发和构建环境使用 Node.js 24.18.0。

无需安装即可运行最新正式版：

```bash
npx @linkyfan/pi-web
```

全局安装：

```bash
npm install -g @linkyfan/pi-web
pi-web
```

已发布的 npm 包包含 Next.js 生产产物。本地源码目录执行 `npm install` 不会自动构建，开发时应使用 `npm run dev`。

需要直接运行 GitHub 最新源码时：

```bash
npx github:linky-fan/pi-web-seeker
```

首次从 GitHub 运行时，npm 会自动构建一次生产产物。

## 监听地址与访问控制

默认监听 `0.0.0.0:30141`：

- 本机：`http://localhost:30141`
- 局域网：`http://<局域网 IP>:30141`

CLI 和环境变量都可以覆盖监听参数：

```bash
pi-web --port 8080
pi-web --hostname 127.0.0.1
pi-web -p 8080 -H 127.0.0.1

PORT=8080 pi-web
PI_WEB_BIND_HOST=127.0.0.1 pi-web
```

开发服务器允许常见私网来源。如果局域网仍无法访问，请检查系统防火墙、虚拟机网络和容器端口映射。

部署到不完全可信的网络时，应启用访问令牌：

```bash
PI_WEB_ACCESS_TOKEN=your-long-random-token pi-web
```

首次打开 `http://<host>:30141/?token=your-long-random-token` 后，服务端写入 HttpOnly cookie 并跳转回普通页面。脚本访问 API 时可以使用：

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

## 本地开发与构建

```bash
git clone git@github.com:linky-fan/pi-web-seeker.git
cd pi-web-seeker
npm install
npm run dev
```

开发服务器默认监听 `0.0.0.0:30141`。常用检查：

```bash
node_modules/.bin/tsc --noEmit
npm run lint
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

个人使用可以直接运行：

```bash
docker compose up --build
```

启动后打开 `http://localhost:30141`。默认挂载：

| 宿主机 | 容器 | 用途 |
| --- | --- | --- |
| `.pi-web-data` | `/home/piweb/.pi` | 会话、模型、凭据、settings、skills、prompts 和 themes |
| `.pi-web-workspace` | `/workspace` | 默认单工作区 |
| `~/.ssh` | `/home/piweb/.ssh:ro` | 只读 SSH 配置和密钥 |

内网部署建议同时设置访问令牌：

```bash
PI_WEB_ACCESS_TOKEN=your-long-random-token docker compose up --build
```

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
