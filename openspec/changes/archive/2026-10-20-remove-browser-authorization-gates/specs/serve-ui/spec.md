# Spec Delta

## MODIFIED Requirements

### Requirement: 仅管理员获得浏览器管理会话

**Identifier:** SUI-002

统一浏览器入口 SHALL 通过 Core 账号密码登录并按每个浏览器会话绑定独立用户；只有启用 admin 可进入管理区，有效普通 user 登录进入其工作台，直接管理请求返回 403。不得通过共享进程身份、CLI 保存 token 或 operator credential 实现登录。不存在、禁用或密码错误的账号 SHALL 统一显示认证失败。首次管理员未初始化时 SHALL 按 web-onboarding 从普通地址直接展示网页创建入口，不要求设置链接或本机浏览器 Access；成功后仍进入正常登录。登录失败 SHALL 保留账号输入、清空密码，并显示限流的剩余等待时间。

Core bearer SHALL 仅留在面板服务端，浏览器会话使用随机不透明 ID 的 HttpOnly、SameSite=Strict、Path=/ Cookie；HTTPS SHALL 设置 Secure，HTTP 不使用无效的 Secure/__Host-组合；Cookie 不设置 Domain。会话有效期 SHALL 不超过 Core 返回的绝对到期时间，不自动滑动续期。页面、脚本存储、URL 和日志 SHALL 不含 Core bearer、密码、operator credential 或模型 secret。面板 SHALL 按账号键和真实连接来源执行每分钟最多 5 次失败的登录限流，并遵守 Core 返回的额外限流。服务端面板会话最多 1,024 个，容量满 SHALL 返回 503 CONSOLE_SESSION_CAPACITY；登录挑战有效期 10 分钟，最多 2,048 个，过量创建 SHALL 返回 429 并优先清理过期挑战，不驱逐有效登录会话。登录和所有状态变更 SHALL 验证配置的 Origin 及与当前会话或登录挑战绑定的 CSRF 证明，验证失败前不得向 Core 发起状态变更。

#### Scenario: 管理员登录
- **WHEN** 已启用管理员提交有效凭证和同源 CSRF 证明
- **THEN** 进入状态页并显示账号，浏览器只收到面板 Cookie 和公开身份，不能从页面或 Web Storage 取得 Core bearer

#### Scenario: 普通用户登录
- **WHEN** 管理员创建的普通用户提交正确凭证
- **THEN** 统一入口登录进入自己的工作台，不能取得管理数据；该账号仍能使用 piwork-cli 登录

#### Scenario: 会话容量已满
- **WHEN** 面板已有 1,024 个有效会话或登录挑战容量耗尽
- **THEN** 拒绝新增对应会话/挑战并显示容量或限流提示，原有效会话不失效，也不泄漏新取得的 Core token

#### Scenario: 伪造管理请求
- **WHEN** 请求带 Cookie 但 Origin 不匹配、缺少 CSRF 或 CSRF 属于其他会话
- **THEN** 返回 403，Core 中用户、配置、Skill 和 package 状态均不变

#### Scenario: 登录失败与限流
- **WHEN** 账号不存在、密码错误、账号禁用，或连续失败触及登录限流
- **THEN** 前三者显示相同认证失败；限流显示可重试时间；密码被清空且不记录到日志

#### Scenario: 普通地址首次创建
- **WHEN** 浏览器直接打开没有持久用户的服务器 IP
- **THEN** 自动取得普通 CSRF 上下文并可创建首管理员，创建后关闭入口并正常登录；管理区权限不因取消设置证明而开放给未登录或普通用户
