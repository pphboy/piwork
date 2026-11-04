## MODIFIED Requirements

### Requirement: 仅管理员获得浏览器管理会话

**Identifier:** SUI-002

统一浏览器入口 SHALL 通过 Core 账号密码登录并按每个浏览器会话绑定独立用户；只有启用 admin 可进入管理区，有效普通 user 登录进入其工作台，直接管理请求返回 403。不得通过共享进程身份、CLI 保存 token 或 operator credential 实现登录。不存在、禁用或密码错误的账号 SHALL 统一显示认证失败。首次管理员未初始化时 SHALL 按 web-onboarding 从普通地址直接展示网页创建入口，不要求设置链接或本机浏览器 Access；成功后仍进入正常登录。登录失败 SHALL 保留账号输入、清空密码，并显示限流的剩余等待时间。

Core bearer SHALL 仅留在面板服务端，浏览器会话使用随机不透明 ID 的 HttpOnly、SameSite=Strict、Path=/ Cookie；HTTP 模式不设置无效的 Secure/__Host-组合；Cookie 不设置 Domain。会话有效期 SHALL 不超过 Core 返回的绝对到期时间，不自动滑动续期。页面、脚本存储、URL 和日志 SHALL 不含 Core bearer、密码、operator credential 或模型 secret。面板 SHALL 按账号键和真实连接来源执行每分钟最多 5 次失败的登录限流，并遵守 Core 返回的额外限流。服务端面板会话最多 1,024 个，容量满 SHALL 返回 503 CONSOLE_SESSION_CAPACITY；登录挑战有效期 10 分钟，最多 2,048 个，过量创建 SHALL 返回 429 并优先清理过期挑战，不驱逐有效登录会话。登录和所有状态变更 SHALL 验证当前入口已验证的 HTTP origin 及与当前会话或登录挑战绑定的 CSRF 证明，验证失败前不得向 Core 发起状态变更。

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

## ADDED Requirements

### Requirement: 随 Core 启动内嵌 HTTP 管理面板

**Identifier:** SUI-001

新默认发行的管理界面 SHALL 由统一 Linux 应用提供，与 Core、工作台、引导共享启动和生命周期，不要求独立 piwork-console 命令、手工指定本机 Core 地址或额外管理端口。统一入口 SHALL 支持仅凭服务器 IP 的本机/远程浏览器访问；必做网络验收为通配地址监听后通过局域网或独立客户端网络中的实际 IP 访问，不要求公网实测。UI 固定使用 HTTP，网络/来源遵守 core-service-startup；删除独立 Console、TLS 和 public-origin 配置，不能把远程浏览器限定为 loopback。

管理页面 SHALL 在 runtime/Docker 不可用时仍能打开，显示真实状态与恢复；不能启动第二个 Core 或读取 CLI 用户 credential store。所有管理操作仍由 Core 校验管理员权限；统一进程停机执行 Core 正常关闭规则，单独关闭管理页不停止 Core 或取消已接受操作。

三项启动配置、端口和数据目录失败 SHALL 有安全诊断及原子清理，帮助不读取状态或连接 Core；相同安装只允许一个 Core 所有者。浏览器凭据/未提交上传不跨进程复用，旧临时授权不得在新进程中成为访问凭据。

ControlPlane SHALL 使用独立的 HTTP 服务，默认端口 `17891`，管理、引导、工作台、上传/下载、事件流和托管 Service 均从该浏览器入口访问。它的后端 SHALL 通过实际 Core 端口（默认 `17871`）的 HTTP API 操作，不直接调用 Core 业务对象；浏览器不获取 Core bearer、不被重定向到 Core 端口。Core URL 与浏览器已验证 origin SHALL 分开，不能将浏览器 origin 作为内部 Core 目标。

ControlPlane SHALL 在自身可提供页面时响应 liveness，在 Core 不可达时报告非 ready 和安全连接错误。对 Core 的读取和变更保持独立状态，不能因控制面页面可打开就宣称 Work 可用。

#### Scenario: 单进程内嵌管理 UI
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
- **WHEN** UI/Core 端口或数据路径非法/冲突，或传入旧监听、公开 origin、TLS 参数
- **THEN** 在开放入口前安全失败并有界清理；只接受三项运行配置，不拒绝合法远程浏览器

#### Scenario: 浏览器请求只走控制面
- **WHEN** 浏览器完成登录、Admin Quick setup、文件传输、事件观察和 Service 访问
- **THEN** 所有平台请求、iframe、WebSocket 和生成的内容链接都指向 ControlPlane 当前已验证的 HTTP origin；Core 17871 只由后端或原生客户端调用

## REMOVED Requirements

### Requirement: 独立启动同机管理面板

**Reason**: 本变更删除旧命令、独立交付或非 Linux 路径；旧条款的相关正向场景不再成立，完整替换为“随 Core 启动内嵌 HTTP 管理面板”，保留其中有效的业务和权限约束。
**Migration**: 按新条款使用两个 Linux 程序、Core 内嵌 UI 与既有管理 API；不保留旧语法、平台或容器兼容入口。
