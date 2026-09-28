# piwork

piwork is a local, single-host runtime for durable AI agent workspaces. One Core process owns authentication, global defaults, Work lifecycle, and recovery. Each running Work has an independent configuration and a non-root `agentd` container.

The command surface has two clients and one optional browser console:

- `piwork-serve` starts Core and performs operator administration. It reads the protected operator credential in the Core data directory. It cannot log in as a user, create Works, or read conversations.
- `piwork-cli` is the logged-in user client. It manages Works, Sessions, Runs, chat, and per-Work configuration. Its bearer credential is stored separately in `$XDG_CONFIG_HOME/piwork/client.json` or `$HOME/.config/piwork/client.json`.
- `piwork-console` starts an independent HTTPS administrator panel on the Core host. It connects to Core over loopback; browsers may connect from other devices. Core and both CLIs work without it.

`piwork-core` is removed. `piwork` remains a compatibility alias for the operator client; `piwork-cli` is the separate user client.

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
npm run serve -- serve --data-dir "$PWD/.piwork/core" \
  --listen 127.0.0.1:7171 \
  --agent-grpc-listen 0.0.0.0:7172 \
  --agent-grpc-advertise piwork-core:7172
```

The second listener is the mutual-TLS control endpoint used only by Work agents. Core adds `piwork-core` as a host-gateway name inside agent containers, and every Work receives its own short-lived client identity. Keep port 7172 private to the Docker host; it is not a user API. The shown values are also the defaults.

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

To manage Serve in a browser, start the optional `piwork-console serve` process after bootstrap. See [Serve 管理面板](docs/serve-console.md) for TLS, startup, role, local directory and ZIP upload, `AGENTS.md` editing, and Operation recovery.
Future browser UI work follows the [UI language](docs/ui-language.md) for visual rules and the [product language](docs/product-language.md) for wording, information order, and actions.

## Managed Skills and default Work context

An operator can import a complete Skill directory after Core is initialized. The path must be absolute, the directory basename becomes the public Skill name, and the directory must contain a regular `SKILL.md`. Core copies the entire validated directory into managed storage, so the source directory is not needed afterward.

```bash
SKILL_DIR="$(realpath ./skills/code-review)"

npm run serve -- --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" \
  skills add --path "$SKILL_DIR"
npm run serve -- --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" \
  skills list
npm run serve -- --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" \
  skills show code-review
```

The basename must match `[a-z0-9][a-z0-9-]{0,63}`. Core does not use metadata inside `SKILL.md` to name the Skill. Imports reject symbolic links and special files and are limited to 2,048 files, 32 MiB total, and 8 MiB per file.

Select managed Skills and optional `AGENTS.md` content for future Works through the default Work configuration:

```bash
npm run serve -- --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" \
  config default-work set --skill code-review \
  --agents-md-file "$PWD/default-AGENTS.md"
npm run serve -- --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" \
  config default-work show
```

Repeat `--skill` to select multiple Skills. Omitting both `--skill` and `--no-skills` preserves the current default selection; `--no-skills` explicitly clears it. `skills update <name> --path <absolute-directory>` replaces the managed content used for future copies. `skills enable`, `disable`, and `remove` manage availability. A Skill selected by the default Work configuration cannot be disabled or removed until it is removed from that selection.

Log in with the user client and create the first Work:

```bash
printf '%s\n' "$PIWORK_ADMIN_PASSWORD" | npm run cli -- \
  --core "$PIWORK_CORE_URL" login --account admin --password-stdin
npm run cli -- status
npm run cli -- whoami
npm run cli -- skills list
npm run cli -- skills show code-review
npm run cli -- work create --name first-work --wait
npm run cli -- work list
```

Startup never creates a default Work. Work creation without Skill or Pi package flags copies the current defaults into independent Work-owned storage. Explicit options replace the corresponding defaults:

```bash
npm run cli -- work create --name reviewed-work \
  --skill code-review --agents-md-file ./AGENTS.md --wait
