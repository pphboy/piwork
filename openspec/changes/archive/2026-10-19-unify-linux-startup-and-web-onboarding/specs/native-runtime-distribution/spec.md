## MODIFIED Requirements

### Requirement: 以独立原生程序交付平台入口

**Identifier:** NATIVE-001

系统 SHALL 为 Linux 交付同一个 Go 服务端程序，通过 `piwork` 或 `piwork-serve` 名称运行，内含 Core、管理页面、工作台和首次引导；无参数或 serve 启动完整应用。默认发行不得要求分别安装/启动 Console 或客户端 Desktop；保留显式 operator 子命令及其身份边界，用户 login/chat 仍属于 piwork-cli。新入口默认监听允许远程浏览器访问，具体状态与初始化遵守 core-service-startup 和 web-onboarding。

系统 SHALL 按 cli-runtime-portability 继续为 Windows/Linux 交付完整原生 piwork-cli；其本机 Desktop、proxy、凭证、输出/退出契约保持。统一服务端的 Windows 原生 Core 不属于本次平台支持，浏览器所在操作系统不决定 Core 平台。

正常运行 SHALL 不依赖宿主 Node、npm、Python、Go、Docker CLI 或 openssl；系统 CA、可写私有数据目录、网络及 Linux 本机 Docker Engine 属于设施。浏览器打开器可选，不可用时 SHALL 输出可手动访问的 URL并保持服务运行。

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

托管页面 SHALL 按浏览器会话隔离用户，Service 独立来源、服务端响应 Cookie 分区及首版脚本 Cookie 限制遵守 browser-service-access；完整工作台不代表任意网页应用的 Cookie 透明兼容。管理区和工作台共用应用入口，页面关闭不影响 Core。独立 piwork-cli desktop SHALL 继续内嵌自己的资源并保持原有本机授权、Service origin 和连接恢复语义。平台凭据不得交给页面或 Service。

#### Scenario: 从任意工作目录打开 Desktop
- **WHEN** 在无源码/静态目录的位置启动统一程序
- **THEN** 登录、管理、引导和工作台资源全部可加载，无需独立 Console 或前端开发服务器

#### Scenario: Agent 默认值随发行交付
- **WHEN** 原生二进制或统一 Docker 镜像从空安装创建 CoreRuntime
- **THEN** 保存后的 Agent 引用与该制品内嵌的同版发行元数据一致；无旁置引用文件、Agent 启动覆盖参数或网页镜像输入步骤

#### Scenario: CLI 本机模式继续可用
- **WHEN** 用户从任意目录运行原生 piwork-cli desktop
- **THEN** 本机资源、授权恢复及已配置 Core 的 Work/Service/Files/Chat/Settings 继续可用

#### Scenario: Console 独立退出
- **WHEN** 管理员关闭浏览器管理页面
- **THEN** Core、Work 和已接受 Operation 继续，只有显式停止统一进程才执行 Core 关闭流程

#### Scenario: 无代理配置访问 Service
- **WHEN** 用户在桌面 Chrome 或 Edge 中登录 Desktop，预览服务并打开独立应用标签页
- **THEN** 浏览器无须配置 proxy/PAC/hosts 即可交互，受支持应用的认证、SSE、WebSocket 和受限嵌入回退可用；托管 IP 模式按 browser-service-access 明确脚本 Cookie 限制，CLI 本机模式保持原行为


### Requirement: 发布产物与运行文档不再依赖旧平台实现

**Identifier:** NATIVE-007

最终发布与默认启动入口 SHALL 只使用 Go 平台程序，默认 Linux 服务端使用 NATIVE-001 的统一程序，并核对管理/工作台两套内嵌资源及发行默认引用；被替换的 TS Core、用户 CLI、Desktop/Console 服务端、Service MCP 服务端、旧文件/快照/包 helper 以及仅供它们使用的生产依赖 SHALL 从当前源码与构建入口移除，不能以包装器、备用后端或静默 fallback 留存。保留的生产 TS SHALL 限于完整 pi-agentd harness 及其可证明必要的依赖、复用浏览器 UI；开发或测试工具可继续使用 TS/JS，但不得作为独立 TS 平台服务交付。

最终构建与发布 SHALL 提供可核对的 TS 保留模块/依赖及其消费者清单，以及统一服务端、独立用户 CLI 和四种镜像内 Go 程序的构建身份。核验 SHALL 同时检查源码 import graph、构建/发布入口、镜像内容/入口及实际进程；不能仅以宿主 PATH 无 Node 判断迁移完成。共享 TS 包 SHALL 裁剪仅供平台准备、上传、归档或旧后端使用的生产代码，同时保留 harness 的 RPC、Session/Run/history 和包加载依赖。

发布包 SHALL 提供版本、校验摘要、程序及配套镜像的构建标识；文档 SHALL 区分宿主运行依赖、开发构建依赖和镜像内依赖。当前部署、诊断和验收命令 SHALL 使用实际 Go 入口。历史资料可保留，但 SHALL 标明其适用实现，不能作为当前 Go 验收通过的证据。

#### Scenario: 脱离源码运行发布包
- **WHEN** 发布程序被拷贝到没有仓库、npm workspace 和旧 dist 的机器或受控验收环境
- **THEN** 用户可以按当前文档启动并使用平台，版本和校验信息对应本次构建，后台没有旧 TS 平台进程

#### Scenario: 删除旧实现后的完整构建
- **WHEN** 旧平台源码和入口已从当前树移除，从干净检出构建并执行验收
- **THEN** Go 程序、保留的浏览器和 Agent 镜像均可重建，测试不借旧 Core/CLI 作为最终被测系统

#### Scenario: 不自动接管开发安装
- **WHEN** 用户将 Go 程序指向旧 TS 数据目录，或同一 Docker Engine 上仍有旧开发资源
- **THEN** 不支持的目录被明确拒绝；新安装只处理自身身份资源，不删除旧目录、容器或卷

#### Scenario: 源码与镜像内平台程序一致
- **WHEN** 核对最终源码、npm 依赖、所有实际交付的 Go 程序构建身份、Agent/helper 镜像和实际执行进程
- **THEN** 完整 TS harness 及浏览器的依赖与保留清单一致，独立平台程序全部为 Go，没有旧 TS helper/dist/shebang 或未登记 TS 服务端

#### Scenario: 镜像内 Pi 生态继续可用
- **WHEN** 在没有宿主解释器的环境中运行发布平台，并通过真实 harness 执行模型工具、包安装及 Pi 子代理
- **THEN** 宿主只运行 Go 平台程序，镜像内 Node/npm 服务于登记的 harness/Pi 包；Go MCP 与 Go package-helper 仍实际执行，不以生态依赖为理由回退旧 TS 平台程序
