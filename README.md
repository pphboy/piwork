# piwork

piwork is a local, single-host runtime for durable AI agent workspaces. One Core process owns authentication, global defaults, Work lifecycle, and recovery. Each running Work has an independent configuration and a non-root `agentd` container.

The command surface has two clients:

- `piwork-serve` starts Core and performs operator administration. It reads the protected operator credential in the Core data directory. It cannot log in as a user, create Works, or read conversations.
- `piwork-cli` is the logged-in user client. It manages Works, Sessions, Runs, chat, and per-Work configuration. Its bearer credential is stored separately in `$XDG_CONFIG_HOME/piwork/client.json` or `$HOME/.config/piwork/client.json`.

Only these two binary names are published. There are no `piwork-core` or `piwork` compatibility aliases.

## Requirements

- Linux with Docker Engine available to the current user
- Node.js 24 LTS and npm 11 or newer
- OpenSSL 3

## Build and run

```bash
npm ci
npm run build
npm run agent:image
mkdir -p .piwork
npm run serve -- serve --data-dir "$PWD/.piwork/core" --listen 127.0.0.1:7171
```

An empty Core still starts. `GET /healthz` returns success while `GET /readyz` reports `ADMIN_REQUIRED`. Core creates `$PWD/.piwork/core/operator.credential` with mode `0600`; it does not print that credential.

In another terminal, initialize the running Core. Global options precede the subcommand:

```bash
export PIWORK_DATA_DIR="$PWD/.piwork/core"
export PIWORK_CORE_URL=http://127.0.0.1:7171

printf '%s\n' "$PIWORK_ADMIN_PASSWORD" | npm run serve -- \
  --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" \
  admin bootstrap --account admin --password-stdin

printf '%s\n' "$PIWORK_MODEL_API_KEY" | npm run serve -- \
  --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" \
  config set --agent-image piwork-agentd:local \
  --model-provider anthropic --model claude-sonnet-4-5-20250929 \
  --model-base-url https://api.anthropic.com --api-key-stdin

npm run serve -- --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" status
npm run serve -- --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" config show
```

Core changes readiness online; it does not need a restart after bootstrap or runtime configuration.

Log in with the user client and create the first Work:

```bash
printf '%s\n' "$PIWORK_ADMIN_PASSWORD" | npm run cli -- \
  --core "$PIWORK_CORE_URL" login --account admin --password-stdin
npm run cli -- status
npm run cli -- whoami
npm run cli -- work create --name first-work --wait
npm run cli -- work list
```

Startup never creates a default Work. Work creation copies the current global runtime default into an independent Work snapshot. Later global changes apply only to Works created afterward.

Copy the `workId` from the create output, then send a message or continue a Session:

```bash
npm run cli -- chat <workId> --message "Inspect this workspace"
npm run cli -- session list <workId>
npm run cli -- chat <workId> --session <sessionId> --message "Continue"
```

Each Work has desired and active configuration revisions:

```bash
npm run cli -- work config show <workId>
npm run cli -- work config set <workId> --config ./work-config.json --expected-revision 1
npm run cli -- work config apply <workId> --expected-revision 2
```

`set` only creates a desired revision and sets `pendingRestart`; it does not interrupt a Run. `apply` explicitly prepares or restarts that Work and advances the active revision after the new runtime reports ready. Existing Works never follow later global `config set` changes.

## Environment-file startup and deployment test

Copy [`.env.test.example`](.env.test.example) to `.env.test`, fill in its administrator and Anthropic values, and run:

```bash
./scripts/deployment-test.sh .env.test
```

The script builds the workspace, selects a free loopback port, starts the compiled daemon with a temporary data directory, waits for health and readiness, logs in with `piwork-cli`, proves no default Work exists, creates a Work, chats with the configured model, exercises Work config set/apply, restarts Core, verifies the saved login and conversation path, and removes its temporary state. It never prints the password, operator credential, user token, or model API key.

For normal startup, `piwork-serve serve --env-file <path>` recognizes:

- `PIWORK_DATA_DIR`, `PIWORK_LISTEN`, and `PIWORK_CORE_URL`
- `PIWORK_ADMIN_ACCOUNT` and `PIWORK_ADMIN_PASSWORD`
- `PIWORK_AGENT_IMAGE`, `PIWORK_MODEL_PROVIDER`, `PIWORK_MODEL`, optional `PIWORK_MODEL_BASE_URL`, and `PIWORK_API_KEY`; `PIWORK_MODEL_ID` and `PIWORK_MODEL_API_KEY` are accepted as compatibility environment names
- `PIWORK_OPERATOR_CREDENTIAL_PATH` for operator client commands

Explicit CLI flags override process environment, which overrides the selected env file. Persisted administrators, the operator credential, and global runtime configuration always win on restart; env values only fill missing first-run state.

## Command ownership

`piwork-serve` provides:

```text
serve
status
admin bootstrap
admin users list
admin users create
admin users enable
admin users disable
admin users reset-credential
config show
config set
```

`piwork-cli` provides:

```text
status
login
logout
whoami
work create|list|show|start|stop|retry|delete
work config show|set|apply
operation show
session create|list|show
run show|watch|cancel
chat
```

Core prints one JSON `core.listening` record after startup checks complete. Stop it with `SIGTERM` or `Ctrl-C`; healthy Work containers remain alive and the next Core process adopts them using each Work's active configuration. See [operations](docs/operations.md) for readiness, restart, backup, credentials, and data retention.

## Verification

```bash
npm run typecheck
npm run build
npm test
npm run test:integration
npm run acceptance
openspec validate unify-core-admin-config-and-split-clients --type change --strict
```

`npm run acceptance` uses the deterministic acceptance image and real compiled Core/CLI subprocesses. It requires Docker but no external model credential. `npm run real-model-smoke` and `scripts/deployment-test.sh` are opt-in real-provider checks.
