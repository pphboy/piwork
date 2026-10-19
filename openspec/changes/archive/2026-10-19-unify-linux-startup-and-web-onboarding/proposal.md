# Proposal

## Why

当前 Piwork 需要分别理解和启动 Core、Console、Desktop，并在启动前提供模型环境变量；这使首次安装和远程使用都需要额外操作。本变更将 Linux 服务端收敛为一个可直接启动的程序和 Docker 入口，通过浏览器完成管理员及 CoreRuntime 配置，并把“仅凭服务器 IP、无需客户端代理或域名配置即可远程使用完整工作台”作为交付目标。

## What Changes

- Linux 上用同一个 Go 二进制承载 Core、Serve 管理界面、Desktop 工作台和首次配置引导，内嵌两套浏览器资源及非敏感发行依赖引用。无参数启动应用，保留显式 operator 子命令；`piwork` 与 `piwork-serve` 指向同一服务端入口。
- **BREAKING**：新版本默认服务端启动不再要求独立 Console、客户端 Desktop、本地 ticket、环境文件或模型环境变量；远程浏览器直接登录服务器工作台。原生 `piwork-cli` 的 Windows/Linux 交付、业务命令、本地 Desktop/proxy 和用户凭证边界保留。
- 空安装提供受一次性设置授权保护的网页首管理员创建；可选 `PIWORK_ADMIN_ACCOUNT`/`PIWORK_ADMIN_PASSWORD` 仍通过同一 bootstrap 事务创建持久管理员，供测试及自动部署使用，重启不覆盖已有账号。
- **BREAKING**：移除服务端模型初始化环境变量及别名。模型连接在页面保存，沿用现有模型管理和 runtime selection API；Agent 镜像引用由服务端随版本内嵌，是发行默认值，不是用户配置项。引导、Runtime 管理页及统一启动参数均不提供手填或高级覆盖，配置保存与后台准备分别反馈。
- 管理区与工作台复用登录入口，浏览器会话、Service 授权、传输及已知操作按用户/会话隔离；管理员仍不能读取他人 Work 内容。
- 完整支持远程 IP 访问的工作台、Chat、Files、配置和 Work 迁移。Service 使用独立入口端口和按浏览器会话/Service 分区的服务端 Cookie jar，保留根路径、HTTP/SSE/WebSocket、响应 Cookie 登录与页面来源隔离，不生成客户端 localhost 地址、不要求 DNS/PAC/hosts 或安装 CLI。首版不透明兼容依赖 document.cookie/Cookie Store 的应用，也不保证脚本自行写入 Cookie 的跨 Service 隔离；该限制明确告知，不阻塞一键启动。
- **BREAKING**：默认 Docker 交付从 Core+CLI 两入口终端流程改为一个统一服务端入口镜像和网页引导；CLI 镜像退为可选高级入口。Linux Docker、受管 Work 卷、同路径 bind、安装归属和正常关闭预算保持。
- 同步双语 README、部署手册、Compose、单机示例、发行清单、官网入口及一致性检查。默认命令不要求环境变量；候选与实际已发布版本继续区分。
- 网络必做验收采用通配地址 `0.0.0.0` 监听后，经局域网或独立客户端网络中的实际非回环 IP 访问；不要求公网实测。默认 Docker run 与可选 Compose 分别完成零业务 env 的网页初始化，ADMIN env 路径独立验证，不能相互替代。

## Capabilities

### New Capabilities

- `web-onboarding`：首次设置授权、网页首管理员创建、模型与 CoreRuntime 引导、可恢复的初始化状态。

### Modified Capabilities

- `native-runtime-distribution`：统一 Linux 服务端二进制、内嵌资源和发行默认值；保留独立原生用户 CLI。
- `core-service-startup`：无参数统一启动、网页 bootstrap、仅管理员 env 初始化、应用存活与运行就绪分离。
- `serve-ui`：管理面板纳入统一应用和浏览器会话，首管理员创建入口及部署来源规则改变。
- `serve-ui-configuration`：引导与 Runtime 管理复用模型/runtime 配置，Agent 镜像只使用同版发行内置值，不提供输入或覆盖入口，保留已有持久模型。
- `desktop-webui`：新增服务端工作台模式，按浏览器身份隔离并复用既有完整功能；本机客户端模式保留。
- `browser-service-access`：增加无需 DNS 的服务器 IP 入口，定义独立来源、服务端响应 Cookie 分区、路径及授权边界，并明确首版脚本 Cookie 限制。
- `docker-delivery`：统一镜像、零必填 env 的默认网页入口、远程验收和对应发布材料。

## Impact

- 入口与后端：`cmd/piwork-serve/`、`cmd/piwork-console/`、`internal/coreoperator/`、`coreapp/`、`consoleapp/`、`cli/user_desktop*`；提取可复用 Handler 和按请求绑定的浏览器身份，不能把三个独立 Entry 放入 goroutine 代替整合。
- 前端与契约：`apps/console-webui/`、`apps/desktop-webui/`、两套嵌入资源、`packages/contracts/`、HTTP DTO 生成与跨语言契约测试。UI 沿用现有组件选型与英文产品文案，不整体重写。
- 交付：`Dockerfile.core`、Docker release 构建、原生打包、素材摘要、Compose/模板、Quick Start/官网同步及验证脚本。配套 Agent/helper 仍独立为 Core 管理的 Linux 镜像。
- 已有 Go 安装通过原数据目录恢复，初始化不重置身份/配置；不迁移旧 TS 数据，不改变 Work history/`.work` 格式、mTLS、配额或模型供应商协议。
- Agent 发行绑定覆盖新建和显式保存的全局 CoreRuntime；仅启动、读配置或升级不重写已有持久配置，已有 Work 继续按自身配置及显式 Update/Apply 语义运行。失败恢复使用实际状态和重试，不要求用户填写镜像名。
- Service 首版采用最小方案：独立端口隔离页面来源，复用 Go 标准 Cookie jar 管理上游响应 Cookie。Chrome/Edge 原型已确认脚本 Cookie 的兼容与隔离限制，所有者已接受将其列为已知限制；不引入 Cookie shim、脚本改写、额外 DNS 或客户端代理。平台凭据、所有者鉴权和服务端 Cookie 分区仍须验证，完整工作台不能缩为首页可达；原型不等于正式网关或远程整体验收。
- 本变更只规划与实现 Linux 服务端；Windows 原生 Core、自动安装 Docker、自更新及公开推送/官网发布不在本次自动执行范围。
