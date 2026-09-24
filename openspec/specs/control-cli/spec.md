# Control CLI Specification

## Purpose

Defines an executable local `piwork` command-line client that connects to Core, manages a durable login credential safely, controls Docker-backed Works, and conducts persistent agent conversations.

## Requirements

### Requirement: Resolve one Core endpoint consistently

系统 SHALL 提供两个独立命令名：`piwork-serve` 用于 operator 控制面，`piwork-cli` 用于登录用户客户端。`piwork-cli` SHALL 按显式 `--core`、环境变量、保存凭证、默认 loopback 的顺序解析 Core；`piwork-serve` SHALL 按显式 `--core`、`--env-file` 中的控制面地址和文档化默认值解析，并使用 operator credential。

#### Scenario: Use the user client endpoint

- **WHEN** 用户运行 `piwork-cli` 且未提供显式地址
- **THEN** CLI 使用 `PIWORK_CORE_URL`、保存凭证中的地址或 loopback 默认值

#### Scenario: Override the Core URL explicitly

- **WHEN** a user invokes a networked command with `--core <url>` while another URL is stored or set in the environment
- **THEN** the CLI sends the request to the explicit URL

#### Scenario: Reuse the saved endpoint

- **WHEN** no explicit or environment URL is present and a saved credential contains its login endpoint
- **THEN** the CLI sends the request to that saved Core URL

#### Scenario: Use the operator endpoint

- **WHEN** 操作者运行 `piwork-serve admin` 或 `config`
- **THEN** CLI 使用 operator 配置和凭证，不读取 `piwork-cli` 的用户 token

### Requirement: Report Core and Work-runtime status

两个 CLI SHALL 提供状态命令但职责不同：`piwork-serve status` 可在未登录用户时查询 Core 初始化、operator 和 readiness 状态；`piwork-cli status` 查询用户可见的 Core 健康与 Work runtime 状态。两者都必须隐藏 secret。

#### Scenario: Report an empty Core

- **WHEN** Core 正在运行但尚未创建管理员
- **THEN** `piwork-serve status` 显示 `ADMIN_REQUIRED`，`piwork-cli status` 仍能显示健康但不得假装用户已登录

#### Scenario: Report a ready Core

- **WHEN** Core and its Work runtime are ready
- **THEN** `piwork status` reports both as ready and exits with status 0

#### Scenario: Report unavailable Docker

- **WHEN** Core is reachable but its Docker dependency is unavailable
- **THEN** `piwork status` identifies the runtime dependency as unavailable and exits nonzero without a stack trace

### Requirement: Log in and persist credentials safely
The `piwork login` command SHALL accept an account and obtain the password from a hidden prompt or standard input. On success it SHALL persist a versioned record containing the Core URL, token, expiration, and public identity. On POSIX systems the parent directory MUST be current-user-only and the credential file MUST be mode `0600`; unsafe targets such as symbolic links MUST be rejected.

#### Scenario: Scripted login through standard input
- **WHEN** a user runs login with an account and `--password-stdin`
- **THEN** the CLI authenticates and saves the credential without printing the password or bearer token

#### Scenario: Failed login preserves an existing credential
- **WHEN** Core rejects a later login attempt
- **THEN** the CLI reports the public authentication error and leaves any previously saved valid credential unchanged

### Requirement: Show identity and perform server-side logout
The `piwork whoami` command SHALL display the public identity associated with the saved credential. The `piwork logout` command SHALL revoke the server session and then remove the local credential after successful revocation or an already-invalid-session response; an unreachable Core MUST leave the credential available for a later retry.

#### Scenario: Use whoami in a new process
- **WHEN** a valid credential was saved by an earlier CLI process
- **THEN** `piwork whoami` authenticates without prompting and reports the same account, role, and user identifier

#### Scenario: Log out a valid session
- **WHEN** the user invokes logout while Core is reachable
- **THEN** the server session is revoked, the local credential is removed, and the old token no longer authenticates

### Requirement: Create and control Works from the CLI

**Identifier:** CLI-WORK-001

`piwork-cli` SHALL provide Work lifecycle, `work config show`, `work config set`, field-specific configuration commands, and explicit `work config apply` without public revision arguments. `work create` SHALL accept `--base-image <image>`, repeatable `--skill <skill-name>`, `--no-skills`, `--agents-md-file <path>`, and `--config <file>`. If neither Skill option nor a `skills` field is supplied, Core SHALL copy the current default Work Skill selection; explicit Skill flags SHALL replace defaults and a configuration-file selection, while `--no-skills` SHALL select an empty set. The CLI SHALL reject duplicate names and mutually exclusive Skill options before contacting Core. Core SHALL copy selected managed Skill directories, AGENTS content, and the resolved configuration into Work-owned storage before reporting successful creation. `piwork-serve` MUST NOT create or control user Works.

