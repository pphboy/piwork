# Control CLI Specification

## Purpose

Defines an executable local `piwork` command-line client that connects to Core, manages a durable login credential safely, controls Docker-backed Works, and conducts persistent agent conversations.

## Requirements

### Requirement: Resolve one Core endpoint consistently

系统 SHALL 提供独立的 operator 控制面和登录用户客户端命令；既有规范中的 `piwork-serve` operator 职责及配置保持，`piwork-cli` 用于用户客户端。业务 CLI SHALL 按显式 `--core`、`PIWORK_CORE_URL`、保存凭证中的 Core、默认 `http://127.0.0.1:17871` 的顺序解析。operator SHALL 按显式 `--core`、`--env-file` 中的控制面地址和文档化默认值解析，并使用 operator credential。

默认或显式 Desktop 启动 SHALL 按显式 `--core`、`PIWORK_CORE_URL`、Desktop 默认 Core 配置、保存凭证中的 Core、相同 loopback 默认值的顺序解析。参数和环境变量 SHALL 仅影响本次启动，不自动保存。业务 CLI SHALL 不读取 Desktop 偏好；`desktop open/logout` SHALL 继续只选择既有本机实例，不重新解析 Core。

Desktop 默认配置不存在 SHALL 回退到原凭证/默认值，不要求迁移旧凭证。需要读取的配置损坏、版本不支持、地址字段非法、超过大小限制或无法安全访问 SHALL 返回 exit 1 和安全恢复方向，保留原文件，不静默改连其他 Core；已由参数或环境选定地址时 SHALL 不读取无须使用的 Desktop 偏好。通过参数、环境或旧凭证选定的地址无效 SHALL 返回 exit 2，不继续尝试低优先级地址。凭证仅 SHALL 用于与其 Core origin 相同的请求。

用户 CLI、operator 和独立 Desktop 后端 SHALL 直接访问 Core HTTP 服务，不能要求先启动或经由 ControlPlane 17891。默认端口变化不得迁移已有凭据 origin、改写显式地址、试探旧端口或把连接失败转成浏览器登录；选定旧地址不可达时提供显式配置当前 Core 后重新登录的方向。远程 Core 的可达性由部署监听决定，不由客户端自动修改服务器。

#### Scenario: Use the user client endpoint
- **WHEN** 用户运行业务 CLI 且未提供显式地址
- **THEN** 使用 `PIWORK_CORE_URL`、保存凭证中的地址或 loopback 默认值；Desktop 默认配置不影响该选择

#### Scenario: Override the Core URL explicitly
- **WHEN** 用户提供 `--core <url>`，另有环境、Desktop 配置或保存凭证地址
- **THEN** 业务 CLI 或 Desktop 使用显式地址；Desktop 启动不覆盖持久配置，不把另一 Core 的 token 发给该地址

#### Scenario: Reuse the saved endpoint
- **WHEN** 没有显式或环境地址，业务 CLI 有保存凭证，或 Desktop 没有默认配置但有保存凭证
- **THEN** 使用该凭证的 Core 地址，不重写或迁移凭证

#### Scenario: Use the operator endpoint
- **WHEN** 操作者运行既有 operator 管理或配置入口
- **THEN** 使用 operator 配置和凭证，不读取 `piwork-cli` 用户 token 或 Desktop 偏好

#### Scenario: Desktop 默认地址和旧凭证并存
- **WHEN** Desktop 配置 Core B，凭证属于 Core A，且没有参数或环境覆盖
- **THEN** Desktop 连接 B 并呈现未登录状态，不发送 A 的 token；业务 CLI 仍解析为 A

#### Scenario: 退出登录后保留 Desktop 默认配置
- **WHEN** 用户保存 Desktop 默认 Core 后清理当前登录，随后重新启动
- **THEN** 仍选择保存的 Core，不因凭证删除回到 loopback，不恢复已清理的 token

#### Scenario: 缺失、损坏和被覆盖的配置
- **WHEN** 默认配置不存在、需要读取的配置损坏，或参数/环境已经覆盖损坏配置
- **THEN** 分别使用原有回退、返回 exit 1 且不监听、或按覆盖地址正常启动；损坏文件均不被自动删除

#### Scenario: 无效高优先级地址
- **WHEN** 参数、环境或保存配置给出不合法 Core origin
- **THEN** 拒绝选定地址，不悄悄使用凭证或 loopback，不泄漏 token

#### Scenario: 无历史配置直接使用新 Core
- **WHEN** 同机客户端没有显式地址、环境覆盖、相关偏好或保存凭据
- **THEN** 连接 127.0.0.1:17871，使用原用户或 operator 身份，不访问 17891

#### Scenario: 已保存旧端口
- **WHEN** 保存凭据或 Desktop 偏好仍指向已停止的 7171
- **THEN** 报告所选地址不可达，不把旧 token 转发到 17871 或其他发现的服务；用户可显式选择新 Core 并正常登录

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

`piwork-cli login` SHALL 接受账号，通过隐藏输入或标准输入获取密码；成功后持久保存包含 Core URL、token、到期时间与公开身份的版本化记录。POSIX 凭证父目录 SHALL 仅允许当前用户访问，凭证文件 SHALL 为 `0600`，符号链接等不安全目标 MUST 拒绝。`piwork-serve` 和它的 `piwork` 别名不提供用户 login，不读取该用户凭证文件。

凭证读取、保存与删除 SHALL 使用同一安全存储边界。读取现有凭证前 SHALL 核验父目录属于当前有效用户且没有 group/other 访问权限，并核验凭证为当前用户所有的普通 `0600` 文件；路径中的符号链接目录及符号链接文件 MUST 拒绝。新建凭证目录 SHALL 使用当前用户专属权限；已有目录权限或归属不满足要求时 SHALL 明确拒绝，不通过修改不安全目录的权限来继续访问。失败 SHALL 保留原凭证及外部目标，不发送从不安全路径取得的凭证，不输出凭证内容。

上述核验及实际读写删除 SHALL 基于已核验目录身份执行，使用目录句柄与相对路径、不跟随链接的操作，防止检查后替换路径将访问重定向到其他目录或文件。此边界 SHALL 同时用于用户 CLI 和 Desktop 共用的凭证存储，不要求用户配置额外代理或改动 Work。

凭证保存与删除 SHALL 使用同一跨进程互斥边界；按会话清理时，当前凭证身份核验及实际删除 SHALL 在一次持锁操作内完成，不得先比较再无条件删除。锁获取 SHALL 非阻塞，锁忙或获取失败 SHALL 返回安全错误，不降级为无锁操作。远端认证及撤销请求 SHALL 在该锁之外执行。

