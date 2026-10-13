## Purpose

定义 piwork 原生程序的安装、运行依赖和交付边界，使操作者能够只部署平台二进制与受管镜像，并在保留浏览器界面及容器内 Pi SDK 生态的条件下，完成 Work、对话、Service、文件与迁移的完整使用流程。

## ADDED Requirements

### Requirement: 以独立原生程序交付平台入口

**Identifier:** NATIVE-001

系统 SHALL 为当前支持的 Linux 部署环境交付 Go 构建的 `piwork-serve`、`piwork-cli` 和 `piwork-console`。Core 的正常启动、初始化、控制面和业务执行 SHALL 不依赖宿主机 Node、npm、Python、Go 工具链、Docker CLI 或 openssl 可执行程序；用户 CLI 和 Console 同样 SHALL 不依赖这些程序。`piwork` SHALL 仅作为 `piwork-serve` 的 operator 别名，不接受用户登录或对话命令。

原生程序 SHALL 保持 `control-cli`、`serve-control-plane`、`serve-ui` 和 `desktop-webui` 定义的命令职责、默认端口、凭证位置、输入输出及退出语义。系统 CA、可写数据目录、网络和 Core 所需 Docker Engine 属于部署设施；远程用户 CLI 不要求本机 Docker。浏览器打开器为可选设施，不可用时 SHALL 输出手动入口并保持本地服务运行。

#### Scenario: 在无解释器宿主上完成初始化
- **WHEN** 操作者仅安装发布程序、必要系统设施和可用 Docker Engine，PATH 中没有 Node、npm、Python、Go、docker、openssl
- **THEN** 可以启动 Core、显式 bootstrap 管理员、保存 runtime、创建并启动 Work，平台宿主进程不尝试调用上述程序

#### Scenario: 仅安装用户 CLI
- **WHEN** 用户机器没有 Docker 或开发工具链，运行 CLI 连接已配置的 Core
- **THEN** 用户能够登录、管理自己的 Work、观察对话并启动 proxy 或 desktop

#### Scenario: 保留命令身份边界
- **WHEN** 调用者分别执行 `piwork-cli login`、`piwork-serve status` 和 `piwork chat`
- **THEN** 前两者使用对应用户与 operator 契约，最后一个命令作为错误入口以 usage 错误拒绝

### Requirement: 直接使用有明确目标的 Docker Engine

**Identifier:** NATIVE-002

Core SHALL 直接通过 Docker Engine API 管理容器、网络、卷、镜像、日志、探针、attach 和镜像导入导出，支持本机标准或 rootless Unix socket。显式 Docker context、`DOCKER_HOST` 和默认 context 的目标选择 SHALL 有确定优先级，选中的未知 context、非本机 Unix endpoint 或不可访问 socket SHALL 报告安全依赖错误，不得悄悄改用另一 Engine。Core SHALL 与 Engine 协商受支持 API 版本；无法协商时不宣称 runtime ready。

已有固定镜像的使用 SHALL 不需要 registry 登录。需要拉取时 SHALL 支持匿名拉取以及 Docker 配置中显式静态 registry auth；如果目标 registry 仅有外部 credential helper，SHALL 明确报告当前凭证方式不可用，不执行宿主 helper、不把它误当成匿名成功，也不输出凭证。系统 SHALL 保持既有镜像固定、资源所有权核验、无用户 service 宿主端口与配额要求。

#### Scenario: 无 Docker CLI 的完整运行操作
- **WHEN** Core 连接合法 Unix socket 且没有 docker 可执行文件
- **THEN** 镜像获取、Work 启停、Service 日志、文件 helper attach 及快照镜像传输均通过 API 完成

#### Scenario: 显式目标无法使用
- **WHEN** 选择的 context 不存在、指向远程 endpoint 或 socket 无访问权限
- **THEN** Core 显示安全 runtime 不可用原因，保留健康/控制面，不创建默认 Engine 上的资源

