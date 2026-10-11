# Spec Delta

## MODIFIED Requirements

### Requirement: 提供可直接使用和派生的 Web 基础镜像

**Identifier:** WEBBASE-001

项目 SHALL 提供 `docker.io/pphboy/piwork-web-base` 作为可复用 NiceGUI 开发和运行基础镜像，首版支持 `linux/amd64`。公开环境契约 SHALL 包含 Python 3.13、NiceGUI、pip、sqlite3 命令及标准模板的测试依赖，固定精确版本和依赖完整性。标准 NiceGUI 应用 SHALL 能直接复用镜像中已安装的环境，无需重新安装标准包或准备独立 Node/npm、React、TypeScript、Vite 工程。NiceGUI 自身所需的浏览器资源和传递依赖 SHALL 完整交付，不将本要求理解为禁止其内部使用 FastAPI 或 JavaScript。

镜像 SHALL 支持直接执行 Work workspace 中的应用，并允许下游通过 `FROM` 增加依赖和改变启动命令；不包含 Todo、复盘或其他特定业务，也不强制通用 NiceGUI 应用采用工作站示例。镜像 SHALL 按 UID/GID `10001:10001` 使用，支持现有非 root、只读根文件系统及 workspace grant。其使用不得要求宿主 Python/Node、Docker socket、特权容器或宿主端口；它是应用 Service 镜像，不承担 agentd 的 SDK、模型或私有历史职责。

sqlite3 CLI SHALL 在镜像 PATH 中预装并可直接执行，支持 workspace 内的数据库建立、查询及机器可读结果，无需启动时联网安装或 root。Python sqlite3 模块或仅有 SQLite 库 SHALL NOT 替代该命令交付；Agent 容器内的同名 CLI 由 RUNTIME-TOOLS-SQLITE-001 单独保证。

#### Scenario: 两个 Work 直接复用环境
- **WHEN** 两个独立 Work 用同一固定镜像分别部署不同 NiceGUI 应用
- **THEN** 两者直接使用同一已安装标准环境，各自在自己的 workspace 读写代码和数据，网络及业务状态独立

#### Scenario: 下游派生基础镜像
- **WHEN** 下游维护者用已发布固定引用通过 `FROM` 添加专用依赖和启动命令
- **THEN** 派生应用能沿现有 Service 部署流程运行，无需取得 Agent 私有存储或维护示例业务

#### Scenario: 非 root 应用直接调用 sqlite3
- **WHEN** base 以 UID/GID 10001:10001、只读根文件系统和可写 workspace 启动
- **THEN** sqlite3 命令可直接执行，在 workspace 合成数据库中建表、写入并查询机器可读结果，无需安装额外工具

#### Scenario: 通用 NiceGUI 应用直接运行
- **WHEN** 应用仅使用 base 的标准 Python/NiceGUI 依赖并显式提供自己的启动命令
- **THEN** 能在该 base 中运行，不要求安装 npm 包、生成前端 bundle 或包含工作站业务

### Requirement: 标准应用能够离线准备构建和启动

**Identifier:** WEBBASE-002

基础镜像 SHALL 提供与默认模板一致的已安装标准依赖和本地浏览器资源，使标准应用在镜像已可用且包注册表/CDN 不可达时，仍能在干净 workspace 完成必要 Python 检查、启动、页面显示和业务操作。默认应用 SHALL NOT 为此复制或重装完整 NiceGUI 基础环境、创建 node_modules 或执行独立前端构建。

开发者 SHALL 能在自己的应用副本中修改源码、依赖声明和启动配置；额外 Python 依赖的安装遵循 WEBBASE-008。普通启动 SHALL 复用与当前源码、依赖和镜像环境匹配的有效准备及检查结果；必要结果缺失或输入变化时重新执行相应检查，不以减少耗时为由绕过未通过检查。普通重启不得重新解析未固定依赖或隐式访问包注册表。新增依赖不在本地集合且未明确选择安装时 SHALL 明确报告缺项，不静默下载可变最新版本或伪称离线成功。

#### Scenario: 首次启动没有注册表网络
- **WHEN** 使用已拉取镜像和匹配的标准模板，在没有应用依赖目录、注册表及 CDN 不可达时启动
- **THEN** 必要检查、NiceGUI 页面和应用请求成功，无 pip/npm 下载，无向 workspace 复制完整标准依赖