#### Scenario: Scripted login through standard input
- **WHEN** 用户运行 `piwork-cli login --account <account> --password-stdin`
- **THEN** CLI 完成认证并保存凭据，不打印密码或 bearer token

#### Scenario: Failed login preserves an existing credential
- **WHEN** Core 拒绝后续登录尝试
- **THEN** CLI 报告公开认证错误，先前保存的有效凭证保持不变

#### Scenario: Wrong command surface
- **WHEN** 用户执行 `piwork login` 或 `piwork-serve login`
- **THEN** 命令以 usage 错误退出，不读取用户凭据或联系用户登录端点

### Requirement: Show identity and perform server-side logout

`piwork-cli whoami` SHALL 显示保存凭据对应的公开身份。`piwork-cli logout` SHALL 撤销服务端会话，在确认撤销成功或会话已经无效后按该会话身份清理本地凭据；Core 不可达时 MUST 保留凭据以便后续重试。这些命令归属用户 CLI，不使用 operator 凭据。

logout 的成功撤销响应，或所选且与凭证归属匹配的 Core 返回可识别的 `401 AUTHENTICATION_FAILED` 公共错误，SHALL 视为无需继续保留该本地会话凭证。清理 SHALL 绑定请求开始时使用的规范化 Core URL 与 token，并在与保存共用的锁内安全读取和比较当前记录；仅身份仍匹配时删除。若凭证已安全确认不存在，或并发登录已将其替换为不同身份，SHALL 不修改当前记录。完成删除或上述无需删除的安全核验后，命令 SHALL exit 0，并按既有输出契约返回 `loggedOut=true`；该结果仅表示本次请求对应的旧会话已结束，不表示并发建立的新会话已登出。此规则包含会话已过期、已撤销或账号已禁用导致的明确认证失效。

网络故障、观察取消、403、5xx、未知错误代码或畸形响应 SHALL 保留本地凭证并按现有失败语义退出，不仅凭任意 HTTP 401 就宣告会话无效。其他 Core 的凭证及同一 Core 上并发登录取得的新 token SHALL 不被删除。本地安全核验、锁获取或删除失败 SHALL 返回失败，不报告 `loggedOut=true`，也不自动重放远端撤销请求。

#### Scenario: Use whoami in a new process
- **WHEN** 先前进程保存的凭据仍有效，用户在新进程执行 `piwork-cli whoami`
- **THEN** 无须重新提示密码即可返回相同账号、角色与用户 ID

#### Scenario: Log out a valid session
- **WHEN** 用户在 Core 可达时执行 `piwork-cli logout`
- **THEN** 服务端旧会话被撤销，仍匹配该会话的本地凭据被删除，旧 token 不再有效；若另一进程在请求期间登录同一 Core 获得新 token，或登录其他 Core 并保存凭据，新凭据保持不变；凭据已不存在时安全完成；保存与清理通过跨进程锁避免比较后删除新记录，锁忙或本地核验、删除失败时返回失败，不报告 `loggedOut=true`

#### Scenario: Core unavailable during logout
- **WHEN** 登出请求无法联系 Core 且撤销结果未确认
- **THEN** CLI 返回安全网络错误并保留本地凭据，不谎报已经撤销

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

### Requirement: 用户客户端统一接受 HTTP(S) Core origin

**Identifier:** CLI-CORE-PROTOCOL-001

用户客户端 SHALL 对普通业务命令、默认及显式 Desktop、Desktop 当前连接切换、默认 Core 保存/读取及 proxy 使用一致的 Core 协议准入：合法 HTTP 与 HTTPS origin 均可作为目标，不因目标是 loopback、局域网、公网、IP 或域名而拒绝 HTTP。该行为 SHALL 在 Windows 与 Linux 一致，不要求额外 flag、环境变量或确认步骤，不自动将 HTTP 改写为 HTTPS。

Core origin SHALL 沿用既有地址语法和规范化规则，拒绝缺失 scheme/host、不支持的协议、userinfo、非根路径、query、fragment 等非法地址。CLI 参数语法、帮助/版本/空 JSON 提前返回、地址优先级及无效高优先级地址不回退的契约 SHALL 保持。HTTP 地址不再属于协议准入错误；网络不可达、鉴权失败和服务端错误 SHALL 按原命令的失败/退出码契约处理。

用户选择 HTTPS 时，客户端 SHALL 继续验证系统信任、证书有效性和目标主机名，不跳过校验、不自动回退 HTTP。凭证 SHALL 继续按包含 scheme、host 和 port 的 Core origin 绑定；从 HTTPS 改为 HTTP 或反向修改 SHALL 不复用另一 origin 的 token，即使 IP 和端口相同。客户端 SHALL 不自动更改系统证书或代理配置。

#### Scenario: 远程 HTTP 地址适用于所有客户端入口
- **WHEN** 用户以合法远程 HTTP Core origin 调用普通命令、默认/显式 Desktop 或已登录的 proxy
- **THEN** 客户端按原命令流程执行，不返回远程 HTTP usage 错误，不要求额外许可，不改写地址；Windows 与 Linux 一致

#### Scenario: 地址来源不影响 HTTP 准入
- **WHEN** 合法 HTTP Core 分别来自参数、环境、Desktop 默认配置或原凭证
- **THEN** 按所属入口的原优先级选择该地址，不因来源或 HTTP 协议回退至其他 Core；业务 CLI 仍不读取 Desktop 偏好

#### Scenario: 非法地址仍被拒绝
- **WHEN** 用户提供空值、缺失 scheme/host、其他协议、userinfo、非根路径、query 或 fragment
- **THEN** 沿用该入口原校验错误；CLI 地址错误 exit 2，Desktop 连接或偏好输入错误返回本地 400，UI 保留编辑值；损坏的已存偏好仍按原存储失败处理，不静默回退

#### Scenario: HTTP 与 HTTPS 的凭证独立
- **WHEN** 已存凭证属于 HTTPS origin，用户选择同 host/port 的 HTTP origin，或反向选择
- **THEN** 不向新 origin 发送旧 token，Desktop 显示新 origin 的真实登录状态；同一 origin 的正常凭证复用仍可用

#### Scenario: HTTPS 校验失败保持失败
- **WHEN** 选择 HTTPS Core，而证书不受信任、过期或目标主机名不匹配
- **THEN** 连接按原网络错误契约失败，不发送应用层登录或业务内容，不关闭证书校验，不改连 HTTP

#### Scenario: HTTP Core 不可达
- **WHEN** 选定 HTTP Core 不可达
- **THEN** 普通命令/proxy 按原网络失败返回，Desktop 仍可显示连接恢复页及本地 Inspect；不把网络失败描述为不允许 HTTP，不重提修改

