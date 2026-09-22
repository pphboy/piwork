# Spec Delta

## MODIFIED Requirements

### Requirement: Work runtime identity is limited and fenced

**Identifier:** WACC-SERVICE-001

daemon 的运行身份 SHALL 绑定 Work 和有效实例代次，只允许报告本实例状态及操作本 Work 服务。系统 MUST NOT 接受通过请求参数覆盖身份归属，MUST NOT 接受旧代次 mutation 或将运行身份用于用户管理。

Core service gRPC SHALL authenticate a cryptographic agent-client identity bound to installation, Work, generation, and instance, and validate that instance is currently authorized on each call. Agent identity MUST NOT be converted into an unrestricted owner/admin credential. Request fields cannot select another Work or a raw Docker target. Service lookups SHALL verify both Work ownership and application-service resource kind; the caller cannot stop, restart, update, or delete agentd itself. Failed, superseded, initialization-only and draining instances MUST NOT submit service mutations. Replacement credentials SHALL invalidate the old instance, even when certificates have not expired.

#### Scenario: Cross-Work service creation

- **WHEN** Work A 的 daemon 使用其身份请求向 Work B 添加服务
- **THEN** 请求被拒绝且 Work B 不产生定义、配额预留或容器

#### Scenario: Replaced daemon sends a late request

- **WHEN** 一个已被替换的 daemon 使用旧代次身份提交服务修改
- **THEN** 系统拒绝该修改，当前服务配置保持不变

#### Scenario: Refuse daemon self-management
- **WHEN** a valid agent passes its own container ID or agentd identity to a service operation
- **THEN** Core returns NOT_FOUND or INVALID_ARGUMENT without invoking Docker

#### Scenario: Reject unauthenticated sibling
- **WHEN** an application container reaches the control listener without an agent-client credential
- **THEN** the transport rejects it before any service data or mutation is returned

#### Scenario: Reject forged ownership metadata
- **WHEN** a valid certificate for Work A is accompanied by metadata claiming Work B or a newer generation
- **THEN** Core rejects the mismatch and changes neither Work

#### Scenario: Initialization cannot deploy
- **WHEN** a candidate daemon is validating a pending Work context
- **THEN** local MCP discovery can complete but Core rejects its lifecycle mutations until activation

## ADDED Requirements

### Requirement: Authorize service content independently of control metadata

**Identifier:** WACC-SERVICE-002

The Work owner and current authorized Work agent SHALL be able to read bounded application logs for that Work service. A non-owner administrator SHALL retain service control and safe diagnostic access but MUST NOT gain application-log content access merely through administrative role. Cross-Work service and Operation IDs SHALL be indistinguishable from absent IDs. Daemon credentials, model secrets, database files and Session history SHALL NOT be mounted into application services.

#### Scenario: Read own application logs
- **WHEN** the valid Work agent requests logs from its own application service
- **THEN** Core returns the bounded content result without extending its authority to another resource

#### Scenario: Admin can repair without content access
- **WHEN** a non-owner admin inspects or stops a service and then requests its application log content
- **THEN** control and safe diagnostics are permitted while log content is denied
