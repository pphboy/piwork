# Spec Delta

## MODIFIED Requirements

### Requirement: Bootstrap the first administrator explicitly

Core SHALL 允许空安装通过普通地址直接进入的网页创建、显式 operator bootstrap，或成对可选的 ADMIN 环境变量创建首管理员。网页和 env 的初始化语义遵守 web-onboarding 与 CORE-DOCKER-INIT-001，所有入口 MUST 原子核验持久用户集合为空，不能因为管理员被禁用而重新开放。不得生成默认账号/密码，不覆盖任何已有身份。

原 operator 在线/离线 bootstrap 的凭证、数据目录锁和未知结果不回退规则 SHALL 保留。网页创建不要求安装者证明或 operator credential；创建成功后仍须正常登录才取得管理员会话或 Work 操作权限。普通会话、来源与 CSRF 校验遵守 web-onboarding。

#### Scenario: 网页创建空安装管理员
- **WHEN** 安装者从服务器普通地址提交合法账号密码及普通 CSRF 上下文
- **THEN** 原子创建持久首管理员并关闭首次创建入口，不需要停启 Core

#### Scenario: Operator 离线或在线初始化
- **WHEN** 有权限操作者按原契约执行 admin bootstrap
- **THEN** 原目录锁、凭证及退出语义保持，不输出密码或摘要

#### Scenario: 重复及并发 bootstrap
- **WHEN** 已有用户时再次调用任一入口，或多个入口并发初始化
- **THEN** 已有身份不变，并发最多一个创建成功，其余返回安全冲突

#### Scenario: Bootstrap an empty installation

- **WHEN** 操作者使用 `piwork-serve admin bootstrap --data-dir <path>` 提供账号和密码
- **THEN** Core 创建首个管理员且不输出密码或摘要

#### Scenario: Bootstrap an empty installation online

- **WHEN** Core 已由 `piwork-serve serve` 监听且操作者通过 operator credential 调用 `piwork-serve admin bootstrap`
- **THEN** Core 创建首个管理员并更新 readiness，不需要停止或重启 Core

#### Scenario: Refuse repeated bootstrap

- **WHEN** 管理员已经存在时调用任一 bootstrap 入口
- **THEN** 请求失败且现有身份数据不变

#### Scenario: Refuse repeated bootstrap (offline command)

- **WHEN** an operator invokes bootstrap after an administrator already exists
- **THEN** Core exits nonzero with a concise diagnostic and leaves the existing identity data unchanged