### Requirement: 启动有界的 CLI 本地服务代理

**Identifier:** CLI-SERVICE-PROXY-001

`piwork-cli [--core <url>] proxy [--port <1..65535>]` SHALL 在原生模式前台监听`127.0.0.1`，默认17890；显式容器模式按 CLI-CONTAINER-001 监听容器内地址并保留宿主本机入口；启动前核验语法、当前用户凭证和Core service网关能力，并探测独立文件能力。Core URL SHALL 接受合法 HTTP 或 HTTPS origin，遵守 CLI-CORE-PROTOCOL-001，不因远程 HTTP 拒绝启动。启动成功 SHALL 输出代理地址、`/proxy.pac` URL及CLI-FILES-001规定的WebDAV信息；PAC SHALL 仅让符合默认Work域名形状的http/ws目标使用代理，其他目标DIRECT。

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

#### Scenario: HTTP Core 支持原代理网络路径
- **WHEN** 当前用户已登录 HTTP Core，service 网关能力可用，并启动 proxy
- **THEN** 原 HTTP、WebSocket、PAC 与可用 WebDAV 路径均可通过同一代理访问；仍拒绝非许可 Service 目标和开放 CONNECT，监听及本地临时凭证契约不变

#### Scenario: HTTP 不能绕过鉴权及能力检查
- **WHEN** HTTP Core 拒绝当前会话或必需 service 网关不可用
- **THEN** 分别按原 auth/网络失败契约退出，不留下半启动代理；文件能力缺失仍仅降级文件分支

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


### Requirement: 启动本地 Desktop WebUI

**Identifier:** CLI-DESKTOP-001

`piwork-cli [--core <url>] desktop [--port <1..65535>] [--no-open]` 及全局参数解析成功、无子命令且没有 `--json` 时的默认 Desktop 入口 SHALL 在原生模式前台启动仅监听 `127.0.0.1` 的本地 WebUI，默认端口 17891；原生模式默认打开系统浏览器，`--no-open` 仅输出本地打开地址。显式容器模式 SHALL 按 CLI-CONTAINER-001 提供宿主本机入口，并按 CLI-CONTAINER-DESKTOP-001 输出可直接打开的普通地址。地址 SHALL 使用受验证的 localhost 主机名；原生模式本机无需 Docker，容器交付使用已安装的 Docker；两种模式的本地 WebUI 均无需代理/PAC、hosts 编辑或安装本地站点证书。Desktop Core 地址 SHALL 按显式 `--core`、`PIWORK_CORE_URL`、保存的 Desktop 默认地址、凭证 Core、`http://127.0.0.1:17871` 的优先级选择；参数与环境仅覆盖本次调用，普通业务命令仍按原地址优先级且不读取 Desktop 偏好；Core 可以使用合法 HTTP 或 HTTPS origin，不按目标位置限制 HTTP，遵守 CLI-CORE-PROTOCOL-001。普通地址 SHALL 不含浏览器入口 ticket 或其他授权片段；来源合法的浏览器自动建立必要会话，复用同 Core 的有效共享 CLI 凭据或进入正常登录。无登录或 Core 暂不可达 SHALL 仍可打开登录/连接页面和本地包 Inspect，不能借用其他 Core 的 token，不要求终端重新授权。

启动前 SHALL 校验参数；未知参数、重复或非法端口、显式 Desktop 的 `--json` 返回 exit 2；端口占用返回 exit 6，资源缺失或监听失败返回 exit 5，不自动换端口或遗留半启动监听器。浏览器打开失败 SHALL 保持服务并打印手动打开地址；`--help` 不读取凭证或偏好、不启动监听、不访问网络。Ctrl+C SHALL 关闭本地连接、清理本次临时资源并退出 130，不停止 Work、不取消已经接受的 Core Operation/Run。平台会话失效 SHALL 回到登录状态而不退出 WebUI。既有 `proxy` 默认 17890、PAC、临时 WebDAV 密码及退出语义 SHALL 不变；Desktop 不要求先启动 proxy。

#### Scenario: 无登录的一键启动
- **WHEN** 原生用户首次运行默认入口或显式 desktop 且没有保存凭证
- **THEN** 浏览器打开登录/连接页面，可以配置默认 Core 和本地 Inspect；输入有效用户凭据后进入自己的 Work List

#### Scenario: 打开浏览器失败
- **WHEN** 本地监听已成功但系统没有可用的打开浏览器命令
- **THEN** 命令持续运行并显示手动地址，不谎报启动失败或自动关闭

#### Scenario: 非法端口与端口占用
- **WHEN** 用户指定非法端口或已被占用的合法端口
- **THEN** 分别返回 exit 2 或 6，不自动监听其他端口，不启动后台副本

#### Scenario: 关闭窗口和退出 CLI
- **WHEN** 用户关闭浏览器窗口，随后终止 Desktop 进程
- **THEN** 关闭浏览器不停止监听；进程退出只终止本地入口，Core 上已接受的工作继续，可在下次登录后查询

#### Scenario: 两种访问命令并存
- **WHEN** 用户同时运行默认 Desktop 与 proxy
- **THEN** 二者使用独立端口与本地凭据，WebUI 的启动和浏览器 Files 不依赖 proxy

#### Scenario: 使用远程 HTTP 启动及恢复
- **WHEN** 用户默认启动或显式 desktop 指定合法远程 HTTP Core，随后执行同用户 desktop open
- **THEN** Desktop 正常监听并输出/打开本地页面，页面报告实际 Core 状态；open 只恢复原实例，不改地址或创建第二实例

### Requirement: 可信本机命令打开既有 Desktop 普通地址

**Identifier:** CLI-DESKTOP-002

`piwork-cli desktop open [--port <1..65535>] [--no-open]` SHALL 连接同一系统用户拥有的既有 Desktop，默认端口 17891，不新建监听实例、不连接 Core、不读取平台凭证、不改变该实例当前 Core。成功输出当前实例准确本机 origin 的普通地址，不含 ticket、证明或账号秘密；原生模式默认打开浏览器，`--no-open` 只打印地址。显式容器模式不尝试打开容器内部浏览器，地址及 exit 0 仍返回当前调用者；发行说明要求使用 `--no-open` 并在宿主浏览器手动打开。调用不依赖工作目录、`PIWORK_CONFIG_PATH` 或 Core 环境配置。该形式不接受全局 `--core` 或 `--json`、未知 flag、重复 flag、额外参数及非法端口；语法错误 exit 2，help exit 0 均先于文件/网络操作。

