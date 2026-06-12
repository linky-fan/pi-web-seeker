# AGENTS.md

## Commands

- Dev:
- Test:
- Lint:
- Build image:
- Run compose:

## Architecture

- `Dockerfile` - image build.
- `docker-compose.yml` - local service wiring.
- `src/` or `app/` - service code.
- `config/` - runtime configuration.
- More details: `docs/agent-notes/architecture.md`

## Critical Rules

- Do not revert user changes unless explicitly asked.
- Do not print or commit secrets, env files, tokens, or private keys.
- Keep host-mounted data and container paths clearly separated.
- Avoid destructive cleanup commands unless explicitly requested.

## Common Flows

- Service code:
- Compose config:
- Image build:
- Volume/permission issues:

## Traps

- Host paths and container paths differ; verify which side a file lives on.
- UID/GID and read-only mounts can cause write failures.
- Network bind addresses and exposed ports may differ between dev and compose.

## Verification

- Config check:
- Container startup:
- Health endpoint:
- Logs:

## More Details

- Deployment: `docs/agent-notes/deployment.md`
- Runtime config: `docs/agent-notes/config.md`
