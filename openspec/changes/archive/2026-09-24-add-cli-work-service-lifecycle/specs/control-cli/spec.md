# Spec Delta

## ADDED Requirements

### Requirement: Expose commands for existing Work services

**Identifier:** CLI-SERVICE-001

`piwork-cli` SHALL expose the following commands for existing services. Global `--core <url>` and `--json` SHALL retain their existing placement before `work` and their existing endpoint and credential resolution rules.

| Command after `piwork-cli` | Arguments and options |
| --- | --- |
| `work service list` | `<workId>` |
| `work service show` | `<workId> <serviceId>` |
| `work service start` | `<workId> <serviceId> [--wait] [--idempotency-key <key>]` |
| `work service stop` | `<workId> <serviceId> [--wait] [--idempotency-key <key>]` |
| `work service restart` | `<workId> <serviceId> [--wait] [--idempotency-key <key>]` |
| `work service retry` | `<workId> <serviceId> [--wait] [--idempotency-key <key>]` |
| `work service remove` | `<workId> <serviceId> [--wait] [--idempotency-key <key>]` |
| `work service logs` | `<workId> <serviceId> [--tail <lines>]` |

Identifiers SHALL be treated as opaque, nonempty, non-whitespace-only IDs, MUST NOT begin with `-` or contain NUL, and SHALL NOT be resolved by service name. The serviceId SHALL be scoped to the supplied Work. Command options SHALL follow the positional arguments. Each allowed option SHALL occur at most once. Missing arguments or option values, empty keys, whitespace-only keys, extra positionals, unknown options, unsupported actions, and duplicate options SHALL exit 2, print safe usage information on stderr, leave stdout empty, and send no HTTP request. Valid commands without a saved credential SHALL exit 3 without contacting Core. Syntax validation SHALL precede credential loading for this command group.

Top-level and Work help SHALL advertise `work service`. `work service --help` and `work service <supported-action> --help` (also `-h`) SHALL show service usage and exit 0 before credential loading or HTTP access. `create`, `update`, `config`, `revisions`, `enable`, `disable`, `delete`, bulk/all operations, `--purge-data`, and `--follow` SHALL NOT be accepted by this group. Creating and updating definitions remains in the pi-agentd workflow; existing HTTP/gRPC capabilities SHALL remain available and unchanged. Existing non-service CLI commands SHALL retain their behavior.

#### Scenario: Discover commands without a login
- **WHEN** a user with no credential requests service help
- **THEN** help lists the eight supported actions, the ID argument order, and supported options, exits 0, and makes no HTTP request

#### Scenario: Reject definition mutations before authentication
- **WHEN** a caller invokes `work service create` or `work service update`, including without a saved credential
- **THEN** the CLI exits 2 without reading a definition file, loading credentials, or contacting Core

#### Scenario: Reject invalid syntax locally
- **WHEN** an invocation omits an ID, supplies an empty ID, adds an extra positional, repeats `--wait` or `--idempotency-key`, or supplies an unsupported option
- **THEN** the CLI emits usage on stderr and exits 2 with no HTTP request or stdout result

#### Scenario: Preserve explicit ID selection
- **WHEN** a caller passes a service name in the serviceId position
- **THEN** the CLI sends that value as an ID without a list/search fallback, and reports Core's missing-resource response if no such ID exists

### Requirement: Inspect service lifecycle metadata safely

**Identifier:** CLI-SERVICE-002

`list` SHALL return nondeleted services ordered by name then serviceId. `show` SHALL return the selected service's metadata. Each CLI service projection SHALL contain exactly `workId`, `serviceId`, `name`, `enabled`, `observedState`, `desiredRevision`, `appliedRevision`, `lastError`, `endpoints`, and `createdAt`. `appliedRevision` and `lastError` SHALL preserve null when absent. `lastError`, when present, SHALL contain only the available public `code`, `message`, and `retryable` fields, with diagnostic strings passed through the existing safe error redaction rules. Endpoint projections SHALL contain only `name`, `protocol`, `host`, `port`, and optional `url` returned by Core. Other fields, especially the full service definition, environment, command, arguments, mount information, and image identity, MUST NOT be printed.

