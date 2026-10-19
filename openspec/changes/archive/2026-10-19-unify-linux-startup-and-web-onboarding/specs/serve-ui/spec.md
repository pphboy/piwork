## MODIFIED Requirements

### Requirement: 独立启动同机管理面板

**Identifier:** SUI-001

新默认发行的管理界面 SHALL 由统一 Linux 应用提供，与 Core、工作台、引导共享启动和生命周期，不要求独立 piwork-console 命令、手工指定本机 Core 地址或额外管理端口。统一入口 SHALL 支持仅凭服务器 IP 的本机/远程浏览器访问；必做网络验收为通配地址监听后通过局域网或独立客户端网络中的实际 IP 访问，不要求公网实测。公网/受信代理部署可显式提供 HTTPS 与公开 origin，不能把远程浏览器限定为 loopback。

管理页面 SHALL 在 runtime/Docker 不可用时仍能打开，显示真实状态与恢复；不能启动第二个 Core 或读取 CLI 用户 credential store。所有管理操作仍由 Core 校验管理员权限；统一进程停机执行 Core 正常关闭规则，单独关闭管理页不停止 Core 或取消已接受操作。

启动参数、端口、数据目录和 TLS 配置失败 SHALL 有安全诊断及原子清理，帮助不读取状态或连接 Core；相同安装只允许一个 Core 所有者。浏览器凭据/未提交上传不跨进程复用，旧临时授权不得在新进程中成为访问凭据。

#### Scenario: 独立运行两个进程
- **WHEN** 安装者启动统一程序并从另一台电脑打开服务器 IP
- **THEN** 一个程序提供引导、登录、管理和工作台，用户无需启动 Console 或本机代理

#### Scenario: Core 暂时不可达
- **WHEN** Core 已监听而运行环境未就绪
- **THEN** 管理页面可登录、配置和查看状态，不以后台准备阻塞页面

#### Scenario: 浏览器关闭和程序退出
- **WHEN** 用户关闭管理页或显式停止统一程序
- **THEN** 前者不影响运行；后者按 Core 有界关闭流程处理全部受管 Work并保留数据与意图

#### Scenario: 面板崩溃后重启
- **WHEN** 统一程序重启或第二实例争用同一安装
- **THEN** 旧临时会话/上传安全清理且需重新登录，第二所有者拒绝，已接受 Operation 保留

#### Scenario: 拒绝不完整或跨机配置
- **WHEN** 显式监听、公开 origin、TLS 或路径参数非法或冲突
- **THEN** 在开放入口前安全失败并有界清理；默认无需独立 Console 的 TLS/Core 参数，不拒绝合法远程浏览器


### Requirement: 仅管理员获得浏览器管理会话

**Identifier:** SUI-002

统一浏览器入口 SHALL 通过 Core 账号密码登录并按每个浏览器会话绑定独立用户；只有启用 admin 可进入管理区，有效普通 user 登录进入其工作台，直接管理请求返回 403。不得通过共享进程身份、CLI 保存 token 或 operator credential 实现登录。不存在、禁用或密码错误的账号 SHALL 统一显示认证失败。首次管理员未初始化时 SHALL 按 web-onboarding 展示受首次设置授权保护的网页创建入口。登录失败 SHALL 保留账号输入、清空密码，并显示限流的剩余等待时间。

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

### Requirement: 会话失效与注销有明确边界

**Identifier:** SUI-003

每次受保护 API 请求 SHALL 经 Core 验证管理员当前会话。到期、撤销、禁用或权限失效后 SHALL 清除面板会话并返回登录页，停止页面轮询，清空密码和文件引用；不得自动重新提交修改。页面可见时 SHALL 至少每 15 秒检查会话，重新聚焦时立即检查。临时 Core 网络失败 SHALL 显示不可达并保留尚未到期的面板会话以便重试，不能当作密码错误。

注销 SHALL 撤销对应 Core 会话后清除面板会话；Core 已返回会话无效时也可完成本地注销。Core 不可达时 SHALL 显示注销未完成并允许重试，不宣称已撤销。账号级撤销不取消已经接受的 package Operation。面板重启后重新登录 SHALL 能按已有 Operation ID 恢复观察。

