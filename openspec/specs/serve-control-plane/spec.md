# Serve Control Plane Specification

## Purpose

为部署者提供独立于登录用户客户端的 Core 控制面，使服务可以先启动再完成管理员和默认运行时初始化，并为未来 WebUI 复用同一套控制接口。

## Requirements

### Requirement: Provide a dedicated operator control plane

**Identifier:** SERVE-CTRL-001

系统 SHALL 提供名为 `piwork-serve` 的部署与控制面 CLI。该 CLI SHALL 能连接正在运行的 Core，查询健康与初始化状态，完成管理员、用户、Core-managed Skills、全局默认运行时和默认 Work configuration 管理；它 MUST NOT 读取或返回 Work 用户会话正文、Run 输出、模型 secret 明文或普通用户不可见的 Skill 文件。默认 Work configuration SHALL 只能通过 operator 控制面或已启用管理员的受保护管理 API 读取和修改，并 SHALL 使用 Skill name 而非导入 path 选择多个默认 Skills。

operator 控制面 SHALL 额外提供 PKG-004 的 Core package catalog/default lifecycle 及只限 Core package Operation 的查询。普通 user credential 不得写 /control/packages/default-work；operator credential 不得借 Core operation 查询读取用户 Work package/Session 数据。default-work packages 使用 manifest name，支持替换列表、显式空集合及省略保持；flag 更新必须原子合并未指定字段。

新增管理员 API SHALL 复用上述管理领域能力，使用登录管理员身份，继续排除其他用户 Work 会话正文和 Run 输出。原 /control/* 的 operator 凭证要求及 CLI 与用户客户端的分工 SHALL 保持；管理员 bearer 通过独立 /api/v1/admin/* 管理接口使用，不直接访问 /control/*。

#### Scenario: Operator controls an initialized Core
- **WHEN** 部署者使用 `piwork-serve status`、`admin`、`skills` 或 `config` 连接 Core
- **THEN** CLI 返回对应的控制面状态或变更结果，并使用独立的 operator 身份完成授权

#### Scenario: Operator manages a Skill path
- **WHEN** operator 执行 `piwork-serve skills add --path <directory>` 或其他已定义的 Skill 生命周期命令
- **THEN** Core 执行授权操作，以规范化目录 basename 返回 Skill name 及公开管理状态，不解析 `SKILL.md`、披露或保存完整来源路径

#### Scenario: Operator updates the default Work configuration
- **WHEN** operator 执行 `piwork-serve config default-work set` 并使用重复的 `--skill <skill-name>`、`--no-skills`、`--base-image` 或 `--agents-md-file`
- **THEN** Core 原子保存结果且不要求或返回公开 revision；省略 Skill 选项时保留当前选择，AGENTS 保存内容而非来源路径

#### Scenario: Default changes do not mutate existing Works
- **WHEN** Work A 已存在后，operator 修改默认 Skills、AGENTS 内容或 base image
- **THEN** Work A 的 active 和 desired context 副本保持不变，仅后续创建的 Work 使用新默认值

#### Scenario: Operator client is not a user client
- **WHEN** 操作者尝试使用 `piwork-serve` 执行用户登录、创建用户 Work 或发送对话
- **THEN** CLI 拒绝该命令并提示使用 `piwork-cli`

#### Scenario: Read a Core package operation
- **WHEN** operator 查询 Core install 返回的 Operation
- **THEN** 返回安全阶段/结果；给同接口传 Work Operation ID 不得泄露 Work 数据

#### Scenario: Keep unrelated defaults on package edit
- **WHEN** operator 只更新默认 packages，同时其他请求修改默认模型
- **THEN** 两项提交不因客户端旧快照互相覆盖，默认 Skill/AGENTS 等省略字段保留

#### Scenario: 管理员使用稳定管理 API
- **WHEN** 已启用管理员通过 /api/v1/admin/default-work 修改默认配置
- **THEN** Core 授权该管理操作并保持原有默认与已有 Work 隔离语义，普通 user 会话仍被拒绝

#### Scenario: 面板未启动仍能使用控制面
- **WHEN** 独立面板进程停止或尚未启动
- **THEN** piwork-serve 的 operator 管理、Core 健康与后台任务仍可独立运行

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

### Requirement: Initialize selected environment files safely

`piwork-serve serve` SHALL 支持显式 `--env-file <path>`，解析 `.env`、`.env.test` 等键值文件。首次初始化时可使用文件中的管理员和默认运行时字段；已有持久管理员、默认配置或 CLI 凭证 MUST NOT 被重启时的 env 文件覆盖。密钥不得出现在日志、普通输出或 API 响应中。

#### Scenario: Bootstrap from `.env.test`

- **WHEN** 空数据目录通过 `--env-file .env.test` 启动，文件包含有效管理员和模型配置
- **THEN** Core 创建管理员和默认运行时配置后继续监听，且不创建默认 Work

#### Scenario: Preserve persisted state on restart

- **WHEN** 已有数据目录使用不同管理员密码或模型配置再次通过同一个 env 文件启动
- **THEN** Core 保留持久化状态，env 文件只补齐缺失状态或报告不可用配置，不覆盖已有值

### Requirement: Separate operator and user credentials

Core SHALL 为 `piwork-serve` 提供仅限本机控制面的 operator credential，并将其与 `piwork-cli` 的用户登录 token 分开存储、校验和撤销。operator credential MUST 使用当前用户可读的保护权限，不能授权用户 Work 对话内容。

#### Scenario: Use operator credential for control commands

- **WHEN** `piwork-serve admin` 或 `piwork-serve config` 连接 Core
- **THEN** Core 接受有效 operator credential，并拒绝缺少或属于 `piwork-cli` 用户会话的凭证

#### Scenario: Reject unsafe operator credential storage

- **WHEN** operator credential 路径是符号链接或可被其他用户读取
- **THEN** Core 拒绝使用该凭证并报告安全错误
