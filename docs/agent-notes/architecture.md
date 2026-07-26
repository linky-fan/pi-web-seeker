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
  |                        |   stored override -> AuthStorage
  |                        |   fallback -> TAVILY_API_KEY  |
  |- test search key ----->| POST .../search-config/test   |
  |                        |   Tavily /usage; no key return|
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

Quick Chat is a separate lightweight path. AppShell renders only `components/QuickChatLauncher.tsx` initially and loads `components/QuickChatPanel.tsx` after the first click. Once loaded, the panel remains mounted while collapsed, while formal sessions change, and while Remote temporarily hides it, so an active stream is not interrupted. The panel keeps temporary text history, the per-tab web-search toggle, and bounded source metadata in browser `sessionStorage`. With web search disabled, `POST /api/quick-chat/stream` calls the configured model through `pi-ai` without a system prompt, `AgentSession`, extensions, or tools. With search enabled, the same route performs one bounded Tavily search, emits search status and up to five sanitized sources, then passes an untrusted-evidence system prompt to `streamSimple()`. Tavily credentials remain server-side: a `tavily-search` AuthStorage entry is an explicit Quick Chat override and takes precedence over the `TAVILY_API_KEY` fallback. The config routes return only source/status metadata, validate credentials through Tavily `/usage`, and never return keys or upstream response bodies. This lets a user recover from a stale Windows process or container environment key without restarting Pi Web. `POST /api/quick-chat/promote` converts the temporary history and source links into a standard persisted JSONL session; subsequent messages use the normal `AgentSession` path.

Controlled browser automation is an optional `pi-opencli` package. Its extension registers four constrained tool groups and maps each action to fixed OpenCLI argv without a shell or arbitrary `eval`. The shared runtime keys one OpenCLI browser session to each formal AgentSession, publishes snapshots/actions/approvals through `/api/browser/*`, and stores screenshots only in the system temporary directory. OpenCLI's localhost daemon and Browser Bridge extension operate the user's real logged-in Chrome tab; Pi Web never receives browser credentials. Sensitive actions use an approval gate, exact-origin allowlist entries persist in `~/.pi/agent/browser-policy.json`, and full-auto mode resets when the browser session closes. The first implementation is local-only; Docker and remote browser tunneling are diagnostics/documentation paths rather than supported runtime wiring.

On Windows, the runtime never executes an npm `.cmd`/`.bat` shim through a shell. It resolves `PI_WEB_OPENCLI_BIN` first, then PATH and the standard npm global roots, reads the adjacent `@jackwener/opencli` package's `bin.opencli` declaration, validates that the JavaScript entry remains inside the package, and launches it with the current Node executable. Forced browser status refreshes repeat resolution so a newly installed or repaired CLI is detected without restarting Pi Web.

Plan Mode is a runtime wrapper state, not a session schema change. `components/ChatInput.tsx` sends `planMode` plus optional `planExecutionMode`, and `lib/rpc-manager.ts` applies a temporary tool/system-prompt snapshot around the active `AgentSessionWrapper`. The default execution mode is `main`; `subagent` mode is only available when extension tools such as `Agent` and `get_subagent_result` are registered.

Buddy review is orthogonal to Plan Mode. `buddyMode: "plan"` keeps the main agent and its reviewer read-only, while `buddyMode: "code"` restores the main agent's normal coding tools and restricts the reviewer to a single foreground `Plan` subagent call. The reviewer model is selected separately, must resolve in the model registry, and must differ from the main model. Runtime tool guards enforce the reviewer type, exact model, independent context, foreground execution, and no-worktree policy; the main agent remains the only writer.

Debug Bundle import/export is separate from normal session browsing. Export builds a `.tar.gz` from session entries, externalized media, diagnostics, and selected workspace files; import inspects first, then restores into a new sandbox cwd.

## App Shell State Ownership

`components/AppShell.tsx` is the public composition root, not the owner of feature-specific rendering. It connects three local controllers and four memoized view regions without adding Context or a global store:

- `useSessionWorkspaceController` owns URL restoration, session/workspace selection, refresh keys, branch and system-prompt state, statistics, context usage, task status, and composer activity.
- `useSessionImportController` owns ordinary JSON/JSONL import and the inspect-confirm-cancel lifecycle for Debug Bundles.
- `useInspectorController` owns file, Browser, and Remote tabs, panel tiers, maximize/navigation restoration, responsive capability, and Browser/Remote SSE activation.
- `ShellNavigation`, `ShellWorkspace`, and `ShellInspector` receive only the state needed by their region. High-frequency chat statistics and composer updates therefore do not invalidate navigation or inspector rendering.
- The inspector and deferred-feature views retain the existing dynamic boundaries: Browser, Remote, Models, Capabilities, and the Quick Chat body stay outside the initial client dependency graph. Quick Chat remains mounted after its first successful load.

Pure transitions used by the controllers live in `components/app-shell/session-state.ts` and `inspector-state.ts`; display derivation lives in `helpers.ts`. Preserve callback stability and the current async ordering when extending a controller.

## Composer State Ownership

`components/ChatInput.tsx` is the stable public composer entry and wires three local controllers without Context or a global store:

