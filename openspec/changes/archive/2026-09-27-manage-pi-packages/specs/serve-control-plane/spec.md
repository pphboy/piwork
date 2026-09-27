# Spec Delta

## MODIFIED Requirements

### Requirement: Provide a dedicated operator control plane

**Identifier:** SERVE-CTRL-001

系统 SHALL 提供名为 `piwork-serve` 的部署与控制面 CLI。该 CLI SHALL 能连接正在运行的 Core，查询健康与初始化状态，完成管理员、用户、Core-managed Skills、全局默认运行时和默认 Work configuration 管理；它 MUST NOT 读取或返回 Work 用户会话正文、Run 输出、模型 secret 明文或普通用户不可见的 Skill 文件。默认 Work configuration SHALL 只能通过 operator 授权操作读取和修改，并 SHALL 使用 Skill name 而非导入 path 选择多个默认 Skills。

operator 控制面 SHALL 额外提供 PKG-004 的 Core package catalog/default lifecycle 及只限 Core package Operation 的查询。普通 user credential 不得写 /control/packages/default-work；operator credential 不得借 Core operation 查询读取用户 Work package/Session 数据。default-work packages 使用 manifest name，支持替换列表、显式空集合及省略保持；flag 更新必须原子合并未指定字段。

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

#### Scenario: Read a Core package operation
- **WHEN** operator 查询 Core install 返回的 Operation
- **THEN** 返回安全阶段/结果；给同接口传 Work Operation ID 不得泄露 Work 数据

#### Scenario: Keep unrelated defaults on package edit
- **WHEN** operator 只更新默认 packages，同时其他请求修改默认模型
- **THEN** 两项提交不因客户端旧快照互相覆盖，默认 Skill/AGENTS 等省略字段保留

### Requirement: Keep Core reachable before initialization

**Identifier:** SERVE-START-001

`piwork-serve serve` SHALL 在管理员或全局默认运行时尚未配置时仍启动健康 HTTP 服务。Readiness SHALL 返回稳定的初始化原因，例如 `ADMIN_REQUIRED`、`RUNTIME_NOT_CONFIGURED` 或 `RUNTIME_UNAVAILABLE`；需要管理员或运行时的业务操作 SHALL 返回可操作的错误，而不是使进程退出。Default Work configuration SHALL be independently reported as missing or invalid when it is required for Work creation.

默认 packages=[] SHALL 是新 V1 的有效初始值。package preparation 若缺少有效默认 agent 环境或 Docker 不可用，SHALL 返回明确运行依赖错误且不使 Core 退出；已有包库 list/show 与健康查询仍可用。默认引用缺失、disabled、重复或超过 64 个 SHALL 原子拒绝，不覆盖既有默认配置。

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

#### Scenario: Reject preparation before runtime setup
- **WHEN** operator 在 agent environment 未配置时安装 package
- **THEN** 返回可操作运行依赖错误，无第三方脚本在 Core 执行，健康服务保持可用

#### Scenario: Clear package defaults independently
- **WHEN** operator 执行 default-work set --no-packages
- **THEN** 只清空默认 packages，不禁用或删除 catalog 包，不更改 Skills 或已有 Work
