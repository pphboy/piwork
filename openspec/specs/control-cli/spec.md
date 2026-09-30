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

work create SHALL 额外支持重复 --package <name> 或互斥 --no-packages，优先于配置文件 packages 与默认集合；重复/空 name 或矛盾选项在 auth/file/network 前拒绝。work config set 同样支持该选择，对已存在 Work 只引用自身 desired 已安装包；flags 选中项 enabled=true，其他字段省略保留，disabled 可用专用命令或完整配置表示。包安装与 apply 分离，create --wait 的成功仍要求最终完整 context ready。

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

#### Scenario: Create from package defaults
- **WHEN** 用户不提供 package flags 或配置字段创建 Work
- **THEN** 继承当时默认包的独立副本，不持续跟随 Core

#### Scenario: Override package selection
- **WHEN** 用户提供 --package tools 或 --no-packages
- **THEN** 分别替换为 tools 或 []，不与文件/defaults 合并

#### Scenario: Reject duplicate package flags before I/O
- **WHEN** 用户重复同名 --package 或与 --no-packages 同用
- **THEN** exit 2 且不读取凭证、本地文件或发起网络请求

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

两个CLI SHALL 使用各自稳定的命令帮助和退出码。`piwork-serve`的错误必须区分Core未运行、管理员未初始化、默认配置缺失、Skill导入失败和权限失败；`piwork-cli`必须区分未登录、Core不可用、Skill不可用、Work不可用和Run失败。任何输出不得包含用户登录密码、平台bearer token、operator credential、模型API key、secret path、Skill import path或internal digest。唯一的密码展示例外是统一proxy成功启动时向启动者一次显示本进程随机生成的WebDAV本地临时密码；该值不得进入URL、PAC、普通日志、错误或后续请求输出，不得持久写入平台登录文件或Work。Work配置命令 SHALL 返回稳定Work/Operation身份及active/desired/pending状态，不返回公开revision。

#### Scenario: Reject a command on the wrong CLI
- **WHEN** 用户在`piwork-cli`执行operator Skill mutation或admin users，或用`piwork-serve`进行chat
- **THEN** 命令立即以usage错误退出，不联系Core或执行状态变更

#### Scenario: Request JSON output
- **WHEN** 用户对支持JSON的status、Skill、identity、Work、Operation、Session或Run命令添加`--json`
- **THEN** stdout恰输出一个合法JSON值

#### Scenario: Order concurrent configuration writes
- **WHEN** 两个已授权配置更新按顺序提交且没有公开revision条件
- **THEN** 后提交配置成为desired，两次响应均不包含内部revision

#### Scenario: Return revision conflict safely
- **WHEN** 旧客户端提供expectedRevision或带revision的配置请求
- **THEN** CLI/API拒绝已废弃输入，不改变desired context，也不返回当前revision

#### Scenario: Reject obsolete revision options
- **WHEN** 用户向默认Work或单Work配置命令传入`--expected-revision`
- **THEN** CLI返回说明无revision命令格式的usage错误，不联系Core

#### Scenario: Reject invalid command input
- **WHEN** 缺少必需参数或选项不合法
- **THEN** CLI向stderr打印相关usage并按规定退出，不联系Core

#### Scenario: 只展示本地临时密码
- **WHEN** proxy成功启动并显示WebDAV连接信息
- **THEN** 仅启动输出含本次本地密码，Core登录token和其他平台秘密始终不出现，后续日志不重复记录密码

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

`list` SHALL 返回未删除服务，按 name、serviceId 排序；`show` SHALL 返回指定服务元数据。每条 CLI 服务投影 SHALL 恰含 `workId`、`serviceId`、`name`、`enabled`、`observedState`、`desiredRevision`、`appliedRevision`、`lastError`、`endpoints`、`access`、`createdAt`。缺少时 `appliedRevision` 和 `lastError` SHALL 保持 null。`lastError` 非空时仅含现有公开的 `code`、`message`、`retryable`，诊断字符串通过现有安全脱敏规则处理。`endpoints` 每项仅含 Core 返回的 `name`、`protocol`、`host`、`port` 与可选 `url`。`access` 仅含 `hostname`、`defaultUrl`、`defaultPortName`、`status`、`ports`；每个 port 仅含 `name`、`port`、`url`。完整服务定义、environment、command、args、mount、镜像身份、容器 IP、平台 token 及其他字段 MUST NOT 输出。

