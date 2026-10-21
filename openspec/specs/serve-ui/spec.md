# Serve UI Specification

## Purpose

提供独立于 Core daemon 的浏览器管理入口，定义同机部署、管理员会话、导航和公共交互行为，使远程管理员能够通过安全连接使用管理能力，并在连接中断、会话失效或面板重启时获得明确结果。

## Requirements

### Requirement: 独立启动同机管理面板

**Identifier:** SUI-001

新默认发行的管理界面 SHALL 由统一 Linux 应用提供，与 Core、工作台、引导共享启动和生命周期，不要求独立 piwork-console 命令、手工指定本机 Core 地址或额外管理端口。统一入口 SHALL 支持仅凭服务器 IP 的本机/远程浏览器访问；必做网络验收为通配地址监听后通过局域网或独立客户端网络中的实际 IP 访问，不要求公网实测。公网/受信代理部署可显式提供 HTTPS 与公开 origin，不能把远程浏览器限定为 loopback。

管理页面 SHALL 在 runtime/Docker 不可用时仍能打开，显示真实状态与恢复；不能启动第二个 Core 或读取 CLI 用户 credential store。所有管理操作仍由 Core 校验管理员权限；统一进程停机执行 Core 正常关闭规则，单独关闭管理页不停止 Core 或取消已接受操作。

启动参数、端口、数据目录和 TLS 配置失败 SHALL 有安全诊断及原子清理，帮助不读取状态或连接 Core；相同安装只允许一个 Core 所有者。浏览器凭据/未提交上传不跨进程复用，旧临时授权不得在新进程中成为访问凭据。

ControlPlane SHALL 使用独立的 `17891` HTTP 服务，管理、引导、工作台、上传/下载、事件流和托管 Service 均从该浏览器入口访问。它的后端 SHALL 通过 Core `17871` 的 HTTP API 操作，不直接调用 Core 业务对象；浏览器不获取 Core bearer、不被重定向到 Core 端口。Core URL 与浏览器 public origin SHALL 分开，不能将浏览器 origin 作为内部 Core 目标。

ControlPlane SHALL 在自身可提供页面时响应 liveness，在 Core 不可达时报告非 ready 和安全连接错误。对 Core 的读取和变更保持独立状态，不能因控制面页面可打开就宣称 Work 可用。

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

#### Scenario: 浏览器请求只走控制面
- **WHEN** 浏览器完成登录、Admin Quick setup、文件传输、事件观察和 Service 访问
- **THEN** 所有平台请求、iframe、WebSocket 和生成的内容链接都指向 ControlPlane 的配置 origin；Core 17871 只由后端或原生客户端调用

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

管理页面 SHALL 区分首次无数据、同页显式刷新和正常后台回读。首次使用稳定外壳和 UIL-PENDING-001 等待槽；当前身份已有已确认内容时，同页刷新 SHALL 保留正文及最后取得时间，不用整页 skeleton 或清空表单取代。页级读取 SHALL 协调同对象显式/后台请求，不让每个卡片另起刷新；状态局部更新保留输入草稿、安全内存中的 Key、焦点/选区、展开和滚动，身份失效与原提交敏感清理规则仍优先。新读失败保留并标明最后确认数据；晚响应不得替换新路由或编辑，修改确认与关联刷新仍遵守 SUI-006。

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

#### Scenario: 同页刷新和轮询保持上下文
- **WHEN** 管理员编辑Runtime/Default Work/模型或展开详情，显式刷新或后台健康读取随后返回
- **THEN** 正文及交互节点保持，不整页闪白或重置选择；只更新有效状态，未保存草稿、焦点、展开和滚动保持，旧数据与新确认可区分

### Requirement: 管理员手动动作与文件预检有明确等待反馈

**Identifier:** SUI-005

Serve SHALL 沿用 UIL-008/009 及 UIL-PENDING-001，在有效异步动作开始后的首个可绘制机会、结果返回前，在原对象/表单显示英文动作和等待状态，提供可访问的状态说明及 busy 语义；只禁用按钮不构成反馈。手动 Refresh status、Verify runtime、Retry connection、Refresh/Resume Operation、Read current runtime/defaults 和 Sign out SHALL 均覆盖，重复入口只能有一个在途请求。不同对象的合法导航和操作保持可用，读操作不得与后台轮询叠加成并行查询同一对象。

选择 Skill 目录、Package 目录/ZIP、AGENTS 文件后，浏览器本地读取/预检 SHALL 显示 Checking selected files，未完成不能提交本次未确认选择；取消选择保持原输入，预检失败保留旧选择，替换/关闭后的晚结果不能恢复旧文件。已有登录、保存、上传和 Package Operation 反馈 SHALL 保持真实；上传、验证、接受、后台准备与发布分别表达。

检查成功即使值未改变 SHALL 有新的确认时间或简短已确认说明。十秒以上未取得响应显示仍在等待及已等待时间，不虚构超时失败。明确失败、结果未知、旧缓存和成功空数据 SHALL 区分；错误不得使用成功措辞/图标。身份/路由变更后旧请求不覆盖当前页面，密码/key 处理仍遵守既有规则。快速动作不人为延迟，普通导航和复制不要求额外 toast。

请求的成功、失败及最终清理回调 SHALL 均受发起时的身份与视图归属约束；离开后返回同一路由也属于新的视图。旧请求不得清理新页面的敏感输入、改变新草稿或释放新动作的提交锁。

