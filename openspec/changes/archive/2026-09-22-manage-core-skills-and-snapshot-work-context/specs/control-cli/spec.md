# Spec Delta

## ADDED Requirements

### Requirement: Discover Skills from the user client

**Identifier:** CLI-SKILL-001

`piwork-cli` SHALL provide `skills list` and `skills show <skill-name>` for authenticated users. These commands SHALL identify enabled Core-managed Skills only by the directory basename assigned by Core, SHALL order list output by Skill name, and MUST NOT expose metadata parsed from `SKILL.md`, the operator import path, Core storage path, internal content digest, or Skill file content.

#### Scenario: List Skills before Work creation
- **WHEN** a logged-in user runs `piwork-cli skills list`
- **THEN** the CLI returns the enabled directory-derived Skill names available for `work create` and configuration commands in deterministic name order without manifest metadata

#### Scenario: Reject Skill management on the user client
- **WHEN** a user attempts `piwork-cli skills add`, `update`, `enable`, `disable`, or `remove`
- **THEN** the CLI returns a usage error without contacting a Skill mutation endpoint

## MODIFIED Requirements

### Requirement: Create and control Works from the CLI

**Identifier:** CLI-WORK-001

`piwork-cli` SHALL provide Work lifecycle, `work config show`, `work config set`, field-specific configuration commands, and explicit `work config apply` without public revision arguments. `work create` SHALL accept `--base-image <image>`, repeatable `--skill <skill-name>`, `--no-skills`, `--agents-md-file <path>`, and `--config <file>`. If neither Skill option nor a `skills` field is supplied, Core SHALL copy the current default Work Skill selection; explicit Skill flags SHALL replace defaults and a configuration-file selection, while `--no-skills` SHALL select an empty set. The CLI SHALL reject duplicate names and mutually exclusive Skill options before contacting Core. Core SHALL copy selected managed Skill directories, AGENTS content, and the resolved configuration into Work-owned storage before reporting successful creation. `piwork-serve` MUST NOT create or control user Works.

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
- **WHEN** a create request repeats a Skill, combines `--skill` with `--no-skills`, names a missing, disabled, or unusable Skill, or supplies a missing, unreadable, or oversized AGENTS file
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
- **WHEN** context copying, Docker, the image, model configuration, or agent readiness causes the create Operation to fail
- **THEN** the CLI displays the stable Work and Operation identifiers plus a safe actionable failure and exits nonzero

#### Scenario: Stop and restart one Work
- **WHEN** an owner stops a ready Work and later starts it with `--wait`
- **THEN** the CLI observes both Operations and the Work becomes ready again with its retained Work-owned context and data

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