JSON list 输出 SHALL 是单个 `{services: [...]}` 值，JSON show 输出 SHALL 是单条服务投影；文本模式沿用现有缩进 JSON 惯例。空列表 SHALL 输出 `{services: []}` 且 exit 0。即使服务 failed、disabled 或 stopped，成功读取仍 SHALL exit 0，查询成功 MUST NOT 暗示 ready。`endpoints` SHALL 保持 Work 私网端点，MUST NOT 被描述为宿主公开端点；`access` URL SHALL 标明需运行 CLI 代理。

#### Scenario: Inspect an agent-created service
- **WHEN** 已认证所有者先列出服务，再按已有 serviceId 查询详情
- **THEN** 输出该服务身份、开关与观测状态、期望/应用版本、公开错误、私网端点和代理访问信息，不改变服务状态

#### Scenario: Return an empty collection
- **WHEN** Work 没有未删除的服务
- **THEN** JSON list 恰输出 `{"services":[]}` 和换行，exit 0

#### Scenario: Protect service definition content
- **WHEN** Core 返回的完整服务定义包含环境凭证和任意额外字段
- **THEN** 文本与 JSON list/show 均不包含该定义、凭证或额外字段

#### Scenario: Inspect a failed service
- **WHEN** show 返回 `observedState: failed`、最近错误和稳定 hostname
- **THEN** CLI 显示公开错误和 `access.status=unavailable`，因查询成功而 exit 0，不声称 URL 当前可访问

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

work export/import SHALL 无条件携带完整 Pi package 闭包；不新增 skip-packages 或“导入时重新安装”模式。既有单数 work package inspect SHALL 报 WSNAP-002 的安全包摘要，与复数 work packages 管理命令区分。导入成功保持 stopped，不暗中 apply pending desired 或加载 extension。

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

#### Scenario: Inspect packages without executing them
- **WHEN** 用户执行 work package inspect demo.work，文件包含 Pi extension/lifecycle scripts
- **THEN** 本地完整验证后显示包数量/安全名称版本，不执行内容、不连接 Core，标明尚未运行验证

#### Scenario: Keep packages in the standard export command
- **WHEN** 用户运行原有 work export/import 命令而没有新增 package 选项
- **THEN** 所有 retained context 的包与依赖自动完整搬迁

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

### Requirement: Manage Core packages from the operator CLI

**Identifier:** CLI-PKG-001

`piwork-serve` SHALL 提供以下命令，使用 operator 身份；全局 --core/--json 沿用现有解析：

```text
packages list
packages show <name>
packages install <source> [--default] [--wait] [--verbose]
packages update <name> --source <source> [--wait] [--verbose]
packages enable|disable|remove <name>
config default-work show
config default-work set [--package <name>]... [--no-packages]
operation show <operation-id>
```

source SHALL 支持 PKG-001 四种形式，本地目录/ZIP 先按 PKG-003 上传。install --default SHALL 原子追加；default-work set --package SHALL 替换全部默认包，--no-packages 显式清空，两者互斥，均省略则保留原 packages。其他默认字段省略 SHALL 保留。operation show SHALL 只查询 Core package Operation，不提供 Work 内容读取。enable/disable/remove SHALL 同步返回结果，不接受 --wait。

#### Scenario: Install each operator source
- **WHEN** operator 分别使用 npm:spec、git:spec、本地目录或 .zip 执行 packages install --wait
- **THEN** CLI 提交对应来源并等待原 Operation，成功时显示实际 name/version 和 enabled/default 状态

#### Scenario: Update does not guess a source
- **WHEN** operator 执行 packages update tools 却缺少 --source
- **THEN** exit 2 且未发请求，不尝试重新读取历史本机目录

#### Scenario: Observe a Core preparation failure
- **WHEN** Core 包安装脚本失败，operator 使用 operation show 查询返回的 ID
- **THEN** 显示持久 failed/stage/code，查询成功 exit 0，不泄露未经处理的脚本日志

