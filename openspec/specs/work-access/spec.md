# Work Access Specification

## Purpose

建立用户、管理员和 Work 运行身份之间的授权边界，确保工作配置、会话内容、容器服务和持久数据只能由获准主体访问，并让跨 Work、过期运行实例和伪造身份的请求得到一致、可验证的拒绝。

## Requirements

### Requirement: Owner-scoped Work access

系统 SHALL 将 Work 绑定到创建用户；普通用户只能列出、查询、配置、启停、删除和连接自己拥有的 Work。对其他用户的 Work、Session、Run、服务、Operation 和卷的请求 SHALL 返回不可见结果，不能仅依赖 Client 隐藏入口。

#### Scenario: Access another user's Work

- **WHEN** 用户 A 使用用户 B 的 Work 或 Run 标识发起控制、观察或对话请求
- **THEN** 系统拒绝并不返回该资源内容，两个 Work 的状态均不改变

#### Scenario: List owned resources

- **WHEN** 普通用户请求 Work 和留存数据列表
- **THEN** 结果只包含其有权访问的对象，已删除 Work 的留存卷仍按原所有者授权

### Requirement: Separate administration from conversation access

管理员 SHALL 能管理所有 Work 的控制状态、资源与配置，但在不是所有者时 MUST NOT 自动获得会话正文、Run 输出或交互权限。

#### Scenario: Administrator stops another user's Work

- **WHEN** 管理员停止其他用户的 Work
- **THEN** 控制操作被允许且可查询结果，但该权限不允许读取用户会话或发送 agent 消息

### Requirement: Work runtime identity is limited and fenced

daemon 的运行身份 SHALL 绑定 Work 和有效实例代次，只允许报告本实例状态及操作本 Work 服务。系统 MUST NOT 接受通过请求参数覆盖身份归属，MUST NOT 接受旧代次 mutation 或将运行身份用于用户管理。

#### Scenario: Cross-Work service creation

- **WHEN** Work A 的 daemon 使用其身份请求向 Work B 添加服务
- **THEN** 请求被拒绝且 Work B 不产生定义、配额预留或容器

#### Scenario: Replaced daemon sends a late request

- **WHEN** 一个已被替换的 daemon 使用旧代次身份提交服务修改
- **THEN** 系统拒绝该修改，当前服务配置保持不变

### Requirement: Enforce resource and transport isolation

系统 SHALL 在运行时隔离不同 Work 的私有网络和卷；默认拒绝特权容器、宿主网络、Docker socket、任意宿主路径挂载和跨 Work 挂载。daemon 控制与对话入口 SHALL 仅接受受信控制面身份，不允许绕过 Gateway 或使用伪造用户元数据。

#### Scenario: Forbidden mount or runtime privilege

- **WHEN** agent 声明包含其他 Work 卷、宿主 socket 或特权模式的服务
- **THEN** 系统在创建资源前拒绝，并返回可识别的策略错误

#### Scenario: Direct unauthorized daemon access

- **WHEN** 未授权客户端或另一 Work 身份直接调用 daemon，或伪造转发用户标识
- **THEN** daemon 拒绝请求，不执行 Run 或返回会话数据

#### Scenario: Network boundary

- **WHEN** Work A 中的容器尝试访问 Work B 私有服务地址
- **THEN** 请求无法到达 Work B 服务，已授权的模型和 MCP 出站访问仍按策略工作
