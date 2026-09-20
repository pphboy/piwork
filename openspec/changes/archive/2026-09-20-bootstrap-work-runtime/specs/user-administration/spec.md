# Spec Delta

## Purpose

提供 piwork 实例从首次管理员初始化到日常用户管理的可验证行为，使部署者能够建立管理身份，并由管理员在控制面板中创建、禁用和恢复用户访问，避免把模型凭证或 Work 运行身份当作用户管理权限。

## ADDED Requirements

### Requirement: Initial administrator bootstrap

系统 SHALL 提供仅部署主机可调用的首次管理员初始化入口，接收显式账号与密码，在没有用户的实例中创建首个启用的管理员；系统 MUST NOT 提供默认公共密码或未认证远程初始化入口。

#### Scenario: Bootstrap an empty instance

- **WHEN** 部署者在无用户实例上运行本机初始化并提供有效凭证
- **THEN** 系统创建一个管理员，该管理员可以通过正常登录入口登录控制面板

#### Scenario: Repeat bootstrap

- **WHEN** 已存在用户的实例再次收到初始化请求
- **THEN** 系统拒绝创建或覆盖管理员，现有用户凭证保持不变

### Requirement: Administrator manages users

系统 SHALL 允许启用的管理员通过控制面板及受保护 API 创建、列出、启用、禁用用户和重置用户凭证；普通用户 MUST NOT 执行这些操作。账号标识 SHALL 唯一，列表和操作响应 MUST NOT 返回密码或可直接使用的密码验证材料。

#### Scenario: Create a normal user

- **WHEN** 管理员在控制面板提交未被使用的账号标识和有效初始凭证
- **THEN** 系统创建普通用户，该用户可以登录并创建自己的 Work

#### Scenario: Duplicate or unauthorized creation

- **WHEN** 管理员重复创建相同账号，或普通用户调用用户创建 API
- **THEN** 系统分别返回冲突或权限拒绝，且不会新增用户

### Requirement: Disabling and resetting revoke access

系统 SHALL 在禁用用户或重置其密码时撤销该用户全部登录会话，并关闭其已认证客户端观察连接；已经接受的 Run 和 Work 服务 SHALL 继续遵循 work-lifecycle，除非管理员显式停止 Work。重新启用用户 MUST NOT 恢复旧会话。

#### Scenario: Disable a connected user

- **WHEN** 管理员禁用拥有一个活动 Run 的用户
- **THEN** 该用户的新请求被拒绝且观察流关闭，Run 不因用户禁用而自动取消

#### Scenario: Reset password and re-enable

- **WHEN** 管理员重置密码并启用用户
- **THEN** 用户只能通过新密码获得新登录会话，旧 token 和旧密码不能恢复访问

### Requirement: Preserve an enabled administrator

系统 SHALL 拒绝会使启用管理员数量变为零的用户管理操作，并报告明确原因。

#### Scenario: Disable the last administrator

- **WHEN** 仅有一个启用管理员且收到禁用该账号的请求
- **THEN** 操作被拒绝，管理员仍然启用
