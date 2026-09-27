# Serve Control Plane Spec Delta

## MODIFIED Requirements

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
