# Spec Delta

## Purpose

为远程 CLI 和浏览器控制面板提供独立于模型服务的用户登录身份，明确凭证签发、保存、过期和撤销后的访问行为，使客户端能够安全地开始和结束使用 piwork，而不把连接状态与 Work 生命周期混同。

## ADDED Requirements

### Requirement: Authenticate enabled users

系统 SHALL 只在账号启用且用户凭证正确时签发登录会话，返回用户身份、到期时间和客户端需要的连接信息。无账号、错误密码和禁用账号 SHALL 返回不泄露账号存在性的认证失败。

#### Scenario: Successful CLI login

- **WHEN** 用户通过 TLS 连接使用有效账号密码登录
- **THEN** Client 获得带到期时间的用户会话，并能够访问授权的 Work API

#### Scenario: Invalid credentials

- **WHEN** 请求使用错误密码、不存在账号或禁用账号
- **THEN** 系统不签发会话，返回统一认证失败且不暴露模型凭证状态

### Requirement: Expire and revoke login sessions

登录会话 SHALL 有可配置的绝对有效期，默认 24 小时；到期、注销或撤销后 SHALL 拒绝该会话的新受保护请求并结束其活动观察流。注销 SHALL 只撤销当前会话，账号级撤销遵循 user-administration。

#### Scenario: Logout one of two sessions

- **WHEN** 同一用户在 Client A 注销，而 Client B 的会话仍有效
- **THEN** A 的旧凭证不可再使用，B 的会话继续有效，Work 不被停止

#### Scenario: Session expires during observation

- **WHEN** 一个已认证的 Run 观察连接到达会话绝对到期时间
- **THEN** 观察连接以认证失效结束，重新登录前不能继续观察，Run 自身仍可运行

### Requirement: Protect credential handling

系统 SHALL 通过 TLS 接收远程用户凭证；除登录成功向请求 Client 签发会话凭证外，普通查询、日志和 UI MUST NOT 返回密码、完整会话 token 或模型 secret。CLI 的持久凭证 SHALL 限于当前本机用户读取；浏览器会话 SHALL 使用不可被脚本读取的安全 cookie，并拒绝缺少有效同源防伪证明的状态变更请求。

#### Scenario: Browser request forgery

- **WHEN** 浏览器发送缺少有效防伪证明或来自不允许来源的用户管理请求
- **THEN** 系统拒绝状态变更，即使请求携带登录 cookie

#### Scenario: Credentials are not diagnostics

- **WHEN** 用户查询自身会话信息或管理员读取认证错误日志
- **THEN** 返回身份与错误诊断而不返回可复用 secret 或完整登录 token

### Requirement: Bound failed login attempts

系统 SHALL 对账号键和请求来源执行可配置的失败登录限流，默认每分钟最多 5 次失败，超过后在该窗口内返回限流结果且不签发会话。

#### Scenario: Repeated invalid login

- **WHEN** 同一账号键或来源在一分钟内超过配置的失败阈值
- **THEN** 后续请求返回限流和重试提示，窗口结束后允许重新尝试
