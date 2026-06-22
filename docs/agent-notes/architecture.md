# Pi Web Seeker Architecture Notes

This file holds lower-frequency reference material for agents. Keep only the rules that matter on every turn in `AGENTS.md`.

## Request Flow

```text
Browser                Next.js Server              AgentSession (in-process)
  |                        |                               |
  |- GET /api/sessions --->| reads ~/.pi/agent/sessions/   |
  |- GET /api/sessions/[id] reads .jsonl file directly     |
  |                        |                               |
  |- send message -------->| POST /api/agent/[id]          |
  |                        |   startRpcSession() --------->| createAgentSession()
  |                        |   session.send(cmd) --------->| session.prompt()
  |                        |                               |
  |- SSE connect --------->| GET /api/agent/[id]/events    |
  |                        |   session.onEvent() <---------| session.subscribe()
  |<-- data: {...} --------|                               |
```

Session browsing is read-only and reads `.jsonl` files directly through `lib/session-reader.ts`. Sending a message creates or reuses an in-process `AgentSession` through `startRpcSession()` in `lib/rpc-manager.ts`.

## File Map

### API Routes

- `app/api/sessions/route.ts` - list all sessions.
- `app/api/sessions/[id]/route.ts` - get, rename, or delete one session.
- `app/api/sessions/[id]/context/route.ts` - get context for a specific `leafId`.
- `app/api/sessions/new/route.ts` - legacy no-op that returns 410 for older clients.
- `app/api/default-cwd/route.ts` - default cwd helper.
- `app/api/home/route.ts` - home directory helper.
- `app/api/agent/new/route.ts` - create a session from `{ cwd, message, toolNames, provider, modelId }`.
- `app/api/agent/[id]/route.ts` - get runtime state or POST commands.
- `app/api/agent/[id]/events/route.ts` - SSE stream.
- `app/api/auth/*` - OAuth/API-key provider login and logout.
- `app/api/files/[...path]/route.ts` - file tree, file contents, media, and SSE watch.
- `app/api/models/route.ts` - model list and default model.
- `app/api/models-config/route.ts` - read/write `~/.pi/agent/models.json`.
- `app/api/models-config/test/route.ts` - one-shot model connection test.
- `app/api/skills/*` - list, install, and search Codex skills.

### Shared Libraries

- `lib/rpc-manager.ts` - `AgentSessionWrapper`, registry, and `startRpcSession()`.
- `lib/session-reader.ts` - parse `.jsonl`, model maps, and default model helpers.
- `lib/types.ts` - shared TypeScript types.
- `lib/normalize.ts` - normalize stored tool call fields to UI fields.
- `lib/markdown.ts` - normalize standalone single-line display math.
- `lib/file-paths.ts` - path encoding and display helpers.
- `lib/path-identity.ts` - cross-platform cwd/session path identity helpers.

### Components

- `components/AppShell.tsx` - layout, URL state, and tab management.
- `components/SessionSidebar.tsx` - session tree and file explorer shell.
- `components/ChatWindow.tsx` - messages, streaming, SSE, fork, and navigation logic.
- `components/ChatInput.tsx` - input bar, model, thinking, tools, and compact controls.
- `components/MessageView.tsx` - user, assistant, tool call, and tool result rendering.
- `components/BranchNavigator.tsx` - in-session branch switcher.
- `components/ChatMinimap.tsx` - scroll minimap.
- `components/ToolsConfig.tsx` - per-tool toggles persisted to pi settings.
- `components/ModelsConfig.tsx` - model configuration modal.
- `components/SkillsConfig.tsx` - skill discovery/install/enablement modal.
- `components/FileExplorer.tsx` - sidebar file tree.
- `components/FileViewer.tsx` - file content tabs.
- `components/TabBar.tsx` - chat and file tab bar.

## CSS Variables

Core variables live in `app/globals.css`: `--bg`, `--bg-panel`, `--bg-hover`, `--bg-selected`, `--border`, `--text`, `--text-muted`, `--text-dim`, `--accent`, `--user-bg`, `--tool-bg`, and `--font-mono`.
