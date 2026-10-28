# Spec Delta

## ADDED Requirements

### Requirement: 管理可达性检查具有真实服务契约

**Identifier:** SUI-AVAILABILITY-001

统一管理入口 SHALL 提供实际可调用的同源 `GET /console/api/availability`，并在既有管理员会话和 Host/Origin 校验之后，只读检查当前安装所绑定的 Core。有效管理员请求在 Core 健康接口返回 HTTP 200 时 SHALL 得到 HTTP 200 JSON 响应，且 `reachable` 明确为布尔值 `true`；不得因路由缺失而返回 `NOT_FOUND`。该结果 SHALL 只表示 Core 健康接口可用，不代表 Runtime、Docker、模型或任何 Work 已就绪。

Core 健康读取 SHALL 有界完成；会话已验证后发生的健康读取连接错误、超时或非 HTTP 200 响应 SHALL 返回 HTTP 200 JSON，且 `reachable` 为布尔值 `false`。前置会话验证的真实失效、权限不足及连接失败 SHALL 保留既有分类：匿名或失效会话返回 401，已认证普通用户返回 403，临时验证连接失败不得伪装为成功或导致本地会话被当作已撤销。响应 SHALL 不含 Core bearer、operator 凭据、用户秘密或原始上游错误。

页面 SHALL 保留既有十秒读取截止、有间隔且次数受限的自动恢复及显式只读 Retry。当前身份与视图的检查明确成功后 SHALL 清除对应连接告警；明确不可达或无法确认时 SHALL 提供真实错误及重试。缺失或非布尔值的 `reachable` SHALL 作为无法确认处理，不宣称已连接；可达性读取和重试 MUST NOT 提交管理修改、触发后台准备或改变 Work 生命周期。

#### Scenario: 真实管理员管理页正常加载
- **WHEN** 管理员登录真实 Go 浏览器入口后打开或刷新管理页面，Core 健康接口正常
- **THEN** 页面实际请求的 `/console/api/availability` 返回 HTTP 200 和 `reachable: true`，页面不出现由该检查产生的 `NOT_FOUND` 或连接告警；检查不依赖浏览器拦截来模拟接口成功。

#### Scenario: Core 可达但业务环境尚未就绪
- **WHEN** Core 健康接口正常，但 Runtime 尚未配置、Docker 尚未就绪或没有 Work
- **THEN** 可达性检查仍返回 `reachable: true`，页面分别呈现真实配置和 readiness，不将这些状态报告为 Core 连接失败。

#### Scenario: 健康读取失败后显式恢复
- **WHEN** 管理员会话已验证，随后健康读取连接失败、超时或返回非 HTTP 200，之后 Core 健康读取恢复并由用户点击 Retry
- **THEN** 首次检查有界返回 `reachable: false` 并显示连接恢复入口；新的成功检查清除原连接告警，路由、未提交草稿、焦点和已确认修改保持，且没有新增业务写请求。

#### Scenario: 可达性响应无法验证
- **WHEN** 可达性响应缺少 `reachable` 或其类型不是布尔值
- **THEN** 页面显示状态未确认并允许只读重试，不因收到 HTTP 200 就显示 Core 可用。

#### Scenario: 继续遵守会话和权限边界
- **WHEN** 匿名浏览器、已失效会话或已认证普通用户直接请求该接口
- **THEN** 前两者返回 401，普通用户返回 403；不能通过该接口取得管理内容或恢复已失效身份。

#### Scenario: 会话验证期间 Core 暂时不可达
- **WHEN** 已登录管理员的可达性请求在前置会话验证时遇到临时 Core 连接失败
- **THEN** 返回现有安全的连接错误并允许只读恢复，保留尚未到期的浏览器会话；不把失败表示为成功或已确认注销。

#### Scenario: 外层验证成功但内层验证连接失败
- **WHEN** 同一可达性请求已通过外层身份验证，随后任一内层管理员会话验证遇到临时 Core 连接错误
- **THEN** 返回 502 连接错误，浏览器保持尚未失效的登录状态；只有真实身份失效才返回 401，连接恢复后原会话可以重新完成只读检查。

#### Scenario: 离开后返回同一路由的旧结果
- **WHEN** 可达性读取或其重试等待中，用户通过普通导航或浏览器历史离开后返回相同路由，旧读取随后成功或失败
- **THEN** 旧结果和旧重试定时器不改变新视图的连接反馈、草稿或焦点；新视图通过自身的只读检查收敛，旧成功不能清除新失败，旧失败不能重新显示已被新检查清除的告警。

#### Scenario: 可达性接口收到非读取请求
- **WHEN** 有效管理员对 `/console/api/availability` 发送 GET 以外的方法
- **THEN** 请求按既有 Origin/CSRF 规则接受检查后返回 405，且不向 Core 发起状态变更。