#### Scenario: 镜像拉取需要外部凭证程序
- **WHEN** 本地没有所需镜像且目标 registry 的凭证只能由外部 helper 提供
- **THEN** 对应 Operation 明确失败并给出预加载镜像或提供受支持凭证方式的方向，不启动宿主凭证程序、不泄漏认证材料

#### Scenario: Engine 版本不兼容
- **WHEN** Engine 没有客户端能够协商的 API 版本
- **THEN** readiness 报告安全依赖故障，现有持久定义和数据不被修改为成功状态

### Requirement: 随原生程序提供既有浏览器界面

**Identifier:** NATIVE-003

发布的 `piwork-cli desktop` 和 `piwork-console serve` SHALL 包含各自全部构建后浏览器资源，不要求旁置 TS 源文件、node_modules、前端开发服务器或运行时构建。复用界面 SHALL 继续满足 `desktop-ui-language`、`ui-language`、各 Desktop/Console 能力及其 API 契约；迁移本身不引入新的导航、产品文案或功能裁减。

Desktop SHALL 保持用户会话、独立 Service 本机 origin、Files 和 Chat 的隔离；Console SHALL 保持独立 HTTPS 管理入口及管理员会话。平台凭据仍只保存在相应服务端，不交给 Service 应用。无登录、Core 不可达、加载中、结果未知和登录失效 SHALL 保留既有界面状态及恢复入口。

#### Scenario: 从任意工作目录打开 Desktop
- **WHEN** 用户仅拷贝发布的 CLI 程序到新目录，并在无源码或静态文件目录处执行 desktop
- **THEN** 本地登录页面及全部资源可加载；连接 Core 后既有 Work、Service、Files、Chat 和 Settings 可用

#### Scenario: 无代理配置访问 Service
- **WHEN** 用户在桌面 Chrome 或 Edge 中登录 Desktop，预览服务并打开独立应用标签页
- **THEN** 浏览器无须配置 proxy/PAC/hosts 即可交互，应用认证、SSE、WebSocket 和受限嵌入回退保持原行为

#### Scenario: Console 独立退出
- **WHEN** 操作者使用发布的 Console 程序提供现有管理页面后停止 Console
- **THEN** Console 会话及本地连接结束，Core、Work 和已接受 Operation 不因此停止或取消

### Requirement: 保持与容器内 Pi 生态的当前契约

**Identifier:** NATIVE-004

Go Core SHALL 与完整保留的 TS pi-agentd Agent harness 通过当前协议互通。harness SHALL 包含其 RPC 服务、readiness/drain、Session/Run、私有历史存储、资源加载、模型/工具执行、MCP 客户端和 SDK 工具适配，以及这些职责所需 TS 依赖；迁移不要求将其中未直接调用 SDK 的函数拆为 Go。`AgentService` 与 `WorkServices` 的 RPC、消息字段、事件序号、缺省值和错误语义 SHALL 保持；双方 SHALL 核验安装、Work、generation、instance 与角色的 mTLS 身份。readiness 完成前不开放运行路由，旧代次不因证书仍有效而获得权限。

Agent runtime/context 配置、挂载布局、Skill/Pi package 内容身份、兼容属性以及 Work history schema 3/storage layout 2 SHALL 保持。SDK 会话、工具执行、模型调用与 Run 终态由 pi-agentd 管理，平台迁移 SHALL 不替换成模拟 Agent 或要求宿主安装 Pi SDK。独立 Service MCP 服务端和 package-helper SHALL 使用 Go；前者继续由 harness 的 TS MCP 客户端调用，后者保持 Pi 兼容准备环境。构建与测试可使用 Node；生产 Node/npm/Pi 生态依赖 SHALL 位于对应镜像内。

#### Scenario: 双向真实 RPC 部署
- **WHEN** Go Core 启动真实 TS Agent 镜像，通过现有 SDK 提交一次部署请求
- **THEN** SDK 经 TS MCP 客户端、Go Service MCP 的真实 MCP 请求及 mTLS gRPC 调用 Go Core，返回持久 Service/Operation，Agent 可查询就绪并访问 Work 私网服务