#### Scenario: 扩展依赖不在环境中
- **WHEN** 应用声明一个 base 和本地安装材料中都没有的包，且未明确选择联网安装
- **THEN** 准备失败并报告所需依赖，已有源码、数据和原有效依赖保留，不偷偷使用其他版本

#### Scenario: 相同环境普通重启
- **WHEN** 标准应用的源码、依赖和镜像环境未改变，已有匹配的检查结果后重启
- **THEN** 复用有效结果并启动，不重新安装依赖或运行不存在的前端构建链，实际就绪仍由 Service 探测确认

#### Scenario: 修改后不能沿用旧检查
- **WHEN** 源码、依赖或实际镜像环境改变
- **THEN** 不将旧检查结果作为新版本通过依据，必要检查失败时不发布新版就绪状态

### Requirement: 默认使用同一 Service 的单 HTTP 入口

**Identifier:** WEBBASE-003

标准运行方式 SHALL 在 `0.0.0.0:8080` 提供 NiceGUI 页面及其 HTTP/WebSocket 资源、业务 API、既有 `/pi/v1` 交互契约及 `/health` 就绪检查，全部通过同一声明端口访问。必要依赖与检查通过且当前应用可服务后才能报告就绪；失败 SHALL 有非零结果或明确运行错误，不用空白页面、旧版本标记或占位健康响应冒充交付成功。API/协议路由不存在时 SHALL 保留相应错误，不能被页面回退吞掉。

基础环境 SHALL 提供显式开发模式供 Python 页面及业务代码迭代，并通过现有授权 Service 入口工作；静态资源、页面路由、API 及 NiceGUI WebSocket SHALL 不依赖硬编码容器 IP、宿主端口或浏览器直连容器。浏览器 SHALL 不获得平台交互 token，UI 与 Agent 入口 SHALL 复用 Service 的权威业务状态。

#### Scenario: 浏览器打开并刷新业务页面
- **WHEN** 用户经 Desktop 打开默认 NiceGUI 应用、访问业务页并直接刷新
- **THEN** 页面资源、同源 API 和 WebSocket 正常，路由刷新可用，Pi 能通过同一后端查询对应业务状态

#### Scenario: 构建失败
- **WHEN** Python 源码错误、依赖缺失或必要测试失败使当前应用不能交付
- **THEN** 该次部署不能报告应用已就绪，错误可从原 Operation/日志查到，业务数据保持

#### Scenario: 显式开发模式
- **WHEN** 开发者使用开发模式并通过受保护的 Service 入口修改 Python 页面代码
- **THEN** 代码重载及页面重新连接可用，WebSocket 不绕过当前 Work/Service 授权

### Requirement: 应用文件可持久编辑且启动不覆盖业务

**Identifier:** WEBBASE-004

源码、额外依赖声明与锁文件、应用可写环境、缓存、检查记录和运行临时文件 SHALL 使用该 Work 获准的 workspace；业务数据 SHALL 使用 `data/<service-name>`。镜像内预置依赖为只读共享来源，应用追加或需要修改的依赖 SHALL 写入应用自己的可写环境，不尝试修改镜像目录。模板初始化 SHALL 是显式且不覆盖已有文件的动作，普通启动/重启不得重建模板、清空数据或修复成空数据库。

默认模板指导与 SDK 部署验收 SHALL 共用实际安全初始化入口。初始化 SHALL 在写入任何 SPEC.md、源码、锁文件或注册信息前拒绝已存在的应用目标，包括空目录、文件和符号链接；独占创建或等效无覆盖操作 SHALL 防止并发初始化相互覆盖。拒绝 SHALL 保留原代码、依赖、注册信息和业务数据，不继续创建或重部署 Service，不把跳过文件后的部分混合模板报告为成功。已有应用的维护 SHALL 读取实际内容并作局部更新，不通过重新初始化恢复模板。

