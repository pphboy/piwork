# piwork single-host operations

piwork currently supports one Linux host with Docker Engine. Core listens on loopback by default and talks to each Work's agentd over a private Docker bridge using generation-scoped mutual TLS. Agent ports are never published on the host. Remote public deployment, public TLS termination, multi-host scheduling, and a browser Console are outside this release.

## Data and credentials

Every Core command takes the same `--data-dir`. For `.piwork/core`, Core stores:

- `core.sqlite`: accounts, login sessions, Works, Operations, and lifecycle state.
- `runtime-profile.json`: public provider, model, image, endpoint, and secret reference metadata.
- `secrets/`: model credentials; directories use mode `0700` and stored secrets use mode `0600`.
- `runtime/`: installation identity, internal CA, generation identities, and materialized Work runtime files.

The CLI credential defaults to `$XDG_CONFIG_HOME/piwork/client.json`, or `$HOME/.config/piwork/client.json`. `PIWORK_CONFIG_PATH` overrides it. The parent directory is `0700`, the file is `0600`, and symlinks are refused.

Work conversation data lives in a Docker named volume. Stopping or deleting a Work retains that volume by policy. Deleting removes the agent container, private network, and Core runtime material; an operator must explicitly remove a retained volume after confirming its conversation data is no longer needed.

## Clean installation

```bash
node --version                 # must be Node.js 24
npm ci
npm run build
npm run agent:image
export PIWORK_DATA_DIR="$PWD/.piwork/core"
printf '%s\n' "$PIWORK_ADMIN_PASSWORD" | npm run core -- \
  bootstrap-admin --data-dir "$PIWORK_DATA_DIR" --account admin --password-stdin
printf '%s\n' "$PIWORK_MODEL_API_KEY" | npm run core -- \
  configure-runtime --data-dir "$PIWORK_DATA_DIR" \
  --agent-image piwork-agentd:local --model-provider anthropic \
  --model claude-sonnet-4-5 --api-key-stdin
npm run core -- show-runtime --data-dir "$PIWORK_DATA_DIR"
npm run core -- serve --data-dir "$PIWORK_DATA_DIR" --listen 127.0.0.1:7171
```

`--model-base-url https://example.invalid` configures a compatible endpoint. `--api-key-file <protected-file>` supports provisioning systems. Reconfiguration creates a profile revision. Repeating bootstrap never overwrites the existing administrator.

`GET /healthz` reports process health. `GET /readyz` reports whether runtime configuration, Docker verification, and recovery completed. A healthy process may be not ready with `RUNTIME_NOT_CONFIGURED`, `RUNTIME_UNAVAILABLE`, `RECOVERING`, or `SHUTTING_DOWN`.

## Login, Works, and conversation

```bash
export PIWORK_CORE_URL=http://127.0.0.1:7171
printf '%s\n' "$PIWORK_ADMIN_PASSWORD" | npm run piwork -- login --account admin --password-stdin
npm run piwork -- status
npm run piwork -- whoami
npm run piwork -- work create --name project-a --wait
npm run piwork -- work list
npm run piwork -- work show <workId>
npm run piwork -- chat <workId> --message "First question"
npm run piwork -- session list <workId>
npm run piwork -- session show <workId> <sessionId>
npm run piwork -- chat <workId> --session <sessionId> --message "Continue"
```

The CLI prints Session and Run IDs before observation. Resume an interrupted stream without resubmitting:

```bash
npm run piwork -- run show <workId> <runId>
npm run piwork -- run watch <workId> <runId> --after <lastSequence>
npm run piwork -- run cancel <workId> <runId>
```

## Restart and lifecycle

Send Core `SIGTERM` or press `Ctrl-C`. Core closes HTTP, gRPC channels, scheduling, and SQLite without stopping healthy Work containers. Restart the same data directory and address; the saved login remains valid until expiry or logout, and Core adopts containers only after identity and readiness verification.

```bash
npm run core -- serve --data-dir "$PIWORK_DATA_DIR" --listen 127.0.0.1:7171
npm run piwork -- work stop <workId> --wait
npm run piwork -- work start <workId> --wait
npm run piwork -- chat <workId> --session <sessionId> --message "After restart"
npm run piwork -- operation show <operationId>
npm run piwork -- work retry <workId> --wait
npm run piwork -- logout
npm run piwork -- work delete <workId> --wait  # requires a current login
```

## Backup and restore

Stop Core and copy the entire Core directory as one unit so SQLite, profiles, secrets, and the internal CA remain consistent:

```bash
tar -C "$(dirname "$PIWORK_DATA_DIR")" -czf piwork-core-backup.tgz "$(basename "$PIWORK_DATA_DIR")"
```

Back up retained Docker volumes separately with an operator-approved volume tool. Restore Core data with its original permissions and restore volumes before startup. Core reports missing data as unavailable rather than silently replacing it.

## Acceptance and real-model smoke

`npm run acceptance` uses compiled subprocesses, Docker, mTLS, and the real Pi SDK Session/Run path with an in-image deterministic provider. It needs no external credential and makes no external model request.

The production image rejects deterministic configuration. The separate opt-in smoke uses `PIWORK_REAL_AGENT_IMAGE`, `PIWORK_REAL_MODEL_PROVIDER`, `PIWORK_REAL_MODEL_ID`, and `PIWORK_REAL_MODEL_API_KEY`:

```bash
PIWORK_REAL_AGENT_IMAGE=piwork-agentd:local \
PIWORK_REAL_MODEL_PROVIDER=anthropic \
PIWORK_REAL_MODEL_ID=claude-sonnet-4-5 \
PIWORK_REAL_MODEL_API_KEY='...' npm run real-model-smoke
```