#### Scenario: 拒绝旧代次控制请求
- **WHEN** 一个已被替换的 Agent 使用旧 generation 或错误 Work 身份调用服务管理
- **THEN** Core 拒绝且不写入定义、不分配配额、不创建容器

#### Scenario: 包准备后离线恢复
- **WHEN** Go package-helper 在兼容容器内完成制品准备，Go Core 保存并应用到 Work，随后来源不可达
- **THEN** 制品摘要和实际加载结果一致，后续 Work 启动、快照和恢复不重新访问来源或调用宿主 npm

#### Scenario: 保留完整 TS Agent harness
- **WHEN** Go Core 驱动真实 TS pi-agentd 创建 Session、执行工具、观察 Run、drain 并替换 Agent 容器
- **THEN** harness 通过原 RPC 和私有历史恢复会话；这些职责仍由 TS harness 执行，宿主没有 Node Agent 进程，平台编排不因保留 harness 而回退为 TS

### Requirement: 平台辅助程序使用 Go 并保持执行边界

**Identifier:** NATIVE-005

系统 SHALL 交付 Go file-helper、snapshot-helper、package-helper 和内置 Service MCP 服务端。file-helper 与 snapshot-helper SHALL 不使用 Node、Python 或 Agent SDK；package-helper 本身 SHALL 是 Go 程序，所调度的 npm/Git/Pi 包安装脚本及 SDK 环境探测 SHALL 仅在兼容隔离镜像内执行。文件访问 SHALL 仍由 Core 授权并只接触当前 Work workspace；快照 SHALL 仍按授权访问两个受管卷和相应制品。helper SHALL 保持网络、用户、挂载、资源限额和生命周期隔离，不成为用户 Service，也不借用 Agent 文件工具。

Service MCP SHALL 保持内置 stdio 子进程的生命周期、全部既有工具、严格参数/默认值、text 与 structuredContent、稳定字段投影、错误与幂等语义。它 SHALL 不开放新网络监听或 Docker 权限，stdout 只承载 MCP，身份由当前 Work 的 mTLS 确定；harness 继续负责工具注册与子进程回收。package-helper SHALL 保持 prepare/init/capture/measure 四入口、请求/结果文件协议及 manifest/归档/摘要校验；只有 prepare 可调用网络来源及包安装脚本，其他入口不得执行包内代码。

运行镜像 SHALL 声明并实际提供匹配平台的原生辅助程序能力。新的包 mutation SHALL 在接受 Operation 前确认准备镜像及可信镜像的 Go package-helper 可用；仅有旧 TS helper、虚假能力声明、缺失可执行文件或错误平台 SHALL 返回 `PI_PACKAGE_HELPER_INCOMPATIBLE` 且无 Operation。已接受同键同内容重放 SHALL 先返回原接受结果，不因镜像后续不可用而重新探测或执行。Agent 运行验证 SHALL 核验 Go MCP 和 package-helper 的交付能力，缺失时按既有 Agent/runtime compatibility 错误保持路由关闭，不回退启动旧 TS 程序。

`.work` 离线 inspect SHALL 仅使用包内数据完成完整性及固定 Agent 镜像能力的静态检查，无需登录，不联系 Core、Docker Engine 或网络，不运行包内 ENTRYPOINT、helper、MCP、Node、安装脚本或 SQLite。成功摘要 SHALL 保持 `integrityVerified=true`、`installationValidated=false`；镜像能力检查通过不得宣称目标安装已验证，也不得代替目标平台兼容性、历史数据库语义、目标模型/外部 MCP 凭证及 quota 检查。

Core SHALL 独立复核固定 Agent 镜像能力，并在 package 标记可导入前完成完整接收预检和隔离历史语义检查；导入接受前 SHALL 检查目标平台、模型/外部 MCP 凭证及容量约束，发布前 SHALL 再次核验目标相关约束，不信任客户端 inspect 的结果作为安装依据。inspect 或 Core 静态核验发现格式合法但固定镜像能力不支持 SHALL 返回 `PACKAGE_INCOMPATIBLE`；此错误表示镜像能力不受支持，不表示包字节损坏或目标安装已验证。系统不得替换镜像、补装程序或更改 V1 schema。包生产者语言不构成拒绝依据；符合格式、平台、能力和凭证条件的包 SHALL 继续保持固定镜像身份与完整搬迁语义。

