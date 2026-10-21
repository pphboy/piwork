# Spec Delta

## MODIFIED Requirements

### Requirement: 以独立原生程序交付平台入口

**Identifier:** NATIVE-001

系统 SHALL 为 Linux 交付同一个 Go 服务端程序，通过 `piwork` 或 `piwork-serve` 名称运行，内含 Core、管理页面、工作台和首次引导；无参数或 serve 启动完整应用。默认发行不得要求分别安装/启动 Console 或客户端 Desktop；保留显式 operator 子命令及其身份边界，用户 login/chat 仍属于 piwork-cli。新入口默认监听允许远程浏览器访问，具体状态与初始化遵守 core-service-startup 和 web-onboarding。

系统 SHALL 按 cli-runtime-portability 继续为 Windows/Linux 交付完整原生 piwork-cli；其本机 Desktop、proxy、凭证、输出/退出契约保持。统一服务端的 Windows 原生 Core 不属于本次平台支持，浏览器所在操作系统不决定 Core 平台。

正常运行 SHALL 不依赖宿主 Node、npm、Python、Go、Docker CLI 或 openssl；系统 CA、可写私有数据目录、网络及 Linux 本机 Docker Engine 属于设施。浏览器打开器可选，不可用时 SHALL 输出可手动访问的 URL并保持服务运行。

同一个统一进程 SHALL 启动 ControlPlane 17891 与 Core 17871 两个独立 HTTP 服务。浏览器使用 ControlPlane；原生 CLI/operator 和 ControlPlane 后端调用 Core。Core 是独立业务领域，不因合并交付而变成只可由 UI 对象调用的内部模块。默认监听、可选远程 Core、启动清理与关闭遵守 core-service-startup。

#### Scenario: 在无解释器宿主上完成初始化
- **WHEN** Linux 安装者仅取得服务端程序和必要设施，从无源码目录运行
- **THEN** 一次启动即可打开本机或远程网页并完成管理员/runtime 引导，没有三个宿主服务进程或运行时前端构建

#### Scenario: Windows 用户只访问服务器
- **WHEN** Windows 浏览器或已有 piwork-cli 连接 Linux 统一服务端
- **THEN** 浏览器无需安装 CLI/Docker 即可使用完整托管工作台，CLI 保留自己的既有能力，不宣称 Windows Core 已支持

#### Scenario: 保留命令身份边界
- **WHEN** 执行 piwork-cli login、piwork-serve status 或 piwork chat
- **THEN** 前两者使用用户/operator 契约，最后一个仍拒绝为错误入口，不因网页整合读取客户端凭证

#### Scenario: 仅安装用户 CLI
- **WHEN** 用户机器没有 Docker 或开发工具链，运行 CLI 连接已配置的 Core
- **THEN** 用户能够登录、管理自己的 Work、观察对话并启动 proxy 或 desktop

### Requirement: 随原生程序提供既有浏览器界面

**Identifier:** NATIVE-003

统一服务端 SHALL 内嵌管理界面、工作台、引导及其全部资源，并携带同版非敏感 Agent/helper 默认引用；Agent 引用 SHALL 与本二进制的发行元数据绑定，是程序默认值，不依赖用户手填、镜像选择或高级覆盖。从任意工作目录运行不要求旁置 WebUI、发行配置文件或源码。复用页面 SHALL 满足既有 desktop-ui-language/ui-language、任务反馈与组件选型约束，不以整合为由裁减 Work、Chat、Files、Service、配置、包和迁移能力。

托管页面 SHALL 按浏览器会话隔离用户，托管 Service 的同源路径入口、可信应用边界、服务端响应 Cookie 分区及脚本 Cookie 限制遵守 browser-service-access；完整工作台不代表独立 origin 隔离或任意根路径网页的透明兼容。管理区和工作台共用应用入口，页面关闭不影响 Core。独立 piwork-cli desktop SHALL 继续内嵌自己的资源，普通地址自动建立浏览器会话，按共享 CLI 凭据或正常账号登录继续；遵守 desktop-webui 取消 Access 门禁后的初始化、注销和恢复契约，Service origin 隔离及连接恢复保持。平台凭据不得交给页面或 Service。

#### Scenario: 从任意工作目录打开 Desktop
- **WHEN** 在无源码/静态目录的位置启动统一程序
- **THEN** 登录、管理、引导和工作台资源全部可加载，无需独立 Console 或前端开发服务器

#### Scenario: Agent 默认值随发行交付
- **WHEN** 原生二进制或统一 Docker 镜像从空安装创建 CoreRuntime
- **THEN** 保存后的 Agent 引用与该制品内嵌的同版发行元数据一致；无旁置引用文件、Agent 启动覆盖参数或网页镜像输入步骤

#### Scenario: CLI 本机模式继续可用
- **WHEN** 用户从任意目录运行原生 piwork-cli desktop
- **THEN** 本机普通地址可直接登录/复用有效共享凭据，资源及已配置 Core 的 Work/Service/Files/Chat/Settings 继续可用，恢复不要求启动授权链接

#### Scenario: Console 独立退出
- **WHEN** 管理员关闭浏览器管理页面
- **THEN** Core、Work 和已接受 Operation 继续，只有显式停止统一进程才执行 Core 关闭流程

#### Scenario: 无代理配置访问 Service
- **WHEN** 用户在桌面 Chrome 或 Edge 中登录 Desktop，预览服务并打开独立应用标签页
- **THEN** 浏览器无须配置 proxy/PAC/hosts 即可交互，受支持应用的认证、SSE、WebSocket 和受限嵌入回退可用；托管 IP 模式按 browser-service-access 明确同源信任、路径前缀和脚本 Cookie 限制，CLI 本机模式保持原行为