open SHALL 只是可选的地址发现/浏览器打开操作，不签发、轮换或兑换浏览器入口授权；任何来源合法的新浏览器均可直接打开该普通地址。多次 open 不改变现有浏览器会话或平台身份。成功 exit 0，浏览器打开失败仍输出手动地址并 exit 0；实例不存在或已退出 exit 4，本机通道权限/安全校验拒绝 exit 3，协议不兼容或超时 exit 5。错误 stdout 为空，stderr 提供安全原因与下一步，不输出秘密、堆栈或任意路径；没有实例时不自动启动另一实例。Ctrl+C 结束 open 的本地等待不终止服务实例；原 `desktop` 的端口占用 exit 6 保持。

浏览器普通会话 SHALL 自动建立，最多 128 个且绝对期限十二小时；注册前回收过期项，容量满返回 503 LOCAL_SESSION_CAPACITY，不驱逐有效会话。容量错误 SHALL 作为普通连接资源限制提供重试说明，不要求取得新 ticket、重置浏览器访问或重新授权。普通浏览器会话到期不延长 Core 账号会话，下一次合法页面初始化自动建立普通会话并按真实账号状态继续。

#### Scenario: 运行中的实例重新打开
- **WHEN** 当前 Desktop 已运行，用户执行 open 并打开输出地址
- **THEN** 原 PID、端口、Core 和平台身份保持，普通地址直接进入正常登录或工作区，已有浏览器可继续访问，不需要平台凭据才能执行命令

#### Scenario: 自定义端口且环境配置不同
- **WHEN** 从不同目录及不同凭证/Core 环境执行 open --port 指向既有实例
- **THEN** 只重新打开该端口的同用户实例，不读取损坏凭证、不切换 Core、不尝试新的 TCP 监听

#### Scenario: 多次打开与旧票据链接
- **WHEN** 连续执行两次 open，或浏览器打开含历史 ticket 的旧链接
- **THEN** open 均返回同一普通地址，旧片段被忽略或移除，没有一次性校验、已有会话撤销或 Access 恢复页面

#### Scenario: 未运行、错误参数或打开浏览器失败
- **WHEN** 实例不存在、参数非法或系统浏览器无法启动
- **THEN** 分别返回 exit 4、exit 2 或带手动地址的 exit 0；均不创建后台副本、停止 Work 或泄漏平台 token

#### Scenario: 浏览器会话容量边界
- **WHEN** 有效普通会话达到 128 个，或注册时存在已过期会话
- **THEN** 分别拒绝新增并保留有效会话，或先回收过期项再自动建立；资源限制不要求重置浏览器访问，不泄漏账号秘密

### Requirement: 可信本机命令清理 Desktop 当前平台登录

**Identifier:** CLI-DESKTOP-003

`piwork-cli desktop logout [--port <1..65535>]` SHALL 通过同用户的可信本机通道清理所选 Desktop 当前平台登录，默认端口 17891。此命令不读取调用者的凭证文件、不依赖浏览器 Cookie/CSRF，不接受 `--no-open`、全局 `--core`/`--json`、重复/非法端口及其他参数；help 与语法校验先于 I/O。实例选择、缺失/权限/通道失败的退出码沿用 CLI-DESKTOP-002。

实例 SHALL 先撤销捕获平台身份的本地内容访问，再对捕获的 Core 会话进行至多五秒的远端注销尝试并条件清理其保存凭证。远端已撤销/已无效或原本无平台登录时 exit 0；本地清理确认但远端不可达、响应未知或凭证清理失败时 exit 5，明确分别结果和安全恢复方向；不可把超时写成远端注销成功。条件清理不得删除另一个进程随后保存的不同凭证。命令不改变本地控制会话、实例监听及任何 Work/Run/Operation 运行目标，不提供不加区分的配置文件删除。

保存凭证清理失败时 SHALL 保留原会话的有界重试上下文；再次执行 logout 继续条件清理该原会话，不能因为内存已 signed-out 而宣称磁盘清理完成。没有待清理记录的空身份注销只确认当前无平台登录，不追认之前未确认的远端撤销。

保存凭证仍待清理时，新的平台登录或切换 Core SHALL 被明确的清理未完成结果拒绝并保留输入，提示执行原实例 logout 后再继续；不能丢弃待清理记录、覆盖它或删除另一 CLI 新保存的会话。

#### Scenario: 浏览器授权丢失后注销
- **WHEN** 浏览器已关闭或 Cookie 已清除，系统用户执行实例 logout
- **THEN** 指定实例的旧平台身份及内容授权失效，随后普通地址可进入正常账号登录，无需 open 或重新授权；其他端口实例不被直接清理

#### Scenario: Core 离线与重复清理
- **WHEN** 平台注销响应不可确认，或已无平台登录再次 logout
- **THEN** 前者报告本地清理和远端未确认且 exit 5，后者 exit 0；均保持实例可重新打开，不假造远端成功

#### Scenario: 并发保存新凭证
- **WHEN** 注销旧会话期间另一个 CLI 写入新登录
- **THEN** 仅条件清理原会话，保留新凭证，不将其 token 或其他内容写入输出

### Requirement: Go 客户端转发当前模型与处理记录并保留原身份

**Identifier:** CLI-BRAIN-001

用户 CLI 和 Desktop 本地后端 SHALL 使用 Go Core 的当前模型、Session/Run 来源、请求和证据接口；公开投影 SHALL 排除平台密钥与内部路径。既有 chat 命令的参数和单槽语义保持，省略模型选择时遵循 Session 偏好；本次不新增自动流程顶层命令。Run 查询 SHALL 能报告真实模型和来源。

Desktop 本地后端 SHALL 按当前 Core/账号/Work 验证请求、转发模型偏好和请求取消/重试、分页读取证据，并沿用自动建立的普通浏览器会话、CSRF、凭证并发及原 ID 记录规则，不增加浏览器 Access 门禁。接受结果与后续读取分开；断线、导航、身份变化不隐式取消或重复提交。未知修改只能核对原对象。

#### Scenario: Desktop 与 CLI 查询同一 Run
- **WHEN** Desktop 选择模型并提交后，所有者使用 Go CLI 按原 Run ID 查询
- **THEN** 两个入口报告相同实际模型、来源与状态，不取得模型 secret

#### Scenario: 接受后刷新失败
- **WHEN** 本地入口已取得原 Run/请求/Operation 回执但关联读取失败
- **THEN** 原 ID 与接受事实保留，只提供原对象查询恢复，不自动重发修改

#### Scenario: 身份改变时晚返回
- **WHEN** 请求在旧 Core/账号下发出，返回前用户切换身份
- **THEN** 旧内容不进入新身份、不释放新动作的锁，同身份已接受结果仍可按原 ID 找回

