# piwork single-host operations

piwork supports one Linux host with Docker Engine. Core listens on loopback by default and talks to each Work's `agentd` over a private Docker bridge with generation-scoped mutual TLS. Agent ports are not published on the host.

## Process and command boundaries

`piwork-serve` is the Core daemon and operator control client. It owns `serve`, status, administrator/user management, global runtime/default Work configuration, and managed Skill lifecycle. `piwork-cli` is the logged-in user client. It owns Work and existing service lifecycle, per-Work configuration, Sessions, Runs, chat, and read-only Skill discovery. `piwork` is a compatibility alias for `piwork-serve`; `piwork-core` is removed.

The optional `piwork-console serve` process hosts the HTTPS administrator browser panel on the Core machine. It uses Core's loopback API and can be stopped independently. See [Serve 管理面板](serve-console.md) for setup and usage.

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

### Managed Skills and Work context

Operators import a complete Skill directory with `piwork-serve skills add --path <absolute-directory>`. The final directory basename is the Skill name and must match `[a-z0-9][a-z0-9-]{0,63}`; Core does not parse `SKILL.md` to assign identity. An import permits at most 2,048 regular files, 32 MiB total, and 8 MiB per file, and rejects symlinks or special files. Core validates and stores the complete tree, and a Work copies selected enabled Skills into its own immutable context. Import validates the file tree rather than Pi SDK metadata, so malformed `SKILL.md` content is reported later when that copied Work context is started or applied. A Work keeps its copy when the source directory or managed Skill is later changed, disabled, or removed. To adopt new content, select the Skill again and apply the Work configuration.

Users can inspect selectable Skills with `piwork-cli skills list` and `piwork-cli skills show <skill-name>`. Work creation inherits default Skills when no selection is supplied, replaces them with repeated `--skill` options, or uses an empty selection with `--no-skills`. The same tri-state applies to `work config skills set`; no public revision or `expected-revision` option is accepted.

## Per-Work configuration

```bash
npm run cli -- work config show <workId>
npm run cli -- work config set <workId> --config ./work-config.json
npm run cli -- work config apply <workId>
```

`set` replaces the desired context without a public precondition. Field-specific updates merge against the latest desired context, preserve unrelated fields, and leave the active runtime and Run untouched. `apply` captures the desired context in a durable Operation, restarts the selected Work when needed, verifies readiness, and then activates exactly that captured context. A later edit remains pending; a failed apply leaves the prior active context usable and attempts to restore its runtime.

If a selected package was prepared for a different agent SDK or Node ABI, update the Core package, then update the affected Work's frozen copy and apply its desired configuration when the Core and Work use the same agent environment:

```bash
npm run serve -- packages update <package-name> --source npm:<package-name>@<version> --wait --verbose
npm run cli -- work packages update <workId> <package-name> --from-core --wait --verbose
npm run cli -- work config apply <workId> --wait
```

`work retry` starts the retained active context, or the original context if the Work has never activated. It does not adopt a newer desired package revision; use `work config apply` after updating a package.
If the Work uses a different agent image, use `work packages update <workId> <package-name> --source npm:<package-name>@<version> --wait --verbose` to prepare the package for that image before applying.

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

## Work snapshot operations

See [the user workflow](work-snapshot.md) for stop/export/import/start and [the package format](work-package-format.md) for the durable Work boundary. Snapshot support needs an operator-built, trusted `Dockerfile.snapshot-helper` image and `PIWORK_SNAPSHOT_HELPER_IMAGE` set to that image reference before starting Core. Core resolves it to a fixed local image ID at startup. A missing or unresolvable helper disables snapshot requests with 503 but leaves ordinary Work management available. Do not configure a user-controlled image as the helper. The helper runs without network, Docker socket, model credentials, or host runtime secrets; it has only the named source/target volume and its private spool.

Pi package installation additionally needs `PIWORK_PACKAGE_HELPER_IMAGE` pointing at the trusted package-helper image built with the agent image. Core resolves the helper image and prepares npm/Git/local/ZIP packages in a short-lived isolated container; it publishes only a verified immutable artifact. A Work's context owns a copy of that artifact, including prepared runtime dependencies. Package install/update changes desired state and does not load extension code in an already running Work; use explicit `work config apply` to activate it, including for a stopped Work with an existing active context. Core default package changes affect future Work creation only. A Core package referenced by the default Work selection must be removed from that selection before disabling or removing it. For package install/update, `--wait` observes the accepted Operation until it finishes, even when online preparation exceeds two minutes; transient observation failures are retried against the same Operation. Add `--verbose` with `--wait` to see safe preparation phases and a 30-second heartbeat on stderr. Ctrl+C stops only local waiting and prints the Operation ID for `operation show <id>`; it does not cancel the background job. Package CLI commands generate their own idempotency keys and do not accept `--idempotency-key`.