JSON list output SHALL be one `{services: [...]}` value and JSON show output one service projection. Text mode SHALL render these same projections as indented JSON, matching the existing general CLI output convention. Empty lists SHALL produce `{services: []}` and exit 0. A successful read SHALL exit 0 even if the service is failed, disabled, or stopped; query success MUST NOT imply readiness. Endpoints SHALL remain Work-private and MUST NOT be described as published host endpoints.

#### Scenario: Inspect an agent-created service
- **WHEN** an authenticated owner lists services and then shows an existing serviceId
- **THEN** output exposes that service's identity, enabled and observed states, desired/applied revisions, public error, and private endpoints without changing its state

#### Scenario: Return an empty collection
- **WHEN** the Work has no nondeleted services
- **THEN** JSON list emits exactly `{"services":[]}` followed by a newline and exits 0

#### Scenario: Protect service definition content
- **WHEN** Core returns a service definition containing an environment credential and arbitrary additional fields
- **THEN** neither text nor JSON list/show output contains that definition, credential, or the additional fields

#### Scenario: Inspect a failed service
- **WHEN** show returns `observedState: failed` with a last error
- **THEN** the CLI displays the public error and exits 0 because the query succeeded

### Requirement: Control services using existing durable lifecycle semantics

**Identifier:** CLI-SERVICE-003

Service controls SHALL retain WSRV-003, WSRV-004, WSRV-005, WSRV-008, and WSRV-009 semantics. `start` SHALL persist enabled=true; `stop` SHALL persist enabled=false and stop the runtime. Stopping a Work SHALL preserve enabled selections, and starting a Work SHALL restore only enabled services. Starting a service in a stopped Work SHALL save the selection without starting that Work or claiming the service is ready. `restart` SHALL preserve enabled and require an enabled service and a running Work target. `retry` SHALL request Core's explicit retry of the retained desired definition and reset its automatic recovery budget for a newly accepted retry; it SHALL reject disabled or removed services according to Core's existing preconditions. The CLI MUST NOT add its own failed-state prerequisite to retry.

`remove` SHALL submit removal immediately without an interactive prompt, tombstone the service and remove its runtime according to Core, and preserve shared workspace data. The CLI MUST NOT request data purge. New mutations during Work stopping/deleting SHALL retain Core's rejection behavior; the CLI SHALL NOT change the Work target, recreate a removed service, or retry rejected mutations automatically.

#### Scenario: Persist an individual stop
- **WHEN** an owner stops a service successfully and subsequently stops and starts its Work
- **THEN** that service remains disabled while other enabled services retain their normal restoration behavior

#### Scenario: Enable while the Work is stopped
- **WHEN** an owner starts a service in a stopped Work and waits for the operation
- **THEN** successful completion reports the accepted enable operation, the Work remains stopped, and the CLI does not claim the service is ready

#### Scenario: Reject an invalid restart
- **WHEN** restart targets a disabled service or a stopped Work
- **THEN** the CLI reports Core's FAILED_PRECONDITION response, exits 6 for its HTTP 409 response, and performs no follow-up mutation

#### Scenario: Explicitly retry after recovery exhaustion
- **WHEN** an enabled failed service is retried with a new key
- **THEN** Core reconciles its existing desired definition with a reset recovery budget, and the CLI observes the resulting Operation without creating or updating a definition

#### Scenario: Remove without deleting workspace data
- **WHEN** remove succeeds for a service mounting the shared workspace
- **THEN** subsequent list excludes the service, its ordinary show returns not found, its accepted Operation remains queryable, and workspace files remain intact

