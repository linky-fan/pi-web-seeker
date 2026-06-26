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

Plan Mode is a runtime wrapper state, not a session schema change. `components/ChatInput.tsx` sends `planMode` plus optional `planExecutionMode`, and `lib/rpc-manager.ts` applies a temporary tool/system-prompt snapshot around the active `AgentSessionWrapper`. The default execution mode is `main`; `subagent` mode is only available when extension tools such as `Agent` and `get_subagent_result` are registered.

Debug Bundle import/export is separate from normal session browsing. Export builds a `.tar.gz` from session entries, externalized media, diagnostics, and selected workspace files; import inspects first, then restores into a new sandbox cwd.

## File Map

### API Routes

- `app/api/sessions/route.ts` - list all sessions.
- `app/api/sessions/[id]/route.ts` - get, rename, or delete one session.
- `app/api/sessions/[id]/context/route.ts` - get context for a specific `leafId`.
- `app/api/sessions/[id]/export/route.ts` - export the current session as Markdown or JSON.
- `app/api/sessions/[id]/debug-bundle/route.ts` - export a cross-machine debug bundle as `tar.gz`.
- `app/api/sessions/new/route.ts` - legacy no-op that returns 410 for older clients.
- `app/api/sessions/import/route.ts` - import ordinary JSON session exports.
- `app/api/debug-bundles/inspect/route.ts` - validate and summarize a debug bundle before import.
- `app/api/debug-bundles/import/route.ts` - restore a debug bundle into a new sandbox cwd.
- `app/api/default-cwd/route.ts` - default cwd helper.
- `app/api/home/route.ts` - home directory helper.
- `app/api/agent/new/route.ts` - create a session from `{ cwd, message, toolNames, provider, modelId, planMode }`.
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
- `lib/session-export.ts` - ordinary Markdown / JSON export helpers.
- `lib/debug-bundle.ts` - debug bundle manifest, tar safety checks, media externalization, workspace snapshot, inspect, and import helpers.
- `lib/plan-mode.ts` - slash command parsing, plan document detection, Plan Mode prompts, subagent status, and read-only bash allowlist.
- `lib/types.ts` - shared TypeScript types.
- `lib/normalize.ts` - normalize stored tool call fields to UI fields.
- `lib/markdown.ts` - normalize standalone single-line display math.
- `lib/file-paths.ts` - path encoding and display helpers.
- `lib/path-identity.ts` - cross-platform cwd/session path identity helpers.

### Components

- `components/AppShell.tsx` - layout, URL state, and tab management.
- `components/SessionSidebar.tsx` - session tree and file explorer shell.
- `components/ChatWindow.tsx` - messages, streaming, SSE, fork, and navigation logic.
- `components/ChatInput.tsx` - input bar, slash commands, Plan Mode chip, model, thinking, tools, and compact controls.
- `components/MessageView.tsx` - user, assistant, PlanCard, tool call, and tool result rendering.
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