### Requirement: 显式容器模式兼容本机发布端口

**Identifier:** CLI-CONTAINER-001

CLI SHALL 仅在 `PIWORK_CLI_CONTAINER_MODE=1` 时启用容器模式；未设置、空值或 `0` 保持原生模式。需要解析该模式的 Desktop/proxy/open 入口遇到其他值 SHALL 在本地资源/网络操作前返回 usage exit 2；help/version 和普通不使用本地监听/浏览器的业务命令不因此改变。

容器模式 Desktop/proxy SHALL 监听容器内 `0.0.0.0`，公开 URL 继续使用同机 `desktop.localhost` 或既有 `127.0.0.1` proxy/WebDAV 地址，内外端口一致；原生模式保持原 loopback 监听。本机 Host、Origin、CSRF、自动建立的普通浏览器会话、WebDAV 临时 Basic 和平台鉴权 SHALL 保持；Desktop 不要求启动票据或本机浏览器授权。proxy 对端可来自 Docker 转发路径，不依据该模式信任请求中的 Forwarded/X-Forwarded-*，PAC 和文件入口依然限定准确本地 Host，拒绝跨站来源。容器模式只适用于宿主 loopback 发布和可信本地 Docker 管理者，不承诺独立容器网络的其他参与者可信，也不作为开放网络代理。

#### Scenario: Windows Desktop 端口转发
- **WHEN** Linux CLI 容器开启容器模式，宿主将 17891 仅发布到 127.0.0.1
- **THEN** 同机 Windows 浏览器可直接打开普通地址，复用有效共享登录或进入正常账号登录，不因 Docker 转发后的 TCP 对端不是 loopback 而拒绝正常入口

#### Scenario: 未开启容器模式的原生 CLI
- **WHEN** 原生 CLI 不设置此 env，或设置为 0
- **THEN** 本地监听仍仅绑定 127.0.0.1，原有 proxy loopback 对端限制及浏览器打开行为保持

#### Scenario: 伪造本地来源
- **WHEN** 请求使用错误 Host/跨站 Origin，或通过 Forwarded/X-Forwarded-* 伪造 loopback
- **THEN** 来源校验拒绝，不创建普通浏览器会话、不借用平台 token、不转发文件请求

#### Scenario: 无效模式与帮助
- **WHEN** 模式值为 true 或 2 时执行 Desktop/proxy 启动，随后只请求 help/version
- **THEN** 前者 exit 2 且无监听/资源副作用，后者按既有无 I/O 帮助/版本契约成功

### Requirement: 在运行容器内重新打开与清理 Desktop

**Identifier:** CLI-CONTAINER-DESKTOP-001

容器模式 Desktop 启动 SHALL 不尝试打开容器内浏览器；主进程 stdout/stderr SHALL 输出宿主本机可直接打开的普通 origin，不输出入口 ticket、Core token 或密码。发行说明 SHALL 直接引导宿主浏览器访问该地址，不要求 `docker exec` 或 `desktop open` 取得授权。普通合法来源自动建立必要会话，并按同 Core 的有效共享 CLI 凭据或正常账号登录继续。容器内 `desktop open --no-open` 继续作为可选地址发现操作，返回同一普通地址。

容器内 open/logout SHALL 使用已有同用户私有控制通道、实例绑定和退出语义；执行方必须在目标 Desktop 容器中且使用同一有效 UID。另起仅共享凭证卷的容器不得因此成为目标实例的控制调用者。重新创建容器后 SHALL 创建新的控制实例身份，旧控制路径和普通浏览器会话不用于新实例；新页面会话自动建立，平台保存凭据按原规则继续可用。服务健康检查 SHALL 不创建浏览器会话、不修改账号状态，不需要 Core 在线。

#### Scenario: 正常启动并手动打开
- **WHEN** CLI 容器主进程启动 Desktop，用户在宿主浏览器打开输出的普通地址
- **THEN** 无需额外 exec/open 命令即可正常登录或使用有效共享 Core 登录，主日志不含 token 或授权 ticket

#### Scenario: 链接过期或丢失
- **WHEN** 用户没有旧启动链接但 CLI 容器仍运行，或在同容器执行 open --no-open
- **THEN** 可直接打开普通 origin，open 也只返回普通地址；其他容器的 open 不能控制该实例，浏览器不出现 Access 门禁

#### Scenario: 无浏览器 Cookie 注销
- **WHEN** 用户在目标容器中执行 desktop logout
- **THEN** 按原实例注销契约撤销旧平台内容授权、尝试远端注销和条件清理，不停止 Work/Run/Operation

#### Scenario: 主进程重建
- **WHEN** 用户保留状态卷并重建 CLI 容器，再打开普通地址
- **THEN** 自动建立当前实例的普通浏览器会话，保存登录按原规则核验并继续，不能复用旧控制实例身份，也不需要新的授权链接

### Requirement: 原生用户 CLI 的操作和恢复入口

**Identifier:** CLI-USAGE-001

用户 CLI SHALL 与 operator 身份分离；单次 --json 在 stdout 输出一个 JSON 值，诊断/进度在 stderr。无子命令启动 Desktop，显式 help/--help 和空 --json 保持帮助，业务命令与退出码保持。业务 Core 选择为 --core、PIWORK_CORE_URL、凭证 Core、默认 loopback；Desktop 增加独立偏好，合法 HTTP(S) origin 按协议隔离 token。

登录状态 SHALL 采用私有固定路径；logout 仅在撤销确认或明确 401 AUTHENTICATION_FAILED 后清除，网络/取消/403/5xx/畸形未知响应保留原凭证。Work 生命周期和包安装接受后保留 Operation ID；等待中断只结束观察，原 ID 查询恢复，不新键重提。包 verbose 仅安全阶段/代码/心跳，不显示第三方输出；安装/配置 set 只改 desired，显式 apply 才生效，空 skills/packages 必须明确指定。

离线 inspect SHALL 不读凭据、不连接 Core，也不宣称目标兼容。导出先 Stop，导入保持 stopped 后显式 Start；下载中断用原 snapshot ID 从头重取，不重新 Export。手动 Chat、中断取消和 run watch/cancel SHALL 沿用有效 CLI-CHAT 与原 Run 身份。

#### Scenario: 按现行契约操作与核对
- **WHEN** 用户或维护者使用上述现行入口，并满足对应身份、平台与运行条件
- **THEN** 操作、边界、拒绝及恢复遵循上述契约，不依赖已移除的开发手册；历史版本描述不覆盖当前有效 Spec

