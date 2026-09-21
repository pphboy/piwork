# Spec Delta

## MODIFIED Requirements

### Requirement: Create and control Works from the CLI

**Identifier:** CLI-WORK-001

`piwork-cli` SHALL provide existing Work lifecycle commands and SHALL add `work config show`, `work config set`, and explicit `work config apply`. Creating a Work SHALL copy the current global default configuration into an independent desired configuration. The create command SHALL accept `--base-image <image>`, repeatable `--skill <catalog-id>`, `--agents-md-file <path>`, and `--config <file>` overrides. The explicit flags and configuration file SHALL be normalized into one complete Work configuration; if the same field is supplied in both places, explicit flags SHALL take precedence. `--agents-md-file` SHALL be read at request time and its contents, rather than the host path, SHALL be persisted. Duplicate Skills SHALL be rejected with a usage error before a Work is created. An unknown, disabled, or unusable Skill catalog entry SHALL be rejected with a field-specific error. A missing, unreadable, or over-limit AGENTS file SHALL be rejected without creating a Work. `piwork-serve` MUST NOT create or control user Works.

#### Scenario: Create from the current default
- **WHEN** 用户运行 `piwork-cli work create --name <name> --wait`
- **THEN** Work 保存创建时的独立配置，即使之后全局默认发生变化也保持该配置

#### Scenario: Create with per-Work context overrides
- **WHEN** 用户使用 `--base-image`, one or more `--skill`, or `--agents-md-file` on Work creation
- **THEN** Core validates the complete resulting configuration, stores the AGENTS content and selected Skills in the Work desired revision, and does not retain the host file path

#### Scenario: Reject invalid create context
- **WHEN** a create request repeats a Skill, names a missing or disabled catalog entry, or supplies a missing, unreadable, or oversized AGENTS file
- **THEN** the CLI exits with a usage or validation error, does not create a Work, and does not disclose secrets

#### Scenario: Update one Work only
- **WHEN** 用户通过 `piwork-cli work config set` 修改 Work A
- **THEN** 只有 Work A 的 desired revision 变化，其他 Work 和全局默认保持不变

#### Scenario: Set Skills and AGENTS independently
- **WHEN** an owner invokes `work config skills set <workId> --skill <catalog-id>...` or `work config agents set <workId> --file <path>` with the current expected revision
- **THEN** the selected Work receives a new desired revision containing the requested complete field value, while other configuration fields remain unchanged and the file contents are persisted instead of its host path

#### Scenario: Apply a pending Work configuration explicitly
- **WHEN** an owner invokes `piwork-cli work config apply <workId> --expected-revision <n>`
- **THEN** the CLI submits one explicit apply operation, reports its stable Operation identifier, and does not silently restart or cancel an active Run before the operation is accepted

#### Scenario: Create and wait for a ready Work
- **WHEN** a logged-in user invokes `piwork work create --name <name> --wait` against a configured installation
- **THEN** the CLI returns the stable Work identifier, follows its Operation, and exits successfully only after the Work is ready

#### Scenario: Show a Work preparation failure
- **WHEN** Docker, the image, model configuration, or agent readiness causes the create Operation to fail
- **THEN** the CLI displays the stable Work and Operation identifiers plus a safe actionable failure and exits nonzero

#### Scenario: Stop and restart one Work
- **WHEN** an owner stops a ready Work and later starts it with `--wait`
- **THEN** the CLI observes both Operations and the Work becomes ready again with its retained data

### Requirement: Create and continue persistent conversations

**Identifier:** CLI-CHAT-001

`piwork-cli` SHALL independently provide login, Session, Run, Work configuration, and chat commands; `piwork-serve` MUST NOT provide user conversation commands. The user client's credential file and the operator credential file MUST remain separate. A chat request SHALL use the Work's active configuration, including active Skills, AGENTS content, base image, model, and tool policy, and SHALL report a pending-configuration state rather than applying desired changes implicitly.

#### Scenario: Continue a Work conversation
- **WHEN** 用户使用 `piwork-cli chat <workId>` 发送消息
- **THEN** CLI 使用用户会话访问其拥有的 Work，并返回持久化 Run 结果

#### Scenario: Send one scripted message
- **WHEN** a user invokes `piwork chat <workId> --message <text>` for a ready Work
- **THEN** the CLI creates or selects a Session, submits exactly one Run, displays the assistant reply, and exits according to the Run terminal state

#### Scenario: Continue an existing Session
- **WHEN** a user invokes chat with a previously returned Session identifier after Core or agentd has restarted
- **THEN** the prompt is added to the same restored Pi SDK history and the reply is associated with that Session

#### Scenario: Chat while configuration is pending
- **WHEN** a Work has desired and active revisions that differ and a user sends a prompt
- **THEN** the CLI uses the active revision, reports that a configuration apply is pending, and does not change the running context as a side effect of chat

#### Scenario: Interrupt an active chat explicitly
- **WHEN** the user presses the documented cancellation key while observing an active Run
- **THEN** the CLI requests Run cancellation, waits for or reports its durable state, and does not treat a mere transport disconnect as cancellation

### Requirement: Provide stable output and failure behavior

**Identifier:** CLI-OUTPUT-001

两个 CLI SHALL 使用各自稳定的命令帮助和退出码。`piwork-serve` 的错误必须区分 Core 未运行、管理员未初始化、默认配置缺失和权限失败；`piwork-cli` 必须区分未登录、Core 不可用、Work 不可用和 Run 失败。任何输出不得包含密码、bearer token、operator credential、模型 API key 或 secret 路径。Work configuration commands SHALL return stable Work and revision identifiers, and validation failures SHALL identify the public field and remediation without echoing AGENTS content when it could contain a secret.

#### Scenario: Reject a command on the wrong CLI
- **WHEN** 用户在 `piwork-cli` 执行 `admin users` 或在 `piwork-serve` 执行 `chat`
- **THEN** 命令立即以 usage 错误退出，不联系 Core 或执行状态变更

#### Scenario: Request JSON output
- **WHEN** a user adds `--json` to a successful status, identity, Work, Operation, Session, or Run command
- **THEN** the CLI writes exactly one valid JSON value to standard output

#### Scenario: Return revision conflict safely
- **WHEN** a Work configuration update uses a stale expected revision
- **THEN** the CLI exits nonzero, identifies the current public revision, and does not overwrite the desired configuration

#### Scenario: Reject invalid command input
- **WHEN** required arguments are missing or an option is invalid
- **THEN** the CLI prints relevant usage to standard error, exits with the documented usage status, and does not contact Core