完整 `.work` 快照传输 SHALL 保持 WSNAP-005 的完整上传/下载语义：显式 Range 请求一律返回 416，不提供部分内容或断点续传；中断后在保留期内通过原 snapshot ID 从头下载相同内容/hash，不重新导出源 Work。此约束与 workspace WebDAV 文件 GET/HEAD 支持单段 Range 的语义分别执行。

平台 SHALL 保持现有路径安全、原子文件提交、部分失败、取消、暂存回收与冷快照验证语义。helper 的创建和清理 SHALL 有持久归属记录，超时或连接关闭不能被当作已经退出。Go helper SHALL 能校验并重建受管 Work 历史身份字段，SDK 历史正文和用户数据库不得被执行或搜索替换。

#### Scenario: 无 Python 或 Node 的文件访问
- **WHEN** 运行中的 Work 接收 WebDAV 上传、下载、MOVE 和 COPY，file-helper 镜像只有原生执行程序及必要系统文件
- **THEN** 请求正确作用于共享 workspace，未挂载该卷的服务不会获得隐式访问，Agent 私有数据不可通过文件入口访问

#### Scenario: 快照恢复既有 Agent 历史
- **WHEN** 原生 snapshot-helper 导出并导入含 schema 3 会话与 SDK JSONL 的合法 `.work` 包
- **THEN** 仅声明的受管身份被映射，历史字节、业务数据和当前包格式保持，显式启动后原 TS Agent 可读取并继续符合 active context 条件的会话

#### Scenario: helper 失败仍保持恢复边界
- **WHEN** 文件提交或快照恢复期间 helper 超时、磁盘写满或 Core 崩溃
- **THEN** 对应结果遵循现有文件/快照失败语义，恢复按归属清理，不自动重放用户写入、不发布不完整 Work、不清理其他安装资源

#### Scenario: Go MCP 保持工具协议
- **WHEN** TS harness 发现 Go MCP 的全部既有工具，并调用含默认值、边界整数的有效请求或未知字段的无效请求
- **THEN** 发现、校验和 JSON 结果与既有工具契约一致，无效请求无副作用；已接受 mutation 不等待镜像就绪，同键恢复不重复部署，Work 停止时子进程按原期限回收

#### Scenario: Go package-helper 完成四入口
- **WHEN** Go helper 执行 init、prepare、measure 和 capture，其中 prepare 为 npm/Git/local/ZIP 包安装运行依赖
- **THEN** 产物、原始 manifest、inventory、共享摘要和 prepared environment 符合原契约，真实 TS SDK 可加载；npm/Git/安装脚本只在准备容器内执行，其余入口不运行包代码

#### Scenario: 拒绝旧 TS helper 或虚假镜像能力
- **WHEN** 新的包 mutation 使用仅有 TS helper、能力 label 存在但原生文件缺失、错误平台的准备镜像或可信镜像
- **THEN** 接受前返回 `PI_PACKAGE_HELPER_INCOMPATIBLE`，不产生 Operation 或 TS fallback；若是已接受同键重放，仍返回原 Operation 而不重新安装

#### Scenario: 静态拒绝不支持的固定 Agent 镜像
- **WHEN** 离线 inspect 或 Core 接收/导入预检发现 V1 包固定 Agent 镜像缺少所需 Go 运行能力，或能力文件被后续镜像层删除
- **THEN** 返回 `PACKAGE_INCOMPATIBLE` 且没有运行包内代码，不发布 Work、不更换镜像；该诊断不宣称目标安装已验证，具有受支持能力的包仍需通过 Core 的独立目标检查才能恢复相同镜像身份

### Requirement: 原生交付覆盖完整的 Work 使用闭环

**Identifier:** NATIVE-006