以下为已有操作/验证入口的示例，使用实际返回 ID 和隔离测试资源；命令存在不表示本次已执行或验收通过。源码构建使用 Go 1.25.5、Node 24，容器/浏览器专项须预备相应依赖。

```sh
piwork-cli --core http://127.0.0.1:17871 status
printf '%s\n' "$PIWORK_USER_PASSWORD" | piwork-cli --core http://127.0.0.1:17871 login --account owner --password-stdin
piwork-cli whoami
piwork-cli work create --name 'My Work' --wait
piwork-cli work list
piwork-cli work show <workId>
piwork-cli work stop <workId> --wait
piwork-cli work start <workId> --wait
piwork-cli work retry <workId> --wait
piwork-cli operation show <operationId>
piwork-cli logout
```

```sh
piwork-cli skills list
piwork-cli skills show <skillName>
piwork-cli packages list
piwork-cli packages show <packageName>
piwork-cli work config show <workId>
piwork-cli work config set <workId> --config ./work-config.json
piwork-cli work config skills set <workId> --no-skills
piwork-cli work config packages set <workId> --no-packages
piwork-cli work config agents set <workId> --file ./AGENTS.md
piwork-cli work config apply <workId> --wait
```

```sh
piwork-cli work packages install <workId> npm:example-package@1.0.0 --wait --verbose
piwork-cli work packages install <workId> git+https://example.org/owner/repo.git#main --wait
piwork-cli work packages install <workId> ./local-package --wait
piwork-cli work packages install <workId> ./package.zip --wait
piwork-cli work packages install <workId> --from-core <catalogName> --wait
piwork-cli work packages list <workId>
piwork-cli work packages show <workId> <packageName>
```

```sh
piwork-cli session create <workId>
piwork-cli session list <workId>
piwork-cli session show <workId> <sessionId>
piwork-cli chat <workId> --session <sessionId> --message 'Summarize the data'
piwork-cli run show <workId> <runId>
piwork-cli run watch <workId> <runId> --after <sequence>
piwork-cli run cancel <workId> <runId>
piwork-cli work service list <workId>
piwork-cli work service show <workId> <serviceId>
piwork-cli work service logs <workId> <serviceId> --tail 100
piwork-cli work service restart <workId> <serviceId> --wait
piwork-cli proxy
piwork-cli desktop
```

```sh
piwork-cli work stop <workId> --wait
piwork-cli work export <workId> --output ./saved.work
piwork-cli work package inspect ./saved.work
piwork-cli work import ./saved.work --name 'Restored Work' --wait
piwork-cli work start <importedWorkId> --wait
```

### Requirement: 平台私有状态与独立客户端交付

**Identifier:** CLI-PLATFORM-001

客户端 SHALL 支持 Windows/Linux 原生入口和任意工作目录，不依赖源码、相邻 WebUI、Go/Node/Python/Docker。Desktop 默认与显式入口按 --core、PIWORK_CORE_URL、独立偏好、凭证 Core、默认地址选择；业务 CLI 不读偏好。偏好保存/清除只影响后续启动，不切换连接或清凭据，响应未知先读回，损坏不静默回退。

凭证路径 SHALL 按 PIWORK_CONFIG_PATH、显式 XDG_CONFIG_HOME、平台 UserConfigDir 选择；帮助/版本/离线 inspect 不创建状态。偏好为独立 v1 文件和锁，最大 64 KiB。Linux 保留 owner/0700/0600/flock；Windows 使用当前 SID/LocalSystem 受保护 DACL、固定目录 handle、拒绝 reparse/hardlink 和宽泛 ACL，不自动放宽权限。并发原子发布只读旧/新完整内容，不承诺所有设备物理断电；缺少变更序号时核对摘要，不以大小/mtime 不变证明同字节。未知容量、身份或进程存活不授权上传/清理。

可信 desktop open/logout SHALL 使用私有实例控制并与 cwd、Core 环境及凭证路径无关，不接受 --core；Linux peer UID/Unix socket 和 Windows SID/PID/创建时间/named pipe 隔离保持。端口占用 exit 6，不自动换端口；关闭浏览器不退出，Ctrl+C/Ctrl+Break 有界收尾，强杀不保证回调。

Windows 来源 SHALL 支持相对、盘符绝对、UNC、中文/空格，拒绝盘符相对、设备名、ADS、junction 与危险组件。普通目录模式为协议 0644/0755，不按扩展名猜执行位；需要执行位使用原协议 ZIP；离线 .work 不解压执行。客户端构建 SHALL 固定 Go 1.25.5/Node 24/CGO=0，独立编译 Desktop 和各目标，真实 build.json 记录 commit/dirty/目标/摘要；候选与 Windows 实机正式通过分别记录。

#### Scenario: 按现行契约操作与核对
- **WHEN** 用户或维护者使用上述现行入口，并满足对应身份、平台与运行条件
- **THEN** 操作、边界、拒绝及恢复遵循上述契约，不依赖已移除的开发手册；历史版本描述不覆盖当前有效 Spec

以下为已有操作/验证入口的示例，使用实际返回 ID 和隔离测试资源；命令存在不表示本次已执行或验收通过。源码构建使用 Go 1.25.5、Node 24，容器/浏览器专项须预备相应依赖。

```sh
piwork-cli                          # 默认启动 Desktop
piwork-cli --core http://<core-host>:17871  # HTTP 默认入口
piwork-cli --core http://core.example:17871 desktop --no-open
piwork-cli --core https://core.example
piwork-cli --help                   # 显式查看原业务命令
piwork-cli help
piwork-cli --json                   # 只输出帮助，不启动 Desktop
piwork-cli desktop --port 17901 --no-open
piwork-cli desktop open --port 17901 --no-open
piwork-cli desktop logout --port 17901
```

```sh
piwork-cli --core http://core.example:17871 status
piwork-cli --core http://core.example:17871 proxy  # 先在这个 origin 登录
PIWORK_CORE_URL=http://core.example:17871 piwork-cli
```

```powershell
$env:PIWORK_CORE_URL = 'http://core.example:17871'
.\piwork-cli.exe
```

```powershell
.\piwork-cli.exe work packages install <workId> '.\本地 包' --wait
.\piwork-cli.exe work packages install <workId> 'C:\Packages\package.zip' --wait
.\piwork-cli.exe work packages install <workId> '\\server\share\package.zip' --wait
```

```sh
npm ci
npm run build:cli
# 或 make build-cli
node scripts/build-cli.mjs --target windows/amd64 --target linux/amd64
```

```text
dist/cli/linux-amd64/piwork-cli
dist/cli/linux-amd64/build.json
dist/cli/windows-amd64/piwork-cli.exe
dist/cli/windows-amd64/build.json
```

