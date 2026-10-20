# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: 控制面不暴露通用 Core 代理

**Identifier:** SUI-BOUNDARY-001

ControlPlane SHALL 只公开其页面、明确的浏览器适配 API、受保护内容入口及健康状态；不能把 `/api/v1/*`、`/control/*` 原样通配转发给 Core。用户、管理员和 operator API 的身份语义由 Core 保留，原生客户端直接使用 Core。浏览器会话凭据、初始化委托和请求内容不得通过任意 URL/Host 参数转发到其他目标。

#### Scenario: 在 UI 端口调用原生接口
- **WHEN** 调用者向 ControlPlane 17891 请求原始 Core 的 /control/runtime 或 /api/v1/works
- **THEN** 请求不被作为通用 Core 代理执行，也不回退到登录成功后的任意转发；现有显式浏览器适配接口继续可用

#### Scenario: Core 请求不能指定任意上游
- **WHEN** 请求伪造 Host、Forwarded 或 URL 参数指向另一个服务器
- **THEN** 后端 Core 连接仍绑定配置的实际 Core，不向伪造目标发送用户或初始化凭据
