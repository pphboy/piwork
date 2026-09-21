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