SDK-invalid imported Skill bytes SHALL be diagnosed asynchronously during required initialization rather than rejected as a CLI syntax error. Both `work config set <workId> --config <file>` and `work config skills set <workId>` SHALL update desired state consistently; omitted fields in field-specific commands SHALL preserve unrelated desired fields. `--no-skills` SHALL be parsed as a boolean flag on create, per-Work Skill set, and operator default-Work set. Missing selection on the field-specific Skill-set command SHALL be a usage error, not implicit clearing. `work config apply <workId> [--wait] [--idempotency-key <key>]` SHALL report acceptance immediately unless waiting was requested and use the same durable Operation observation behavior as create/start.

#### Scenario: Create from the current default
- **WHEN** 用户运行 `piwork-cli work create --name <name> --wait` without a Skill selection
- **THEN** the Work receives independent copies of the current default Skills and other effective context, and later default or managed-Skill changes do not alter it

#### Scenario: Create with explicit Skills
- **WHEN** a user supplies one or more `--skill <skill-name>` options
- **THEN** the Work receives exactly those enabled managed Skills in the supplied order, replacing the default or configuration-file selection

#### Scenario: Create with per-Work context overrides
- **WHEN** a user supplies base image, Skills, AGENTS content, or a configuration file while creating a Work
- **THEN** explicit CLI fields take precedence over the corresponding configuration-file and default fields, and Core copies the resulting complete context into the new Work

#### Scenario: Create with no Skills
- **WHEN** a user supplies `--no-skills`
- **THEN** the Work is created with an empty Skill directory and does not inherit default Skills

#### Scenario: Reject invalid create context
- **WHEN** a create request repeats a Skill, combines `--skill` with `--no-skills`, names a missing or disabled Skill, or supplies a missing, unreadable, or oversized AGENTS file
- **THEN** the CLI exits with a usage or validation error, no Work becomes visible, no partial Work context remains, and no secret or host path is disclosed

#### Scenario: Update one Work only
- **WHEN** a user changes Work A configuration without an expected-revision argument
- **THEN** only Work A's desired context changes, later successfully committed updates replace earlier desired values, and other Works and global defaults remain unchanged

#### Scenario: Set Skills and AGENTS independently
- **WHEN** an owner invokes `work config skills set <workId> --skill <name>...`, `work config skills set <workId> --no-skills`, or `work config agents set <workId> --file <path>`
- **THEN** Core copies the requested content into that Work's desired context, preserves unrelated fields, and leaves the running active context unchanged

#### Scenario: Apply pending Work configuration explicitly
- **WHEN** an owner invokes `piwork-cli work config apply <workId>`
- **THEN** the CLI submits one apply operation for the desired context captured at acceptance, reports its stable Operation identifier, and does not require a revision or silently cancel an active Run

#### Scenario: Apply a pending Work configuration explicitly
- **WHEN** an owner invokes `piwork-cli work config apply <workId>` while `pendingApply` is true
- **THEN** the CLI applies the desired context captured by that Operation without an expected-revision option and reports the durable Operation state

#### Scenario: Create and wait for a ready Work
- **WHEN** a logged-in user invokes `piwork-cli work create --name <name> --wait` against a configured installation
- **THEN** the CLI returns the stable Work identifier, follows its Operation, and exits successfully only after the Work-owned context is mounted and agentd is ready

#### Scenario: Show a Work preparation failure
- **WHEN** Docker, the image, model configuration, or agent readiness causes an accepted create Operation to fail
- **THEN** the CLI displays the stable Work and Operation identifiers plus a safe actionable failure and exits nonzero

#### Scenario: Stop and restart one Work
- **WHEN** an owner stops a ready Work and later starts it with `--wait`
- **THEN** the CLI observes both Operations and the Work becomes ready again with its retained Work-owned context and data

#### Scenario: Clear Skills through the documented flag
- **WHEN** the owner uses `work config skills set <workId> --no-skills` and successfully applies
- **THEN** desired and active Skills become empty, the ready runtime reports no loaded Skills, and AGENTS/model/image/tool fields are preserved

#### Scenario: Set Skills through configuration JSON
- **WHEN** the owner supplies a valid configuration file with skills [s-a] to the generic set command
- **THEN** it produces the same desired Skill snapshot and pending state as the field-specific set command with s-a, without changing active Skills before apply