npm run cli -- work create --name no-skill-work --no-skills --wait
```

Repeat `--skill` to select multiple enabled Skills. `--skill` and `--no-skills` are mutually exclusive. Creation also accepts `--base-image <image>` and `--config <file>`. Later changes to defaults, managed Skill content, or the original import directory do not alter an existing Work.

## Pi packages

An operator can install a Pi package from npm, Git, a local directory, or a ZIP file. The local directory and ZIP are uploaded from the CLI machine. The install lines below illustrate alternative sources for a package. These examples use the installed `piwork-serve` and `piwork-cli` commands (or `npm run serve --` and `npm run cli --` from this checkout):

```bash
piwork-serve packages install npm:@example/pi-tools@1.0.0 --default --wait
piwork-serve packages install git:github.com/example/pi-tools@v1 --wait
piwork-serve packages install ./local-package --wait
piwork-serve packages install ./local-package.zip --wait
piwork-serve packages list
piwork-serve packages show @example/pi-tools
piwork-serve packages update @example/pi-tools --source npm:@example/pi-tools@1.0.1 --wait
piwork-serve packages enable @example/pi-tools
piwork-serve packages disable @example/pi-tools
piwork-serve packages remove @example/pi-tools
piwork-serve operation show <operationId>
```

`--default` installs and adds the package to the default Work selection in one operation. A package selected by default must first be removed from that selection before it can be disabled or removed from Core. `piwork-serve config default-work set --package <name>` replaces the default package list; `--no-packages` clears it. Changes to Core packages and defaults affect only Works created afterwards. Existing Works own their package bytes and change only through their own package commands.

Choose one source form for each install; use `update` to replace an existing package.

```bash
piwork-cli packages list
piwork-cli work create --name demo --package @example/pi-tools --wait
piwork-cli work packages list <workId>
piwork-cli work packages install <workId> npm:@example/pi-tools@1.0.0 --wait
piwork-cli work packages install <workId> git:github.com/example/pi-tools@v1 --wait
piwork-cli work packages install <workId> ./local-package --wait
piwork-cli work packages install <workId> ./local-package.zip --wait
piwork-cli work packages install <workId> --from-core @example/pi-tools --wait
piwork-cli work packages update <workId> @example/pi-tools --from-core --wait
piwork-cli work packages update <workId> @example/pi-tools --source ./local-package --wait
piwork-cli work packages enable <workId> @example/pi-tools
piwork-cli work packages disable <workId> @example/pi-tools
piwork-cli work packages remove <workId> @example/pi-tools
piwork-cli work config packages set <workId> --package @example/pi-tools
piwork-cli work config packages set <workId> --no-packages
piwork-cli work config apply <workId> --wait
```

Package install, update, selection, enable, disable, and removal change the desired context. An existing Work keeps its active package set across restarts until explicit `work config apply`; a newly created Work starts with its copied initial selection. `work packages list` shows desired, active, and loaded state. Use `--wait` to observe installation until the Operation finishes; interrupting the CLI or losing observation does not cancel the accepted Operation, which remains queryable by ID. The singular `work package inspect <file.work>` checks a complete Work archive, while plural `work packages` manages Pi packages within a Work.

For every create or configuration edit, Core materializes one immutable Work context. The data path is:

```text
managed Skill directory
  -> <data>/works/<workId>/contexts/<contextId>/skills/<skillName>
  -> read-only bind mount at /run/piwork in that Work's agentd container
  -> agentd loads /run/piwork/skills with the Pi SDK before readiness