统一等待 SHALL 覆盖首次引导读取/创建/登录、Quick setup保存与显式Test、准备观察，以及所有Admin/独立Console列表和详情、模型目录回读、模型添加/保存/启用/停用/删除/设为默认、Runtime/Defaults、用户/Skill/Package动作、Operation与About。独立表单或动作状态不能因未使用通用动作组件而缺失；三点 SHALL 附着实际发起的按钮或对象，启停模型不能仅让无关的Save按钮呈保存中。读取失败、明确结果和未知结果仍按原契约处理。

#### Scenario: 手动检查等待与重复点击
- **WHEN** 用户点击 Verify runtime、Refresh status、Read current configuration 或 Refresh Operation，响应被延迟并再次触发同一入口
- **THEN** 原区域已显示 Checking/Reading，只有一个对应请求；返回相同内容仍可确认本次检查完成，后台轮询不使等待提示提前消失

#### Scenario: 本地大文件预检
- **WHEN** 用户选择 Package ZIP 或较大目录，本地校验尚未结束
- **THEN** 原表单显示文件目标与预检中，不能提交未确认的新选择；失败、换源或关闭后不恢复晚到的旧选择

#### Scenario: 注销与身份失效
- **WHEN** 注销响应缓慢或 Core 暂时不可达
- **THEN** 显示 Signing out，重复注销受限，随后按 SUI-003 区分已撤销与未完成，旧账号的晚结果不覆盖新登录页

#### Scenario: 独立模型操作有准确等待对象
- **WHEN** 管理员点击Read current data或Enable/Disable/Delete/Use for future Work且响应延迟
- **THEN** 实际操作处显示Reading或相应状态和三点，重复入口受限；不会只把Save按钮改成Saving，也不隐藏未知结果读回要求

#### Scenario: 同页刷新保留导航展开语义
- **WHEN** 管理员展开账户菜单或窄屏导航，当前身份与路由的后台状态读取返回
- **THEN** SHALL 保持菜单节点、焦点和展开，触发器 aria-expanded 与实际状态一致；离开或身份变化时关闭，不把旧菜单带入新视图

### Requirement: 已确认管理修改与关联刷新独立呈现

**Identifier:** SUI-006

Serve SHALL 在收到可靠的账号创建、启用/禁用、密码重置、Skill 添加/更新、Skill/Package 启用/禁用/移除、Runtime/Defaults 保存确认后，立即保存并显示目标与已确认结果。后续 Users、catalog、defaults、readiness 查询 SHALL 单独显示 Refreshing 和取得时间，不能阻塞成功反馈、撤销原确认或重新执行修改。

刷新失败 SHALL 显示“修改已确认；当前列表/状态未确认”及对应只读 Retry refresh，保留安全的旧数据并标记为最后已知。反馈 SHALL 位于仍存在的页面/结果容器，不能只写入已关闭弹层。更新自身凭据/状态导致撤销仍按 SUI-USR-002 返回登录，不能被普通刷新成功覆盖。响应未知继续使用既有只读核对或稳定 package key 恢复，不能据此显示确定成功。

Runtime 保存后的 API Key 清理 SHALL 仅作用于该次提交的原输入上下文。用户离开 Runtime 后重新进入并输入的新 Key 与非敏感草稿不得被旧保存请求或后续 readiness 查询的晚回调清空；原提交 Key 仍按既有敏感输入规则清理，不从后端回填，不进入动作状态、日志或验收截图。

#### Scenario: 创建用户成功但刷新缓慢
- **WHEN** Core 已返回新用户，随后用户列表查询被延迟
- **THEN** 创建结果及普通用户/管理员入口已可见，密码清空，列表显示刷新中，不要求再次创建

#### Scenario: 目录修改成功但刷新失败
- **WHEN** Skill 上传或 Skill/Package 状态修改已确认，随后 catalog/defaults 查询失败
- **THEN** 显示原成功和刷新失败，提供只读恢复；不访问已移除弹层、不抛出因其缺失而产生的异常、不再次上传或修改

#### Scenario: 保存结果与 readiness
- **WHEN** Runtime 保存成功后 readiness 查询失败，或 Defaults 保存后的辅助查询失败
- **THEN** 保留保存成功，readiness/辅助信息单独未确认，非敏感新草稿保留，key 不被回填或记录

#### Scenario: Runtime 旧保存不清理重新进入后的输入
- **WHEN** Runtime 保存请求被延迟，用户按脏草稿规则离开页面，再返回编辑并输入新 Key 与新草稿，旧保存或其 readiness 回调随后完成或失败
- **THEN** 新 Key 与新非敏感草稿保持不变，新动作的锁不被旧回调释放；旧反馈不替换新视图，原提交 Key 仍遵守敏感清理规则且不回填、不记录

### Requirement: 控制面不暴露通用 Core 代理

**Identifier:** SUI-BOUNDARY-001

ControlPlane SHALL 只公开其页面、明确的浏览器适配 API、受保护内容入口及健康状态；不能把 `/api/v1/*`、`/control/*` 原样通配转发给 Core。用户、管理员和 operator API 的身份语义由 Core 保留，原生客户端直接使用 Core。浏览器会话凭据、初始化委托和请求内容不得通过任意 URL/Host 参数转发到其他目标。

#### Scenario: 在 UI 端口调用原生接口
- **WHEN** 调用者向 ControlPlane 17891 请求原始 Core 的 /control/runtime 或 /api/v1/works
- **THEN** 请求不被作为通用 Core 代理执行，也不回退到登录成功后的任意转发；现有显式浏览器适配接口继续可用

#### Scenario: Core 请求不能指定任意上游
- **WHEN** 请求伪造 Host、Forwarded 或 URL 参数指向另一个服务器
- **THEN** 后端 Core 连接仍绑定配置的实际 Core，不向伪造目标发送用户或初始化凭据