#### Scenario: A Work stop overtakes service control
- **WHEN** a service action has been accepted and a concurrent Work stop supersedes that action
- **THEN** waiting reports the retained terminal result, exits 6 if superseded, and never resubmits or starts the Work

### Requirement: Preserve service acceptance and observation results

**Identifier:** CLI-SERVICE-004

Each control invocation SHALL submit one mutation with either the nonempty supplied `--idempotency-key` or a newly generated UUID. The CLI MUST NOT pre-read service state before submitting, automatically retry a mutation after a transport error, or replace a supplied key. Repeated requests SHALL rely on Core's existing idempotency scope and lifecycle preconditions; if Core returns a reused acceptance, the CLI SHALL retain its identifiers and `reused: true` rather than create another mutation. A lost acceptance response SHALL be reported as a request failure; the CLI MUST NOT invent an operationId.

Without `--wait`, successful submission SHALL print `{workId, serviceId, operationId, correlationId, reused}` and exit 0 regardless of eventual completion. With `--wait`, the CLI SHALL query the accepted Operation until succeeded, failed, superseded, observation failure, or a 120-second observation deadline measured from acceptance. The deadline SHALL bound in-flight observation requests as well as polling; it SHALL NOT cancel the server Operation. Polls SHALL be sequential and separated by 250 milliseconds while nonterminal and before the deadline.

JSON waiting output SHALL contain exactly one result with `workId`, `serviceId`, `operationId`, `correlationId`, `state`, `result`, `error`, and `diagnostics`; terminal output SHALL preserve Core's additional existing public Operation fields. A deadline or observation failure SHALL retain the acceptance identifiers and use `state: waiting`, null result/diagnostics, and an error with code `OPERATION_WAIT_TIMEOUT` or `OPERATION_OBSERVATION_UNAVAILABLE`, respectively. JSON stdout MUST NOT include the earlier acceptance or progress records. Text mode SHALL print acceptance immediately, then the terminal state or wait failure with Work ID, service ID, Operation ID and the recovery command `piwork-cli operation show <operationId>`; operation failures SHALL include available stage, code, safe reason, and remediation.

Waiting SHALL exit 0 for succeeded, 6 for failed/superseded, and 5 for deadline or unavailable observation, including authentication loss after acceptance. `operation show` SHALL retain its existing query behavior, returning the public Operation and exit 0 even for failed/superseded Operations; this change SHALL NOT require a serviceId field in that existing server response. Other Work wait output SHALL remain compatible.

#### Scenario: Accept without waiting
- **WHEN** a valid stop command is accepted without `--wait`
- **THEN** the CLI prints all five acceptance fields, exits 0, and makes no Operation query

#### Scenario: Reuse an accepted mutation
- **WHEN** Core accepts a repeated same-key request as a replay
- **THEN** the CLI prints the original identifiers and reused=true; with --wait it queries that original Operation

#### Scenario: Observe success or terminal failure as JSON
- **WHEN** a waited service Operation reaches succeeded, failed, or superseded
- **THEN** stdout contains one terminal JSON value including serviceId, and exit status is respectively 0, 6, or 6

#### Scenario: Retain identifiers after an observation failure
- **WHEN** an Operation was accepted and a later poll fails because of a disconnected Core, rejected credential, malformed response, or HTTP error
- **THEN** the CLI emits a waiting result with OPERATION_OBSERVATION_UNAVAILABLE and the accepted identifiers, exits 5, and does not resubmit

#### Scenario: Bound a stalled poll
- **WHEN** the Operation remains pending or its observation request hangs beyond 120 seconds after acceptance
- **THEN** the CLI stops observation with OPERATION_WAIT_TIMEOUT and exit 5, retains the identifiers, and leaves the server Operation running

#### Scenario: Revisit a result after service removal
- **WHEN** the owner runs `operation show` for the retained remove Operation
- **THEN** the public Operation remains readable using its ID without a service lookup and the CLI exits 0 for a successful query

### Requirement: Read bounded service logs

