# AGENTS.md

## Commands

- Run:
- Test:
- Typecheck:
- Lint:
- Format:

## Architecture

- `src/` - application/package code.
- `tests/` - test suite.
- `scripts/` - local automation.
- More details: `docs/agent-notes/architecture.md`

## Critical Rules

- Do not revert user changes unless explicitly asked.
- Do not commit secrets, virtualenvs, caches, or local data.
- Prefer project scripts or Makefile targets over ad hoc commands.
- Keep dependency changes scoped and explain why they are needed.

## Common Flows

- Library code:
- CLI code:
- Data processing:
- Tests:

## Traps

- Note project-specific import, environment, data, or platform pitfalls here.

## Verification

- Unit tests:
- Integration tests:
- Type/lint checks:

## More Details

- Architecture: `docs/agent-notes/architecture.md`
- Data formats: `docs/agent-notes/data-formats.md`