For online packages requiring Pi 0.86.1, build and deploy the production and acceptance agent images from the same revision (`npm run agent:image` and `npm run agent:image:acceptance`), then point `PIWORK_PACKAGE_HELPER_IMAGE` at a trusted image from that build. A new Core or Work install/update checks both selected images before accepting an Operation. HTTP 409 / CLI exit 6 with `PI_PACKAGE_HELPER_INCOMPATIBLE` means the selected agent or trusted helper image lacks the package-helper contract; rebuild both images and retry. An accepted package Operation that fails with `PI_PACKAGE_SDK_VERSION_UNSUPPORTED` means the package's Pi peer range does not match the selected immutable image. `PI_PACKAGE_INVALID_MANIFEST` instead means the declared peer range or manifest is invalid. These errors contain safe diagnostics; inspect `operation show <id>` for a failed accepted Operation. API callers can replay their original idempotency key to retrieve the same Operation even if the image has since been removed.

An existing Work retains its captured agent image ID and frozen package bytes when the Core image tag changes. To upgrade it, explicitly select a compatible new image for that Work, install or copy a package prepared for that image, then run `piwork-cli work config apply <workId> --wait`. A 0.86.1 package artifact cannot be relabeled as compatible with a 0.86.0 Work; cross-image copy continues to fail the exact environment check. To roll back, explicitly select the previous image ID and previously frozen matching package, then apply. Moving the Core default image or default package selection affects future Works only.

This change establishes the final V1 storage and `.work` format directly. Existing nonempty pre-change Core data directories and old `.work` files without required Pi package fields are rejected; there is no automatic migration or backfill. Deploy Core, both CLIs, contracts, agent image, and helpers together with a fresh data directory. Preserve old data separately if it is needed for the previous release.

Export requires a stopped Work and performs a second actual-container check while holding the Work snapshot gate. It does not require stale source resource-occupancy counters to be zero. `work export <workId>` writes `<workId>.work` by default; `work import <file> --wait` needs only that file, and returns the chosen Work name. Export fails as a whole on unsupported filesystem metadata, unverified history, missing fixed images, an inconsistent managed-volume graph, or unreadable bytes; it never emits a partial successful package. Import requires a verified ready package, target Core with an enabled matching model and readable credential, and sufficient quota. Core selects the model automatically; the user does not provide bindings. Custom external MCP platform secret references are not migrated in this version and fail before acceptance, while built-in `work-services` uses new target Core control credentials at first start. Import creates new platform identities, two new managed volumes, and a stopped Work; no Work container, network, or TLS identity is created before explicit start. Platform-managed source credentials are never copied. User content may include secrets because there is no content filter.

Only one snapshot job and two concurrent binary transfers are admitted per Core installation. Jobs have a 30-minute deadline; upload/download also enforce 60 seconds without progress and 30 minutes total. A ready package is retained for 24 hours. A current download or import lease protects its bytes from collection; expiration prevents new downloads/imports, while the owner can still distinguish an expired package from an unknown one. The snapshot directory under the Core data root needs room for staging plus ready bytes; Docker's data root needs room for new volumes and missing image layers. V1 caps both package size and logical restored bytes at 100 GiB. Ensure backups of the Core data root include the snapshot directory while a transfer or job is in progress; a copied `.work` file is independently usable.

Core records job-owned helpers, volumes, contexts, and transfer leases before use. Startup fences interrupted jobs, removes only their recorded artifacts after ownership checks, and releases their name/quota/gate reservations. A committed import is not rolled back. If Docker cannot confirm helper exit or a target volume's ownership, the job stays `cleanup-pending` and holds its reservations; investigate Docker availability and the exact job labels before retrying recovery. Do not manually delete a different Work's volume or clear SQLite reservations to make room. Core shutdown aborts snapshot work and waits within its 45-second coordination window; any unfinished job is handled by the next startup recovery. Normal Work containers are not stopped for a snapshot job.

The supported rollback is to delete the newly imported Work through normal Work lifecycle commands after confirming it is the intended target; the source Work and downloaded package remain unchanged. Import never overwrites a Work. A failed pre-publication import is cleaned from its own journal and exposes no partial Work. Failed export leaves its source Work stopped. A restored Work may still depend on external URLs or credentials embedded in user files; content-preserving export does not make external systems portable. No automatic registry pull, dependency reinstall, or source platform credential reuse is performed.

