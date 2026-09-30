# Spec Delta

## ADDED Requirements

### Requirement: 将应用内容访问限定为当前 Work 所有者

**Identifier:** WACC-SERVICE-ACCESS-001

Core SHALL 在域名解析、HTTP 请求及 WebSocket Upgrade 时用当前用户会话检查 Work 所有者与当前服务身份。普通非所有者及非所有者管理员 SHALL 不得经该网关读取或写入应用内容；其控制元数据权限不视为应用内容权限。未知域名、跨 Work 请求与非所有者请求 SHALL 返回不可区分的不可见错误。CLI 本地代理不得使用 operator 或 agent 身份回退。已有连接在会话失效、Work 停止或 service 停止/删除后 SHALL 在 2 秒内关闭。

#### Scenario: 管理员不获得应用正文
- **WHEN** 非所有者管理员可以检查、停止某 service，却访问其 HTTP URL
- **THEN** Core 拒绝并不返回应用正文或容器地址

#### Scenario: 伪造其他 Work 域名
- **WHEN** 用户 A 的代理请求用户 B 的 service 域名
- **THEN** 返回与不存在域名相同的不可见结果，不访问 B 的容器

#### Scenario: 登出撤销活动连接
- **WHEN** 用户登出后，其代理仍保持一个 WebSocket 连接
- **THEN** Core 在 2 秒内关闭连接，代理不凭缓存的授权继续发送帧

### Requirement: 隔离平台认证与应用认证

**Identifier:** WACC-SERVICE-ACCESS-002

CLI 与 Core 使用的用户 token SHALL 仅用于 Core 鉴权，不得转发给 service。应用原有 `Authorization`、Cookie 及响应 Cookie SHALL 作为应用流量保持；客户端或应用伪造的网关保留头 SHALL 被剔除。Core 只能连接经当前 service ID 与 Docker labels 核验且位于所属 Work 私网的已声明 TCP 端口，不接受请求带来的原始 IP/URL/网络目标。应用响应中的 HTTP 401/403/404 SHALL 不被当作平台鉴权错误改写。

#### Scenario: 应用使用自己的 Bearer
- **WHEN** 浏览器向应用发送自己的 Authorization Bearer 和 Cookie
- **THEN** 应用收到这些头，但收不到 CLI 登录 token、网关保留头或 operator 凭证

#### Scenario: 应用返回 401
- **WHEN** 应用拒绝其自身登录态并返回 401
- **THEN** 用户收到应用原有 401 与正文，CLI 代理保持运行且不会删除平台登录状态
