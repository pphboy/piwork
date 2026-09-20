# piwork

piwork is a local, single-host runtime for durable AI agent workspaces. Core owns authentication and Work lifecycle, one non-root `agentd` container runs inside each Work, and the `piwork` CLI controls Works and persistent conversations.

## Requirements

- Linux with Docker Engine available to the current user
- Node.js 24 LTS and npm 11 or newer
- OpenSSL 3

## Build and start

```bash
npm ci
npm run build
npm run agent:image

mkdir -p .piwork
printf '%s\n' "$PIWORK_ADMIN_PASSWORD" | npm run core -- \
  bootstrap-admin --data-dir .piwork/core --account admin --password-stdin

printf '%s\n' "$PIWORK_MODEL_API_KEY" | npm run core -- \
  configure-runtime --data-dir .piwork/core \
  --agent-image piwork-agentd:local \
  --model-provider anthropic \
  --model claude-sonnet-4-5 \
  --api-key-stdin

npm run core -- serve --data-dir .piwork/core --listen 127.0.0.1:7171
```

Use another terminal for the client:

```bash
export PIWORK_CORE_URL=http://127.0.0.1:7171
printf '%s\n' "$PIWORK_ADMIN_PASSWORD" | npm run piwork -- \
  login --account admin --password-stdin
npm run piwork -- status
npm run piwork -- whoami
npm run piwork -- work create --name first-work --wait
npm run piwork -- work list
```

Copy the `workId` from the create output, then start or continue a conversation:

```bash
npm run piwork -- chat <workId> --message "Inspect this workspace"
npm run piwork -- session list <workId>
npm run piwork -- chat <workId> --session <sessionId> --message "Continue"
```

Core prints one JSON `core.listening` record at startup. Core may be stopped with `SIGTERM` or `Ctrl-C`; running Work containers remain alive and the next Core process adopts them. See [operations](docs/operations.md) for restart, stop/start, deletion, backup, data retention, and diagnostics.

## Verification

```bash
npm run typecheck
npm run build
npm test
npm run test:integration
npm run acceptance
```

`npm run acceptance` builds the deterministic acceptance image and drives compiled Core and CLI processes through login, Docker Work creation, a real Pi SDK conversation, Core replacement, Work stop/start, logout, and deletion. It requires Docker but no external model credential. `npm run real-model-smoke` is separate and opt-in.

The supported control surface in this release is the CLI. A browser Console and remote production deployment are outside the current release scope.