```

The context records both the copied Skill identities and the immutable container-image identity. Selecting, clearing, or reselection of Skills only creates a new context; it does not rebuild the agentd image. A software release that changes the context protocol does require a compatible agentd image to be selected for the Work.

Copy the `workId` from the create output, then send a message or continue a Session:

```bash
npm run cli -- chat <workId> --message "Inspect this workspace"
npm run cli -- session list <workId>
npm run cli -- chat <workId> --session <sessionId> --message "Continue"
```

## Agent-managed Work services

After pi-agentd creates a service, use `piwork-cli work service list <workId>` to obtain its serviceId. The command group supports `show`, `start`, `stop`, `restart`, `retry`, `remove`, and bounded `logs`; creation and definition updates stay with pi-agentd. Controls support `--wait` and `--idempotency-key`, and global `--json` goes before `work`. Stop is persistent across Work restarts; remove preserves shared workspace data. See [service commands and recovery](docs/operations.md#manage-existing-work-services) for examples, log permissions, and Operation observation.

## Share a complete Work

Stop the source Work, export one complete `.work` package, then import it as a new stopped Work under the recipient account:

```sh
piwork-cli work stop <sourceWorkId> --wait
piwork-cli work export <sourceWorkId>
piwork-cli work package inspect <sourceWorkId>.work
# On the recipient installation, after logging in there:
piwork-cli work import <sourceWorkId>.work --wait
piwork-cli work start <newWorkId> --wait
```

The package carries both managed volume trees (workspace and agent-private data), Work-owned code and configuration, retained Skills, Pi packages with prepared dependencies, and AGENTS.md, service definitions and state, reservations, history, and fixed images. It is a full copy: `.env`, user-written credentials, business databases, and development dependencies are not filtered. Share it only with someone you trust. The target Core must already have an enabled matching model with a readable credential; it selects that model automatically, and built-in `work-services` reconnects to the target Core when the Work starts. Custom external MCP platform secrets are not migrated in this version. Import automatically chooses a non-conflicting name from the package unless `--name` is supplied, and never auto-starts the Work, runs user code, replaces an existing Work, or copies the source installation's platform credentials. The first explicit start creates the recipient's runtime network and TLS identity. Container writable layers and anonymous volumes are not part of Work's persistent storage contract. See [the user guide](docs/work-snapshot.md) and [operator notes](docs/operations.md#work-snapshot-operations).

On a fresh installation, the default Work context selects the bundled `deploy-work-service` Skill and the required `work-services` MCP adapter. They are copied into each new Work context and loaded before agentd reports ready. The Skill teaches the agent how to deploy an existing image; the MCP adapter is the only service-control path available to the model. Adding or updating this Skill does not rebuild the agent image. An explicit `--no-skills` removes the instructions from that Work, while an explicit configuration with `mcpServers: []` also removes the deployment tools after apply.

Application containers share the Work bridge network with agentd. A service named `demo` is reachable inside that Work as `svc-demo`; Core never publishes a host port. Services may mount only the Work workspace at `/var/data/workspace` and never receive agentd's private `/var/data`, control credentials, the Docker socket, host paths, or another network. Core uses an existing local or registry image and does not build or commit an application image.

The workspace volume is the persistence boundary. Put source under `/var/data/workspace/apps/<service-name>` and mutable data under `/var/data/workspace/data/<service-name>`. Bind servers to `0.0.0.0`. The container writable layer and `/tmp` are disposable.

This CLI demo asks the agent to write a Python standard-library server, deploy it, and verify it from the same Work:

```bash
npm run cli -- work create --name service-demo --wait
# Copy workId from the response.
npm run cli -- chat <workId> --message '
Use the deploy-work-service Skill. Create apps/demo/server.py using
http.server.ThreadingHTTPServer on 0.0.0.0:8000. Store an atomic JSON counter in
data/demo/counter.json. Deploy it from an existing Python image as service demo,
with a read-write workspace mount, internal TCP port http:8000, and HTTP
readiness at /health. Wait for the Operation, request http://svc-demo:8000/
from this Work twice, and report the counter values and service ID.'
```

The expected model tool flow is `work-services__deployment_context`, file writes through the SDK, `work-services__service_create`, then polling `work-services__operation_get` and `work-services__service_get`. The agent can call `work-services__service_logs` for bounded application output. These provider-safe names map internally to canonical MCP names such as `work-services.service_create`, which remain the names used by tool policy and runtime readiness. A successful result must include the durable service and Operation IDs and an actual request to `svc-demo`; a text-only claim is not deployment evidence.

Service actions have distinct durable meanings:

- `service_restart` replaces the current enabled instance and keeps future restoration enabled.
- `service_stop` disables the service. It remains defined but will not return on Work start until `service_start` enables it.
- `work stop` stops every application service and agentd while retaining enabled state, definitions, and workspace data. `work start` restores enabled services.
- `service_remove` tombstones the service and removes its container while retaining the shared workspace. Work deletion retains its managed volumes for explicit owner cleanup.

Mutations return after durable acceptance, before image resolution and readiness complete. Keep the returned `operationId`, poll it with `operation_get`, and reuse the same idempotency key and payload if a reply is lost. Do not submit a new key merely because image preparation is slow. Failures expose fixed diagnostic codes and stages such as `IMAGE_UNAVAILABLE` at `service-image`, `SERVICE_EXITED` or `SERVICE_READINESS_TIMEOUT` at `service-readiness`, and `DOCKER_UNAVAILABLE`. `service_logs` returns at most 200 lines and 64 KiB, defaults to 100 lines, uses a two-second collection bound, and is available only to the Work owner or its current agent identity. Log content remains application data and is never copied into Core's durable error message.

Each Work has an active context, a desired context, and a revision-free pending flag:

```bash
npm run cli -- work config show <workId>
npm run cli -- work config set <workId> --config ./work-config.json
npm run cli -- work config skills list <workId>
npm run cli -- work config skills set <workId> --skill code-review
npm run cli -- work config agents show <workId>
npm run cli -- work config agents set <workId> --file ./AGENTS.md
npm run cli -- work config apply <workId> --idempotency-key apply-1 --wait
```

Use `work config skills set <workId> --no-skills` to select an empty Skill set; a Skills set command must contain either `--skill` or `--no-skills`. Field-specific Skill and AGENTS commands preserve unrelated desired fields. Configuration updates only change the desired context and set `pendingApply`; they do not interrupt the active runtime or a Run. `apply` accepts immediately with an Operation ID, captures the current desired context, prepares or restarts that Work, and activates the captured context only after agentd reports the exact context, tools, and SDK-loaded Skills. If another update commits while apply is running, it remains desired with `pendingApply: true`. A failed apply leaves the prior active context usable.

`work config show` reports desired and active context settings plus `runtime`. `runtime.skills` is current agentd readiness evidence: `ready` means each displayed Skill was SDK-loaded from this Work's copied directory; `initializing` and `failed` describe the current lifecycle attempt; `unavailable` means the Work is stopped, unreachable, or cannot prove the active generation. These non-ready states always have an empty loaded list and never reuse a historical load result. Each ready entry also reports `modelVisible`. A false value includes `model-invocation-disabled` or `read-tools-disabled` as the reason; a Skill can be loaded correctly while policy prevents the model from invoking it.

Core writes JSON-line start and terminal events to the `piwork-serve serve` process stderr. Agentd writes initialization events to its container stderr before an initialization exit; Core validates and stores recognized safe evidence before cleanup. To inspect a failed create or apply, retain its Operation ID and run `operation show <operationId>`; it includes the safe failure code, stage, retry guidance, collection state, and bounded stage history without Skill contents, paths, credentials, or raw container output. With `--json --wait`, stdout contains one terminal Operation object and no progress records, so scripts can parse it as one JSON value.

Representative errors include `SKILL_LOAD_FAILED` at `skill-load` for an SDK-invalid manifest, `AGENT_CONTEXT_INCOMPATIBLE` for an old agentd/context contract, and `AGENT_READINESS_TIMEOUT` when the exact running generation never completes its handshake. Use the returned remediation and retry with a new idempotency key after correcting the cause:

```bash
npm run cli -- operation show <operationId>
npm run cli -- work config apply <workId> --idempotency-key apply-2 --wait
```

To adopt updated managed Skill content, select that Skill again for the Work and apply the new desired context. Existing Work copies remain usable if the managed Skill is later updated, disabled, removed, or if its original source directory disappears. Configuration commands do not accept or expose numeric revisions.

This is the initial pre-0.1 storage format. Core performs structural database initialization and same-version recovery, but it does not migrate older experimental Work contexts, one-volume Work layouts, or service records without captured image identities. Unsupported data fails explicitly and remains untouched; create a new Work with the current version and remove retained old data explicitly when it is no longer needed.

## Environment-file startup and deployment test

Copy [`.env.test.example`](.env.test.example) to `.env.test`, fill in its administrator and Anthropic values, and run:

```bash
./scripts/deployment-test.sh .env.test
```

The script builds the workspace, selects a free loopback port, starts the compiled daemon with a temporary data directory, waits for health and readiness, logs in with `piwork-cli`, proves no default Work exists, creates a Work, chats with the configured model, exercises Work config set/apply, restarts Core, verifies the saved login and conversation path, and removes its temporary state. It never prints the password, operator credential, user token, or model API key.

For normal startup, `piwork-serve serve --env-file <path>` recognizes:

- `PIWORK_DATA_DIR`, `PIWORK_LISTEN`, and `PIWORK_CORE_URL`
- `PIWORK_AGENT_GRPC_LISTEN` and `PIWORK_AGENT_GRPC_ADVERTISE` for the private agent-to-Core service-control endpoint
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
config default-work show
config default-work set
skills list|show|add|update|enable|disable|remove
```

