# Go RPC bridge prototype

This is an isolated Go service prototype for one vertical slice:

1. Start a Pi CLI process in RPC mode.
2. Send prompts to that process.
3. Forward Pi's JSONL output to clients over Server-Sent Events (SSE).

The existing Next.js UI and in-process Node `AgentSession` remain unchanged. This
prototype is not wired into the UI and deliberately starts Pi with `--no-session`;
its sessions are in-memory and are not persisted or compatible with the formal
Pi Web Seeker session list.

## Requirements

- Go 1.22 or newer.
- Node.js and the repository's npm dependencies, or a `pi` executable on `PATH`.
- The Pi CLI version pinned by this repository supports `--mode rpc`.

From this directory, run:

```powershell
go run ./cmd/server
```

The server listens on `localhost:30142` by default. It discovers the repository
root by walking up to `package.json`; the default workspace is that repository
root. To override the Pi executable, set `PI_RPC_COMMAND` to its executable path.
When no `pi` executable is on `PATH`, the service tries the repository's pinned
`node_modules/@earendil-works/pi-coding-agent/dist/cli.js` through Node.

## API

Create a session and submit its first prompt:

```powershell
$body = @{
  cwd = (Get-Location).Path
  message = "Reply with a short greeting."
} | ConvertTo-Json

$session = Invoke-RestMethod `
  -Uri "http://localhost:30142/api/sessions" `
  -Method Post `
  -ContentType "application/json" `
  -Body $body

$session.sessionId
```

Stream Pi JSON events:

```powershell
curl.exe -N "http://localhost:30142/api/sessions/$($session.sessionId)/events"
```

Send another prompt:

```powershell
Invoke-RestMethod `
  -Uri "http://localhost:30142/api/sessions/$($session.sessionId)/prompt" `
  -Method Post `
  -ContentType "application/json" `
  -Body (@{ message = "Now reply with a farewell." } | ConvertTo-Json)
```

Delete the session to stop its Pi process:

```powershell
Invoke-RestMethod `
  -Uri "http://localhost:30142/api/sessions/$($session.sessionId)" `
  -Method Delete
```

## Configuration

- `PI_GO_BIND_HOST`: listen host; defaults to `localhost`.
- `PI_GO_PORT`: listen port; defaults to `30142`.
- `PI_GO_POC_ROOT`: override repository-root discovery.
- `PI_WEB_ACCESS_TOKEN`: required for non-loopback binds; when set, all API
  requests require `Authorization: Bearer <token>`.
- `PI_WEB_ALLOWED_ROOTS`: allowed workspace roots using the platform path-list
  separator. Defaults to the detected repository root.
- `PI_GO_DEFAULT_CWD`: default workspace when the request omits `cwd`.
- `PI_RPC_COMMAND`: optional path to a Pi-compatible executable.
- `PI_RPC_NODE`: optional Node executable used for the repository-local Pi CLI.

The process is launched directly without a shell, and requested workspaces are
resolved through symlinks before allowed-root checks. Output is bounded to a
small replay window for reconnecting SSE clients.

## Prototype boundary

This proves the Go HTTP/process/SSE boundary only. Persistent Pi sessions,
provider/model selection, formal session IDs, tools/extensions, browser and
remote integrations, and Next.js UI routing remain on the existing Node path.