Service 和 Agent SHALL 使用现有共享身份读写应用文件。Stop/Start、Service 替换和完整环境导出导入 SHALL 保留应用源码、额外依赖锁文件、离线安装材料及业务数据；导入仍是 stopped Work，由用户显式 Start。应用环境若因位置、Python 或镜像身份不匹配需要重建，SHALL 使用保留的精确安装材料，不覆盖用户源码或重新联网解析版本。标准镜像依赖无需复制进 workspace 或快照，镜像身份仍按原 Service/快照契约保留。

#### Scenario: 只读根文件系统下开发
- **WHEN** Service 的根文件系统只读且仅 workspace 可写
- **THEN** Python 检查、额外依赖准备、运行和缓存写入成功，Agent 能继续编辑 Service 生成的应用文件

#### Scenario: 重启或再次初始化
- **WHEN** 已有应用有自定义代码、额外依赖和业务数据，随后 Service 重启或再次执行初始化
- **THEN** 重启沿用已有内容，初始化拒绝覆盖，修改和数据均保留

#### Scenario: 真实 SDK 重复初始化先拒绝写入
- **WHEN** 默认部署路径已初始化应用，用户已修改 SPEC.md、源码或锁文件并保存业务数据，随后真实 SDK 再次调用同一初始化入口
- **THEN** 初始化失败发生在任何覆盖写入之前，原文件、数据和 Service 保持，部署 driver 不继续 service_create 或重启；不能用原幂等回执掩盖初始化失败

#### Scenario: 已有目标不能作为空白应用接管
- **WHEN** 初始化目标是已有空目录、普通文件、符号链接，或已由另一并发初始化调用取得
- **THEN** 当前调用明确拒绝且不跟随链接或覆盖目标，不改动已有应用和业务数据

#### Scenario: 带新增依赖的环境分享
- **WHEN** 已成功安装额外 Python 包的 Work 停止、导出、导入另一 Work，原固定 base 已可用且包注册表不可达
- **THEN** 导入保持 stopped，显式 Start 后使用保留的环境或离线精确重建，额外包可被实际应用导入，两份 Work 的业务数据独立

### Requirement: 默认环境具有可查文档和固定版本

**Identifier:** WEBBASE-005

仓库 SHALL 将 `deploy/images/web-base/` 作为 NiceGUI 基础镜像的长期维护源，保存构建材料、环境版本/锁文件、通用工具及顶部互链的英文/中文 README。README SHALL 同步解释 base 概念、与 Agent/Work/Service 的关系、直接使用、`FROM` 派生、模板入口、准备/检查/运行/开发命令、自动生效/页面刷新、sqlite3 用法、workspace/数据持久化、额外 Python 依赖安装、只读身份、版本升级及已验证平台。根 README 双语 SHALL 提供入口，不要求用户从历史验收记录推导当前用法。

文档 SHALL 明确镜像源位于本仓库 `deploy/images/web-base/`，构建/验证/发布入口位于 scripts/Makefile，脑包保存使用指导、模板及固定引用，`dist/web-base/` 是本地产物，DockerHub 是发布制品位置。后续镜像维护 SHALL 从仓库源和锁文件产生新版本，不能把临时容器补丁或某个 Work 的副本当作唯一维护源。

正式默认脑包 SHALL 使用可查的固定版本和已验证镜像 digest；构建材料、环境契约与脑包引用 SHALL 能核对兼容性，不能仅写 `latest`。NiceGUI 环境 SHALL 使用新的固定版本和可辨环境契约，不覆盖原 FastAPI/React 版本。未发布候选只供显式本地验收，不写成正式可用默认镜像；镜像可独立发行，不强制与 Core/CLI/Agent/helper 同次发布。

#### Scenario: 按文档复用基础镜像
- **WHEN** 维护者按任一语言 README 创建应用、安装额外 Python 包或构建派生镜像
- **THEN** 命令与目录一致且可执行，能查到固定环境身份、支持平台、联网安装条件和依赖持久化方式

#### Scenario: 后续维护能够找到权威来源
- **WHEN** 维护者需要升级 NiceGUI、Python 或 sqlite3 并准备新版本
- **THEN** 从 README 可定位本仓库维护目录、锁文件和构建/验证/发布入口，无需读取某个 Work 或修改运行容器

#### Scenario: 新旧固定环境并存
- **WHEN** 新 NiceGUI base 准备完成，而既有 Work 仍绑定原 FastAPI/React 固定镜像
- **THEN** 环境身份可区分，旧引用不被重写或覆盖，旧 Work 不因默认环境变化被自动迁移

