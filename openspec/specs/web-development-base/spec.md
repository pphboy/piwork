# web-development-base Specification

## Purpose

为 Piwork 的多个 Work 提供可重复使用、直接运行或派生扩展的默认 Web 开发基础环境，使 Agent 能在现有受管 Service 和持久 workspace 内开发、构建、验证与交付应用，无需每次重新准备工具链和标准依赖。

## Requirements

### Requirement: 提供可直接使用和派生的 Web 基础镜像

**Identifier:** WEBBASE-001

项目 SHALL 提供 `docker.io/pphboy/piwork-web-base` 作为通用 Web 开发基础镜像，首版支持 `linux/amd64`。公开环境契约 SHALL 包含 Python 3.13、Node 24、FastAPI/Uvicorn、React、TypeScript、Vite、sqlite3 命令及标准模板的测试依赖，固定发布时的精确版本和依赖完整性。镜像 SHALL 支持直接执行 Work workspace 中的应用，并允许下游通过 `FROM` 增加依赖和改变启动命令；不要求应用包含 Todo、复盘或任何特定业务。

镜像 SHALL 按 UID/GID `10001:10001` 使用，支持现有非 root、只读根文件系统及 workspace grant。其使用不得要求宿主 Python/Node、Docker socket、特权容器或宿主端口。它是应用 Service 镜像，不承担 agentd 的 SDK、模型或私有历史职责。

sqlite3 CLI SHALL 在镜像 PATH 中预装并可直接执行，支持 workspace 内的数据库建立、查询及机器可读结果，无需启动时联网安装或 root。Python sqlite3 模块、Node SQLite API 或仅有 SQLite 库 SHALL NOT 替代该命令交付；Agent 容器内的同名 CLI 由 RUNTIME-TOOLS-SQLITE-001 单独保证。

#### Scenario: 两个 Work 直接复用环境
- **WHEN** 两个独立 Work 用同一固定镜像分别部署不同 Web 应用
- **THEN** 两者使用相同工具链，各自在自己的 workspace 读写代码和数据，网络及业务状态独立

#### Scenario: 下游派生基础镜像
- **WHEN** 下游维护者用已发布固定引用通过 `FROM` 添加专用依赖和启动命令
- **THEN** 派生应用能沿现有 Service 部署流程运行，无需修改基础镜像业务代码或取得 Agent 私有存储

#### Scenario: 非 root 应用直接调用 sqlite3
- **WHEN** base 以 UID/GID 10001:10001、只读根文件系统和可写 workspace 启动
- **THEN** sqlite3 命令可直接执行，在 workspace 合成数据库中建表、写入并查询机器可读结果，无需安装额外工具

### Requirement: 标准应用能够离线准备构建和启动

**Identifier:** WEBBASE-002

基础镜像 SHALL 提供与默认模板一致的锁定离线依赖，使标准应用在镜像已可用且包注册表不可达时，仍能在干净 workspace 完成依赖准备、前后端测试、前端构建和启动。开发者 SHALL 能在自己的应用副本中修改源码、依赖声明和启动配置；新增依赖不在离线集合时 SHALL 明确报告缺项，并通过显式锁定和保留依赖或派生镜像解决，不静默下载可变最新版本或伪称离线成功。

#### Scenario: 首次启动没有注册表网络
- **WHEN** 使用已拉取镜像和与其匹配的标准模板，在空应用依赖目录且注册表不可达时启动
- **THEN** 依赖准备、测试、构建和应用请求成功，无 pip/npm 注册表下载

#### Scenario: 扩展依赖不在环境中
- **WHEN** 应用锁文件新增一个离线集合中没有的包
- **THEN** 准备失败并报告所需依赖，已有源码、数据和原有效依赖保留，不偷偷使用其他版本

### Requirement: 默认使用同一 Service 的单 HTTP 入口

**Identifier:** WEBBASE-003

