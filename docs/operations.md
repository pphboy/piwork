# piwork single-host operations

piwork supports one Linux host with Docker Engine. Core listens on loopback by default and talks to each Work's `agentd` over a private Docker bridge with generation-scoped mutual TLS. Agent ports are not published on the host.

## Process and command boundaries

`piwork-serve` is the Core daemon and operator control client. It owns `serve`, status, administrator/user management, and the global runtime default. `piwork-cli` is the logged-in user client. It owns Work lifecycle, per-Work configuration, Sessions, Runs, and chat. Only these two binaries are published.

Operator authentication uses `<data-dir>/operator.credential`. User authentication uses `$XDG_CONFIG_HOME/piwork/client.json`, `$HOME/.config/piwork/client.json`, or `PIWORK_CONFIG_PATH`. Both files require mode `0600` and a private parent directory; symlinks are refused. The credentials are independent: an operator credential cannot read conversation content, and a user bearer token cannot mutate users or global defaults.

For `.piwork/core`, Core stores:

- `core.sqlite`: accounts, login sessions, Works, Operations, configuration revisions, and control metadata.
- `operator.credential`: the local operator credential.
- `runtime-profile.json`: the current global default image, provider, model, endpoint, and secret reference metadata.
- `secrets/`: immutable model credentials referenced by global and Work revisions.
- `runtime/`: installation identity, internal CA, generation identities, and Work runtime files.

## Clean installation

Build and start an empty Core:

```bash
node --version                 # Node.js 24
npm ci
npm run build
npm run agent:image
export PIWORK_DATA_DIR="$PWD/.piwork/core"
export PIWORK_CORE_URL=http://127.0.0.1:7171
npm run serve -- serve --data-dir "$PIWORK_DATA_DIR" --listen 127.0.0.1:7171
```

The Agent image build uses the USTC npm proxy by default. To select another
registry, pass `--build-arg NPM_REGISTRY=<registry>` to the Docker build.

Core binds even when it has no administrator or runtime default. In another terminal, initialize the running service:

```bash
printf '%s\n' "$PIWORK_ADMIN_PASSWORD" | npm run serve -- \
  --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" \
  admin bootstrap --account admin --password-stdin

printf '%s\n' "$PIWORK_MODEL_API_KEY" | npm run serve -- \
  --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" \
  config set --agent-image piwork-agentd:local \
  --model-provider anthropic --model claude-sonnet-4-5-20250929 \
  --api-key-stdin

npm run serve -- --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" status
npm run serve -- --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" config show
```

`--model-base-url <url>` configures a compatible endpoint. `--api-key-file <protected-file>` supports provisioning systems. Repeated administrator bootstrap fails without changing existing users. Updating the global default creates a new profile revision and affects only future Work creation.

## Environment-file initialization

`piwork-serve serve --env-file .env.test` parses plain `KEY=value`, quoted values, comments, and blank lines without executing shell expressions. It recognizes the following keys:

```text
PIWORK_DATA_DIR
PIWORK_LISTEN
PIWORK_CORE_URL
PIWORK_OPERATOR_CREDENTIAL_PATH
PIWORK_ADMIN_ACCOUNT
PIWORK_ADMIN_PASSWORD
PIWORK_AGENT_IMAGE
PIWORK_MODEL_PROVIDER
PIWORK_MODEL
PIWORK_MODEL_BASE_URL
PIWORK_API_KEY
```

Existing deployments may use `PIWORK_MODEL_ID` in place of `PIWORK_MODEL` and
`PIWORK_MODEL_API_KEY` in place of `PIWORK_API_KEY`.

Explicit flags have highest transient precedence, then process environment, then the selected file. Persisted administrator, operator, and runtime records always win on restart. Initialization only fills missing state and never creates a default Work.

Use [`.env.test.example`](../.env.test.example) and run [deployment-test.sh](../scripts/deployment-test.sh) for the real Anthropic deployment path:

```bash
cp .env.test.example .env.test
# Edit .env.test.
./scripts/deployment-test.sh .env.test
```

## Health and readiness

`GET /healthz` reports listener/process health. `GET /readyz` reports whether Core can accept runtime operations. Healthy but non-ready states are:

- `ADMIN_REQUIRED`: bootstrap the first administrator.
- `RUNTIME_NOT_CONFIGURED`: save a global runtime default.
- `RUNTIME_UNAVAILABLE`: Docker, the selected image, or another runtime dependency is unavailable.
- `RECOVERING`: Core is adopting or reconciling persisted Works.
- `SHUTTING_DOWN`: Core is closing.

`piwork-serve status` shows initialization and runtime checks without returning secrets. Bootstrap and config routes remain available while Core is healthy but not ready.

## Login, Works, and conversation

```bash
printf '%s\n' "$PIWORK_ADMIN_PASSWORD" | npm run cli -- \
  --core "$PIWORK_CORE_URL" login --account admin --password-stdin
npm run cli -- status
npm run cli -- whoami
npm run cli -- work create --name project-a --wait
npm run cli -- work list
npm run cli -- work show <workId>
npm run cli -- chat <workId> --message "First question"
npm run cli -- session list <workId>
npm run cli -- session show <workId> <sessionId>
npm run cli -- chat <workId> --session <sessionId> --message "Continue"
```

Resume or cancel a Run without resubmitting its prompt:

```bash
npm run cli -- run show <workId> <runId>
npm run cli -- run watch <workId> <runId> --after <lastSequence>
npm run cli -- run cancel <workId> <runId>
```

Startup creates no Work. A new Work copies the current global default. Existing Works keep their own desired and active configuration snapshots after the global default changes.

## Per-Work configuration

```bash
npm run cli -- work config show <workId>
npm run cli -- work config set <workId> --config ./work-config.json --expected-revision 1
npm run cli -- work config apply <workId> --expected-revision 2
```

`set` uses compare-and-swap. A stale expected revision returns a conflict and leaves the first update intact. It changes only desired configuration and does not interrupt the current runtime or Run. `apply` explicitly prepares the desired snapshot, restarts the selected Work when needed, verifies readiness, and then advances active revision. A failed apply leaves the prior active revision recorded and attempts to restore its runtime.

## Restart and lifecycle

Send Core `SIGTERM` or press `Ctrl-C`. Core closes HTTP, runtime channels, scheduling, and SQLite without stopping healthy Work containers. Restart the same data directory and address. Login sessions remain valid until expiration or logout. Recovery adopts each Work using its persisted active configuration, so changing the global default cannot switch an existing Work's model.

```bash
npm run serve -- serve --data-dir "$PIWORK_DATA_DIR" --listen 127.0.0.1:7171
npm run cli -- work stop <workId> --wait
npm run cli -- work start <workId> --wait
npm run cli -- chat <workId> --session <sessionId> --message "After restart"
npm run cli -- operation show <operationId>
npm run cli -- work retry <workId> --wait
npm run cli -- work delete <workId> --wait
npm run cli -- logout
```

Work conversation data lives in a Docker named volume. Stop and delete retain that volume by policy. Delete removes the agent container, private network, and Core runtime material. Remove retained volumes separately only after confirming their data is no longer needed.

## Backup and restore

Stop Core and copy the entire data directory as one unit so SQLite, profiles, secrets, operator credential, and internal CA remain consistent:

```bash
tar -C "$(dirname "$PIWORK_DATA_DIR")" -czf piwork-core-backup.tgz "$(basename "$PIWORK_DATA_DIR")"
```

Back up retained Docker volumes separately. Restore Core data with owner-only permissions and restore volumes before startup. Core reports missing credentials or runtime dependencies as unavailable instead of silently replacing persisted state.

## Acceptance and real-model smoke

`npm run acceptance` uses compiled subprocesses, Docker, mTLS, and an in-image deterministic provider. It needs no external model credential. The opt-in real-model smoke accepts `PIWORK_REAL_AGENT_IMAGE`, `PIWORK_REAL_MODEL_PROVIDER`, `PIWORK_REAL_MODEL_ID`, optional `PIWORK_REAL_MODEL_BASE_URL`, and `PIWORK_REAL_MODEL_API_KEY`:

```bash
PIWORK_REAL_AGENT_IMAGE=piwork-agentd:local \
PIWORK_REAL_MODEL_PROVIDER=anthropic \
PIWORK_REAL_MODEL_ID=claude-sonnet-4-5-20250929 \
PIWORK_REAL_MODEL_API_KEY='...' npm run real-model-smoke
```