### Requirement: Manage independent Work packages from the user CLI

**Identifier:** CLI-PKG-002

`piwork-cli` SHALL 提供 enabled Core catalog 的 `packages list` 和 `packages show <name>`，以及下列 Work 命令，采用现有用户/Work 授权：

```text
work packages list <work-id>
work packages show <work-id> <name>
work packages install <work-id> <source> [--wait] [--verbose]
work packages install <work-id> --from-core <name> [--wait] [--verbose]
work packages update <work-id> <name> --source <source> [--wait] [--verbose]
work packages update <work-id> <name> --from-core [--wait] [--verbose]
work packages enable|disable|remove <work-id> <name>
```

install 的位置 source 与 --from-core <name> SHALL 恰选其一；update 的 --source 与 boolean --from-core SHALL 恰选其一。四类直接来源 SHALL 与 Core 语义一致；from-core 只复制当前 enabled Core 制品。所有修改 SHALL 仅作用 desired，命令不得隐式 apply。list/show SHALL 显示 PKG-008 的 desired/active/runtime 状态，指明需显式 work config apply；操作成功不能用 installed 代替 loaded。

#### Scenario: Install locally and activate explicitly
- **WHEN** 用户 work packages install W ./tools.zip --wait 后查询配置，再 work config apply W --wait
- **THEN** 第一步只等待 desired 提交；第二步才验证和激活，list/show 能分别观察两个时点

#### Scenario: Copy from Core after import
- **WHEN** 用户对已导入 Work 执行 work packages update W tools --from-core
- **THEN** 选择当前连接 Core 的 tools，不联系最初导出 Core；同名不存在/disabled 时明确失败

#### Scenario: Reject source ambiguity
- **WHEN** install 同时给位置 source 和 --from-core，或 update 两者都缺失/都存在
- **THEN** CLI exit 2，在 credential、文件和网络 I/O 前拒绝

### Requirement: Preserve package acceptance waiting and output semantics

**Identifier:** CLI-PKG-003

两个 CLI 的 package install/update SHALL 在未 --wait 时输出一次 acceptance 并 exit 0；CLI 每次提交 SHALL 自动生成 UUID 幂等键，不提供用户传入幂等键的 package 命令参数。--wait SHALL 对同一 Operation 串行观察直至 succeeded、failed 或 superseded，不设置本地总等待时限；正常观察每 250 ms 一次，单次观察请求有界。单次请求超时、暂时网络中断或服务暂不可用 SHALL 以 250 ms 起、最多 5 秒的退避间隔重试读取原 Operation，成功观察后恢复 250 ms 间隔，不重提安装或取消后台任务；鉴权被拒、Operation 不存在等无法继续观察的确定性错误 SHALL exit 5 并保留 ID 与恢复查询命令。用户以 Ctrl+C 主动中断等待 SHALL exit 130，保留 ID 与恢复查询命令，不取消已接受的 Operation。succeeded exit 0、failed/superseded exit 6，服务端真实失败不得被无限等待掩盖。operation show 查询成功 SHALL exit 0，包括任务失败。--json 的 stdout SHALL 恰有一条 acceptance、最终 observation，或在不可恢复观察错误/主动中断时带原 Operation ID 的 waiting 结果；进度和恢复命令输出 stderr。

两个 CLI 的 package install/update SHALL 仅在与 --wait 同用时接受 --verbose；单独 --verbose SHALL 在鉴权、文件及网络 I/O 前以 usage exit 2 拒绝。--verbose SHALL 在 stderr 显示原 Operation ID、安全的 packagePhase 变化、已等待时间、每 30 秒仍处于同一阶段的心跳、暂时观察故障的重试/恢复，以及终态安全 stage/code；同一阶段的普通 250 ms 轮询不得逐次打印。--verbose 不改变 Operation、轮询语义、退出码或 --json 的单值 stdout。任何模式 SHALL NOT 输出 npm/Git 原始 stdout/stderr、命令参数、来源绝对路径、凭据、helper ID 或内部 digest。

