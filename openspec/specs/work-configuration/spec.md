# Work Configuration Specification

## Purpose

定义用户如何为每个 Work 选择和更新可重现的运行环境，使基础镜像、Skills、MCP、模型引用及资源策略有明确版本，并让用户区分保存的期望配置、当前实际配置以及无法生效的具体原因。

## Requirements

### Requirement: Select a complete Work environment

系统 SHALL 维护全局默认运行时配置和每个 Work 的独立配置。创建 Work 时，系统 SHALL 将当时的全局默认解析为 Work 的 desired configuration；Work 所有者之后可以读取和更新自己的配置。全局配置查询不得暴露 secret 明文。

#### Scenario: Copy defaults at creation

- **WHEN** 全局默认选择 model-a，用户创建 Work A，随后全局默认改为 model-b
- **THEN** Work A 的配置仍引用 model-a，新建 Work B 才引用 model-b

#### Scenario: Create a configured Work

- **WHEN** 用户选择可用镜像、Skill、模型和 MCP 配置创建 Work
- **THEN** 系统保存完整配置 revision，启动结果可核对实际镜像、Skill、MCP 和模型引用

#### Scenario: Configure one Work

- **WHEN** Work 所有者更新 Work A 的 Agent image、model、Skill、MCP 或资源策略
- **THEN** 只有 Work A 的 desired configuration revision 改变，并返回 secret 引用和可用性信息而非明文

#### Scenario: Secret query

- **WHEN** 用户查询包含模型或 MCP secret 引用的 WorkConfig
- **THEN** 系统返回引用和可用性信息，不返回 secret 明文
### Requirement: Validate environment compatibility

系统 SHALL 验证配置结构、引用权限、agent 镜像兼容性和工具运行条件，并将异步准备失败关联到配置字段及 Operation。无法解析的镜像、缺失模型配置或不兼容入口 MUST NOT 被报告为可用 Work。

#### Scenario: Invalid reference before acceptance

- **WHEN** 创建请求引用不存在或无权使用的模型／Skill
- **THEN** 请求被拒绝并指出无效字段，不创建可运行实例

#### Scenario: Image fails during preparation

- **WHEN** 接受的配置在拉取镜像或启动兼容入口时失败
- **THEN** Work 和配置保留，Operation 提供失败原因，用户可以修正或重试
### Requirement: Version desired and active configuration

系统 SHALL 为每个 Work 保存独立的 desired revision 和 active revision。修改必须携带预期版本；`work config apply` 或等价的显式 lifecycle 操作才可将 desired 配置应用到运行实例。修改不得隐式中断当前 Run，active revision 只有在新配置被验证加载后才更新。

#### Scenario: Update without implicit restart

- **WHEN** 用户修改运行中 Work 的模型配置
- **THEN** 当前 Run 继续使用旧 active revision，Work 显示 pending restart/apply，系统不自动重启容器

#### Scenario: Update a running Work

- **WHEN** 用户为运行中的 Work 修改 Skills 或基础镜像
- **THEN** 当前 Run 保持原环境，界面显示待应用版本，重启后报告新 active revision

#### Scenario: Apply a Work revision

- **WHEN** 用户显式应用 Work 的 desired revision
- **THEN** Core 按该 Work 配置准备或重启实例，成功后更新 active revision，失败时保留旧 active revision 并返回可重试错误

#### Scenario: Concurrent Work edits

- **WHEN** 两个客户端基于同一旧 revision 修改同一 Work
- **THEN** 先成功的修改保留，后者收到 revision conflict 且不覆盖 desired 配置

#### Scenario: Concurrent edits

- **WHEN** 两个客户端基于相同旧版本提交不同配置，先前提交已成功
- **THEN** 后一提交返回版本冲突，不覆盖已保存版本
### Requirement: Resolve reproducible artifacts

系统 SHALL 为首次成功准备的配置记录不可变镜像和 Skill 制品身份；同 revision 重启 SHALL 使用已解析身份，即使来源 tag 或分支改变。需要新制品时 SHALL 创建新配置 revision。

#### Scenario: Mutable tag changes

- **WHEN** Work 停止期间其镜像 tag 指向新镜像，然后使用原配置重新启动
- **THEN** Work 仍使用原 revision 解析的镜像，不静默升级
### Requirement: Expose and enforce supported resource policy

系统 SHALL 查询可支持的资源限制与有效策略，并拒绝无法实际执行的强制限制。第一版 SHALL 执行服务数量、CPU 和内存预算；未支持硬存储字节限制的后端 SHALL 返回 UNSUPPORTED_LIMIT，而不能仅保存一个无效数值。

#### Scenario: Unsupported storage limit

- **WHEN** 用户在不支持硬存储限额的后端请求强制 storage_bytes
- **THEN** 配置被明确拒绝，现有有效配置保持不变
