# Pi Web Seeker - Development Notes

Repository: https://github.com/linky-fan/pi-web-seeker

## Commands

- Dev: `npm run dev` on port 30141.
- Typecheck: `node_modules/.bin/tsc --noEmit`.
- Lint: `npm run lint`.
- AGENTS check: `node scripts/agents-md.mjs check --path AGENTS.md`.
- Do not run `next build` during ordinary dev; it pollutes `.next/` and can break `npm run dev`.
- If stale generated Next.js types mention a deleted route, remove `.next/types` or `.next/dev/types` and rerun typecheck.

## Architecture

Pi Web Seeker is a Next.js UI over Pi session files and in-process `AgentSession` instances.

- Session browsing is read-only and parses `.jsonl` files via `lib/session-reader.ts`; it does not create an `AgentSession`.
- Sending a message goes through `lib/rpc-manager.ts`, where `startRpcSession()` creates or reuses an in-process `AgentSessionWrapper`.
- API routes live under `app/api/`; UI lives mostly in `components/`; shared helpers live in `lib/`.
- Full file map and request flow: `docs/agent-notes/architecture.md`.
- Session file schema and examples: `docs/agent-notes/session-format.md`.

## Critical Rules

- Never revert user changes unless explicitly requested.
- Keep API keys, auth files, local session data, and private paths out of commits and screenshots.
- Use `apply_patch` for manual edits; avoid touching generated `.next/` output.
- Preserve extension tools when changing tool presets; packages such as `pi-subagents` must not be hidden by built-in tool filtering.
- For Docker/default workspace changes, keep host-mounted user data separate from app code and preserve LAN access behavior.
- For Markdown math, remember `remark-math` can misread prices such as `$5` to `$10`; keep `singleDollarTextMath` disabled where configured.

## Common Flows

- UI changes: edit the relevant component, run typecheck/lint, then smoke-test the affected route in the browser.
- API/session changes: inspect `lib/session-reader.ts`, `lib/rpc-manager.ts`, and the matching `app/api/*` route together.
- File explorer changes: check allowed roots, Docker workspace env vars, symlink safety, and large-file behavior.
- Model config changes: verify both `models.json` editing and the user-triggered connection test path.
- Subagent UI changes: check older `subagents:record` history and streamed `subagent-notification` messages.

## Traps

- `globalThis.__piSessions` and `globalThis.__piStartLocks` intentionally survive Next.js hot reload; plain module-level maps do not.
- `AgentSession.fork()` mutates the wrapper's inner state in-place. After fork, destroy the wrapper so the original session reloads cleanly.
- Forked sessions and in-session branches are different: fork creates a child `.jsonl`; branch navigation uses `navigate_tree` inside the same file.
- `parentSession` is display metadata only. It does not affect chat content and session files may be fully rewritten by pi migrations.
- Pi stores tool calls differently from UI types; keep `normalizeToolCalls()` in both file-load and streaming paths.
- On refresh during streaming, `ChatWindow` should reconnect SSE from `GET /api/agent/[id]` when `isStreaming` is true.
- Accept both newer `compaction_start` / `compaction_end` and older `auto_compaction_start` / `auto_compaction_end` events.
- Orphaned sessions have invalid headers; keep them visible as incomplete and non-clickable.

## Verification

- Small code/UI change: `node_modules/.bin/tsc --noEmit`, `npm run lint`, and a browser smoke test.
- Docs or AGENTS change: `node scripts/agents-md.mjs check --path AGENTS.md` and `git diff --check`.
- Model/provider change: run the Models panel test or `npm run test:context -- --provider <id> --model <id> --tokens 8192` when a real request is intended.
- Docker/deploy change: verify compose startup, workspace permissions, persisted data paths, and LAN browser access.

## More Details

- Architecture and file map: `docs/agent-notes/architecture.md`.
- Pi session file format: `docs/agent-notes/session-format.md`.