标准运行方式 SHALL 在 `0.0.0.0:8080` 提供构建后的前端、业务 API、既有 `/pi/v1` 交互契约及 `/health` 就绪检查，全部通过同一声明端口访问。前端构建成功且后端可服务之后才能报告就绪；失败 SHALL 有非零结果或明确运行错误，不用空白页面、旧前端产物或占位健康响应冒充交付成功。API/协议路由不存在时 SHALL 保留相应错误，不能被 SPA 页面回退吞掉。

基础环境 SHALL 提供显式开发模式供前后端迭代，并通过现有授权 Service 入口工作；静态资源、页面路由、API 及开发 WebSocket SHALL 不依赖硬编码容器 IP、宿主端口或浏览器直连容器。React 页面 SHALL 只调用自己的 Service 后端，不获得平台交互 token。

#### Scenario: 浏览器打开并刷新业务页面
- **WHEN** 用户经 Desktop 打开默认应用、访问业务页并直接刷新
- **THEN** 前端资源与同源 API 正常，路由刷新可用，Pi 能通过同一后端查询对应业务状态

#### Scenario: 构建失败
- **WHEN** 前端存在语法或类型错误使构建失败
- **THEN** 该次部署不能报告应用已就绪，错误可从原 Operation/日志查到，业务数据保持

#### Scenario: 显式开发模式
- **WHEN** 开发者使用开发模式并通过受保护的 Service 入口修改页面
- **THEN** 页面更新与 API 调用可用，开发 WebSocket 不绕过当前 Work/Service 授权

### Requirement: 应用文件可持久编辑且启动不覆盖业务

**Identifier:** WEBBASE-004

源码、锁文件、可写依赖、缓存、构建产物和运行临时文件 SHALL 使用该 Work 获准的 workspace；业务数据 SHALL 使用 `data/<service-name>`。镜像内预置依赖为只读来源，应用需要修改的依赖不得仅链接到不可写镜像目录。模板初始化 SHALL 是显式且不覆盖已有文件的动作，普通启动/重启不得重建模板、清空数据或修复成空数据库。

默认模板指导与 SDK 部署验收 SHALL 共用实际安全初始化入口。初始化 SHALL 在写入任何 SPEC.md、源码、锁文件或注册信息前拒绝已存在的应用目标，包括空目录、文件和符号链接；独占创建或等效无覆盖操作 SHALL 防止并发初始化相互覆盖。拒绝 SHALL 保留原代码、依赖、注册信息和业务数据，不继续创建或重部署 Service，不把跳过文件后的部分混合模板报告为成功。已有应用的维护 SHALL 读取实际内容并作局部更新，不通过重新初始化恢复模板。

Service 和 Agent SHALL 使用现有共享身份读写应用文件。Stop/Start、Service 替换和完整环境导出导入 SHALL 保留应用源码、锁定依赖及业务数据；导入仍是 stopped Work，由用户显式 Start。重建可再生产物须按锁文件完成，不能覆盖用户修改。

#### Scenario: 只读根文件系统下开发
- **WHEN** Service 的根文件系统只读且仅 workspace 可写
- **THEN** 标准依赖准备、构建、测试、运行和缓存写入成功，Agent 能继续编辑 Service 生成的应用文件

#### Scenario: 重启或再次初始化
- **WHEN** 已有应用有自定义代码和业务数据，随后 Service 重启或再次执行初始化
- **THEN** 重启沿用已有内容，初始化拒绝覆盖，修改和数据均保留

#### Scenario: 真实 SDK 重复初始化先拒绝写入
- **WHEN** 默认部署路径已初始化应用，用户已修改 SPEC.md、源码或锁文件并保存业务数据，随后真实 SDK 再次调用同一初始化入口
- **THEN** 初始化失败发生在任何覆盖写入之前，原文件、数据和 Service 保持，部署 driver 不继续 service_create 或重启；不能用原幂等回执掩盖初始化失败