接受前 syntax=2、auth=3、missing=4、network=5、conflict=6、其他=1。未知 flag、额外位置参数、空值和组合矛盾 SHALL 在 auth/file/network 前拒绝；各级 help SHALL 不读取凭证或文件。公共输出 SHALL 不含 source 绝对路径、secret、内部 digest/revision。文档 SHALL 包含四来源测试示例和 install→desired→apply→loaded→stop/export/import/start 的完整示例。

#### Scenario: Preparation exceeds two minutes
- **WHEN** --wait 在 120 秒内未观察到终态，而后原 Operation 完成
- **THEN** CLI 继续观察原 Operation 并显示最终结果，不重新发起 install

#### Scenario: Observation becomes unavailable
- **WHEN** --wait 的单次观察请求超时或连接中断
- **THEN** CLI 保留原 Operation ID、限频重试读取，连接恢复后显示该 Operation 的最终结果；不重新发起 install，暂时故障不产生终态 stdout

#### Scenario: User interrupts package waiting
- **WHEN** 用户在 install/update --wait 期间按 Ctrl+C
- **THEN** CLI exit 130；stdout 仅输出一条带原 Operation ID 的 waiting 结果，stderr 给出 operation show 恢复命令；后台 Operation 不被取消

#### Scenario: Observation cannot be authorized
- **WHEN** 已接受包 Operation 后，观察请求被确定性拒绝鉴权或报告该 Operation 不存在
- **THEN** CLI exit 5；stdout 仅输出一条带原 Operation ID 的 waiting 结果，stderr 给出恢复查询命令；不重新发起 install

#### Scenario: Wait for failure in JSON mode
- **WHEN** 已接受 Operation 随后 failed 且启用 --json --wait
- **THEN** stdout 恰好一条最终 failed observation，包含安全 stage/code 与 ID，exit 6

#### Scenario: Verbose package wait without leaking output
- **WHEN** operator 或 Work 用户运行 package install/update --wait --verbose，Operation 经过 queued、prepare 并完成，期间某次观察暂时断线
- **THEN** stderr 显示该 Operation 的阶段变化、已等待时间、重试及恢复，超过 30 秒的未变阶段有心跳；--json stdout 仍只有一条最终结果，不打印第三方进程输出或敏感字段，也不重复提交安装

#### Scenario: Reject verbose without waiting
- **WHEN** package install/update 指定 --verbose 而未指定 --wait
- **THEN** CLI exit 2，且不读取凭证、来源文件或联系 Core

#### Scenario: Reject a caller-supplied package idempotency key
- **WHEN** Core 或 Work 的 package install/update 命令带有 --idempotency-key
- **THEN** CLI exit 2，且不读取凭证、来源文件或联系 Core；不带该参数的有效请求仍由 CLI 自动生成请求幂等键

#### Scenario: Help with unavailable authentication
- **WHEN** 用户执行任一 package 命令 --help 且凭证文件不可读
- **THEN** help 成功，不读凭证、不读本地来源或发送请求

### Requirement: 启动有界的 CLI 本地服务代理

**Identifier:** CLI-SERVICE-PROXY-001

`piwork-cli [--core <url>] proxy [--port <1..65535>]` SHALL 在前台监听`127.0.0.1`，默认17890；启动前核验语法、当前用户凭证和Core service网关能力，并探测独立文件能力。远程Core URL SHALL 使用HTTPS，loopback Core可以使用HTTP。启动成功 SHALL 输出代理地址、`/proxy.pac` URL及CLI-FILES-001规定的WebDAV信息；PAC SHALL 仅让符合默认Work域名形状的http/ws目标使用代理，其他目标DIRECT。

service分支 SHALL 拒绝其他域名、HTTPS/wss、未登记域名和未声明端口，不修改系统代理、hosts或公网DNS。WebDAV SHALL 仅通过CLI-FILES-001定义的本地origin-form路径进入独立分支，不扩大service网关可转发目标。帮助无需凭证和网络；`--json`、非法或重复端口为usage错误exit 2，缺登录/确认的Core会话失效exit 3，必需Core service网关不可用exit 5，端口占用exit 6；启动失败不留监听进程。文件能力缺失按CLI-FILES-002降级。Ctrl+C SHALL 关闭两类连接并退出130，不停止Work。应用4xx/5xx及非会话文件错误不结束proxy。