### Requirement: 发布后才能宣称 DockerHub 交付完成

**Identifier:** WEBBASE-006

本地构建与验收 SHALL 生成可审阅候选，记录源码身份、dirty 状态、构建输入、锁定环境、平台及实际镜像内容。对外推送 SHALL 仅在用户另有明确发布要求时执行；规划、本地实现或已登录 DockerHub 不构成发布授权。

获准发布时 SHALL 在构建、离线运行、依赖扩展、派生及真实 Service 验证通过后发布到用户指定的 DockerHub `pphboy` 命名空间，不得覆盖已有不同内容的固定版本。发布记录 SHALL 区分本地候选和远端已发布，保存真实 registry digest，并证明该 digest 可匿名拉取和运行后，才更新正式脑包默认引用。推送失败或匿名读取失败 SHALL 如实保留未完成状态，不把不可获得候选或原 FastAPI/React digest 宣称为可用 NiceGUI 默认环境。

#### Scenario: 本地验收未请求发布
- **WHEN** NiceGUI 候选完成本地检查，用户没有要求对外发布
- **THEN** 保留真实候选身份和检查结果，不推送、不声称远端可用，本地运行使用显式预备镜像

#### Scenario: 成功交付基础镜像
- **WHEN** 用户明确要求发布且候选通过验证，完成 DockerHub 推送与匿名读取检查
- **THEN** 远端固定引用和 digest 可匿名取得，按该 digest 运行的 NiceGUI 环境通过检查，正式 README 与脑包引用匹配

#### Scenario: 发布未成功
- **WHEN** 推送被拒绝或远端候选不可匿名拉取
- **THEN** 记录实际失败，不报告已发布，也不把该候选设置为可用的默认镜像

### Requirement: 修改后的应用自动生效且页面无需手动刷新

**Identifier:** WEBBASE-007

默认 NiceGUI 模板 SHALL 让用户在保持应用页面打开的情况下自动采用已成功部署的新版本，不要求手动刷新浏览器或重启 Service。显式开发模式 SHALL 支持 Python 页面及业务代码重载；默认运行模式 SHALL 在必要检查和部署成功后，依据实际就绪的代码/页面版本自动更新，不要求独立前端构建。磁盘文件改变、Service Ready、WebSocket 重新连接或通知到达 SHALL NOT 单独证明新版本实际生效。

codeVersion 和 frontendVersion SHALL 绑定对应 Python 源码、额外依赖锁定身份及实际镜像环境摘要；frontendVersion 表示页面实现与资源身份，不要求存在 React bundle。相同输入 SHALL 得到稳定版本；仅独立业务实现改变 SHALL 不改变页面版本；页面实现或实际基础环境变化 SHALL 改变相应版本。环境摘要 SHALL 来源于镜像的受构建输入绑定环境清单，不能以应用可写 marker 或可伪造环境变量替代；版本生成不包含自身字段、缓存或业务数据，不形成 hash 循环。检查记录、运行进程及页面取得的安全版本信息 SHALL 使用一致算法，运行版本反映实际已加载源码而不是请求时才读取的未生效磁盘内容。

页面身份 SHALL 支持应用显式扩展页面输入集合，将拆分后的页面辅助模块及本地浏览器资源纳入 frontendVersion，不只识别固定入口文件名。默认模板及部署指导 SHALL 提供并维护页面文件清单；附加文件内容或有效页面文件集合变化 SHALL 改变页面版本，独立业务模块、业务数据及缓存变化 SHALL NOT 因此改变页面版本。有效集合 SHALL 按稳定路径与内容计算；无清单的现有应用 SHALL 保留默认页面输入集合。清单格式错误、声明文件缺失、越界或符号链接 SHALL 明确失败，不静默遗漏并复用旧检查或报告新版就绪。

应用页面 SHALL 使用自己的同源受保护入口读取安全版本信息，不包含平台凭据。页面更新需要重载时 SHALL 自动保存/恢复模板支持的非秘密草稿与当前路径；仅业务实现变化时 SHALL 更新受影响的页面查询。草稿恢复准备失败 SHALL 保留现有输入并显示更新未完成，可自动重试，不能静默丢弃输入。