最终交付 SHALL 满足全部现行主规格经本变更 delta 合并后的 Requirement 和 Scenario，包括 Core 控制面、用户 CLI、Desktop、Console 与完整 TS harness 的交互。Core 阶段验收 SHALL 已包含 Go MCP/package/file/snapshot 程序及其镜像兼容边界。验收 SHALL 使用真实 Go 程序、Docker Engine 和真实 Pi SDK 路径；确定性模型可作为模型提供者，但不能用模拟 Core/Agent/Service 绕过业务边界。

验证 SHALL 同时覆盖成功、失败、权限、并发、进程中断与数据恢复；只通过编译、单元测试或 happy path 不足以声明迁移完成。每个场景 SHALL 对应可定位的自动测试或必要的人工 UI 验收记录，未验证项不能标为通过。

#### Scenario: 一个 Work 的日常工作流
- **WHEN** 在空 Go 安装初始化后创建 Work，发送对话部署持久计数服务，再从 CLI proxy、Desktop 和 WebDAV 访问
- **THEN** 对话、服务计数和共享文件一致可见，启停与配置 Save/Apply 保持现有含义，禁用的服务不会被 Work 重启复活

#### Scenario: 完整包在两个 Go 安装间迁移
- **WHEN** Work 包含业务文件、服务定义、会话历史、Skills、Pi Packages 和 pending desired，用户先 Stop 再 Export，离线 Inspect 后导入另一空 Go 安装
- **THEN** Inspect 成功仅给出 `integrityVerified=true`、`installationValidated=false`；Core 独立完成目标检查后导入得到独立且 stopped 的 Work，使用目标凭据显式启动后数据和历史可读、服务可用，源安装和原包来源不必在线

#### Scenario: 观察中断与未知写入结果
- **WHEN** 已接受的 Run/Operation 观察断开，或文件 mutation 响应丢失
- **THEN** 客户端保留已知身份并查询实际结果，不重新提交 prompt、安装、导入或文件写入，不把传输失败伪装为业务终态

#### Scenario: 未完成场景的验收状态
- **WHEN** 验收只覆盖 Core 启动，或某浏览器、故障恢复场景缺少执行证据
- **THEN** 对应项保持未完成，迁移不得宣告完成

### Requirement: 发布产物与运行文档不再依赖旧平台实现

**Identifier:** NATIVE-007

最终发布与默认启动入口 SHALL 只使用 Go 平台程序；被替换的 TS Core、用户 CLI、Desktop/Console 服务端、Service MCP 服务端、旧文件/快照/包 helper 以及仅供它们使用的生产依赖 SHALL 从当前源码与构建入口移除，不能以包装器、备用后端或静默 fallback 留存。保留的生产 TS SHALL 限于完整 pi-agentd harness 及其可证明必要的依赖、复用浏览器 UI；开发或测试工具可继续使用 TS/JS，但不得作为独立 TS 平台服务交付。

最终构建与发布 SHALL 提供可核对的 TS 保留模块/依赖及其消费者清单，以及三种宿主和四种镜像内 Go 程序的构建身份。核验 SHALL 同时检查源码 import graph、构建/发布入口、镜像内容/入口及实际进程；不能仅以宿主 PATH 无 Node 判断迁移完成。共享 TS 包 SHALL 裁剪仅供平台准备、上传、归档或旧后端使用的生产代码，同时保留 harness 的 RPC、Session/Run/history 和包加载依赖。

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
- **WHEN** 核对最终源码、npm 依赖、七种 Go 程序构建身份、Agent/helper 镜像和实际执行进程
- **THEN** 完整 TS harness 及浏览器的依赖与保留清单一致，独立平台程序全部为 Go，没有旧 TS helper/dist/shebang 或未登记 TS 服务端

#### Scenario: 镜像内 Pi 生态继续可用
- **WHEN** 在没有宿主解释器的环境中运行发布平台，并通过真实 harness 执行模型工具、包安装及 Pi 子代理
- **THEN** 宿主只运行 Go 平台程序，镜像内 Node/npm 服务于登记的 harness/Pi 包；Go MCP 与 Go package-helper 仍实际执行，不以生态依赖为理由回退旧 TS 平台程序
