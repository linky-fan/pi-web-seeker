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
  |                        |                               |
  |- quick chat ---------->| POST /api/quick-chat/stream   |
  |                        |   optional Tavily search       |
  |<-- search status ------|   max 5 bounded sources        |
  |<-- text SSE -----------|   streamSimple() ------------>| configured model
  |                        |   no AgentSession or tools     |
  |                        |                               |
  |- search config ------->| /api/quick-chat/search-config |
  |                        |   -> ~/.pi/agent/auth.json     |
  |                        |                               |
  |- promote quick chat -->| POST /api/quick-chat/promote  |
  |                        |   SessionManager.create()      |
  |                        |   append full text history     |
  |                        |   -> ~/.pi/agent/sessions      |
  |                        |                               |
  |- browser panel ------->| GET /api/browser/* SSE/state  |
  |<-- snapshots/events ---|   shared OpenCLI runtime       |
  |                        |              ^                |
  |                        |              | pi-opencli tools|
  |                        |<-------------|                |
  |                        |   fixed argv -> OpenCLI CLI    |
  |                        |   -> localhost daemon          |
  |                        |   -> Chrome extension/tab      |
```

Session browsing is read-only and reads `.jsonl` files directly through `lib/session-reader.ts`. Sending a message creates or reuses an in-process `AgentSession` through `startRpcSession()` in `lib/rpc-manager.ts`.

Quick Chat is a separate lightweight path. `components/QuickChatPanel.tsx` keeps temporary text history, the per-tab web-search toggle, and bounded source metadata in browser `sessionStorage`. With web search disabled, `POST /api/quick-chat/stream` calls the configured model through `pi-ai` without a system prompt, `AgentSession`, extensions, or tools. With search enabled, the same route performs one bounded Tavily search, emits search status and up to five sanitized sources, then passes an untrusted-evidence system prompt to `streamSimple()`. The Tavily key remains server-side in `AuthStorage` or `TAVILY_API_KEY`; `/api/quick-chat/search-config` never returns it. `POST /api/quick-chat/promote` converts the temporary history and source links into a standard persisted JSONL session; subsequent messages use the normal `AgentSession` path.

Controlled browser automation is an optional `pi-opencli` package. Its extension registers four constrained tool groups and maps each action to fixed OpenCLI argv without a shell or arbitrary `eval`. The shared runtime keys one OpenCLI browser session to each formal AgentSession, publishes snapshots/actions/approvals through `/api/browser/*`, and stores screenshots only in the system temporary directory. OpenCLI's localhost daemon and Browser Bridge extension operate the user's real logged-in Chrome tab; Pi Web never receives browser credentials. Sensitive actions use an approval gate, exact-origin allowlist entries persist in `~/.pi/agent/browser-policy.json`, and full-auto mode resets when the browser session closes. The first implementation is local-only; Docker and remote browser tunneling are diagnostics/documentation paths rather than supported runtime wiring.

Plan Mode is a runtime wrapper state, not a session schema change. `components/ChatInput.tsx` sends `planMode` plus optional `planExecutionMode`, and `lib/rpc-manager.ts` applies a temporary tool/system-prompt snapshot around the active `AgentSessionWrapper`. The default execution mode is `main`; `subagent` mode is only available when extension tools such as `Agent` and `get_subagent_result` are registered.

Buddy review is orthogonal to Plan Mode. `buddyMode: "plan"` keeps the main agent and its reviewer read-only, while `buddyMode: "code"` restores the main agent's normal coding tools and restricts the reviewer to a single foreground `Plan` subagent call. The reviewer model is selected separately, must resolve in the model registry, and must differ from the main model. Runtime tool guards enforce the reviewer type, exact model, independent context, foreground execution, and no-worktree policy; the main agent remains the only writer.

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
- `app/api/quick-chat/stream/route.ts` - optionally prefetch bounded Tavily results, then stream a text-only response directly from a configured model without an `AgentSession` or tools.
- `app/api/quick-chat/search-config/route.ts` - report, save, or remove the server-side Tavily credential without exposing it to the browser.
- `app/api/quick-chat/promote/route.ts` - persist a temporary Quick Chat history as a standard JSONL session.
- `app/api/browser/status/route.ts` - detect the external OpenCLI binary, doctor/profile state, and built-in package state.
- `app/api/browser/setup/route.ts` - opt a workspace into the built-in `pi-opencli` package and reload a live AgentSession.
- `app/api/browser/sessions/[id]/*` - browser session state, SSE events, constrained UI commands, approvals, policy, preview, and close.
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
- `lib/quick-chat.ts` - Quick Chat message/source types, size limits, validation, and promotion formatting.
- `lib/quick-chat-search.ts` - Tavily credential resolution, bounded search, source sanitization, timeouts, and the untrusted-evidence prompt.
- `lib/browser-types.ts` - shared controlled-browser session, event, approval, policy, and status types.
- `lib/browser-package.ts` - built-in `pi-opencli` package discovery and workspace enablement.
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
- `components/ChatInput.tsx` - input bar, slash commands, Plan/Buddy chips, writer/reviewer models, thinking, tools, and compact controls.
- `components/QuickChatPanel.tsx` - floating model-direct text chat, optional Tavily search controls and sources, temporary browser history, and promotion to a formal session.
- `components/BrowserPanel.tsx` - controlled-browser snapshot, activity timeline, permissions, setup diagnostics, and manual takeover UI.
- `components/MessageView.tsx` - user, assistant, PlanCard, tool call, and tool result rendering.
- `components/BranchNavigator.tsx` - in-session branch switcher.
- `components/ChatMinimap.tsx` - scroll minimap.
- `components/ToolsConfig.tsx` - per-tool toggles persisted to pi settings.
- `components/ModelsConfig.tsx` - model configuration modal.
- `components/SkillsConfig.tsx` - skill discovery/install/enablement modal.
- `components/FileExplorer.tsx` - sidebar file tree.
- `components/FileViewer.tsx` - file content tabs.
- `components/TabBar.tsx` - right-side file and controlled-browser tabs.
- `pi-packages/pi-opencli` - built-in optional OpenCLI extension tools plus the shared process/session runtime.

## CSS Variables

Core variables live in `app/globals.css`: `--bg`, `--bg-panel`, `--bg-hover`, `--bg-selected`, `--border`, `--text`, `--text-muted`, `--text-dim`, `--accent`, `--user-bg`, `--tool-bg`, and `--font-mono`.
