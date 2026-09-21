# Spec Delta

## MODIFIED Requirements

### Requirement: Provide a dedicated operator control plane

**Identifier:** SERVE-CTRL-001

系统 SHALL 提供名为 `piwork-serve` 的部署与控制面 CLI。该 CLI SHALL 能连接正在运行的 Core，查询健康与初始化状态，完成管理员、用户和全局默认运行时配置管理，并管理全局默认 Work configuration（base image、Skills、`AGENTS.md` 和已有 runtime defaults）；它 MUST NOT 读取或返回 Work 用户会话正文、Run 输出或模型 secret 明文。默认 Work configuration SHALL be readable and editable only through operator-authorized control-plane operations.

#### Scenario: Operator controls an initialized Core
- **WHEN** 部署者使用 `piwork-serve status`、`piwork-serve admin` 或 `piwork-serve config` 连接 Core
- **THEN** CLI 返回对应的控制面状态或变更结果，并使用独立的 operator 身份完成授权

#### Scenario: Operator updates the default Work configuration
- **WHEN** an operator invokes `piwork-serve config default-work show` or `piwork-serve config default-work set --base-image <image> --skill <catalog-id>... --agents-md-file <path>`
- **THEN** Core validates and transactionally stores the complete default Work configuration, returns its public revision and selected artifact identities, and stores AGENTS content rather than the host path

#### Scenario: Default changes do not mutate existing Works
- **WHEN** an operator changes the default Skills, AGENTS content, or base image after Work A exists
- **THEN** Work A's desired and active revisions remain unchanged and only later Work creation uses the new default

#### Scenario: Operator client is not a user client
- **WHEN** 操作者尝试使用 `piwork-serve` 执行用户登录、创建用户 Work 或发送对话
- **THEN** CLI 拒绝该命令并提示使用 `piwork-cli`

### Requirement: Keep Core reachable before initialization

**Identifier:** SERVE-START-001

`piwork-serve serve` SHALL 在管理员或全局默认运行时尚未配置时仍启动健康 HTTP 服务。Readiness SHALL 返回稳定的初始化原因，例如 `ADMIN_REQUIRED`、`RUNTIME_NOT_CONFIGURED` 或 `RUNTIME_UNAVAILABLE`；需要管理员或运行时的业务操作 SHALL 返回可操作的错误，而不是使进程退出。Default Work configuration SHALL be independently reported as missing or invalid when it is required for Work creation.

#### Scenario: Start an empty installation
- **WHEN** 操作者在空数据目录运行 `piwork-serve serve`
- **THEN** Core 监听成功，`/healthz` 成功，`/readyz` 返回非 ready 的管理员初始化原因，且不会创建默认 Work

#### Scenario: Complete initialization while Core is running
- **WHEN** 操作者通过 `piwork-serve admin bootstrap` 创建管理员并通过 `piwork-serve config set` 保存有效默认配置
- **THEN** Core 更新健康与 readiness 状态，在 Docker 可用时进入 ready，后续 Work 创建可用

#### Scenario: Reject an invalid default Work configuration
- **WHEN** an operator attempts to save a disabled Skill, duplicate Skill, invalid base image, or unreadable AGENTS file
- **THEN** the control plane returns a field-specific validation error, leaves the previous default configuration unchanged, and keeps Core serving health endpoints