- `useComposerDraftController` owns text, per-session draft persistence, prompt history navigation, image object URLs, send/steer/follow-up behavior, and the imperative insertion handle.
- `useComposerSuggestionsController` owns file mentions, slash-command selection, bounded asynchronous lookup, notices, and suggestion keyboard handling.
- `useComposerMenusController` owns snippets, model, reviewer, and thinking menus together with outside-click handling and viewport-aware portal placement.
- Memoized editor, status, primary-control, and runtime-control views isolate normal keystrokes from model, reviewer, thinking, context, compact, and sound controls.

Keep the composer on the initial client path. When extending it, preserve draft keys, callback ordering, DOM/class names, focus behavior, and the split between high-frequency editor state and low-frequency controls.

## Message Rendering Ownership

`components/MessageView.tsx` is the stable message-role router. Rendering details live in `components/message-view/`:

- `UserMessageView` owns user text, images, copy, fork, and edit-from-here controls.
- `AssistantMessageView` owns the assistant shell and resolves only the tool state referenced by that message. `MessageBlock` memoizes text, thinking, and tool-call blocks independently.
- `StreamingMetrics` owns its one-second TPS timer, while `useStreamingDurations` records block transitions. Metrics ticks do not invalidate Markdown or completed tool blocks.
- `MarkdownContent`, `ThinkingBlock`, and `ToolCallBlock` own their local copy/expanded/timer state. Shared Markdown plugin instances are stable, and raw HTML remains disabled by React Markdown's default behavior.
- `CustomMessageView` and `ComsNetMessageCard` own Subagent, custom, and coms-net history rendering.

`MessageView` uses a relevant-tool comparator: replacement Maps and Sets only invalidate a historical message when the value for one of that message's `toolCallId` entries changed. Preserve this boundary when adding tool status fields. Message rendering remains on the initial client path; Markdown and syntax highlighting are also shared by `FileViewer`, so their loading boundary is handled separately.

## Chat Window Rendering Ownership

`components/ChatWindow.tsx` is the stable session-view composition root. `useAgentSession` continues to own session loading, SSE events, commands, scrolling, and Agent lifecycle; the view layer under `components/chat-window/` separates its update frequencies:

- `messageProjection.ts` derives tool results, timestamps, prompt history, lazy-message decisions, and coms-net visibility only when completed messages or the streaming-active flag changes.
- `HistoricalMessageTimeline` owns completed messages and lazy slots. Per-token live output does not invalidate it; tool-state changes still reach the relevant tool card through the `MessageView` comparator.
- `ConversationRegion` owns the live message, phase indicator, scroll anchors, and Classic minimap. The minimap may update with live preview text; Fluid does not render it.
- `ComposerSurface` owns empty-session and dock placement. Its memoized input props stay stable across token updates, while context, model, retry, and Agent-running changes still reach `ChatInput`.
- `ExtensionLayer` owns statuses, notices, dialogs, custom terminal rendering, and ANSI parsing. `useChatWindowBridge` is limited to completion audio and scalar status publication to AppShell.

Preserve these boundaries when extending chat rendering: do not pass `streamingMessage` through the historical, composer, or extension regions, and keep `useAgentSession` lifecycle changes separate from view refactors.

## Agent Session Lifecycle Ownership

`hooks/useAgentSession.ts` is the stable composition entry for chat state. The controllers under `hooks/agent-session/` separate network lifetimes from view-facing state without changing the hook's public return shape:

- `useSessionDataController` owns formal-session and branch-context fetches, completed messages, entry IDs, the active leaf, and aggregate token/cost statistics. Session and context requests have independent abort scopes.
- `usePreferencesController` owns model metadata, Thinking, Plan, and Buddy state together with their existing localStorage keys. Mode, reviewer, model, and Thinking mutations use operation IDs so an older response cannot roll back a newer choice.
- `useRuntimeController` owns the SSE connection, streaming projection, Agent/tool/retry/compaction state, and extension UI. Each EventSource has a connection generation; reconnect timers and notification timers are cleared on identity changes and unmount.
- `useCommandsController` owns prompt, abort, fork, navigation, compaction, steer, and follow-up commands. New-session creation still resolves the real session ID before opening SSE, and failed sends remove only their own optimistic user message.
- `useScrollController` owns DOM anchors and output-follow decisions. Streaming updates scroll only while the user remains near the bottom.