只有实际就绪且与本页已采用版本不同的更新 SHALL 触发重新加载；相同版本、检查失败、断线或短暂不可达 SHALL 不触发重载循环，连接或页面可见性恢复后 SHALL 自动重新检查。普通业务数据变化不得被误作代码版本变化。

该行为 SHALL 由 Pi 开发的应用模板提供，沿用现有 Service 授权和端口；不得为此强制刷新 Desktop 外壳、重建未改变的 iframe、访问跨源 DOM 或向第三方页面注入脚本。版本读取 SHALL 不启动新的 Agent Run，也不绕过正式脑包/Work 配置的显式 Apply。

#### Scenario: 页面保持打开时采用新前端
- **WHEN** 用户在默认应用的业务页保留未提交草稿，AI 成功部署新的 NiceGUI 页面实现
- **THEN** 无需用户点击刷新，页面自动采用新界面且当前路径和支持恢复的草稿保留

#### Scenario: 仅后端修改自动影响现有页面
- **WHEN** AI 修改独立业务实现并成功部署，页面实现未改变
- **THEN** 正在运行的 codeVersion 可验证改变，页面版本保持，已打开页面自动更新受影响查询和业务结果

#### Scenario: 页面辅助模块变化进入页面身份
- **WHEN** ui.py 导入页面清单中声明的辅助模块，AI 仅修改该模块的页面实现并成功部署
- **THEN** codeVersion 和 frontendVersion 均改变，已打开页面自动采用实际新效果并保留支持的草稿和路径，不因入口文件未改而沿用旧页面身份

#### Scenario: 本地资源及页面文件集合变化
- **WHEN** AI 修改已声明的本地浏览器资源，或新增、移除页面文件并同步维护清单
- **THEN** 有效页面输入变化使 frontendVersion 改变；相同有效集合和内容重复计算保持稳定，独立业务模块修改仍只改变 codeVersion

#### Scenario: 页面清单兼容与无效输入拒绝
- **WHEN** 现有应用没有页面清单，或提供的清单格式错误、引用缺失文件、越界路径或符号链接
- **THEN** 无清单时按原默认集合检查和运行；无效清单明确失败，不能静默忽略输入或使用旧检查报告新版就绪，已有源码与业务数据保留

#### Scenario: 仅基础环境升级时自动采用新前端
- **WHEN** 应用源码及额外依赖锁文件保持不变，原 Service 流程采用不同实际环境摘要的基础镜像并成功检查/部署，用户保持有草稿的非根路径页面打开
- **THEN** codeVersion 和 frontendVersion 均改变，页面自动采用新环境一次并保留草稿/路径；不要求手动 reload，不新增被动 Agent Run 或脑包 Apply

#### Scenario: 环境版本身份稳定且不可由 marker 冒充
- **WHEN** 对相同源码、依赖和镜像环境重复计算，或只改写运行 marker 而未加载新环境
- **THEN** 相同输入得到相同版本且无循环刷新，marker 或未加载的源码不能把旧进程报告为新版本就绪

#### Scenario: 开发模式前后端更新
- **WHEN** 开发模式修改 Python 页面或业务代码
- **THEN** 重载及自动重新连接后相应效果生效，用户不需手动刷新/重启，业务数据写入不触发源码重载

#### Scenario: 更新失败或断线不造成循环刷新
- **WHEN** 新检查失败、版本未改变或页面暂时失去服务连接
- **THEN** 不强制 reload、不丢弃现有草稿；连接恢复并确认新版本就绪后自动采用一次，无刷新循环

#### Scenario: 业务刷新不改变平台执行
- **WHEN** 页面检测版本、普通 Service 状态轮询或用户切换 Focus
- **THEN** 不额外启动 Agent Run、不 Apply 脑包、不重建未改变的应用 iframe，也不刷新无关第三方应用

## ADDED Requirements

### Requirement: 在基础镜像内安装并持久复用额外 Python 依赖

**Identifier:** WEBBASE-008

base SHALL 支持在已有 Python 环境中为应用安装镜像未预装的兼容 Python 包，无需用户或运行中的 Pi 构建镜像。安装 SHALL 使用应用获准 workspace 的独立可写环境，支持 pip、精确依赖声明、本地安装材料以及明确选择的联网获取。标准依赖仍来自固定 base；新增包不得静默替换或升级 base 的锁定依赖，冲突 SHALL 明确失败。