#### Scenario: curl 使用默认域名
- **WHEN** 所有者已登录，启动`piwork-cli proxy`并执行`curl --proxy http://127.0.0.1:17890 http://notes.w-a1b2c3d4.work/`
- **THEN** 返回目标应用HTTP响应，CLI无需本机Docker权限

#### Scenario: 浏览器使用 PAC 和 WebSocket
- **WHEN** 浏览器配置CLI输出的PAC URL，打开服务网页并建立ws连接
- **THEN** HTTP与WebSocket均经过代理和Core，其他网站按PAC返回DIRECT

#### Scenario: 无法启动代理
- **WHEN** 用户未登录、端口已占用或传入非数字端口
- **THEN** CLI返回对应退出码和安全错误，不打印平台token，不改听其他地址或端口

#### Scenario: 拒绝开放 CONNECT
- **WHEN** 浏览器为WebSocket发送CONNECT后传入非HTTP Upgrade字节或不匹配Host
- **THEN** 代理关闭连接，不建立任意TCP通道；合法WebSocket升级仍可完成

#### Scenario: 同一监听器服务两种访问
- **WHEN** service客户端使用HTTP代理，文件客户端直连本地Work文件URL
- **THEN** 两者共享一个proxy进程和端口，分别进入Core service网关和文件入口

### Requirement: 在统一 proxy 上提供多个 Work 的本地 WebDAV

**Identifier:** CLI-FILES-001

proxy SHALL 在同一端口提供`http://127.0.0.1:<port>/works/<workId>/files/`；客户端把该地址作为WebDAV服务器，无需为文件访问额外配置HTTP代理/PAC。一个进程支持多个自有Work，不新增`work files serve`命令或独立17891监听器。CLI SHALL 输出URL模板、文件能力状态、用户名piwork及32随机字节base64url临时密码；密码仅当前进程有效。Work ID通过现有work list/show获取，本地`/`和`/works/`不提供跨Work聚合列表。

本地文件路由 SHALL 只接受origin-form、准确本地Host（127.0.0.1或localhost和实际端口）及WACC-FILES-002认证。service absolute-form请求即使带`/works/.../files/`路径也 SHALL 保持service分支；文件路由不接受CONNECT/Upgrade，也不将任意绝对URL改成文件请求。CLI SHALL 替换请求前缀为Core文件入口，对Destination、返回Location及全部DAV:href做同Work映射；非法/越界目标拒绝。普通文件体流式转发，XML元数据最多有界缓冲16 MiB，禁止向客户端泄漏Core内部前缀或生成无法重新访问的href。

#### Scenario: 两个自有Work与路径映射
- **WHEN** 同一proxy分别访问两个自有Work的文件根
- **THEN** 路径中的workId选择正确workspace，列表href可以直接再次访问，不能串到另一Work

#### Scenario: service恰有同名路径
- **WHEN** service请求URL为`http://notes.w-a1b2c3d4.work/works/example/files/a`
- **THEN** 请求原样进入notes应用，不被本地文件分支拦截

#### Scenario: 移动和复制的Destination
- **WHEN** 客户端向本地文件入口发送同Work绝对或origin-form Destination
- **THEN** CLI转换为Core同Work目的路径，响应href/Location转换回来，跨Work或外部目的地在转发前被拒绝

#### Scenario: 本地认证与进程重启
- **WHEN** proxy退出后重新启动，客户端继续使用旧临时密码
- **THEN** 返回本地401，新进程使用新密码，Core登录凭据无需因proxy重启而改变

#### Scenario: 无须Docker和第二个代理
- **WHEN** 仅安装CLI和通用WebDAV客户端的用户启动proxy
- **THEN** 能通过Core访问文件，无需在客户端运行Docker、额外serve命令或本地service容器

### Requirement: 文件能力失败不得破坏既有 service 访问

**Identifier:** CLI-FILES-002

新CLI连接旧Core、文件能力版本不兼容、文件helper未配置或文件能力探测暂时失败时 SHALL 显示明确状态并继续已有service代理；后续文件请求可重查能力，未支持返回501 FILE_ACCESS_UNSUPPORTED、配置/版本/暂时不可用返回503 FILE_HELPER_UNAVAILABLE或CORE_UNAVAILABLE。能力缓存不能代替Core逐请求授权。普通WebDAV方法未实现仍为405，不能与整项功能未支持混淆。