#### Scenario: 已有目标不能作为空白应用接管
- **WHEN** 初始化目标是已有空目录、普通文件、符号链接，或已由另一并发初始化调用取得
- **THEN** 当前调用明确拒绝且不跟随链接或覆盖目标，不改动已有应用和业务数据

### Requirement: 默认环境具有可查文档和固定版本

**Identifier:** WEBBASE-005

仓库 SHALL 将 `deploy/images/web-base/` 作为基础镜像的长期维护源，保存构建材料、环境版本/锁文件、通用工具及顶部互链的英文/中文 README。README SHALL 同步解释 base 概念、与 Agent/Work/Service 的关系、直接使用、`FROM` 派生、模板入口、准备/构建/运行/开发命令、自动生效/页面刷新、sqlite3 用法、workspace/数据持久化、依赖扩展、只读身份、版本升级及已验证平台。根 README 双语 SHALL 提供入口，不要求用户从历史验收记录推导当前用法。

文档 SHALL 明确镜像源位于本仓库 `deploy/images/web-base/`，构建/验证/发布入口位于 scripts/Makefile，脑包保存使用指导、模板及固定引用，`dist/web-base/` 是本地产物，DockerHub 是发布制品位置。后续镜像维护 SHALL 从仓库源和锁文件产生新版本，不能把临时容器补丁或某个 Work 的副本当作唯一维护源。

默认脑包 SHALL 使用可查的固定版本和已验证镜像 digest；构建材料与脑包引用 SHALL 能核对环境兼容性，不能仅写 `latest`。镜像可独立发行，不强制与 Core/CLI/Agent/helper 同次发布。

#### Scenario: 按文档复用基础镜像
- **WHEN** 维护者按任一语言 README 创建应用或构建派生镜像
- **THEN** 命令与目录一致且可执行，能查到工具链、固定镜像引用、支持平台和依赖扩展方式

#### Scenario: 后续维护能够找到权威来源
- **WHEN** 维护者需要升级基础工具链或 sqlite3 并发布新版本
- **THEN** 从 README 可定位本仓库维护目录、锁文件和构建/发布入口，无需读取某个 Work 或修改运行容器

### Requirement: 发布后才能宣称 DockerHub 交付完成

**Identifier:** WEBBASE-006

实施 SHALL 在构建、离线运行、派生及真实 Service 验证通过后，将基础镜像发布到用户指定的 DockerHub `pphboy` 命名空间。版本 SHALL 绑定源码身份、构建输入、锁定环境、平台及镜像内容；不得覆盖已有不同内容的固定版本。发布记录 SHALL 区分本地候选和远端已发布，保存真实 registry digest，并证明该 digest 可匿名拉取和运行。推送失败或匿名读取失败 SHALL 如实保留未完成状态，不能让默认脑包引用不可获得的候选。

#### Scenario: 成功交付基础镜像
- **WHEN** 候选验证通过且实施阶段完成 DockerHub 推送
- **THEN** 远端固定引用和 digest 可匿名取得，按该 digest 运行的基础环境通过检查，README 与默认脑包引用匹配

#### Scenario: 发布未成功
- **WHEN** 推送被拒绝或远端候选不可匿名拉取
- **THEN** 记录实际失败，不报告已发布，也不把该候选设置为可用的默认镜像

### Requirement: 修改后的应用自动生效且页面无需手动刷新

**Identifier:** WEBBASE-007

默认模板 SHALL 让用户在保持应用页面打开的情况下自动采用已成功部署的新版本，不要求手动刷新浏览器或重启 Service。显式开发模式 SHALL 支持前端热更新及后端代码重载；默认运行模式 SHALL 在必要 checks/build 和部署成功后，依据实际就绪的应用代码/前端版本自动更新。磁盘文件改变、Service Ready 或通知到达 SHALL NOT 单独证明新版本实际生效。

