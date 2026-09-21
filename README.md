# piwork

piwork is a local, single-host runtime for durable AI agent workspaces. One Core process owns authentication, global defaults, Work lifecycle, and recovery. Each running Work has an independent configuration and a non-root `agentd` container.

The command surface has two clients:

- `piwork-serve` starts Core and performs operator administration. It reads the protected operator credential in the Core data directory. It cannot log in as a user, create Works, or read conversations.
- `piwork-cli` is the logged-in user client. It manages Works, Sessions, Runs, chat, and per-Work configuration. Its bearer credential is stored separately in `$XDG_CONFIG_HOME/piwork/client.json` or `$HOME/.config/piwork/client.json`.

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

Startup never creates a default Work. Work creation without Skill flags copies the current default Skills and other effective context into independent Work-owned storage. Explicit options replace the corresponding defaults:

```bash
npm run cli -- work create --name reviewed-work \
  --skill code-review --agents-md-file ./AGENTS.md --wait
npm run cli -- work create --name no-skill-work --no-skills --wait
```

Repeat `--skill` to select multiple enabled Skills. `--skill` and `--no-skills` are mutually exclusive. Creation also accepts `--base-image <image>` and `--config <file>`. Later changes to defaults, managed Skill content, or the original import directory do not alter an existing Work.

Copy the `workId` from the create output, then send a message or continue a Session:

```bash
npm run cli -- chat <workId> --message "Inspect this workspace"
npm run cli -- session list <workId>
npm run cli -- chat <workId> --session <sessionId> --message "Continue"
```

Each Work has an active context, a desired context, and a revision-free pending flag:

```bash
npm run cli -- work config show <workId>
npm run cli -- work config set <workId> --config ./work-config.json
npm run cli -- work config skills list <workId>
npm run cli -- work config skills set <workId> --skill code-review
npm run cli -- work config agents show <workId>
npm run cli -- work config agents set <workId> --file ./AGENTS.md
npm run cli -- work config apply <workId>
```

Use `work config skills set <workId> --no-skills` to select an empty Skill set. Field-specific Skill and AGENTS commands preserve unrelated desired fields. Configuration updates only change the desired context and set `pendingApply`; they do not interrupt the active runtime or a Run. `apply` captures the current desired context in an Operation, prepares or restarts that Work, and activates the captured context only after the runtime reports ready. If another update commits while apply is running, it remains desired with `pendingApply: true`. A failed apply leaves the prior active context usable.

To adopt updated managed Skill content, select that Skill again for the Work and apply the new desired context. Existing Work copies remain usable if the managed Skill is later updated, disabled, removed, or if its original source directory disappears. Configuration commands do not accept or expose numeric revisions.

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
npm run cli -- work config apply <workId>
npm run cli -- operation show <operationId>

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

Core prints one JSON `core.listening` record after startup checks complete. Stop it with `SIGTERM` or `Ctrl-C`; healthy Work containers remain alive and the next Core process adopts them using each Work's active configuration. See [operations](docs/operations.md) for readiness, restart, backup, credentials, and data retention.

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