For release verification, run `npm run typecheck`, `npm run build`, `npm test`, `npm run test:integration`, `npm run agent:image`, `npm run agent:image:acceptance`, `npm run acceptance`, `node scripts/pi-package-fault-acceptance.mjs`, and `node scripts/online-pi-package-acceptance.mjs` on a Docker-enabled Linux host. The online script uses the public npm registry and fixed `npm:pi-subagents@0.71.0`; registry or network failure fails the release check rather than skipping it. It copies the frozen Core package into a Work and drives foreground and background SDK calls against an ephemeral OpenAI-compatible model fixture in that Work's network namespace. Build the snapshot helper with `docker build -f Dockerfile.snapshot-helper -t piwork-snapshot-helper:pi-packages .`, then run `PIWORK_SNAPSHOT_HELPER_TEST_IMAGE=piwork-snapshot-helper:pi-packages node scripts/work-snapshot-acceptance.mjs`. The snapshot acceptance uses disposable labeled installations and verifies owned Pi packages across stop/export/import/start/apply/re-export and real SDK tool calls after a second import. The package fault acceptance checks real npm/Git source limits, unsafe and expanding ZIPs, lifecycle failure, safe Operation codes, and cleanup of owned Docker resources.

## Manage existing Work services

Use `piwork-cli work service` to inspect and control services created by pi-agentd. Creating and updating service definitions remain in the agent workflow; the CLI has no service create/update commands. All service commands use your saved user login and the existing Core HTTP API.

```bash
piwork-cli work service --help
piwork-cli work service list <workId>
# Copy serviceId from list; service names are not accepted as name selectors.
piwork-cli work service show <workId> <serviceId>
piwork-cli work service stop <workId> <serviceId> --wait
piwork-cli work service start <workId> <serviceId> --wait
piwork-cli work service restart <workId> <serviceId> --wait
piwork-cli work service retry <workId> <serviceId> --wait
piwork-cli work service logs <workId> <serviceId> --tail 100
piwork-cli work service remove <workId> <serviceId> --wait
```

For a source checkout, replace `piwork-cli` with `npm run cli --`. Pass global options before `work`, for example:

```bash
piwork-cli --core http://127.0.0.1:7171 --json work service list <workId>
piwork-cli --json work service stop <workId> <serviceId> --idempotency-key stop-demo-1 --wait
piwork-cli operation show <operationId>
```

`start` persistently enables the service; on a stopped Work it saves that choice and completes without starting the Work or claiming readiness. Run `work start` separately to start the Work. `stop` persistently disables the service, so later Work restarts do not restore it. Stopping the Work itself preserves the enabled choices of its services. `restart` requires an enabled service and a running Work target. `retry` reconciles the existing definition and resets its automatic recovery budget; it does not create or update a definition.

`remove` executes without prompting, removes the service's restoration target and runtime, and retains shared workspace data. The service disappears from list/show; start cannot undo removal. There is no purge-data option. Its accepted Operation remains queryable after removal.

Control commands return Work, service, Operation and correlation IDs plus `reused` immediately unless `--wait` is supplied. An explicit idempotency key is sent unchanged; omitted keys are generated for each invocation. The CLI does not automatically resubmit a mutation on errors. Reusing a key follows Core's existing idempotency and lifecycle preconditions.

For Work and service control commands, `--wait` observes for up to 120 seconds and does not cancel the operation when observation times out or disconnects. It retains the IDs and reports `waiting`; inspect the durable result with `operation show`. Service readiness can take longer than the CLI observation deadline. JSON waiting mode prints exactly one result, including serviceId, and never prints an earlier acceptance or progress lines. Waiting exits 0 for succeeded, 6 for failed/superseded, and 5 for timeout or unavailable observation. `operation show` exits 0 whenever the query succeeds, even for a failed Operation.

List/show display lifecycle metadata, enabled/observed state, desired/applied revisions, public errors and Work-private endpoints. They omit full definitions and environment values. Querying a failed service still exits 0. An endpoint such as `svc-demo` is reachable inside its Work network, not a published host address.

Owners and authorized administrators can read metadata and control services. Only the Work owner can read application logs. Logs are a single bounded read: 100 lines by default, `--tail` accepts 1 through 200, with at most 64 KiB of Core-redacted UTF-8 text. There is no follow mode. JSON reports available/truncated/unavailable, text, truncation and collection time; text mode sends truncation/unavailability notices to stderr. Available or truncated logs exit 0, including empty available logs; unavailable logs exit 5.

Before acceptance, usage errors exit 2, missing login or HTTP 401/403 exit 3, not found exits 4, network/502/503/504 exits 5, conflicts exit 6, and other errors retain fallback exit 1. These request errors leave stdout empty and print safe errors on stderr, including with `--json`.

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
