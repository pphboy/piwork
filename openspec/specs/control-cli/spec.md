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

`piwork-cli` SHALL 提供现有 Work 生命周期命令，并增加 `work config show`、`work config set` 和显式 `work config apply`。创建 Work 时复制当前全局默认配置为该 Work 的独立 desired 配置；用户可提供显式配置文件覆盖默认值。`piwork-serve` MUST NOT 创建或控制默认 Work。

#### Scenario: Create from the current default

- **WHEN** 用户运行 `piwork-cli work create --name <name> --wait`
- **THEN** Work 保存创建时的独立配置，即使之后全局默认发生变化也保持该配置

#### Scenario: Update one Work only

- **WHEN** 用户通过 `piwork-cli work config set` 修改 Work A
- **THEN** 只有 Work A 的 desired revision 变化，其他 Work 和全局默认保持不变

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

`piwork-cli` SHALL 独立提供登录、Session、Run 和 chat 命令；`piwork-serve` MUST NOT 提供用户对话命令。用户客户端的凭证文件和 operator credential 文件必须分离。

#### Scenario: Continue a Work conversation

- **WHEN** 用户使用 `piwork-cli chat <workId>` 发送消息
- **THEN** CLI 使用用户会话访问其拥有的 Work，并返回持久化 Run 结果

#### Scenario: Send one scripted message

- **WHEN** a user invokes `piwork chat <workId> --message <text>` for a ready Work
- **THEN** the CLI creates or selects a Session, submits exactly one Run, displays the assistant reply, and exits according to the Run terminal state

#### Scenario: Continue an existing Session

- **WHEN** a user invokes chat with a previously returned Session identifier after Core or agentd has restarted
- **THEN** the prompt is added to the same restored Pi SDK history and the reply is associated with that Session

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

两个 CLI SHALL 使用各自稳定的命令帮助和退出码。`piwork-serve` 的错误必须区分 Core 未运行、管理员未初始化、默认配置缺失和权限失败；`piwork-cli` 必须区分未登录、Core 不可用、Work 不可用和 Run 失败。任何输出不得包含密码、bearer token、operator credential、模型 API key 或 secret 路径。

#### Scenario: Reject a command on the wrong CLI

- **WHEN** 用户在 `piwork-cli` 执行 `admin users` 或在 `piwork-serve` 执行 `chat`
- **THEN** 命令立即以 usage 错误退出，不联系 Core 或执行状态变更

#### Scenario: Request JSON output

- **WHEN** a user adds `--json` to a successful status, identity, Work, Operation, Session, or Run command
- **THEN** the CLI writes exactly one valid JSON value to standard output

#### Scenario: Reject invalid command input

- **WHEN** required arguments are missing or an option is invalid
- **THEN** the CLI prints relevant usage to standard error, exits with the documented usage status, and does not contact Core
### Requirement: Retain CLI authentication and conversation access across Core restart
A saved CLI credential SHALL remain usable after Core restarts with the same data directory while the server session remains valid. The same CLI process contract SHALL let the user query the existing Work and continue an existing Session after Core re-adopts the Work generation.

#### Scenario: Continue after Core restart without logging in again
- **WHEN** a user logs in, creates a Work and Session, Core restarts with the same data directory, and the user sends another message before login expiration
- **THEN** the CLI reuses the saved Core URL and token, reaches the recovered Work, and receives a reply in the existing Session
