# Design

## Context

The existing implementation keeps the Core executable and the user CLI in separate packages, but the command surfaces are mixed conceptually: `piwork-core` owns offline bootstrap/configuration/serve operations while `piwork` owns user authentication and Work operations. Core startup currently assumes that an administrator and a global runtime profile already exist, and the HTTP layer exposes user-facing routes without a control-plane boundary. Work configuration storage already has desired and active revisions, but the Docker adapter still resolves the model from the global runtime profile.

This change crosses the Core application lifecycle, authentication, persistent stores, HTTP routing, both CLI packages, and the Docker runtime adapter. The implementation must preserve the existing data directory and persisted behavior where possible, while intentionally replacing the old command names with `piwork-serve` and `piwork-cli`. Requirement details are in the delta specs for `serve-control-plane`, `core-service-startup`, `control-cli`, `user-administration`, and `work-configuration`.

## Goals / Non-Goals

**Goals:**

- Make a running Core reachable before administrator or runtime initialization is complete, with machine-readable health and readiness reasons.
- Introduce a dedicated operator surface (`piwork-serve`) and a dedicated logged-in user surface (`piwork-cli`) with separate credentials and command ownership.
- Provide authenticated control-plane APIs for administrator bootstrap, user administration, and global default runtime configuration.
- Materialize global defaults into an independent Work configuration at creation time and make every runtime/recovery path resolve that Work configuration.
- Support safe `.env`/`.env.test` bootstrap with deterministic precedence and no overwriting of persisted state.
- Keep existing users, Works, sessions, and runs usable after the command-name change; do not add legacy command aliases.
- Add tests that exercise a real Core subprocess, restart persistence, CLI separation, environment initialization, and per-Work configuration behavior.

**Non-Goals:**

- Building the future WebUI; the HTTP control routes only need to be stable enough for a later WebUI client.
- Implementing a new agent protocol, Docker image, provider integration, or conversation UX beyond routing existing login/session/run/chat behavior through `piwork-cli`.
- Making global defaults retroactively migrate or restart existing Works.
- Creating an implicit default Work during startup or initialization.
- Allowing operators to read another user's conversation or Run content.

## Decisions

### 1. Keep one Core process and split only the client surfaces

Add a control-plane command package/bin named `piwork-serve` and a user command package/bin named `piwork-cli`. They share a small HTTP client and typed protocol models, while each command registers only its own subcommands and credential provider. Publish only these two command names; do not retain `piwork-core` or `piwork` aliases. This makes the command split explicit and prevents the command trees from being merged again.

This keeps deployment simple (one listener and one data directory), allows a future WebUI to consume the control-plane API, and prevents an operator token from accidentally entering a user command path. A separate daemon would duplicate persistence and recovery responsibilities, while a single all-purpose CLI would keep the current authorization ambiguity.

### 2. Use a staged startup state machine

Refactor `CoreApplication.create()`/startup so that opening the data store and binding the HTTP listener are independent of readiness. The state progression is:

1. `STORE_OPEN`: open or migrate the data directory and load persisted records.
2. `LISTENING`: bind the configured address and serve `/healthz` and `/readyz`.
3. `ADMIN_REQUIRED`: no administrator exists.
4. `RUNTIME_NOT_CONFIGURED`: an administrator exists but no usable global default exists.
5. `RUNTIME_UNAVAILABLE`: defaults exist but Docker/provider validation is currently unavailable.
6. `RECOVERING`: validate dependencies and recover persisted Work instances using each Work's active configuration.
7. `READY`: all startup checks pass.

Only states 3–5 are non-ready; they are not process-fatal. Control routes remain available in those states, with route-specific errors (`ADMIN_REQUIRED`, `RUNTIME_NOT_CONFIGURED`, `RUNTIME_UNAVAILABLE`) instead of generic 500 responses. A failed recovery records the reason and keeps health available; retrying readiness/recovery must be idempotent and must not create duplicate Work instances.

`/healthz` reports process/listener availability and never requires authentication. `/readyz` reports `{ready, state, reason?, checks}` and does not disclose credentials or API keys. The existing health/readiness response shape should be extended rather than replaced so current probes continue to work.

### 3. Separate operator credentials from user sessions