本地401、文件403/404/409/5xx、207部分失败及service应用401 SHALL 保留proxy进程。只有确认的Core会话401 SHALL 关闭两类流量并exit 3，提示重新登录后重启proxy。CLI SHALL 不自动重放失败PUT/COPY/MOVE/DELETE，不把收到错误解释为服务端必然回滚。帮助与文档 SHALL 给出单proxy、多Work URL、rclone通用模式、本地密码有效期、运行状态限制、文件方法/限额及export/import验证步骤。

#### Scenario: 新CLI连接旧Core
- **WHEN** service capability可用但file-access返回404
- **THEN** proxy仍启动并显示文件不支持，service网页可访问，文件入口返回501而不尝试把它转成用户service

#### Scenario: 缺少helper
- **WHEN** file-access报告后端不可用
- **THEN** service继续可用，文件请求明确返回503；后端恢复后新文件请求可以重新发现能力

#### Scenario: 文件错误和会话错误分别处理
- **WHEN** 文件缺失、本地密码错误、应用返回401，随后Core真正撤销登录会话
- **THEN** 前三种错误不退出proxy；最后一种关闭两类连接并提示重新登录

#### Scenario: 写入响应断开
- **WHEN** PUT已转发但响应途中断开
- **THEN** CLI报告连接失败而不自动再发PUT，文档指引重新查询实际目标

### Requirement: 启动本地 Desktop WebUI

**Identifier:** CLI-DESKTOP-001

`piwork-cli [--core <url>] desktop [--port <1..65535>] [--no-open]` SHALL 在前台启动仅监听 `127.0.0.1` 的本地 WebUI，默认端口 17891；默认打开系统浏览器，`--no-open` 仅输出本地打开地址。地址 SHALL 使用受验证的 localhost 主机名；本机无需 Docker、代理/PAC、hosts 编辑或安装证书。Core 地址优先级沿用显式参数、环境、已存配置和默认值；远程 Core 要求 HTTPS，loopback Core 可用 HTTP。无登录或 Core 暂不可达 SHALL 仍可打开登录/连接页面和本地包 Inspect，不能借用其他 Core 的 token。

启动前 SHALL 校验参数；未知参数、重复或非法端口、`--json` 返回 exit 2；端口占用返回 exit 6，资源缺失或监听失败返回 exit 5，不自动换端口或遗留半启动监听器。浏览器打开失败 SHALL 保持服务并打印手动打开地址；`--help` 不读取凭证、不启动监听、不访问网络。Ctrl+C SHALL 关闭本地连接、清理本次临时资源并退出 130，不停止 Work、不取消已经接受的 Core Operation/Run。平台会话失效 SHALL 回到登录状态而不退出 WebUI。既有 `proxy` 默认 17890、PAC、临时 WebDAV 密码及退出语义 SHALL 不变；desktop 不要求先启动 proxy。

#### Scenario: 无登录的一键启动
- **WHEN** 用户首次运行 desktop 且没有保存凭证
- **THEN** 浏览器打开登录/连接页面，可以本地 Inspect；输入有效用户凭据后进入自己的 Work List

#### Scenario: 打开浏览器失败
- **WHEN** 本地监听已成功但系统没有可用的打开浏览器命令
- **THEN** 命令持续运行并显示手动地址，不谎报启动失败或自动关闭

#### Scenario: 非法端口与端口占用
- **WHEN** 用户指定非法端口或已被占用的合法端口
- **THEN** 分别返回 exit 2 或 6，不自动监听其他端口，不启动后台副本

#### Scenario: 关闭窗口和退出 CLI
- **WHEN** 用户关闭浏览器窗口，随后终止 desktop 进程
- **THEN** 关闭窗口不停止监听；进程退出只终止本地入口，Core 上已接受的工作继续，可在下次登录后查询

#### Scenario: 两种访问命令并存
- **WHEN** 用户同时运行默认 desktop 与 proxy
- **THEN** 二者使用独立端口与本地凭据，WebUI 的启动和浏览器 Files 不依赖 proxy
