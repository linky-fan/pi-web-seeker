# AGENTS.md

## Commands

- Dev: `npm run dev`
- Typecheck: `node_modules/.bin/tsc --noEmit`
- Lint: `npm run lint`
- Test:
- Do not run production builds during ordinary dev unless requested.

## Architecture

- `app/` - Next.js routes, layouts, and API handlers.
- `components/` - reusable UI and client components.
- `lib/` - shared server/client helpers.
- `public/` - static assets, if present.
- More details: `docs/agent-notes/architecture.md`

## Critical Rules

- Do not revert user changes unless explicitly asked.
- Keep secrets out of logs, commits, screenshots, and generated reports.
- Prefer existing package scripts over direct Next.js commands.
- Avoid changing generated `.next/` output.

## Common Flows

- UI changes: edit `components/` or `app/`, then run typecheck/lint and a browser smoke test.
- API changes: edit `app/api/` and related `lib/` helpers; verify request and error paths.
- Styling changes: check desktop and one narrow viewport for clipping and overflow.

## Traps

- Client components may hydrate differently if they use time, random values, or browser-only state during render.
- Keep route handlers explicit about dynamic behavior when they read local state.
- Do not expose API keys or local paths in client-rendered UI.

## Verification

- Typecheck: `node_modules/.bin/tsc --noEmit`
- Lint: `npm run lint`
- Browser: load the affected route and check console errors.

## More Details

- Architecture: `docs/agent-notes/architecture.md`
- Deployment: `docs/agent-notes/deployment.md`