Add an operator credential store under the Core data directory, created with owner-only permissions (0600 for the file and restrictive permissions for its parent). The credential is generated or accepted during the first protected control-plane setup and is loaded independently from user bearer tokens. Validate the path before use: reject symlinks and group/world-readable files. Do not print the credential after creation; commands read it from the configured protected location or an explicit stdin/file input.

The HTTP authorization layer recognizes two principals: `operator` and `user`. Operator routes require the operator credential; user routes require a user session token. Operator authorization never implies access to session messages, Run output, or chat history. An operator may manage user metadata and global defaults, and may perform the existing administrative Work lifecycle actions subject to the existing `work-access` rules. User tokens cannot call bootstrap, user-management, or global-runtime routes.

### 4. Make environment initialization an idempotent first-run layer

Implement a parser in the control-plane package for `KEY=VALUE` files with blank lines, comments, and single/double quoted values. It must not evaluate shell syntax. Define precedence as explicit CLI flags, then process environment, then `--env-file`; persisted database/credential values always win over all transient sources on restart.

Use a narrow documented key set for listener address, Core URL, first administrator name/password, operator credential location, agent image, provider, model, model base URL, and API key input. On startup, after the store is opened and the listener is available, apply only missing values: create the first administrator and global runtime profile transactionally when all required fields are present, otherwise leave the corresponding readiness reason visible. A malformed or incomplete env file produces a structured initialization error and does not partially overwrite existing state. Secrets are held in memory only long enough to perform the store write or runtime injection and are excluded from logs, status output, and response bodies.

### 5. Expose explicit control-plane HTTP contracts

Add versioned control routes alongside the existing user routes. The exact path prefix may follow the repository's current router convention, but the contracts and authorization are fixed:

- `GET /control/status`: operator-optional status for local `piwork-serve status`, returning startup state, readiness reasons, and non-secret configuration availability.
- `POST /control/admin/bootstrap`: operator-authorized (or the documented empty-install one-time flow) creation of the first administrator; returns safe user metadata.
- `GET /control/users`, `POST /control/users`, and `POST /control/users/{id}/enable|disable|reset-credential`: operator-only user administration.
- `GET /control/runtime` and `PUT /control/runtime`: operator-only global default profile read/update; responses contain references and availability flags rather than secret values.
- Existing Work configuration routes are extended so an authenticated `piwork-cli` owner can read/update desired configuration and explicitly apply it with an expected revision.

Every mutating route is idempotent where the underlying operation is idempotent, uses the existing transaction/store abstractions, and returns stable error codes for unauthorized, conflict, missing initialization, invalid input, and unavailable runtime. The HTTP layer must never serialize password hashes, bearer tokens, operator credentials, API keys, or secret file contents.

### 6. Materialize defaults and resolve runtime configuration per Work

At Work creation, load the current global default profile and copy its non-secret fields plus secret references into the Work's desired configuration. Store a binding/version that records the source default at creation for observability, but do not retain a live pointer that would cause future global changes to flow into the Work. If no global default exists, reject Work creation with `RUNTIME_NOT_CONFIGURED`.

Keep the existing `desiredRevision`, `activeRevision`, and `pendingRestart` model. `work config set` updates only the selected Work's desired revision and requires `expectedRevision`; `work config apply` validates and loads that revision, then updates active revision in one transaction after the runtime is ready. A failed apply leaves the old active revision and running instance untouched. The Work lock/transaction used by the existing configuration service must serialize concurrent edits and applies.

Change `apps/core/src/runtime/docker-work-runtime.ts` and its factory interface to accept a resolved Work runtime configuration. Recovery, start, and apply paths must pass the Work's active configuration; they must not call `RuntimeProfileStore.load()` to choose a model for an existing Work. Global profile reads remain limited to Work creation and control-plane configuration. Secret material continues to be injected into the container/provider process through the existing runtime mechanism and is never written to Work metadata, history, logs, or CLI output.

### 7. Keep command ownership and output contracts explicit

`piwork-serve` owns `serve`, `status`, `admin bootstrap`, `admin users`, and `config show|set`; it never registers `login`, `logout`, `whoami`, `work create`, `session`, `run`, or `chat`. `piwork-cli` owns those user commands plus `work config show|set|apply` and user-visible Work status. Wrong-surface commands fail locally with usage exit code before making an HTTP request.