codeVersion 和 frontendVersion SHALL 将实际镜像环境摘要与对应源码/锁文件摘要共同纳入计算；仅在单独 environmentHash 字段报告环境变化 SHALL NOT 替代版本身份的变化。相同输入 SHALL 得到稳定版本；仅后端源码改变 SHALL 不改变 frontendVersion；仅基础环境改变并重新成功构建/部署 SHALL 改变前端版本，使旧页面采用匹配该环境的新 bundle。环境摘要 SHALL 来源于镜像的受构建输入绑定环境清单，不能以应用可写 marker 或可伪造环境变量替代；版本生成不包含自身字段或生成产物，不形成 hash 循环。checks/build、实际后端与前端 bundle SHALL 使用一致的版本算法。

应用页面 SHALL 使用自己的同源受保护入口读取安全版本信息，不包含平台凭据。新前端需要页面重载时 SHALL 自动保存/恢复模板支持的非秘密草稿与当前路径；后端版本改变而前端未变时 SHALL 更新受影响的页面查询，避免继续展示旧业务结果。草稿恢复准备失败 SHALL 保留现有输入并显示更新未完成，可自动重试，不能静默丢弃输入。

只有实际就绪且与本页已采用版本不同的更新 SHALL 触发重新加载；相同版本、构建失败、断线或短暂不可达 SHALL 不触发重载循环，连接或页面可见性恢复后 SHALL 自动重新检查。普通业务数据变化不得被误作代码版本变化。

该行为 SHALL 由 Pi 开发的应用模板提供，沿用现有 Service 授权和端口；不得为此强制刷新 Desktop 外壳、重建未改变的 iframe、访问跨源 DOM 或向第三方页面注入脚本。版本读取 SHALL 不启动新的 Agent Run，也不绕过正式脑包/Work 配置的显式 Apply。

#### Scenario: 页面保持打开时采用新前端
- **WHEN** 用户在默认应用的业务页保留未提交草稿，AI 成功部署了新的前端版本
- **THEN** 无需用户点击刷新，页面自动采用新界面且当前路径和支持恢复的草稿保留

#### Scenario: 仅后端修改自动影响现有页面
- **WHEN** AI 修改后端业务逻辑并成功部署，前端产物未改变
- **THEN** 正在运行的 codeVersion 可验证改变，已打开页面自动更新受影响查询和业务结果，无需手动 reload

#### Scenario: 仅基础环境升级时自动采用新前端
- **WHEN** 应用源码和锁文件保持不变，维护者通过原 Service 流程采用不同实际环境摘要的基础镜像并成功检查、构建和部署，用户保持有草稿的非根路径页面打开
- **THEN** codeVersion 和 frontendVersion 均改变，页面自动采用与新环境匹配的前端一次并保留草稿/路径；不要求手动 reload，不新增被动 Agent Run 或脑包 Apply

#### Scenario: 环境版本身份稳定且不可由 marker 冒充
- **WHEN** 对相同源码/锁文件/镜像环境重复计算或构建，或只改写磁盘运行 marker 而未加载新环境
- **THEN** 相同输入得到相同版本且无循环刷新，marker 不能改变当前进程已加载的环境/代码版本或把未交付环境报告为就绪

#### Scenario: 开发模式前后端更新
- **WHEN** 开发模式修改前端组件或后端源码
- **THEN** 相应界面热更新或后端重载后生效，用户不需手动刷新/重启，业务数据写入不触发源码重载

#### Scenario: 更新失败或断线不造成循环刷新
- **WHEN** 新构建失败、版本未改变或页面暂时失去服务连接
- **THEN** 不强制 reload、不丢弃现有草稿；连接恢复并确认新版本就绪后自动采用一次，无刷新循环

#### Scenario: 业务刷新不改变平台执行
- **WHEN** 页面检测版本、普通 Service 状态轮询或用户切换 Focus
- **THEN** 不额外启动 Agent Run、不 Apply 脑包、不重建未改变的应用 iframe，也不刷新无关第三方应用