#### Scenario: SDK-invalid creation is an Operation failure
- **WHEN** an enabled managed Skill has bytes that pass Core tree validation but fail SDK loading
- **THEN** create returns the accepted Work and Operation, initialization fails before ready, and `--wait` shows the Skill error with those identifiers and exits 6

#### Scenario: Repeated apply key
- **WHEN** a caller repeats an apply with the same idempotency key
- **THEN** the CLI receives the original Operation and reused true, without causing another initialization

### Requirement: Create and continue persistent conversations

**Identifier:** CLI-CHAT-001

`piwork-cli` SHALL independently provide login, Session, Run, Work configuration, and chat commands; `piwork-serve` MUST NOT provide user conversation commands. The user client's credential file and operator credential file MUST remain separate. A chat request SHALL use the Work's active copied context, including active Skills, AGENTS content, base image, model, and tool policy, and SHALL report `pendingApply` rather than applying desired changes implicitly or exposing a configuration revision.

#### Scenario: Continue a Work conversation
- **WHEN** 用户使用 `piwork-cli chat <workId>` 发送消息
- **THEN** CLI 使用用户会话访问其拥有的 Work，并返回持久化 Run 结果

#### Scenario: Send one scripted message
- **WHEN** a user invokes `piwork-cli chat <workId> --message <text>` for a ready Work
- **THEN** the CLI creates or selects a Session, submits exactly one Run, displays the assistant reply, and exits according to the Run terminal state

#### Scenario: Continue an existing Session
- **WHEN** a user invokes chat with a previously returned Session identifier after Core or agentd has restarted
- **THEN** the prompt is added to the same restored Pi SDK history and the reply is associated with that Session

#### Scenario: Chat while configuration is pending
- **WHEN** a Work has a desired context different from its active context and a user sends a prompt
- **THEN** the CLI uses the active context, reports `pendingApply: true`, and does not change the running context as a side effect of chat

#### Scenario: Interrupt an active chat explicitly
- **WHEN** the user presses the documented cancellation key while observing an active Run
- **THEN** the CLI requests Run cancellation, waits for or reports its durable state, and does not treat a mere transport disconnect as cancellation

### Requirement: Inspect Sessions and Runs
The CLI SHALL provide Session list/show and Run show/watch/cancel commands so a user can recover after disconnecting from chat. Watching from a retained event cursor MUST continue the original Run without resubmitting the prompt, and an expired cursor MUST direct the user to the durable Run result and Session history.

#### Scenario: Recover after an observation disconnect
- **WHEN** chat loses its event connection after a Run was accepted
- **THEN** the CLI reports the Run identifier and the user can watch or show that Run without causing another model execution

#### Scenario: Query a completed Run
- **WHEN** a user invokes `run show` for an authorized completed Run
- **THEN** the CLI displays its terminal state and final result without contacting the model again

### Requirement: Provide stable output and failure behavior

**Identifier:** CLI-OUTPUT-001

两个 CLI SHALL 使用各自稳定的命令帮助和退出码。`piwork-serve` 的错误必须区分 Core 未运行、管理员未初始化、默认配置缺失、Skill 导入失败和权限失败；`piwork-cli` 必须区分未登录、Core 不可用、Skill 不可用、Work 不可用和 Run 失败。任何输出不得包含密码、bearer token、operator credential、模型 API key、secret path、Skill import path 或 internal digest。Work configuration commands SHALL return stable Work and Operation identifiers plus active/desired/pending state without public revisions.

#### Scenario: Reject a command on the wrong CLI
- **WHEN** 用户在 `piwork-cli` 执行 operator Skill mutation or `admin users`, or uses `piwork-serve` to chat
- **THEN** 命令立即以 usage 错误退出，不联系 Core 或执行状态变更

#### Scenario: Request JSON output
- **WHEN** a user adds `--json` to a successful status, Skill, identity, Work, Operation, Session, or Run command
- **THEN** the CLI writes exactly one valid JSON value to standard output

#### Scenario: Order concurrent configuration writes
- **WHEN** two authorized configuration updates for one Work commit in sequence without public revision preconditions
- **THEN** the later committed update becomes desired, both callers receive stable results, and neither response contains a revision

#### Scenario: Return revision conflict safely
- **WHEN** a legacy caller supplies an expected revision or revision-bearing configuration request
- **THEN** the CLI or API rejects the obsolete input as unsupported without changing desired context or returning any current revision

#### Scenario: Reject obsolete revision options
- **WHEN** a caller supplies `--expected-revision` to a default Work or per-Work configuration command
- **THEN** the CLI returns a usage error describing the revision-free command and does not contact Core

