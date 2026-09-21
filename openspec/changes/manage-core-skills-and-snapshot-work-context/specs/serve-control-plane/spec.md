# Spec Delta

## MODIFIED Requirements

### Requirement: Provide a dedicated operator control plane

**Identifier:** SERVE-CTRL-001

系统 SHALL 提供名为 `piwork-serve` 的部署与控制面 CLI。该 CLI SHALL 能连接正在运行的 Core，查询健康与初始化状态，完成管理员、用户、Core-managed Skills、全局默认运行时和默认 Work configuration 管理；它 MUST NOT 读取或返回 Work 用户会话正文、Run 输出、模型 secret 明文或普通用户不可见的 Skill 文件。默认 Work configuration SHALL 只能通过 operator 授权操作读取和修改，并 SHALL 使用 Skill name 而非导入 path 选择多个默认 Skills。

#### Scenario: Operator controls an initialized Core
- **WHEN** 部署者使用 `piwork-serve status`、`admin`、`skills` 或 `config` 连接 Core
- **THEN** CLI 返回对应的控制面状态或变更结果，并使用独立的 operator 身份完成授权

#### Scenario: Operator manages a Skill path
- **WHEN** an operator invokes `piwork-serve skills add --path <directory>` or another documented Skill lifecycle command
- **THEN** Core performs the authorized Skill operation and returns the normalized directory basename as its Skill name plus public management state, without parsing `SKILL.md` or disclosing/persisting the full source path

#### Scenario: Operator updates the default Work configuration
- **WHEN** an operator invokes `piwork-serve config default-work set` with repeated `--skill <skill-name>`, `--no-skills`, `--base-image`, or `--agents-md-file`
- **THEN** Core atomically stores the resulting default configuration without requiring or returning a public revision, preserves the current Skill selection when neither Skill option is present, and stores AGENTS content rather than its source path

#### Scenario: Default changes do not mutate existing Works
- **WHEN** an operator changes default Skills, AGENTS content, or base image after Work A exists
- **THEN** Work A's active and desired context copies remain unchanged and only later Work creation uses the new default

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
- **WHEN** an operator attempts to save a missing, disabled, duplicate, or unusable Skill name, an invalid base image, or an unreadable AGENTS file
- **THEN** the control plane returns a field-specific validation error, leaves the previous default configuration unchanged, and keeps Core serving health endpoints

#### Scenario: Clear default Skills explicitly
- **WHEN** an operator invokes `config default-work set --no-skills`
- **THEN** Core stores an empty default Skill selection without altering unrelated default fields, and rejects combining `--no-skills` with any `--skill`