`piwork-cli` provides:

```text
status
login
logout
whoami
work create|list|show|start|stop|retry|delete
work config show|set|apply
work config skills list|set
work config agents show|set
skills list|show
operation show
session create|list|show
run show|watch|cancel
chat
```

## CLI usage demos

The examples in this repository use npm wrappers. After installing the binaries, replace `npm run serve --` with `piwork-serve` and `npm run cli --` with `piwork-cli`. Global options such as `--core`, `--data-dir`, and `--json` must appear before the command. Use `--help` to print the full command grammar:

```bash
npm run serve -- --help
npm run cli -- --help
```

### Operator client

The operator client uses the protected credential under `PIWORK_DATA_DIR`. This example checks Core, manages a user, inspects Skills, and changes the defaults copied into future Works:

```bash
npm run serve -- --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" status
npm run serve -- --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" \
  admin users list

printf '%s\n' "$NEW_USER_PASSWORD" | npm run serve -- \
  --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" \
  admin users create --account alice --role user --password-stdin

npm run serve -- --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" \
  skills list
npm run serve -- --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" \
  config default-work set --skill code-review
npm run serve -- --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" \
  config default-work show
```

User lifecycle commands take the stable user ID returned by `admin users list`:

```bash
npm run serve -- --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" \
  admin users disable <userId>
npm run serve -- --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" \
  admin users enable <userId>
printf '%s\n' "$NEW_USER_PASSWORD" | npm run serve -- \
  --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" \
  admin users reset-credential <userId> --password-stdin
```