#### Scenario: Reject invalid command input
- **WHEN** required arguments are missing or an option is invalid
- **THEN** the CLI prints relevant usage to standard error, exits with the documented usage status, and does not contact Core

### Requirement: Retain CLI authentication and conversation access across Core restart
A saved CLI credential SHALL remain usable after Core restarts with the same data directory while the server session remains valid. The same CLI process contract SHALL let the user query the existing Work and continue an existing Session after Core re-adopts the Work generation.

#### Scenario: Continue after Core restart without logging in again
- **WHEN** a user logs in, creates a Work and Session, Core restarts with the same data directory, and the user sends another message before login expiration
- **THEN** the CLI reuses the saved Core URL and token, reaches the recovered Work, and receives a reply in the existing Session

### Requirement: Discover Skills from the user client

**Identifier:** CLI-SKILL-001

`piwork-cli` SHALL provide `skills list` and `skills show <skill-name>` for authenticated users. These commands SHALL identify enabled Core-managed Skills only by the directory basename assigned by Core, SHALL order list output by Skill name, and MUST NOT expose metadata parsed from `SKILL.md`, the operator import path, Core storage path, internal content digest, or Skill file content.

#### Scenario: List Skills before Work creation
- **WHEN** a logged-in user runs `piwork-cli skills list`
- **THEN** the CLI returns the enabled directory-derived Skill names available for `work create` and configuration commands in deterministic name order without manifest metadata

#### Scenario: Reject Skill management on the user client
- **WHEN** a user attempts `piwork-cli skills add`, `update`, `enable`, `disable`, or `remove`
- **THEN** the CLI returns a usage error without contacting a Skill mutation endpoint

### Requirement: Explain Skill state and durable failures through the CLI

**Identifier:** CLI-DIAG-001

`work config show` and `work config skills list` SHALL display desired, active, pendingApply, and current runtime load state defined by WCFG-004. Set responses in text mode SHALL explain that changes are pending until apply; JSON SHALL expose the structured state. Accepted Work commands with `--wait` SHALL output exactly one JSON value in JSON mode: `{workId, operationId, correlationId, state, result, error, diagnostics}` for a terminal Operation, or those identifiers with state `waiting` and a safe wait error if observation fails. Without `--wait`, output SHALL be the acceptance object. Text-mode failures SHALL show Work ID, Operation ID, stage, code, safe reason, remediation, and the `operation show` command. `operation show` SHALL expose the durable structured result/error including rollback and diagnostic-collection outcome, even after Core restart or container removal. It SHALL exit 0 when the query succeeds, including for a failed Operation; waiting exits SHALL be 0 for succeeded, 6 for failed/superseded, and 5 for timeout/unavailable observation. Existing usage/authentication exits SHALL remain unchanged. JSON stdout MUST NOT be polluted by progress logs or multiple result objects.

#### Scenario: See a saved but inactive Skill
- **WHEN** the owner sets s-a and then runs Skill-list before apply
- **THEN** text and JSON distinguish desired s-a from unchanged active/current loaded state and make pendingApply visible

#### Scenario: See and revisit the root cause
- **WHEN** `work create --wait` fails because agentd could not load a selected Skill
- **THEN** the CLI exits 6 and displays the Skill/stage/code and Operation ID; a later authorized `operation show` returns the same primary diagnostic and exits 0

#### Scenario: Wait without losing the Operation
- **WHEN** waiting times out or loses Core connectivity after acceptance
- **THEN** the CLI exits 5, retains Work and Operation identifiers in its output, does not resubmit, and directs the caller to `operation show`

#### Scenario: One machine-readable failure
- **WHEN** a caller uses `--json work config apply <workId> --wait` and initialization fails
- **THEN** stdout contains one parseable terminal envelope including the structured diagnostic and no raw stack, internal path, or earlier acceptance JSON

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

### Requirement: Transfer complete Work packages from the user CLI

**Identifier:** CLI-SNAPSHOT-001

piwork-cli SHALL 提供以下命令，沿用全局 --core/--json 放在 work 前的约定：
- `work export <workId> [--output <file>] [--idempotency-key <key>]`
- `work snapshot download <snapshotId> --output <file>`
- `work package inspect <file>`
- `work import <file> [--name <name>] [--wait] [--idempotency-key <key>]`

