# Spec Delta

## MODIFIED Requirements

### Requirement: Initial administrator bootstrap

系统 SHALL 允许部署者通过 `piwork-serve admin bootstrap` 在线初始化首个启用管理员，也 SHALL 保留本机离线 bootstrap 入口。在线入口只接受 operator credential 或空安装的受保护一次性初始化流程；普通 `piwork-cli` 用户 token 不得调用。已有用户时必须拒绝且不修改任何用户。

#### Scenario: Bootstrap through the control plane

- **WHEN** Core 已监听且用户数据库为空，部署者通过 `piwork-serve admin bootstrap` 提供账号和密码
- **THEN** 创建首个管理员并允许其随后使用 `piwork-cli login`

#### Scenario: Bootstrap an empty instance

- **WHEN** 部署者在无用户实例上运行本机初始化并提供有效凭证
- **THEN** 系统创建一个管理员，该管理员可以通过正常登录入口登录控制面板

#### Scenario: Reject user-client bootstrap

- **WHEN** 普通用户客户端请求首管理员 bootstrap
- **THEN** 请求被拒绝且数据库不发生变化

#### Scenario: Repeat bootstrap

- **WHEN** 已存在用户的实例再次收到初始化请求
- **THEN** 系统拒绝创建或覆盖管理员，现有用户凭证保持不变

### Requirement: Administrator manages users

系统 SHALL 允许管理员通过 `piwork-serve admin users` 及对应受保护 API 创建、列出、启用、禁用用户和重置凭证。响应不得包含密码或可直接验证密码的材料；这些操作不授予管理员读取其他用户的 Session 或 Run 正文的权限。

#### Scenario: Manage users through the operator CLI

- **WHEN** 管理员使用有效 operator credential 执行用户管理命令
- **THEN** Core 执行对应变更并返回安全的用户元数据

#### Scenario: Create a normal user

- **WHEN** 管理员在控制面板提交未被使用的账号标识和有效初始凭证
- **THEN** 系统创建普通用户，该用户可以登录并创建自己的 Work

#### Scenario: Duplicate or unauthorized creation

- **WHEN** 管理员重复创建相同账号，或普通用户调用用户创建 API
- **THEN** 系统分别返回冲突或权限拒绝，且不会新增用户
