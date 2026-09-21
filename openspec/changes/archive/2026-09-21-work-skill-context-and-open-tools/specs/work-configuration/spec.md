# Spec Delta

## MODIFIED Requirements

### Requirement: Select a complete Work environment

**Identifier:** WCFG-001

系统 SHALL 维护全局默认运行时配置和每个 Work 的独立配置。创建 Work 时，系统 SHALL 将当时的全局默认解析为 Work 的 desired configuration；Work 所有者之后可以读取和更新自己的配置。配置 SHALL 包含 base image、model、Skills、`AGENTS.md` 内容、MCP 和资源策略。新 Work 的 Skills 与 `AGENTS.md` SHALL 是默认配置的值拷贝，之后全局默认变化不得回写已有 Work。全局配置查询不得暴露 secret 明文，且任何持久配置不得保存宿主路径作为运行时上下文引用。

#### Scenario: Copy defaults at creation
- **WHEN** 全局默认选择 model-a，Skill s-a 和 AGENTS text-a，用户创建 Work A，随后全局默认改为 model-b、Skill s-b 和 AGENTS text-b
- **THEN** Work A 的配置仍引用 model-a、s-a 和 text-a，新建 Work B 才引用新默认值

#### Scenario: Create a configured Work
- **WHEN** 用户选择可用镜像、Skill、模型和 MCP 配置创建 Work
- **THEN** 系统保存完整配置 revision，启动结果可核对实际镜像、Skill、MCP 和模型引用

#### Scenario: Configure one Work
- **WHEN** Work 所有者更新 Work A 的 Agent image、model、Skill、MCP、AGENTS content 或资源策略
- **THEN** 只有 Work A 的 desired configuration revision 改变，并返回 secret 引用和可用性信息而非明文

#### Scenario: Reject host-path context references
- **WHEN** a configuration update attempts to persist an AGENTS host path or a Skill path outside the catalog
- **THEN** the request is rejected and no host path is stored as Work runtime context

#### Scenario: Secret query
- **WHEN** 用户查询包含模型或 MCP secret 引用的 WorkConfig
- **THEN** 系统返回引用和可用性信息，不返回 secret 明文

### Requirement: Version desired and active configuration

**Identifier:** WCFG-002

系统 SHALL 为每个 Work 保存独立的 desired revision 和 active revision。修改必须携带预期版本；`work config apply` 或等价的显式 lifecycle 操作才可将 desired 配置应用到运行实例。修改不得隐式中断当前 Run，active revision 只有在新配置被验证加载后才更新。Skills、`AGENTS.md` 和 base image 的修改 SHALL 遵守同一 desired/active 生命周期。

#### Scenario: Update without implicit restart
- **WHEN** 用户修改运行中 Work 的模型配置
- **THEN** 当前 Run 继续使用旧 active revision，Work 显示 pending restart/apply，系统不自动重启容器

#### Scenario: Update a running Work
- **WHEN** 用户为运行中的 Work 修改 Skills、AGENTS content 或基础镜像
- **THEN** 当前 Run 保持原环境，界面显示待应用版本，重启后报告新 active revision

#### Scenario: Apply a Work revision
- **WHEN** 用户显式应用 Work 的 desired revision
- **THEN** Core 按该 Work 配置准备或重启实例，成功后更新 active revision，失败时保留旧 active revision 并返回可重试错误

#### Scenario: Apply an invalid Skill context
- **WHEN** an apply operation cannot load a selected Skill or validate AGENTS content
- **THEN** the operation fails with the public field and Work identifier, the old active revision remains active, and no partial context is exposed to new Runs

#### Scenario: Concurrent Work edits
- **WHEN** 两个客户端基于同一旧 revision 修改同一 Work
- **THEN** 先成功的修改保留，后者收到 revision conflict 且不覆盖 desired 配置

#### Scenario: Concurrent edits
- **WHEN** 两个客户端基于相同旧版本提交不同配置，先前提交已成功
- **THEN** 后一提交返回版本冲突，不覆盖已保存版本

### Requirement: Resolve reproducible artifacts

**Identifier:** WCFG-003

系统 SHALL 为首次成功准备的配置记录不可变镜像和 Skill 制品身份；同 revision 重启 SHALL 使用已解析身份，即使来源 tag 或分支改变。需要新制品时 SHALL 创建新配置 revision。`AGENTS.md` 内容 SHALL 与其 Work configuration revision 一起版本化并在重启时使用同一内容。

#### Scenario: Mutable tag changes
- **WHEN** Work 停止期间其镜像 tag 指向新镜像，然后使用原配置重新启动
- **THEN** Work 仍使用原 revision 解析的镜像，不静默升级

#### Scenario: Stable Skill and AGENTS revision
- **WHEN** a source Skill catalog entry or default AGENTS content changes after Work A's active revision was prepared
- **THEN** restarting Work A uses its recorded Skill digest and AGENTS content, while a new revision is required to adopt the changed source
