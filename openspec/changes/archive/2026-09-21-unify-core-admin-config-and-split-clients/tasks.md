# Tasks

## 1. Persistence and migration foundation

- [x] 1.1 Extend the Core store schema with operator credential metadata, global runtime secret references/availability, and per-Work configuration binding fields; verify the migration creates the new schema on an empty data directory.
- [x] 1.2 Add a transactional, rerunnable migration for existing Works that snapshots the current global runtime profile into desired and active Work configuration revisions and clears `pendingRestart`; verify a migrated Work retains its model after the global profile changes.
- [x] 1.3 Add store-level compare-and-swap helpers for Work desired/active revisions and idempotent bootstrap/config writes; verify stale expected revisions fail without changing stored data.

## 2. Startup state and environment initialization

- [x] 2.1 Implement the `.env`/`.env.test` parser for comments, blank lines, quoted values, duplicate keys, and invalid syntax without shell evaluation; verify parser unit tests cover valid and malformed files.
- [x] 2.2 Implement configuration precedence (CLI flags, process environment, env file, persisted state) and the documented initialization key set; verify persisted administrator, credential, and runtime values always win on restart.
- [x] 2.3 Refactor Core startup into the staged `STORE_OPEN`, `LISTENING`, `ADMIN_REQUIRED`, `RUNTIME_NOT_CONFIGURED`, `RUNTIME_UNAVAILABLE`, `RECOVERING`, and `READY` states; verify `/healthz` stays available while `/readyz` reports the correct reason for each missing dependency.
- [x] 2.4 Apply env-file first-run initialization only to missing administrator and global runtime records, using one transaction and no default Work creation; verify a partial or malformed env file leaves existing records unchanged and returns an actionable initialization error.
- [x] 2.5 Make recovery retryable and idempotent, and route every existing Work through its persisted active configuration; verify restarting twice does not create duplicate runtime instances.

## 3. Operator credential and authorization boundary

- [x] 3.1 Add protected operator credential creation/loading with owner-only permissions, parent-directory checks, symlink rejection, and non-echoing stdin/file input; verify unsafe paths and permissions are rejected.
- [x] 3.2 Extend HTTP authentication to distinguish operator and user principals and enforce route-level authorization; verify user tokens cannot call control routes and operator credentials cannot read Session, Run, or chat content.
- [x] 3.3 Add centralized secret redaction for passwords, bearer tokens, operator credentials, API keys, and secret paths in logs, errors, status responses, and CLI output; verify redaction tests cover success and failure paths.

## 4. Core control-plane API

- [x] 4.1 Add the operator status endpoint returning startup state, readiness reason, and non-secret availability checks; verify it works before administrator bootstrap and after the Core reaches `READY`.
- [x] 4.2 Add protected online administrator bootstrap with empty-install one-time handling and repeated-bootstrap rejection; verify it creates exactly one enabled administrator and preserves existing identities on retry.
- [x] 4.3 Expose operator user-management routes for list, create, enable, disable, and credential reset using existing `UserAdministrationService` rules; verify responses contain safe metadata only and preserve last-enabled-admin protection.
- [x] 4.4 Expose operator global runtime read/update routes with validation, secret references, and availability flags; verify updates affect the persisted default without returning secret plaintext.
- [x] 4.5 Standardize control-route error codes for unauthorized, initialization-required, invalid input, conflict, and runtime-unavailable cases; verify the two CLIs can map each code to a stable exit status.

## 5. Shared client protocol and split binaries

- [x] 5.1 Extract shared HTTP protocol types, endpoint resolution, error mapping, and safe output helpers for the two CLI packages; verify both packages compile against the same response and error contracts.
- [x] 5.2 Implement `piwork-serve` with `serve`, `status`, `admin bootstrap`, `admin users`, and `config show|set`, using only operator credentials; verify wrong-surface user commands fail locally without an HTTP request.
- [x] 5.3 Implement `piwork-cli` with login, logout, whoami, status, Work lifecycle, Session, Run, chat, and Work configuration commands; verify wrong-surface operator commands fail locally without an HTTP request.
- [x] 5.4 Publish exactly the `piwork-serve` and `piwork-cli` binaries and remove legacy `piwork-core`/`piwork` alias entries; verify package metadata exposes only the two intended command names.
- [x] 5.5 Implement distinct endpoint and credential lookup precedence for operator and user clients, including `--core`, environment, env-file, saved credentials, and loopback defaults; verify each precedence path with CLI unit tests.
- [x] 5.6 Add stable usage, authentication, Core-unavailable, initialization, conflict, runtime-failure, and server-error exit codes while hiding all secrets; verify snapshot or golden-output tests for representative commands.

## 6. Global defaults and Work-specific configuration

- [x] 6.1 Update Work creation to materialize the current global default into an independent desired configuration snapshot and reject creation when no usable default exists; verify changing the global default does not alter an existing Work.
- [x] 6.2 Add authenticated Work configuration read/update/apply routes backed by `WorkConfigurationService`, including expected revision and pending-restart behavior; verify concurrent edits return a conflict and do not overwrite the first update.
- [x] 6.3 Add `piwork-cli work config show|set|apply` with validation for image, model, provider, endpoint, skills, MCP, resources, and secret references; verify secret values are accepted through protected input but never displayed.
- [x] 6.4 Change Docker runtime construction, recovery, and restart paths to consume the Work's active configuration rather than loading the global profile; verify an existing Work continues using model-a after the global default changes to model-b.
- [x] 6.5 Ensure apply validates and activates a Work revision only after the runtime is ready, preserving the previous active revision and current Run on failure; verify an in-flight Run is not implicitly interrupted by `work config set`.

## 7. Integration and deployment tests

- [x] 7.1 Add subprocess integration coverage that starts Core on a temporary data directory, checks health/readiness, bootstraps through `piwork-serve`, configures the runtime, and proves no default Work is created; verify the test uses the built binaries and real HTTP calls.
- [x] 7.2 Add restart persistence coverage for administrator login, saved user credentials, global defaults, Work desired/active revisions, sessions, and Run/chat continuation; verify all survive a Core process stop and start.
- [x] 7.3 Add authorization and isolation coverage proving operator APIs cannot return conversation content and user APIs cannot mutate users or global defaults; verify both credential stores are independent.
- [x] 7.4 Add a repository test shell script and `.env.test` template that start the daemon, wait for health/readiness, run the two CLIs through bootstrap/login/chat and Work configuration flows, and clean up temporary state; verify the script exits nonzero on any failed assertion and never prints secrets.
- [x] 7.5 Add failure-path integration tests for unavailable Docker/provider, malformed env files, unsafe operator credential files, missing initialization, and stale revision conflicts; verify stable reason codes and that persisted data remains consistent.

## 8. Documentation and final validation

- [x] 8.1 Document the separation between `piwork-serve` (operator control plane) and `piwork-cli` (logged-in user client), command ownership, credential locations, env-file keys, and the no-default-Work behavior; verify examples match the implemented help output.
- [x] 8.2 Document migration, restart behavior, global-default copy semantics, per-Work apply semantics, readiness states, and secret-handling guarantees; verify the deployment test script is referenced and reproducible.
- [x] 8.3 Run the complete unit, package, subprocess, and deployment test suites plus strict OpenSpec validation; verify `openspec validate --change unify-core-admin-config-and-split-clients --strict` passes and every requirement scenario has automated coverage.