成功安装 SHALL 保留解析后的精确版本、完整性信息及重新安装额外依赖所需的本地材料，运行、检查和已安装命令 SHALL 使用同一选定环境。普通重启在相同依赖/镜像身份下 SHALL 复用已准备环境且不重新联网；环境重建 SHALL 可按锁定材料离线完成。新增依赖准备或校验失败 SHALL 保留原有效环境、代码和数据，不将部分安装标记为成功。需要 base 未提供的系统库或构建工具时 SHALL 明确报告限制，并保留通过 `FROM` 派生解决的入口，不授予 root 或 Docker socket。

#### Scenario: 安装一个基础镜像没有的 Python 包
- **WHEN** 应用声明一个兼容额外包并明确选择联网安装，注册表可达
- **THEN** 同一 base 的准备流程完成安装、固定依赖及保留本地材料，实际 NiceGUI 应用能够导入并使用该包，不需要镜像 build

#### Scenario: 重启复用额外依赖
- **WHEN** 已安装额外依赖的应用在包注册表不可达时重启或替换容器
- **THEN** 实际运行继续使用相同锁定依赖，不重复下载或退回缺包的基础环境

#### Scenario: 删除可再生环境后离线恢复
- **WHEN** 保留的声明、锁文件和安装材料有效，但应用的可再生 Python 环境已不存在
- **THEN** 能在匹配的 base 中离线重建，实际导入及依赖命令成功，源码与业务数据不被改写

#### Scenario: 依赖冲突或安装失败
- **WHEN** 新依赖与 base 锁定版本冲突、下载失败、完整性不匹配或安装校验失败
- **THEN** 原有效环境仍可查并可恢复使用，新候选不生效，部署报告真实失败，不清除业务数据

#### Scenario: 两个应用的扩展依赖相互独立
- **WHEN** 两个应用基于同一 base 安装不同的兼容扩展依赖
- **THEN** 各自使用自己的可写环境，一个应用的安装或失败不改动另一个应用或镜像标准环境

### Requirement: 用实际测量核对默认环境的验收开销

**Identifier:** WEBBASE-009

本次默认环境切换 SHALL 在可比的机器、Engine、业务场景和缓存条件下，记录旧 FastAPI/React 基线及 NiceGUI 候选的镜像/输入身份、首次准备、同输入重启、导出导入、完整工作站验收耗时与 workspace/快照体积。冷准备与已预备镜像的运行耗时 SHALL 分开，超时预算、历史记录或估算不能替代实际执行。

验收 SHALL 证明标准应用没有独立 npm/前端构建或完整 base 依赖副本，保留 BRN-006、ADEP-003 的业务、反馈、恢复和两份独立分享回路。测量不可比、旧基线未通过或某阶段没有改善时 SHALL 如实记录，不通过删用例、降低通过条件或单纯延长超时宣称提速。

验收记录 SHALL 引用实际对应候选的日志及验证材料，并能核对 image ID/input hash。最终候选的预检与通过结论 SHALL NOT 仅引用另一候选的旧日志；候选变化后所需验证 SHALL 绑定实际新身份，旧日志和测量保留原事实，未重跑检查 SHALL 明确标识其原身份与适用范围。

#### Scenario: 比较前后环境开销
- **WHEN** 同一环境分别完成旧基线和 NiceGUI 候选的同场景验收
- **THEN** 新记录给出各阶段实际耗时、体积和差异，可核对保持的业务覆盖及移除的准备步骤

#### Scenario: 基线无法完成或阶段出现退步
- **WHEN** 旧基线执行失败、测量条件不同或 NiceGUI 某阶段耗时增加
- **THEN** 记录实际条件、失败或退步，不把未取得的数字、超时预算或历史事实当作本次提速证明

#### Scenario: 最终候选证据引用与身份一致
- **WHEN** 修复运行工具后产生新候选，维护者更新验收记录及发布预检结论
- **THEN** 记录引用实际新候选的日志与验证材料，image ID/input hash 一致；旧候选日志保留且可区分，不把旧检查转写为新候选已通过