The lifecycle gate combines a session/cwd identity with a monotonically increasing generation. Any fetch, SSE callback, reconnect timer, or command completion that no longer matches that gate must be treated as stale and must not update visible state.

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
- `app/api/quick-chat/search-config/route.ts` - report credential sources, validate and save a manual override, or remove it to restore the environment fallback.
- `app/api/quick-chat/search-config/test/route.ts` - validate the active or candidate Tavily credential without exposing the key or consuming a search credit.
- `app/api/quick-chat/promote/route.ts` - persist a temporary Quick Chat history as a standard JSONL session.
- `app/api/browser/status/route.ts` - detect the external OpenCLI binary, doctor/profile state, and built-in package state.
- `app/api/browser/setup/route.ts` - opt a workspace into the built-in `pi-opencli` package and reload a live AgentSession.
- `app/api/browser/sessions/[id]/*` - browser session state, SSE events, constrained UI commands, approvals, policy, preview, and close.
- `app/api/remote/profiles/route.ts` - manage secret-free SSH/Telnet target profiles stored in the Agent data directory.
- `app/api/remote/setup/route.ts` - enable the built-in `pi-remote-exec` package for a workspace and reload a live AgentSession.
- `app/api/remote/sessions/[id]/*` - remote state, SSE terminal output, commands, approvals, control handoff, captures, and safe export.
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
- `lib/quick-chat-search.ts` - Tavily override/fallback resolution, safe validation and error codes, bounded search, source sanitization, timeouts, and the untrusted-evidence prompt.
- `lib/browser-types.ts` - shared controlled-browser session, event, approval, policy, and status types.
- `lib/browser-package.ts` - built-in `pi-opencli` package discovery and workspace enablement.
- `lib/remote-store.ts` / `lib/remote-captures.ts` - atomic target configuration, known-host fingerprints, bounded sensitive captures, and allowed-root export.
- `pi-packages/pi-remote-exec/runtime.ts` - per-AgentSession SSH/Telnet connection state, serial command execution, approval policy, and transport cleanup.
- `lib/plan-mode.ts` - slash command parsing, plan document detection, Plan Mode prompts, subagent status, and read-only bash allowlist.
- `lib/types.ts` - shared TypeScript types.
- `lib/normalize.ts` - normalize stored tool call fields to UI fields.
- `lib/markdown.ts` - normalize standalone single-line display math.
- `lib/file-paths.ts` - path encoding and display helpers.
- `lib/path-identity.ts` - cross-platform cwd/session path identity helpers.

### Components

- `components/AppShell.tsx` - stable public composition root for shell controllers and memoized view regions.
- `components/app-shell/useSessionWorkspaceController.ts` - session, workspace, URL, branch, statistics, context, task, and composer state.
- `components/app-shell/useSessionImportController.ts` - ordinary session and Debug Bundle import lifecycle.
- `components/app-shell/useInspectorController.ts` - file/Browser/Remote tabs, responsive panel state, maximize restoration, and SSE activation.
- `components/app-shell/ShellNavigation.tsx` / `ShellWorkspace.tsx` / `ShellInspector.tsx` - memoized navigation, chat workspace, and inspector view regions.
- `components/app-shell/ShellDeferredFeatures.tsx` - Models, Capabilities, and Quick Chat dynamic-load ownership; Browser and Remote boundaries stay with `ShellInspector.tsx`.
- `components/SessionSidebar.tsx` - session tree and file explorer shell.
- `components/ChatWindow.tsx` - stable session-view composition root over `useAgentSession`.
- `components/chat-window/` - message projection, historical/live rendering regions, composer placement, extension UI, ANSI helpers, and AppShell status bridging.
- `components/ChatInput.tsx` - stable composer entry connecting draft, suggestion, and menu controllers.
- `components/chat-input/` - composer controllers, pure state helpers, memoized editor/suggestion/status views, and low-frequency model/runtime controls.
- `components/QuickChatPanel.tsx` - floating model-direct text chat, optional Tavily search controls and sources, temporary browser history, and promotion to a formal session.
- `components/QuickChatLauncher.tsx` - initial lightweight Quick Chat launcher plus local loading and chunk-error states.
- `components/BrowserPanel.tsx` - controlled-browser snapshot, activity timeline, permissions, setup diagnostics, and manual takeover UI.
- `components/MessageView.tsx` - stable role router and relevant-tool memo boundary for message rendering.
- `components/message-view/` - user/assistant/custom views, Markdown and Plan rendering, Thinking and tool cards, streaming metrics, and pure message helpers.
- `components/BranchNavigator.tsx` - in-session branch switcher.
- `components/ChatMinimap.tsx` - scroll minimap.
- `components/ToolsConfig.tsx` - per-tool toggles persisted to pi settings.
- `components/ModelsConfig.tsx` - model configuration modal.
- `components/SkillsConfig.tsx` - skill discovery/install/enablement modal.
- `components/FileExplorer.tsx` - sidebar file tree.
- `components/FileViewer.tsx` - file content tabs.
- `components/TabBar.tsx` - right-side file and controlled-browser tabs.
- `pi-packages/pi-opencli` - built-in optional OpenCLI extension tools, cross-platform launch-target resolution, and the shared process/session runtime.

## CSS Variables

Core variables and shared/Classic component styles live in `app/globals.css`: `--bg`, `--bg-panel`, `--bg-hover`, `--bg-selected`, `--border`, `--text`, `--text-muted`, `--text-dim`, `--accent`, `--user-bg`, `--tool-bg`, and `--font-mono`. `app/fluid.css` loads immediately after it and is the single authoritative layer for Fluid-only tokens, layout, component overrides, integrations, responsive behavior, and motion. Keep ordinary component styling in `globals.css`; rules added to `fluid.css` must remain scoped to `html[data-ui="fluid"]` and must not reintroduce duplicate selectors in the same media context.
