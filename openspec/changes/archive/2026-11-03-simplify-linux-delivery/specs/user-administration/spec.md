## MODIFIED Requirements

### Requirement: Initial administrator bootstrap

系统 SHALL 允许部署者通过 Core 自带网页引导或既有受保护 operator API 在线初始化首个启用管理员；旧 bootstrap 命令和离线命令 SHALL 删除。在线入口只接受 operator credential 或空安装的受保护一次性初始化流程；普通 `piwork-cli` 用户 token 不得调用。已有用户时必须拒绝且不修改任何用户。

#### Scenario: Bootstrap through the control plane

- **WHEN** Core 已监听且用户数据库为空，部署者通过有效 operator API 提供账号和密码
- **THEN** 创建首个管理员并允许其随后使用 `piwork-cli login`

#### Scenario: Bootstrap an empty instance

- **WHEN** 部署者在无用户实例的网页引导中提交合法账号密码及 CSRF
- **THEN** 系统创建一个管理员，该管理员可以通过正常登录入口登录控制面板

#### Scenario: Reject user-client bootstrap

- **WHEN** 普通用户客户端请求首管理员 bootstrap
- **THEN** 请求被拒绝且数据库不发生变化

#### Scenario: Repeat bootstrap

- **WHEN** 已存在用户的实例再次收到初始化请求
- **THEN** 系统拒绝创建或覆盖管理员，现有用户凭证保持不变

## ADDED Requirements

### Requirement: 通过内嵌 UI 和管理 API 管理用户

系统 SHALL 允许管理员通过 Core 内嵌管理 UI 和对应受保护 API 创建、列出、启用、禁用用户和重置凭证。响应不得包含密码或可直接验证密码的材料；这些操作不授予管理员读取其他用户的 Session 或 Run 正文的权限。

#### Scenario: 通过 operator API 管理用户

- **WHEN** 管理员使用有效 operator credential 调用用户管理 API
- **THEN** Core 执行对应变更并返回安全的用户元数据

#### Scenario: Create a normal user

- **WHEN** 管理员在控制面板提交未被使用的账号标识和有效初始凭证
- **THEN** 系统创建普通用户，该用户可以登录并创建自己的 Work

#### Scenario: Duplicate or unauthorized creation

- **WHEN** 管理员重复创建相同账号，或普通用户调用用户创建 API
- **THEN** 系统分别返回冲突或权限拒绝，且不会新增用户

## REMOVED Requirements

### Requirement: Administrator manages users

**Reason**: 本变更删除旧命令、独立交付或非 Linux 路径；旧条款的相关正向场景不再成立，完整替换为“通过内嵌 UI 和管理 API 管理用户”，保留其中有效的业务和权限约束。
**Migration**: 按新条款使用两个 Linux 程序、Core 内嵌 UI 与既有管理 API；不保留旧语法、平台或容器兼容入口。