```sh
go test -mod=readonly ./internal/clientfs ./internal/client ./internal/cli ./internal/pipackage
go list -deps ./cmd/piwork-cli
```

```sh
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go test -mod=readonly -c -o clientfs.test.exe ./internal/clientfs
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go test -mod=readonly -c -o client.test.exe ./internal/client
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go test -mod=readonly -c -o cli.test.exe ./internal/cli
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go test -mod=readonly -c -o pipackage.test.exe ./internal/pipackage
```

```powershell
.\clientfs.test.exe -test.v -test.timeout=90s
.\client.test.exe -test.v -test.timeout=90s
```

```sh
go build -mod=readonly -o storage-fixture scripts/check-cli-storage-fixture.go
./storage-fixture --create --directory <新的哨兵目录>
# 保存返回的 owner；以 owner 启动本次 Desktop，保持控制通道存活。
# 再以另一普通账号执行：
./storage-fixture --probe-other-user --directory <哨兵目录> --owner <owner> --control <活跃通道>
```

```sh
go build -mod=readonly -o credential-fixture.exe scripts/check-cli-credential-fixture.go
# Windows 设置 PIWORK_TEST_CREDENTIAL_FIXTURE 为该 helper 的绝对路径。
npm run test:browser -w @piwork/desktop-webui
```

```sh
node scripts/check-cli-platform.mjs --build dist/cli/linux-amd64 --report dist/cli/linux-amd64/native-evidence.json --fixtures <原生fixture配置.json>
```

```json
{
  "version": 1,
  "scenarios": {
    "core-command-families": { "command": "native-core-fixture", "args": ["--scenario", "core-command-families"] },
    "core-packages-snapshots": { "command": "native-core-fixture", "args": ["--scenario", "core-packages-snapshots"] }
  }
}
```

```json
{"id":"core-command-families","status":"pass","sha256":"本次候选摘要","target":"linux/amd64","diagnostic":"已执行的非敏感断言说明"}
```

```sh
go run -mod=readonly scripts/package-cli-release.go --build dist/cli/linux-amd64 --evidence dist/cli/linux-amd64/native-evidence.json --output dist/cli-release
# 在 Windows 原生验收后可在构建机打包其 PE：
go run -mod=readonly scripts/package-cli-release.go --build dist/cli/windows-amd64 --evidence <Windows原生报告.json> --output dist/cli-release
```

### Requirement: 文件能力独立降级并保持 service 代理

**Identifier:** CLI-FILES-002

文件能力未提供、版本不兼容、文件 helper 未配置或文件能力探测暂时失败时 SHALL 显示明确状态并继续已有 service 代理；后续文件请求可重查能力，未支持返回 `501 FILE_ACCESS_UNSUPPORTED`，配置/版本/暂时不可用返回 `503 FILE_HELPER_UNAVAILABLE` 或 `CORE_UNAVAILABLE`。能力缓存不能代替 Core 逐请求授权。普通 WebDAV 方法未实现仍为 405，不能与整项功能未支持混淆。此降级契约按当前能力响应验证，不要求维护旧 TS Core 与 Go CLI 的发行版本组合。

本地 401、文件 403/404/409/5xx、207 部分失败及 service 应用 401 SHALL 保留 proxy 进程。只有确认的 Core 会话 401 SHALL 关闭两类流量并 exit 3，提示重新登录后重启 proxy。CLI SHALL 不自动重放失败 PUT/COPY/MOVE/DELETE，不把收到错误解释为服务端必然回滚。帮助与文档 SHALL 给出单 proxy、多 Work URL、rclone 通用模式、本地密码有效期、运行状态限制、文件方法/限额及 export/import 验证步骤。

#### Scenario: 文件能力入口不存在
- **WHEN** service capability 可用但 file-access 能力探测返回 404
- **THEN** proxy 仍启动并显示文件不支持，service 网页可访问，文件入口返回 501 而不尝试把它转成用户 service

#### Scenario: 缺少helper
- **WHEN** file-access 报告后端不可用
- **THEN** service 继续可用，文件请求明确返回 503；后端恢复后新文件请求可以重新发现能力

#### Scenario: 文件错误和会话错误分别处理
- **WHEN** 文件缺失、本地密码错误、应用返回 401，随后 Core 真正撤销登录会话
- **THEN** 前三种错误不退出 proxy；最后一种关闭两类连接并提示重新登录

#### Scenario: 写入响应断开
- **WHEN** PUT 已转发但响应途中断开
- **THEN** CLI 报告连接失败而不自动再发 PUT，文档指引重新查询实际目标

### Requirement: 无子命令时默认启动 Desktop 并保留显式命令契约

**Identifier:** CLI-DEFAULT-001

`piwork-cli` SHALL 在全局参数解析成功、没有子命令且没有 `--json` 时执行默认 `desktop` 启动；无参数和仅提供 `--core <url>` 均适用。该入口 SHALL 使用显式 `desktop` 的监听、授权、浏览器打开、失败和前台退出契约，不根据操作系统、终端是否存在或启动手势选择另一套流程。

所有显式业务命令、`desktop`、`desktop open`、`desktop logout`、`proxy` 的参数语法、输出、退出码和等待/取消语义 SHALL 保持；默认路由不得吞掉未知命令或参数，不得自动启动后台进程、复用其他实例或自动换端口。自定义端口和禁止打开浏览器 SHALL 继续通过 `desktop --port ... --no-open` 设置，根级别不新增这些 flag。

`help`、`--help`、`-h` 和既有子命令帮助 SHALL 输出帮助并退出 0，`version`、`--version` SHALL 保持版本输出；均不读取凭证或 Desktop 配置、不访问 Core、不创建监听。无子命令的 `--json` 或 `--core <url> --json` SHALL 保持帮助输出和 exit 0，不进入 Desktop。显式 `--json desktop` 和 `--json proxy` SHALL 仍返回 exit 2。参数或命令语法错误 SHALL 在本地状态和网络访问前返回 exit 2。

#### Scenario: 无参数启动
- **WHEN** 用户直接执行 `piwork-cli`，默认端口可用
- **THEN** 前台启动默认 Desktop 并尝试打开浏览器，行为等同显式 `desktop`，不只输出帮助

#### Scenario: 仅参数选择 Core
- **WHEN** 用户执行 `piwork-cli --core https://core.example`
- **THEN** 启动 Desktop 并使用该 Core；不修改默认配置或登录凭证，不运行 status 或 login

#### Scenario: 显式命令和机器调用
- **WHEN** 调用 `--json work list`、`chat`、`proxy`、`desktop --port 17901 --no-open` 或 `desktop open`
- **THEN** 分别执行原命令，不额外启动默认 Desktop、不添加浏览器启动日志到业务 stdout