Managed Skill lifecycle commands use the directory basename as `<skill-name>`:

```bash
npm run serve -- --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" \
  skills update <skill-name> --path <absolute-directory>
npm run serve -- --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" \
  skills disable <skill-name>
npm run serve -- --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" \
  skills enable <skill-name>
npm run serve -- --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" \
  skills remove <skill-name>
```

### User client

The user client saves its own login credential. This example discovers available Skills, creates a Work, updates its desired context, applies it, and starts a persistent conversation:

```bash
printf '%s\n' "$USER_PASSWORD" | npm run cli -- \
  --core "$PIWORK_CORE_URL" login --account alice --password-stdin

npm run cli -- whoami
npm run cli -- skills list
npm run cli -- skills show code-review
npm run cli -- work create --name project-a --skill code-review \
  --agents-md-file ./AGENTS.md --wait
npm run cli -- work list
npm run cli -- work show <workId>

npm run cli -- work config skills set <workId> \
  --skill code-review --skill another-skill
npm run cli -- work config agents set <workId> --file ./AGENTS.md
npm run cli -- work config show <workId>
npm run cli -- work config apply <workId> --idempotency-key project-a-skill-apply --wait
npm run cli -- operation show <operationId>

# Whole-context replacement from an exported or edited configuration object:
npm run cli -- work config set <workId> --config ./work-config.json
npm run cli -- work config apply <workId> --idempotency-key project-a-config-apply --wait

# Explicitly clear Skills, then activate that desired context:
npm run cli -- work config skills set <workId> --no-skills
npm run cli -- work config apply <workId> --idempotency-key project-a-clear-skills --wait

npm run cli -- session create <workId>
npm run cli -- chat <workId> --session <sessionId> \
  --message "Review the current workspace"
npm run cli -- session show <workId> <sessionId>
```

`chat` prints the stable Session and Run IDs. Use them to inspect, resume, watch, or cancel execution:

```bash
npm run cli -- run show <workId> <runId>
npm run cli -- run watch <workId> <runId> --after <lastSequence>
npm run cli -- run cancel <workId> <runId>
npm run cli -- chat <workId> --session <sessionId> --message "Continue"
```

Work lifecycle commands optionally wait for their durable Operation to finish:

```bash
npm run cli -- work stop <workId> --wait
npm run cli -- work start <workId> --wait
npm run cli -- work retry <workId> --wait
npm run cli -- work delete <workId> --wait
npm run cli -- logout
```

Add `--json` before the command when scripting. The installed binary writes one JSON value to standard output without npm wrapper output:

```bash
piwork-cli --json work list
piwork-serve --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" \
  --json skills list
```

Core prints one JSON `core.listening` record after startup checks complete. Stop it with `SIGTERM` or `Ctrl-C`; Core closes new admission, drains active Runs, reaps MCP subprocesses, stops every Work service even if agentd is missing, then stops agentd. Shutdown is bounded to 45 seconds and fails instead of claiming a clean exit when an owned container cannot be confirmed stopped. The next Core process restores only Works whose desired state is still running. See [operations](docs/operations.md) for readiness, restart, backup, credentials, and data retention.

## Verification

```bash
npm run typecheck
npm run build
npm test
npm run test:integration
npm run acceptance
openspec validate --specs --strict
```

`npm run acceptance` uses the deterministic acceptance image and real compiled Core/CLI subprocesses. It requires Docker but no external model credential. `npm run real-model-smoke` and `scripts/deployment-test.sh` are opt-in real-provider checks.
