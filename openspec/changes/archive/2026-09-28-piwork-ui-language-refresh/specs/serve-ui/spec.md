# Spec Delta

## MODIFIED Requirements

### Requirement: 仅管理员获得浏览器管理会话

**Identifier:** SUI-002

面板 SHALL 通过 Core 账号密码登录，只有启用的 `admin` 可以获得面板会话。有效普通 `user` 凭证 SHALL 得到说明仅管理员可访问、普通用户应使用 piwork-cli 的英文拒绝提示，面板 SHALL 撤销或丢弃本次取得的 Core token 且不签发面板会话。不存在、禁用或密码错误的账号 SHALL 统一显示认证失败。首次管理员未初始化时 SHALL 以英文提示通过 CLI/env 初始化，不展示 bootstrap 表单。登录失败 SHALL 保留账号输入、清空密码，并显示限流的剩余等待时间。

Core bearer SHALL 仅留在面板服务端，浏览器会话使用随机不透明 ID 的 Secure、HttpOnly、SameSite=Strict、Path=/ Cookie，不设置 Domain。会话有效期 SHALL 不超过 Core 返回的绝对到期时间，不自动滑动续期。页面、脚本存储、URL 和日志 SHALL 不含 Core bearer、密码、operator credential 或模型 secret。面板 SHALL 按账号键和真实连接来源执行每分钟最多 5 次失败的登录限流，并遵守 Core 返回的额外限流。服务端面板会话最多 1,024 个，容量满 SHALL 返回 503 CONSOLE_SESSION_CAPACITY；登录挑战有效期 10 分钟，最多 2,048 个，过量创建 SHALL 返回 429 并优先清理过期挑战，不驱逐有效登录会话。登录和所有状态变更 SHALL 验证配置的 Origin 及与当前会话或登录挑战绑定的 CSRF 证明，验证失败前不得向 Core 发起状态变更。

#### Scenario: 管理员登录
- **WHEN** 已启用管理员提交有效凭证和同源 CSRF 证明
- **THEN** 进入状态页并显示账号，浏览器只收到面板 Cookie 和公开身份，不能从页面或 Web Storage 取得 Core bearer

#### Scenario: 普通用户登录
- **WHEN** 管理员创建的普通用户提交正确凭证
- **THEN** 面板以英文拒绝访问且无管理会话，该账号仍能使用 piwork-cli 登录

#### Scenario: 会话容量已满
- **WHEN** 面板已有 1,024 个有效会话或登录挑战容量耗尽
- **THEN** 拒绝新增对应会话/挑战并显示容量或限流提示，原有效会话不失效，也不泄漏新取得的 Core token

#### Scenario: 伪造管理请求
- **WHEN** 请求带 Cookie 但 Origin 不匹配、缺少 CSRF 或 CSRF 属于其他会话
- **THEN** 返回 403，Core 中用户、配置、Skill 和 package 状态均不变

#### Scenario: 登录失败与限流
- **WHEN** 账号不存在、密码错误、账号禁用，或连续失败触及登录限流
- **THEN** 前三者显示相同认证失败；限流显示可重试时间；密码被清空且不记录到日志

### Requirement: 提供一致的管理员导航和表单状态

**Identifier:** SUI-004

面板 SHALL 在原有 `/`、`/users`、`/runtime`、`/default-work`、`/skills`、`/packages`、`/operations` 路由分别提供 `Status`、`Users`、`Runtime`、`Default Work`、`Skills`、`Packages`、`Find Operation` 导航。未经另行要求，UI 自有文字 SHALL 只使用英文；用户内容、资源名称、技术标识和错误码保持原样。管理页面 SHALL 仅显示当前功能所需的公开数据，所有服务器返回文本 SHALL 按纯文本显示。列表 SHALL 区分加载、空集合、成功和失败；错误 SHALL 提供英文可执行提示及可复制 correlationId（如有）。表单 SHALL 在提交中禁用重复提交，验证失败保留非敏感草稿并定位字段；成功后显示 Core 确认结果并刷新相关数据。

离开有未提交更改的页面或覆盖草稿 SHALL 提示丢弃确认。删除、禁用账号及密码重置 SHALL 有含目标名称与实际影响的英文确认步骤。未知结果的变更 SHALL 提示先查询当前状态；只有显式重试且具备稳定幂等键的包安装/更新可以重放原提交。控件 SHALL 有英文可访问名称、键盘操作及可见焦点；360px 宽屏下表单和主要动作仍可操作，宽表格可横向滚动。未知页面 SHALL 返回 404；不提供任意 URL/路径代理。

#### Scenario: 空列表与加载失败
- **WHEN** 列表尚未完成、返回空集合或请求失败
- **THEN** 分别显示英文加载状态、带创建入口的空态或错误重试入口，失败不能显示为没有数据

#### Scenario: 保存失败保留编辑
- **WHEN** 表单提交被 Core 拒绝
- **THEN** 保留非敏感编辑，显示英文错误并重新启用提交，密码类字段清空，不提前显示成功

#### Scenario: 恶意名称与窄屏操作
- **WHEN** 数据含 HTML 字符，管理员通过键盘或窄屏访问页面
- **THEN** 字符按文本呈现，主要动作可聚焦和执行，不注入脚本或遮挡提交按钮
