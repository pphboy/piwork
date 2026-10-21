## MODIFIED Requirements

### Requirement: 原生交付覆盖完整的 Work 使用闭环

**Identifier:** NATIVE-006

最终交付 SHALL 满足全部现行主规格经本变更 delta 合并后的 Requirement 和 Scenario，包括 Core 控制面、用户 CLI、Desktop、Core 内嵌管理 UI 与完整 TS harness 的交互。Core 阶段验收 SHALL 已包含 Go MCP/package/file/snapshot 程序及其镜像兼容边界。验收 SHALL 使用真实 Go 程序、Docker Engine 和真实 Pi SDK 路径；确定性模型可作为模型提供者，但不能用模拟 Core/Agent/Service 绕过业务边界。

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

## ADDED Requirements

### Requirement: 干净构建和本地发行

**Identifier:** NATIVE-008

系统 SHALL 只从本次已验证输入组装 Linux 发行，宿主执行文件清单仅包含 piwork-core 和 piwork-cli；MCP/package/file/snapshot helper 继续随相应内部镜像交付。发行 SHALL 核对版本、commit、dirty、平台、UI、协议、镜像引用和校验和，Core 内嵌引用与配套生产镜像一致。验收镜像、旧程序、非 Linux 产物、旧 staging、临时报告和历史开发附件不得混入发行包。

构建和打包 SHALL 在独立暂存区完成，仅在全部校验成功后替换受管本地输出。失败不得发布半成品或破坏上次完整发行；再次运行应能安全识别本次暂存与上次完整输出。成功后的 dist/release SHALL 仅保留本次完整展开目录、对应压缩包及外部校验文件。清理只针对已确认归属的构建/打包目录，拒绝危险输出路径，不触及 Core 数据、凭证、Work 卷、其他安装和历史发布记录。

包内使用明确文件清单，包含两个程序、许可、当前必要双语使用材料/资源、构建和镜像身份及校验；离线依赖镜像按生产镜像 ID 去重。不通过目录通配或文档链接遍历打入整个源码、OpenSpec 或历史证据。候选仍是本地产物，不因 make release 自动 push、上传或发布。

#### Scenario: 旧残留不进入新包
- **WHEN** 构建和发布目录预置旧 piwork-serve、piwork-console、helper、Windows 包、旧版本目录和验收报告后制作发行
- **THEN** 新输出只包含本次允许文件，两个程序及资源、镜像身份均可核对

#### Scenario: 重复发布
- **WHEN** 连续制作候选 A、B，并再次制作 B
- **THEN** 每次成功后成品清单只对应当前候选，内容与校验自洽，无 A 残留、嵌套包或重复镜像

#### Scenario: 生成或校验中断
- **WHEN** 编译、镜像身份核验、归档或最终提交失败
- **THEN** 命令非零退出，不发布部分结果；上次完整成品可恢复，本次暂存不被误认为成功发行

#### Scenario: 无权清理的路径
- **WHEN** 构建输出配置指向仓库根、用户目录、链接目标或非受管数据目录
- **THEN** 清理前拒绝，原文件与业务数据保持不变

### Requirement: 以两个 Linux 原生程序交付平台入口

**Identifier:** NATIVE-001

系统 SHALL 仅为 Linux 交付 `piwork-core` 和 `piwork-cli` 两个宿主程序，当前发行目标沿用 linux/amd64。Core 无子命令启动完整 Core、管理页面、工作台和首次引导；只提供 core-service-startup 规定的三项运行配置及帮助/版本查询。系统 SHALL 删除 piwork-serve、piwork 别名、独立 piwork-console、serve 子命令和旧 Core 管理命令，不提供转发壳或兼容解析。

piwork-cli SHALL 继续提供默认 Desktop、用户命令、proxy、凭证及原输出/退出契约，可连接本机或远程 Core；不启动、停止或配置 Core 进程。operator 身份、凭证和受保护管理 API SHALL 保留，用户客户端不读取 operator 凭证。浏览器访问不受原生 Linux 平台边界限制，Windows 浏览器仍可访问 Linux Core。

正常运行 SHALL 不依赖宿主 Node、npm、Python、Go、Docker CLI 或 openssl；系统 CA、可写私有数据目录、网络及 Linux 本机 Docker Engine 属于设施。浏览器打开器可选，不可用时输出 HTTP URL 并保持运行。

同一 Core 进程 SHALL 启动独立 UI 与 Core HTTP 服务；浏览器只连接 UI，ControlPlane 后端和原生客户端通过实际 Core HTTP 调用。端口、远程连接和关闭遵守 core-service-startup。

#### Scenario: 两个宿主产物
- **WHEN** 从干净源码执行 make build，或在带旧构建残留的工作区重复执行
- **THEN** 宿主输出目录最终只有 piwork-core、piwork-cli，无旧别名、Console 或 helper

#### Scenario: 无工具宿主启动
- **WHEN** Linux 机器仅有发行程序及必要设施，从任意工作目录启动 piwork-core
- **THEN** 一次启动提供完整网页引导和工作台，无旁置资源或第二宿主进程依赖

#### Scenario: 外部客户端
- **WHEN** Linux CLI 指定远程 Core HTTP 地址，或 Windows 浏览器访问服务器 UI
- **THEN** 分别按用户身份直连 Core 或使用 UI，不要求客户端部署 Core/Docker，不宣称 Windows 原生程序受支持

#### Scenario: 旧命令退出支持
- **WHEN** 用户查看新发行清单或给 piwork-core 传入 serve、status、admin、config、skills、packages、operation、login 或 chat
- **THEN** 清单没有旧程序，退役子命令被无副作用拒绝；operator 后端机制仍存在

## REMOVED Requirements

### Requirement: 以独立原生程序交付平台入口

**Reason**: 本变更删除旧命令、独立交付或非 Linux 路径；旧条款的相关正向场景不再成立，完整替换为“以两个 Linux 原生程序交付平台入口”，保留其中有效的业务和权限约束。
**Migration**: 按新条款使用两个 Linux 程序、Core 内嵌 UI 与既有管理 API；不保留旧语法、平台或容器兼容入口。