#### Scenario: 管理员在另一客户端被禁用
- **WHEN** 已登录管理员被禁用或重置密码后继续请求管理数据
- **THEN** 请求失败，面板退出到登录页，后续写请求不可成功；已接受的 Core 包任务仍保留

#### Scenario: 只注销当前浏览器
- **WHEN** 管理员在两个浏览器登录并在其中一个注销成功
- **THEN** 当前面板及对应 Core 会话失效，另一个浏览器继续可用

#### Scenario: 连接中断后恢复
- **WHEN** Core 暂时不可达但面板会话尚未到期
- **THEN** 显示连接错误和重试，恢复后重新验证身份并加载数据，不隐式重发变更

### Requirement: 提供一致的管理员导航和表单状态

**Identifier:** SUI-004

面板 SHALL 采用用户交付的三个顶层工作区：`Overview`、`User access`、`Work setup`。`Overview` SHALL 使用 `/admin`，运行时配置 SHALL 保留 `/admin/runtime` 并可从 Overview 进入；`User access` SHALL 使用 `/admin/users`；`Work setup` SHALL 将 `/admin/default-work`、`/admin/skills`、`/admin/packages` 分别组织为 `Starting point`、`Skills`、`Packages`。`Find operation` SHALL 保留 `/admin/operations` 和已有 Operation 详情深链接，作为辅助导航，不声称提供全局操作历史。旧管理深链接 SHALL 映射到对应管理前缀；新路由 SHALL 继续支持直接打开、刷新及浏览器前进后退；窄屏 SHALL 通过可操作的导航菜单提供相同入口。

未经另行要求，UI 自有文字 SHALL 只使用英文；用户内容、资源名称、技术标识和错误码保持原样。管理页面 SHALL 仅显示当前功能所需的公开数据，所有服务器返回文本 SHALL 按纯文本显示。列表 SHALL 区分加载、空集合、成功和失败；错误 SHALL 提供英文可执行提示及可复制 correlationId（如有）。表单 SHALL 在提交中禁用重复提交，验证失败保留非敏感草稿并定位字段；成功后显示 Core 确认结果并刷新相关数据。

离开有未提交更改的页面或覆盖草稿 SHALL 提示丢弃确认。删除、禁用账号及密码重置 SHALL 有含目标名称与实际影响的英文确认步骤。未知结果的变更 SHALL 提示先查询当前状态；只有显式重试且具备稳定幂等键的包安装/更新可以重放原提交。控件 SHALL 有英文可访问名称、键盘操作及可见焦点；360px 宽屏下表单和主要动作仍可操作，宽表格可横向滚动。未知页面 SHALL 返回 404；不提供任意 URL/路径代理。

#### Scenario: 空列表与加载失败
- **WHEN** 列表尚未完成、返回空集合或请求失败
- **THEN** 分别显示英文加载状态、带创建入口的空态或错误重试入口，失败不能显示为没有数据

#### Scenario: 保存失败保留编辑
- **WHEN** 表单提交被 Core 拒绝或响应丢失
- **THEN** 保留非敏感草稿、清空密码类字段，并提供英文修正或读回入口；明确拒绝后恢复合法提交，不能把未知结果表示为已保存或自动再次提交

#### Scenario: 恶意名称与窄屏操作
- **WHEN** 数据含 HTML 字符，管理员通过键盘或窄屏访问页面
- **THEN** 字符按文本呈现，主要动作可聚焦和执行，不注入脚本或遮挡提交按钮

#### Scenario: 管理员按任务进入工作区
- **WHEN** 管理员完成登录并打开首页
- **THEN** 显示真实 Core 配置及 readiness，提供运行时配置、用户访问、默认 Work 与能力管理入口，不把未配置运行时表达为认证失败

#### Scenario: 深链接与移动导航
- **WHEN** 管理员直接打开任意既有管理路由、刷新或使用浏览器前进后退
- **THEN** 页面保持对应功能及当前会话检查，窄屏菜单能进入三个工作区和 Operation 查询

#### Scenario: 高风险变更经确认
- **WHEN** 管理员禁用账号、重置密码或移除资源
- **THEN** 确认步骤显示目标及真实影响，取消不发送变更请求