#### Scenario: 帮助、版本和空机器调用
- **WHEN** 调用帮助、版本，或只提供 `--json`，且本地配置损坏、Core 不可达
- **THEN** 仍按原有成功契约结束，不读取配置、不监听、不打开浏览器；无子命令的 `--json` 输出帮助

#### Scenario: 无效调用不能进入界面
- **WHEN** 用户输入未知命令、重复全局参数、缺失参数值，或根级别的 `--port`、`--no-open`
- **THEN** 返回 exit 2 和安全用法提示，不打开浏览器、不创建本地状态；显式 Desktop/proxy 的 `--json` 同样拒绝

#### Scenario: 已有实例不改变默认启动语义
- **WHEN** 默认 Desktop 端口已经被现有实例或其他程序占用，再执行无子命令入口
- **THEN** 返回 exit 6，不复用、不切换既有 Core、不新建其他端口实例；用户可显式执行 `desktop open` 恢复自己的实例

### Requirement: 管理员通过 CLI 一次导出 Core 与自有 Work 日志

**Identifier:** CLI-LOG-001

piwork-cli SHALL 提供 `logs export [--output <file>] [--idempotency-key <key>]`、`logs show <exportId>`、`logs download <exportId> --output <file>`，沿用全局 `--core`/`--json`、业务 Core 地址优先级及同 origin 用户凭证规则，直接连接 Core 17871，不依赖 UI 后端或本机 Docker。命令仅使用管理员用户会话；普通用户的 403 映射为 exit 3，不回退 operator 或本机日志读取。

export SHALL 预先校验参数与输出目标，缺省目标为当前目录 `piwork-logs-<本次客户端UUID>.zip`；自动补齐 UUID 幂等键。export 提交一次创建并保留原 exportId/cutoffTime/scope，然后串行观察同一任务，ready 后自动下载至目标。进度在 stderr 显示收集来源、打包、下载及实际 Core 日志可用/缺口状态，不仅凭 scope 声称 Core 文件已成功取得。CLI SHALL 不给正在正常推进的任务附加短于服务端任务预算的总等待期限；单次请求有界，暂时观察故障退避读取原 ID，确定无法继续时保留恢复信息。

用户 Ctrl+C SHALL 结束观察或本次下载并 exit 130，不取消已接受 Core 任务；show/download 恢复原任务，不重新创建。创建响应丢失 SHALL 报告未确认且保留本次幂等键供显式同键恢复，不自动以新键重提。

各级 help SHALL 在凭据、文件或网络 I/O 前成功；未知/重复 flag、空值、非法 ID、额外位置参数及输出 `-` SHALL exit 2，不接受 owner、Work 范围、Core-only、follow、停止或过滤选项。既有 `work service logs`、`work export`、默认 Desktop 和 operator API 语义保持。

#### Scenario: 管理员导出远程 Core
- **WHEN** 已在所选服务器登录的管理员运行 logs export --output ./piwork-logs.zip
- **THEN** CLI 直连该 Core，观察并下载其 Core 文件及管理员自有 Work 日志，服务器收集打包，本地只接收和校验

#### Scenario: 普通用户执行命令
- **WHEN** 普通用户调用 logs export/show/download
- **THEN** Core 权限拒绝映射为 exit 3，不创建本地最终文件或寻求其他凭据

#### Scenario: 中断后恢复
- **WHEN** CLI 已取得 exportId 后等待被中断或下载断开
- **THEN** 保留原 ID，用户可 logs show 后 logs download，Core 不被要求取消或重新收集

#### Scenario: 未确认创建结果
- **WHEN** POST 已发送但响应丢失
- **THEN** 输出安全的未确认结果与原幂等键，不虚构 exportId，显式同键恢复返回同一已接受任务

### Requirement: 日志包下载安全发布并提供稳定结果

**Identifier:** CLI-LOG-002

CLI SHALL 以 0600 权限在已核验输出目录创建本次临时文件，流式下载并校验 Content-Length、application/zip 和 SHA-256，完成同步后无覆盖发布；拒绝已有目标、链接或不安全路径，失败只清理本次临时文件，不留下最终名称的半包。不以 Work 快照 Inspect 校验 ZIP，也不将 ZIP 写 stdout。

JSON 模式 export/download 成功 SHALL 在 stdout 恰输出一个 `{exportId,cutoffTime,path,size,digest,complete,warningCount}` 对象；show 输出一个安全任务对象。部分结果成功保存仍 exit 0，但 complete=false 和缺口计数必须保留，文本/JSON 模式 stderr 均提示缺口；只有文件交付成功才报告本地保存完成。接受后观察/下载失败保留 exportId 及恢复命令，JSON 输出一个带原 ID 的 waiting/failed 结果，不污染进度。

退出码 SHALL 为：syntax/本地目标与文件失败 2，缺登录或 401/403 为 3，404 为 4，网络/503/观察或传输失败为 5，409/任务 failed 或 interrupted 为 6，410/内容校验失败及其他失败为 1，主动 Ctrl+C 为 130，成功交付或成功 show 查询为 0。show 查询到任务 failed/interrupted 时查询本身仍 exit 0；ready 包过期后 download 明确报告重新导出，不隐式提交新任务。

#### Scenario: 下载内容被截断或损坏
- **WHEN** 下载的长度或 hash 不符
- **THEN** 不发布最终 ZIP，清理本次临时文件，保留 exportId 并按内容校验失败退出

#### Scenario: 目标文件在下载期间出现
- **WHEN** 另一个进程创建了同名输出
- **THEN** 无覆盖发布失败，保留另一个文件，返回 exit 2 和原 exportId

#### Scenario: 带缺口的机器输出
- **WHEN** --json logs export 下载 complete=false 的有效结果
- **THEN** stdout 只有最终文件结果且 complete=false，stderr 显示进度和缺口，保存成功 exit 0

#### Scenario: 查询失败任务与下载过期包
- **WHEN** logs show 成功查询 failed 任务，或 logs download 收到 410
- **THEN** 前者 exit 0 并展示真实任务失败，后者 exit 1 并指向显式重新导出，无新 POST

#### Scenario: Core 确认原结果损坏后恢复查询
- **WHEN** download 因 Core 核验确认损坏收到 503 LOG_EXPORT_CONTENT_UNAVAILABLE，随后 show 原 ID 或显式用原键恢复
- **THEN** 下载 exit 5 且不发布本地文件，show 成功返回原 failed 状态、result=null、原 cutoffTime 和安全错误并 exit 0；同键返回原失败任务，不重采，不将服务端拒绝误报为本地保存成功