**Identifier:** CLI-SERVICE-005

`logs` SHALL perform one bounded read with `--tail` default 100 and allowed integer values 1 through 200. Explicit values SHALL consist solely of decimal digits and evaluate to a safe integer within that range. Empty, nonnumeric, fractional, signed, zero, out-of-range, and repeated values SHALL be usage errors before HTTP access. The command SHALL preserve Core's existing maximum 64 KiB UTF-8 text, redaction, and availability/truncation reporting and SHALL NOT stream or follow logs.

JSON output SHALL be one object containing `workId`, `serviceId`, `status`, `text`, `truncated`, `collectedAt`, and `reason` only when Core supplies one. `status` SHALL retain `available`, `truncated`, or `unavailable`; `collectedAt` SHALL be Core's timestamp. Text mode SHALL write available/truncated log text to stdout, adding a trailing newline only to nonempty text that lacks one, and write a truncation notice to stderr when truncated. Unavailable logs SHALL leave text stdout empty and write a safe reason to stderr. Available/truncated reads, including empty available logs, SHALL exit 0; status unavailable SHALL exit 5, with its JSON object still printed when JSON was requested. HTTP failures SHALL follow CLI-SERVICE-006 instead.

#### Scenario: Read the default tail
- **WHEN** the owner requests logs without --tail
- **THEN** the request asks for 100 lines and displays Core's bounded log result without streaming

#### Scenario: Preserve a truncated result
- **WHEN** Core returns truncated logs
- **THEN** JSON retains status=truncated and truncated=true, text mode includes a stderr truncation notice, and either mode exits 0

#### Scenario: No log instance is available
- **WHEN** Core returns status=unavailable because the runtime no longer exists or collection failed
- **THEN** the CLI reports that availability explicitly and exits 5 without pretending there were simply zero log lines

#### Scenario: Validate both log tail boundaries
- **WHEN** the owner supplies --tail 1 or --tail 200
- **THEN** the CLI requests exactly that line limit; --tail 0, --tail 201, --tail 1.5 and repeated --tail are rejected locally with exit 2

### Requirement: Preserve service authorization and error compatibility

**Identifier:** CLI-SERVICE-006

Service commands SHALL use the saved user bearer credential, the selected Core endpoint, and Core's existing authorization. Owners and authorized administrators SHALL be able to read service metadata and control services; only the Work owner SHALL read application logs. Ordinary nonowners and mismatched Work/service ID combinations SHALL remain indistinguishable from missing resources as enforced by Core. The CLI MUST NOT fall back to operator credentials, direct Docker access, agent conversation, or another Work.

Before acceptance, missing login or HTTP 401/403 SHALL exit 3, HTTP 404 SHALL exit 4, network failures and HTTP 502/503/504 SHALL exit 5, HTTP 409 SHALL exit 6, and other errors SHALL retain the existing fallback exit 1. Locally rejected syntax SHALL exit 2. These failures SHALL leave stdout empty, write safe errors on stderr even with --json, and never print a stack trace or credential. Observation failures after acceptance SHALL follow CLI-SERVICE-004 instead. Existing Core redaction of application logs SHALL be preserved; CLI metadata SHALL follow CLI-SERVICE-002 rather than print full definitions.

#### Scenario: Administrator controls a service but cannot read its logs
- **WHEN** a logged-in administrator targets another user's Work
- **THEN** authorized metadata and control commands succeed, while logs reports HTTP 403 as exit 3 without printing log content

#### Scenario: Conceal another owner's service
- **WHEN** an ordinary nonowner attempts show or control for another user's service, or an owner supplies a service ID under the wrong Work
- **THEN** Core's not-found response is reported with exit 4 and no metadata, acceptance, or log content

#### Scenario: No fallback after rejection
- **WHEN** Core rejects a control request or the request loses connectivity before acceptance is received
- **THEN** the CLI reports the mapped error without a second mutation, operator request, Docker invocation, or agent Run