Both clients use a shared endpoint resolver with surface-specific precedence. The user client resolves explicit `--core`, `PIWORK_CORE_URL`, saved user credential metadata, then loopback. The operator client resolves explicit `--core`, values from `--env-file`, then the documented loopback default and reads only operator credential storage. Exit codes distinguish usage, authentication, Core unavailable, initialization required, conflict, runtime failure, and server error. Human output is stable and secret-free; a machine-readable format may be added through the existing CLI output convention.

### 8. Preserve data compatibility through additive migration

Extend the existing store schema with operator credential metadata, startup/runtime availability metadata where needed, and per-Work configuration binding fields. Use the repository's existing migration/version mechanism. Backfill existing Works by taking the currently persisted global profile as their desired and active configuration at migration time, so a restart cannot silently change their model. Mark the backfilled revision as active and clear `pendingRestart`.

Migration runs before listener readiness is reported. It is transactional and rerunnable; a failed migration leaves the prior version intact and prevents readiness while keeping `/healthz` available. The new commands use the same additive store fields, so rollback can run the previous binary against data written only with additive fields. Do not delete legacy profile fields until a later, separately specified migration.

### 9. Test through real process boundaries

Unit tests cover env parsing, precedence, state transitions, authorization, secret redaction, and revision conflicts. Integration tests start the compiled Core as a subprocess with a temporary data directory, exercise `piwork-serve` and `piwork-cli` over HTTP, and verify:

- empty Core binds health, reports `ADMIN_REQUIRED`, and creates no Work;
- `.env.test` first-run initialization creates exactly one administrator and one global default;
- a restart preserves users, credentials, global defaults, Work desired/active revisions, sessions, and login behavior;
- changing global defaults affects only newly created Works;
- Work config changes require explicit apply and do not interrupt an in-flight Run;
- operator commands cannot read conversation content and user commands cannot call control routes;
- malformed env files, unsafe operator credential permissions, unavailable Docker, and stale expected revisions produce stable failures.

The existing CLI/Core test harness should be extended rather than replaced, and the deployment test shell script should invoke the same binaries a user would run.

## Risks / Trade-offs

- **[Risk] A Core process can be healthy while not ready, and clients may misinterpret that state.** → Keep `/healthz` and `/readyz` distinct, return stable reason codes, and make both CLIs render actionable messages and exit codes.
- **[Risk] Operator credential files may be copied or exposed during deployment.** → Enforce owner-only permissions and symlink checks, support stdin/file injection without echoing, and redact all command/API output.
- **[Risk] Existing Works could switch models during migration or recovery.** → Backfill an explicit per-Work configuration snapshot and require every runtime start/recovery path to receive that snapshot.
- **[Risk] Concurrent config edits can lose updates.** → Reuse expected-revision compare-and-swap inside the Work transaction and return a conflict without modifying the stored desired revision.
- **[Risk] Env-based bootstrap could unexpectedly overwrite an operator's changes.** → Apply env values only when the corresponding persisted record is absent; persisted state has precedence on every restart.
- **[Risk] Splitting packages can drift protocol models or leave an obsolete command surface behind.** → Put shared HTTP types, endpoint resolution, and error-code mapping in a common package; add package metadata tests that assert only the two new command names are published.
- **[Risk] Runtime availability may change after Core becomes ready.** → Keep readiness checks retryable, surface `RUNTIME_UNAVAILABLE`, and make Work creation/apply return a typed unavailable error without corrupting desired state.

## Migration Plan

1. Ship additive schema and service changes together with the intentional command-name change to `piwork-serve` and `piwork-cli`.
2. On first start, migrate the data directory before declaring readiness; backfill existing Work configuration snapshots from the current global profile.
3. Generate or validate the protected operator credential and expose control routes. Existing user tokens remain valid and remain stored in their current location.
4. Install the `piwork-serve` and `piwork-cli` binaries and update deployment scripts and documentation to use them; do not install legacy command aliases.
5. For rollback, stop the new process cleanly and run the prior binary against the migrated directory. Because changes are additive and legacy fields remain, Core can still serve existing users and Works; do not roll back while a partially completed migration transaction is open.

## Open Questions

None. Route prefixes and exact flag spelling should follow the existing router/CLI conventions during implementation, but they do not change the specified authorization, state, precedence, or persistence behavior.