--idempotency-key 缺省由 UUID 补齐；export SHALL 先按 ResourceId 规则验证 workId，缺省输出到当前目录的 `<workId>.work`，不得把未验证的输入拼成路径；import 缺省使用包内源名称并由 Core 原子处理冲突。`--output` 与 `--name` 可显式覆盖默认值，file/workId 仍必填；`--bindings` 不再接受。禁止空白值、NUL、重复选项、额外位置参数、未知 flag、stdout 目标 "-"、覆盖已有输出、过滤/排除/自动停止/自动启动选项。各级 -h/--help SHALL 在凭证或文件读取前成功返回。syntax 错误 exit 2；inspect 不需登录或 Core，其他命令沿用保存的用户 credential。CLI SHALL 完整校验本地输入包后再上传，服务器独立重验。

export SHALL 提交一次请求并等待最多 120 秒（含每次 poll），串行每 250ms 观察，完成后下载并验证到新文件；超时/观察失败返回 waiting 与 Work/snapshot/Operation ID、恢复命令，exit 5，不取消服务端任务或自动重提。download 对未就绪 snapshot 返回冲突，不隐式新建快照。import 默认上传并提交后输出 acceptance，--wait 使用同样观察期限，只观察导入而不启动 Work。

本地输出 SHALL 使用安全新建、同目录临时文件、0600 权限及校验后的无覆盖发布；已有目标、symlink 目标/父路径或读取错误 exit 2，不改原文件。失败只清理本次临时文件，不留名为最终目标的半包。transfer 超时按 WSNAP-005；包永不写 stdout。export/import 前 stderr SHALL 明确提示原样携带敏感内容和不自动执行包，非交互模式不额外要求输入确认。

#### Scenario: Export and share
- **WHEN** 所有者导出已停止 Work 到不存在的 demo.work
- **THEN** 命令返回完整校验后的 0600 文件和一条结果，不打印包内配置/历史，不自动启动或停止 Work

#### Scenario: Do not overwrite a destination
- **WHEN** output 已存在或在下载期间被其他进程创建
- **THEN** 原文件不变，命令失败并清理其临时文件

#### Scenario: Inspect without login
- **WHEN** 未登录用户检查一个合法包
- **THEN** 完整校验并显示安全摘要及平台依赖概况，exit 0，不发网络请求或执行包

#### Scenario: Import an ordinary Work with only its file
- **WHEN** 接收端已有匹配模型，用户运行 `work import ./first.work --wait`，不提供名称或 bindings
- **THEN** CLI 上传并提交导入，目标 Work 获得不冲突名称，Operation 成功且 Work 保持 stopped

#### Scenario: Export without an output option
- **WHEN** 用户运行 `work export work-abc` 且当前目录不存在 `work-abc.work`
- **THEN** 导出经完整校验后无覆盖地发布为当前目录的 `work-abc.work`

#### Scenario: Recover after wait timeout
- **WHEN** export 超过 CLI 观察期限但服务端仍在工作
- **THEN** CLI exit 5 保留 snapshotId，用户可以 operation show 后 snapshot download 而无需再 export

### Requirement: Keep snapshot output and existing commands compatible

**Identifier:** CLI-SNAPSHOT-002

JSON 模式 SHALL 对每个成功命令输出恰好一个对象：inspect 为 WSNAP-002 安全摘要；export/download 为 `{workId,snapshotId,operationId,path,digest,size}`；import 非 wait 为 `{workId,name,operationId,correlationId,reused}`；import wait 为既有终态 Operation envelope 加目标 name，export waiting 额外带 snapshotId。text 模式用可读摘要/缩进 JSON，进度与敏感内容警告只写 stderr。相对于旧“internal digest 不公开”的限制，新 digest 仅指用户包校验 hash，不暴露平台 context identity。

syntax/local file exit 2；缺登录/401/403 exit 3；404 exit 4；网络、503、transfer/观察超时 exit 5；409、已接受任务 failed/superseded exit 6；包校验400/413、不兼容、目标模型或自定义外部 MCP 凭证不可用与410 exit 1；成功 exit 0。接受前错误 stdout 为空，且 stderr SHALL 显示安全的错误 code 与可执行处理方向；不能仅输出 `Work snapshot request cannot be accepted`。接受后观察失败输出带 ID 的 waiting；校验过的包下载后本地发布失败也必须在安全错误中保留 snapshotId。旧 Work/service/chat、operator CLI 和通用 operation show 行为 SHALL 不变，不新增 service create/update。

#### Scenario: One JSON result
- **WHEN** --json work export 完成接受、观察、下载
- **THEN** stdout 只有最终文件结果，早期 acceptance/进度/警告不污染 JSON

#### Scenario: Preserve service boundary
- **WHEN** 用户运行 work service create 或 update
- **THEN** 仍是 usage error，本变更仅支持作为整个包恢复服务定义
