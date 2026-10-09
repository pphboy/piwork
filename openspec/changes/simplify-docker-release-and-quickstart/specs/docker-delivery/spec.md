# Spec Delta

## MODIFIED Requirements

### Requirement: 交付两个入口镜像及可独立使用的发行包

**Identifier:** DOCKER-DELIVERY-001

每个新发行版本 SHALL 提供已发布且可按发行说明拉取的 Core 与 CLI 两个 `linux/amd64` 入口镜像，并以 Core、CLI 各一条独立 Docker 命令作为默认试用入口。Core SHALL 单独提供 Compose 部署方式，CLI 默认 SHALL 不使用 Compose，只连接已运行且可达的 Core。合并 Core 与 CLI 的单文件 Compose SHALL 作为 `examples/single-host/` 的可选“单机部署示例”（Single-host deployment）提供并由文档引用，不成为默认前置条件。默认入口及示例 SHALL 不要求取得压缩包、release.env、环境模板、源码或其他 Compose 文件。Core SHALL 携带同版 Agent、package/file/snapshot helper 的非敏感发行引用并自行准备运行依赖；package helper 可复用满足契约的 Agent 镜像。新安装用户 SHALL 只需分别启动 Core 和 CLI，不手动启动管理容器或拉取 helper；已有 Core 的用户 SHALL 可只运行 CLI。

入口与依赖镜像 SHALL 对应同一可核查的源码输入及协议组合，CLI SHALL 内嵌该版本 Desktop 资源。新镜像及其依赖 SHALL 使用发行专属、不可覆盖的版本标签或实际发布 digest，不使用 `latest` 等浮动引用；发行清单 SHALL 记录全部角色的实际 digest、源码身份、平台、协议及存储兼容信息，并核对其与经验证候选的镜像身份一致。对已存在而身份不同的发行标签 SHALL 拒绝发布，不能覆盖旧版本来掩盖差异。缺少实际地址、必需依赖、协议验证或对应平台证据时不得宣称该版本交付完成。

旧版本压缩包、release.env、环境模板及安装入口 SHALL 保留其版本归属，不成为新默认路径的前置条件。继续提供压缩包时 SHALL 保留外部 SHA256 和内部 SHA256SUMS、下载失败及 checksum 不符时停止的行为；已取得旧包的离线用户保留独立校验和安装入口，离线材料不等于镜像已离线可用。镜像、Compose、发行清单及文档 SHALL 不包含真实密码、模型 key 或用户 token。

本地候选 SHALL 与正式发行明确区分。既有 registry 登录不代表推送授权；构建、材料整理或验收 SHALL 不自动执行镜像 push、上传、Release 创建或官网发布，未经用户判断不得把候选地址写为可使用的新正式入口。

#### Scenario: 只取得一个 Compose 文件
- **WHEN** Linux 用户已具备支持的 Docker/Compose 和合法初始化环境变量，明确选择单机部署示例并取得其 docker-compose.yml
- **THEN** 不下载其他安装文件、不修改配置模板即可运行 Core 与 CLI 两个独立容器，Core 自动取得匹配运行依赖；此示例不取代默认独立入口

#### Scenario: 直接使用已发布镜像
- **WHEN** 用户选择文档中的 Core 和 CLI Docker run 命令
- **THEN** 每个入口各用一条逻辑启动命令，无需发行压缩包、release.env、Compose 或源码构建

#### Scenario: 运行依赖没有发布
- **WHEN** 任一必需依赖不可取得、协议不匹配，或发行标签已对应另一候选身份
- **THEN** 发行检查失败，不覆盖旧标签、不让用户自行寻找 helper 补齐

#### Scenario: 下载发行包而不是构建源码
- **WHEN** 用户持有旧发行包及对应可信校验信息
- **THEN** 按旧版本入口完成校验与安装，无需构建源码；旧材料不被伪装成新镜像已具备的默认配置

#### Scenario: 仅修复问题且未请求发行
- **WHEN** 本地镜像和材料检查完成但用户尚未明确允许推送
- **THEN** 提供可审阅的候选身份和检查结果，保留未发布状态，不因已登录 Docker Hub 而推送

#### Scenario: 已有下载地址时使用可选下载步骤
- **WHEN** 用户按旧版本手册使用实际压缩包和 SHA256 文件地址
- **THEN** Linux Bash 或 Windows PowerShell 下载后比较可信预期 checksum，成功后才解压和验证内部清单；这些操作不成为新默认入口的前置条件

#### Scenario: 已取得离线发行包
- **WHEN** 用户离线取得旧版本完整包和对应可信 SHA256
- **THEN** 可独立校验、解压并按对应版本安装，无需再次下载同一包，说明后续镜像仍须可取得

#### Scenario: 下载或校验失败
- **WHEN** 旧版本可选下载失败或任何发行材料的 checksum 非法或与可信预期值不符
- **THEN** 停止使用相应材料，不只输出 hash 后继续解压或安装，不将损坏材料称为已验证候选

#### Scenario: 旧包缺少新模板
- **WHEN** 已校验旧包缺少后续加入的 Docker run 配置模板
- **THEN** 旧版本手册保留独立空白原始值示例，不修改真实已填配置；此兼容过程不重新进入新默认 Quick Start，也不宣称旧包包含新材料

### Requirement: 明确 Core 与客户端的平台边界

**Identifier:** DOCKER-DELIVERY-002

Core Docker SHALL 在 Linux Docker Engine 的 host 网络下运行；CLI Docker SHALL 在 Linux Docker Engine 和 Windows Docker Desktop 的 Linux 容器模式运行。首发支持 `linux/amd64` 镜像，发行说明 SHALL 记录实际测试的 OS、Docker Engine/Desktop、Compose 和架构；Engine 基线为 28 或更新。直接 Docker run 终端流程 SHALL 不要求 Compose；Core Compose、单机部署示例及高级 Compose 部署要求 Compose v2.24 或更新。单机部署示例 SHALL 面向 Linux 同机 Core/CLI，Windows CLI 连接 Linux Core 的操作放在平台手册中。Windows Core、Windows 容器及其他镜像架构不属于本次交付。

宿主不支持相应镜像或模式时 SHALL 给出明确前置条件和修正方向，不能以模拟验收宣称兼容。用户显式选择 Desktop 时浏览器位于 CLI 所在电脑；终端默认路径 SHALL 不要求浏览器。

#### Scenario: Windows 用户连接 Linux Core
- **WHEN** Windows Docker Desktop 使用 Linux 容器，终端 CLI 配置可达的 Linux Core 地址
- **THEN** 可在终端登录和使用现有业务命令；显式 Desktop 入口仍可使用同机浏览器，不需要 Core 的 Docker socket

#### Scenario: 使用 Windows 容器模式
- **WHEN** docker info 报告 Windows 容器模式
- **THEN** 文档要求切换 Linux 容器并重新检查，不指导在该模式启动 Core/CLI Linux 镜像

#### Scenario: Linux 终端试用未安装 Compose
- **WHEN** 同机 Linux 用户拥有支持的 Docker Engine 和已发布镜像，但没有 Compose
- **THEN** 仍可用直接 Docker run 路径启动 Core/CLI、登录、创建 Work 和聊天

### Requirement: Core 管理运行过程并保留准确的宿主路径

**Identifier:** DOCKER-DELIVERY-003

Core SHALL 挂载同一 Linux Engine 的 Unix socket，默认 /var/run/docker.sock，并设置 DOCKER_HOST=unix:///var/run/docker.sock，不依赖宿主 Docker CLI 或不完整 Docker context 文件。Core 数据目录 SHALL 在宿主和容器使用相同绝对路径；默认 Docker run 与 Core-only Compose 使用 /var/lib/piwork/quickstart/core，单机部署示例使用独立的 /var/lib/piwork/examples/single-host/core 和专属 CLI 状态卷；已有高级 Core Demo 的 /var/lib/piwork/core 保持独立，以满足 Engine 创建 Agent/helper bind mount 的宿主路径语义。Core SHALL 按既有安装/Work 身份管理 Agent、Service/helper、Work 私网及私有/workspace 卷，不由用户 Compose 管理这些内部对象。

新空数据路径 SHALL 可由默认启动挂载自动创建，并由现有安全初始化设定私有权限，不要求用户先执行 mkdir。Core SHALL 保留私有目录/文件权限和单实例锁；新安装默认以 UID 0 创建独占数据目录，已有数据须匹配其所有者及 socket 访问权限，禁止无条件改变已有文件所有者或放宽校验。缺失 socket 不得被 Compose 自动建成目录。CLI SHALL 不挂载 Docker socket、Core 数据或 Work 私有卷。

#### Scenario: Core 启动一个 Work
- **WHEN** 登录用户创建 Work，Core 需要创建 Agent 和只读配置挂载
- **THEN** 宿主 Engine 找到相同绝对路径的配置，Core 自动管理网络和 Work 卷，CLI 无需访问 Engine

#### Scenario: 首次使用没有数据目录
- **WHEN** 用户按默认命令启动新安装且独立试用数据路径尚不存在
- **THEN** 挂载和安全初始化创建合法私有目录，不额外要求宿主准备目录，不影响其他安装

#### Scenario: 不同绝对路径或 socket 不可用
- **WHEN** 源/目标绝对路径不同，socket 缺失或权限不足，或已有数据不满足所有者和权限检查
- **THEN** 启动或就绪检查安全失败，不创建伪 socket 目录、不修改已有数据所有者、不报告完整就绪

### Requirement: 容器网络覆盖本机和外部服务

**Identifier:** DOCKER-DELIVERY-004

Core host 网络 SHALL 支持 Core 直接访问其 Engine 上 Work 私网地址，以及 Agent 经 `piwork-core:host-gateway` 回连 Core 的既有 mTLS 控制端口；默认 HTTP 7171，Agent 控制 7172，不要求发布每个 Service 端口。非 loopback HTTP SHALL 显式沿用既有远程明文 opt-in，文档说明监听范围和已有认证/TLS 能力。

默认终端 CLI SHALL 使用独立 bridge、Linux host-gateway 和可达的 Core HTTP 地址，不发布 Desktop 端口；单机部署示例 SHALL 直接包含所需 Linux host-gateway 配置，无需覆盖文件。Windows CLI SHALL 使用 Docker Desktop 内建 host.docker.internal，远端 Core 通过 PIWORK_CORE_URL 配置。不将宿主 localhost、CLI 的 hostname 或 CLI 出站网络误认为 Agent 的模型/MCP 网络。HTTPS 自定义 CA SHALL 保留显式挂载和配置方式，不关闭证书校验。

高级 Desktop Compose SHALL 保留仅在宿主 127.0.0.1 发布 17891、内外端口一致及同机浏览器 URL 的既有契约；旧 Linux 覆盖文件仅用于其明确标注的高级或旧版本入口。

#### Scenario: Linux 同机 Core 和 CLI
- **WHEN** 用户采用独立 Docker run、Core-only Compose 配合独立 CLI，或明确选择单机部署示例，Core 使用 host 网络，CLI 设置 host-gateway 和 http://host.docker.internal:7171
- **THEN** CLI 可连接 Core，无需发布客户端端口、打开浏览器或下载 Linux 覆盖文件

#### Scenario: CLI 在 Windows 而模型在其他机器
- **WHEN** Windows CLI 连接远端 Linux Core，Work 需要调用模型或 MCP
- **THEN** 模型/MCP 地址必须从 Core 的 Work 网络可达，本机 CLI 的宿主别名不能替代该地址，既有 Base URL 校验保持

#### Scenario: 显式启动高级 Desktop
- **WHEN** 用户按高级说明运行显式 Desktop 命令及端口映射
- **THEN** 端口仅发布到宿主 loopback，同机浏览器及既有本地授权语义保持

### Requirement: 提供完整的中文操作命令与新增操作清单

**Identifier:** DOCKER-DELIVERY-006

发行手册 SHALL 给出 Linux Bash 与 Windows PowerShell 的镜像启动、就绪、状态与日志、重建、停止、保留数据卸载和升级/回退步骤，区分 Linux 同机默认入口与 Windows 远端 CLI。默认试用的初始化信息 SHALL 来自已有宿主环境变量，Docker run 只传变量名；Compose SHALL 从环境取得相同实际值，不要求编辑或 source 环境文件。五个必填名称为 PIWORK_ADMIN_ACCOUNT、PIWORK_ADMIN_PASSWORD、PIWORK_MODEL_PROVIDER、PIWORK_MODEL、PIWORK_API_KEY，管理员密码至少 12 位；可选 PIWORK_MODEL_BASE_URL 保留既有 HTTPS/可达性规则，未设置与显式空值不得混淆。值缺失或非法 SHALL 通过安全诊断或非就绪结果说明，不提供默认账号、密码或模型 key。

完整操作说明 SHALL 保留 Core 同绝对路径数据持久化、CLI 独立状态卷、host-gateway、完整交付就绪和高级文件交换、升级保留数据的解释。Desktop open/logout、浏览器、旧环境模板及压缩包校验 SHALL 放在明确标注的高级或旧版本入口，不进入默认 Quick Start 或单文件终端试用流程。

Core operator 与无 Desktop 用户业务命令 SHALL 提供完整 Docker 前缀和原有参数；交互方式 SHALL 给出完整进入命令，并标注后续 piwork-cli 在容器内执行。变量来源、执行位置、平台差异、文件输入输出以及 Operation/Work/Session/Run/Service ID 的取得和使用 SHALL 明确，不用省略必要前缀、未知脚本或省略号代替步骤。

文档 SHALL 使用 docker compose、docker run、piwork-serve、piwork-cli，不引入新业务顶层命令或用户 wrapper。登录密码等交互秘密 SHALL 使用隐藏 TTY 或 stdin，不放进命令参数；Core 初始化秘密不得传入 CLI 环境、公开材料或验收输出。检查特殊字符传递时 SHALL 使用合成值且不输出真实秘密；不推荐打印含真实初始化值的 Compose 展开配置。

#### Scenario: 新用户按文档操作
- **WHEN** 用户只有支持的 Docker、可用镜像或单一 Compose 文件及已导出的合法初始化变量
- **THEN** 无需创建、编辑或读取安装配置文件即可启动、登录、创建 Work 并收到回复，每一步知道执行位置及输入来源

#### Scenario: 采用无 Desktop CLI Docker
- **WHEN** 用户以显式 Docker 命令调用同一 CLI 镜像的业务入口
- **THEN** 说明覆盖身份、配置、Work/Operation、Session/Run/chat、Service、快照、proxy 及文件交换，不要求先启动 Desktop

#### Scenario: 秘密包含特殊字符
- **WHEN** 已有宿主环境的密码或模型 key 包含美元符号、空格或引号
- **THEN** 默认独立入口、Core Compose 与单机部署示例向 Core 传递相同实际值，不执行值中的 shell 内容、不额外加引号或递归插值，CLI 不取得这些初始化秘密

#### Scenario: 必填值不合法
- **WHEN** 初始化字段缺项、密码过短、可选地址非法，或显式设置可选地址为空
- **THEN** 默认流程不能报告完整就绪或继续首次对话，给出不包含秘密的修正方向；未设置可选地址不被变成非法空值

### Requirement: 保留安装状态并明确备份与回退边界

**Identifier:** DOCKER-DELIVERY-008

Core/CLI 停止、重建和 down 的默认说明 SHALL 保留 Core 目录、客户端卷及 Core 管理的 Work 卷。Core 正常关闭 SHALL 沿用 work-lifecycle 的既有有界排空与停止 Agent/Service 流程，保持 Work desiredState、Service 启用意图及数据，不隐式将持久目标改为 stopped 或删除 Work；重启按安装身份恢复 desiredState=running 的 Work 及启用的 Service。CLI 停止 SHALL 不停止 Work。持续业务停机 SHALL 显式执行 Work stop；常规升级/卸载不得使用 down -v、全局 prune 或删除未核对的运行卷。

Core 正常关闭成功 SHALL 以本安装全部受管 Work 运行容器已停止为前提，不要求 Work 在 Core 退出期间继续运行。某 Work 关闭失败仍须尝试其他 Work，无法确认停止时按既有非零退出及恢复诊断契约处理；异常退出不能记为已确认正常关闭。默认独立入口、Core Compose 和单机部署示例 SHALL 给予 Core 60 秒关闭窗口。CLI 的启动、退出和重进 SHALL 不创建、启动、停止或重建 Core；此约束在单机部署示例中同样成立。

升级 SHALL 固定新的发行身份并保留旧镜像引用、对应 Compose 文件及发行清单；旧安装继续保留其 release.env。升级前 SHALL 检查数据格式与迁移规则，初始化 env 不覆盖持久管理员/模型，默认配置修改使用已有 operator 入口。回退 SHALL 仅在格式兼容时恢复旧镜像；不兼容时恢复一致性确认的 Core 数据和匹配 Work 卷。.work 导出/import 是产生新 Work 的 Work 级迁移，不能称为保留原 ID 的安装回滚。

#### Scenario: Core 重建后恢复
- **WHEN** 用户保留数据目录和匹配运行卷，用原默认入口重建 Core
- **THEN** 原用户和 Work/Operation/Session/Run 标识及持久配置保留，不因合法初始化 env 改变而重置密码或模型

#### Scenario: 只备份 Core 数据或旧镜像
- **WHEN** Work 卷丢失，用户只持有 Core SQLite 或旧镜像
- **THEN** 说明不能完整恢复 Work 内容，不能宣称镜像回退或数据库复制完成安装恢复

#### Scenario: Core 停止后所有 Work 停止
- **WHEN** Docker stop 或 Compose stop/down 完成，Core 报告正常关闭成功后重新启动
- **THEN** 本安装 Agent/Service 运行容器先确认停止，记录、意图与卷保留，并按原持久意图恢复

### Requirement: 以 Core 与 Desktop 实际使用验证交付闭环

**Identifier:** DOCKER-DELIVERY-009

新默认交付 SHALL 用实际候选镜像，从独立空安装、无本版运行依赖缓存的 Linux Engine 开始，验证默认独立 Docker run、Core-only Compose 配合独立 Docker run CLI，以及可选单机部署示例。验证 SHALL 覆盖自动拉取、管理员/模型初始化、完整就绪、依赖失败和恢复、隐藏 TTY 登录、自动启动 Work、终端首条真实模型回复、CLI 重建后凭证保持，以及 Core 正常关闭停止受管 Work、重启后原对象和数据保持。容器运行、健康探针或确定性 fixture SHALL 不代替真实模型回复。

各路径 SHALL 验证不依赖其他安装文件、CLI 不持有 Core 初始化秘密、可选环境变量未设置与空值的差别，以及已有持久配置不被初始化值覆盖。候选检查 SHALL 核对当前源码输入、实际镜像身份、协议、CLI 内嵌资源、Compose/清单一致性与负向入口，不伪造元数据或用旧镜像结果证明新镜像入口。

既有 Compose/Desktop 全功能 Linux 与 Windows 浏览器验收 SHALL 保留为对应高级能力的证据，覆盖打开/登录、创建就绪 Work、模型 Run、Service HTTP/WebSocket、Files、停机导出/Inspect/import、重新 start、本地授权恢复/注销及 Core/CLI 重建后的数据保持；新终端验证不扩展为全部业务功能或替代原生平台验收。证据 SHALL 记录版本、环境、镜像身份、对象 ID、状态转移、结果及未完成项；缺少 Windows Desktop 实机、真实模型或公开镜像证据时不能用 Linux/终端/夹具结果冒充。

推送前 SHALL 完成本地候选验证并提供用户审阅结果。未获推送授权时 SHALL 保留本地候选状态，不要求绕过门禁完成公共发行。获得授权后 SHALL 另外验证匿名拉取、远端 digest、入口与全部依赖身份以及正式 Compose 下载材料；旧版 checksum、离线安装和 D01–D09 记录继续用于其对应未变行为，不视作新候选通过。

#### Scenario: 两种默认入口均完成终端闭环
- **WHEN** 新候选默认独立 Docker run 和 Core-only Compose 配合独立 CLI 均在独立 Linux 安装通过规定检查，单机部署示例另有对应验收
- **THEN** 可分别记录默认路径、Core Compose 替代方式与单机部署示例的本地验证完成、首条真实模型回复及恢复结果，无需 GUI 操作

#### Scenario: 缺少 Windows 或模型实际调用
- **WHEN** 只有构建、静态检查、fixture 回复，或缺少对应 Windows/模型/远端验证
- **THEN** 报告明确区分已通过和未执行项，不宣称完整正式发行闭环

#### Scenario: 用户批准推送后核对远端
- **WHEN** 用户审核候选后明确授权推送
- **THEN** 发布检查以实际远端 digest 和匿名读取证明同一候选可取得，必需依赖全部匹配后才生成正式入口材料

#### Scenario: 候选无法通过既有发行门禁
- **WHEN** 镜像、清单、Compose 或源码输入不一致，或 Core 关闭无法确认成功
- **THEN** 阻止候选通过，保留安全诊断，不重提已接受的操作、不自动推送或伪造成功证据

#### Scenario: 两种客户端平台均通过
- **WHEN** 同一正式发行的 Linux/Windows 高级 Desktop 验收和默认独立终端路径、Core Compose 和单机部署示例均具备对应真实使用证据
- **THEN** 可以声明所验证平台的完整交付闭环，同时独立保留原生验收结果，不能由单一平台结果推断其他平台通过

#### Scenario: 默认终端路径与 Core Demo 均可用
- **WHEN** 维护默认独立 Docker run、Core Compose、单机部署示例和仍受支持的高级 Core-only Demo
- **THEN** 默认独立入口、Core Compose 和单机部署示例按规定分别验证真实终端回复与恢复，高级 Core Demo 保留匹配镜像、独立路径、交互 CLI 兼容及对应使用验证；Demo 不成为新默认前置步骤

### Requirement: README 提供最短的终端试用入口

**Identifier:** DOCKER-DELIVERY-010

README.md 和 README.zh-CN.md SHALL 保持顶部互链、章节及命令同步，Logo 居中且保留已有图片和 160×160 尺寸。完整 Architecture 章节含图与解释 SHALL 位于项目介绍之后、Problem 之前。

Quick Start SHALL 默认展开 Docker 终端入口，分别提供 Core 和 CLI 独立 Docker run 命令，Core 可选用单独的 Compose 部署，CLI 默认不使用 Compose；合并 Compose 只以可选单机部署示例的链接提供；Core 入口前提只说明支持的 Docker 环境与已有五个初始化变量；CLI 入口只要求自己的运行环境和已配置、可达的 Core，不要求用户持有 Core 初始化变量。Try 中 SHALL 移除 Download and verify the installer、Configure and start Core 及对应压缩包校验、环境文件创建/编辑和 release.env 读取步骤，不以同义标题重新引入配置流程，不要求运行 make、源码构建或 Desktop/浏览器。

直接路径 SHALL 用 Core 和 CLI 各一条完整逻辑命令，明确引用已发布发行镜像。Core 使用 host 网络、同一 Engine Unix socket、相同绝对路径的独立试用数据目录及 60 秒关闭窗口；新空目录沿用现有安全初始化，不放宽已有目录权限校验。CLI 使用 host-gateway 和独立持久用户状态，不发布客户端端口、不挂载 Core 配置、socket、Work 数据。Core-only Compose SHALL 只定义 Core，保持相同的 Core 网络、存储及关闭规则。CLI 只需要自己的凭证存储和可达 Core 地址；无论 Core 如何部署，CLI 均可独立运行。单机部署示例 SHALL 独立说明其适用场景，不混入默认操作步骤。

默认 CLI SHALL 在至多 600 秒内等待完整交付就绪，再允许用户执行隐藏密码 TTY 登录、work create --wait 和 chat --message 得到首条模型回复；用户不必复制额外就绪循环。Work ID SHALL 来自创建结果，不额外列举或启动已自动运行的 Work。等待失败 SHALL 安全退出并指向状态/日志；操作或消息观察中断 SHALL 依据原 Operation/Run ID 恢复，不自动重提 mutation。

README SHALL 用默认关闭的折叠区域提供连接已有 Core 的原生 CLI 终端路径。代码块 SHALL 标注 shell、统一缩进、完整可复制；长命令按网络、环境、存储与镜像分组续行，业务命令独立展示，并说明执行位置和占位符来源。退出与重新进入终端的方式 SHALL 明确。

#### Scenario: 首次使用者完成一次对话
- **WHEN** 已导出合法初始化变量的 Linux 用户执行默认 Docker 入口
- **THEN** 无需下载发行包或填写配置，启动 Core 与终端 CLI 后即可登录、创建 Work 并收到首条模型回复

#### Scenario: 只使用已有 Core
- **WHEN** 用户已有可达且已配置的 Core，只执行 CLI 独立启动命令
- **THEN** 无需下载 Core Compose、启动本地 Core 或提供管理员/模型初始化变量，即可按用户身份登录和使用；CLI 退出不影响 Core 或 Work

#### Scenario: Core 正在准备依赖
- **WHEN** Core 健康但 docker-delivery readiness 未成功，或尚未监听
- **THEN** 默认 CLI 在预算内等待完整就绪，超过预算非零退出，不能把容器运行或健康视为成功

#### Scenario: Work 等待中断或消息流中断
- **WHEN** Work 等待或 Run 流超时/断开
- **THEN** 文档给出原 Operation/Run ID 的恢复方向，不重新创建 Work 或重发聊天来判断结果

#### Scenario: 查看原生 CLI 替代路径
- **WHEN** 用户已有可达且已配置 Core，展开原生 CLI 折叠区域
- **THEN** 可按明确的 Linux/Windows 可执行文件名完成终端登录、创建和聊天，原生默认行为保持

#### Scenario: 阅读和复制代码
- **WHEN** 用户查看任一语言入口
- **THEN** Logo 居中，Architecture 位于 Problem 前，长命令规整分行，两种语言对应命令相同，Try 不含旧下载及配置步骤

### Requirement: 可选 Core Compose Demo 与默认材料同步维护

**Identifier:** DOCKER-DELIVERY-011

默认 Core Compose SHALL 仅定义 Core；默认 CLI SHALL 使用独立 Docker 命令。合并 Core 和终端 CLI 的配置 SHALL 放在 examples/single-host/docker-compose.yml，作为“单机部署示例”（Single-host deployment），提供 README.md 和 README.zh-CN.md，并由根双语 README、安装手册及官网引用。示例 SHALL 包含两个独立容器的固定发行镜像、环境传入、Linux host-gateway、数据与状态持久化、完整就绪及关闭预算，不依赖 env_file、release.env、include、extends 或第二个 YAML。既有高级或旧版材料 SHALL 保留清晰的用途与版本归属。

默认独立入口与 Core-only Compose SHALL 共用同一 Core 数据路径，以便停止后顺序切换。单机部署示例 SHALL 使用 /var/lib/piwork/examples/single-host/core 和专属用户状态卷，与默认安装及已有高级 Demo 隔离；宿主与容器数据绝对路径仍须相同。示例与默认 Core 不得同时争用同一监听端口，说明 SHALL 明确先停止冲突服务，不自动停止已有安装。CLI 启动、退出或重进 SHALL 不触发 Core 的创建、启动、停止或重建；Core 不存在或未就绪时由 CLI 有界等待并安全失败。

发行材料、双语 README、安装手册、镜像默认配置、Core Compose、单机部署示例与官网双语页面 SHALL 同步维护，并提供可执行的一致性检查。镜像、初始化变量、网络、数据目录、用户状态、等待或关闭预算改变时 SHALL 同步对应命令、示例、模板及材料清单，不依赖后续人工记忆。

官网 Quick Start、首页试用入口、安装、First Work、源码安装导航及当前静态下载材料 SHALL 与根 README 和当前发行一致。每次同步 SHALL 更新上述全部当前镜像引用，连续同步不同候选亦不得残留前一候选；旧版本下载地址及冻结材料保留其原有内容和归属。新候选或下载文件未公开时不能宣称已可下载。

检查失败 SHALL 阻止不同步材料进入候选；诊断不得输出真实环境值。正式材料 SHALL 记录 Core Compose、单机部署示例 Compose 的校验与镜像来源，生成后的引用、内容或清单不一致时检查失败。

#### Scenario: 新 Compose 文件独立运行
- **WHEN** 用户明确选择并仅下载单机部署示例的 docker-compose.yml，使用合法宿主环境
- **THEN** 无需旁置环境文件或第二个 YAML 即可运行 Core 与 CLI 两个独立容器，默认 Quick Start 仍为独立 Docker 入口

#### Scenario: 切换默认启动方式
- **WHEN** 用户先停止 Core Docker run，再用 Core-only Compose 重新创建 Core，或反向切换
- **THEN** 同一 Core 数据目录保留原安装，独立 CLI 的状态卷和凭证不变；不会自动迁移到单机部署示例的数据目录

#### Scenario: 材料产生漂移
- **WHEN** README、Core Compose、单机部署示例、镜像默认值、手册、官网命令或材料清单的关键字段不一致
- **THEN** 检查非零退出并指出文件和字段，修复后方可通过候选检查，诊断不包含秘密

#### Scenario: 高级 Demo 与旧下载保留
- **WHEN** 用户查阅已有高级 Core-only Demo、Desktop 或旧版本下载
- **THEN** 入口明确标注其用途和版本，旧地址不被覆写为未验证的新候选，也不要求默认用户使用它们

#### Scenario: 用户选择 Compose Demo
- **WHEN** 用户选择 examples/single-host/ 的单机部署示例
- **THEN** 文档说明适用场景、两个独立容器、专属数据与端口冲突处理，完整命令可完成终端使用，退出 CLI 不影响 Core 和 Work

#### Scenario: 新模板进入候选包
- **WHEN** Core Compose 或单机部署示例模板渲染并进入候选材料，或维护者继续制作旧类型安装包
- **THEN** 对应实际分发文件进入清单和校验，引用及内容与所属版本匹配，文件缺失或变化导致检查失败；新候选不因此重新要求压缩包或环境模板

#### Scenario: CLI 重进不改变 Core
- **WHEN** Core 已运行且有运行中的 Work，用户在缺少或改变初始化变量的新终端再次打开示例 CLI
- **THEN** Core 容器身份和启动时间保持，Work 不被停止，CLI 不取得初始化秘密；Core 不存在时不自动启动 Core

#### Scenario: 连续同步两个候选版本
- **WHEN** 官网依次同步候选 A 和候选 B
- **THEN** 两种语言的所有当前启动入口和示例引用均更新为 B；任一 First Work、首页、安装或当前下载引用残留 A 时门禁失败，冻结的历史版本材料保持原样

## ADDED Requirements

### Requirement: 使用 Docker 命令制作可审阅的发行候选

**Identifier:** DOCKER-DELIVERY-012

维护者 SHALL 能从同一源码输入用 Docker build 构建全部入口和运行依赖镜像，并通过 Docker 构建输出生成 Core-only Compose、单机部署示例及发行候选清单；宿主仅需相应 Docker 构建能力、Git 与终端工具，不要求安装 Go、Node、npm 或 Make，不要求先构建宿主 dist 文件。发行流程 SHALL 不新增独立发布的 Release 工具镜像，既有原生构建与发行入口继续独立存在。

构建 SHALL 记录真实源码 commit、修改状态、源码输入摘要、版本、平台和 CLI 资源身份，检查镜像与二进制身份及各协议一致。构建输入在候选生成期间变化、身份未知、引用不匹配或必需材料缺失 SHALL 使检查失败；真实秘密不得作为构建输入写入镜像层、标签或清单。

本地构建、候选检查和生成推送命令 SHALL 不执行 push。用户明确审核允许后，维护者才使用 Docker push 发布已检查的镜像；随后核对匿名读取、远端 digest 及候选身份，并生成对应正式材料。未完成远端检查 SHALL 不标记正式可用。

发布入口 SHALL 在首次推送前核对全部角色的实时本地镜像身份与用户已审阅候选清单，包括源码输入、平台、协议和 CLI 资源身份，并查询远端标签的实际 manifest/config 身份。不能以本地标签名、旧检查记录或可选 existingImageId 字段代替实时核验。任一角色身份改变、远端标签冲突、认证/网络错误或查询结果无法确认 SHALL 阻止全部推送；只有明确确认标签不存在或远端身份匹配才可继续。预检及演练 SHALL 不执行 push，镜像 config ID 不得冒充 registry manifest digest。

#### Scenario: 审阅后本地标签改变
- **WHEN** 任一待推送标签被指向与已审阅候选不同的镜像
- **THEN** 发布入口在任何 push 前失败，要求重新生成和审阅候选，不发布替换镜像

#### Scenario: 远端标签冲突或查询失败
- **WHEN** 任一角色远端身份不同，或查询遇到认证、网络错误及无法确认的结果
- **THEN** 全部角色零推送，不能把查询错误当成标签不存在

#### Scenario: 宿主没有 Go 或 Node
- **WHEN** 维护者仅有支持的 Docker 构建能力、Git 和终端工具，使用干净源码输入
- **THEN** 可以构建并核查 Core、CLI、Agent/helper 和候选材料，CLI 内嵌资源来自同一输入，运行镜像不携带宿主编译工具链

#### Scenario: 生成候选供用户判断
- **WHEN** 本地镜像和候选材料验证完成
- **THEN** 输出实际身份、材料校验、验证结果及待执行推送命令，不自动推送、不把本地候选标为正式发行

#### Scenario: 源码或镜像身份变化
- **WHEN** 构建后输入、镜像、CLI 资源或协议标签与记录不一致
- **THEN** 候选检查失败并要求重新制作一致候选，不能用修改清单来绕过检查

### Requirement: Docker CLI 默认进入终端并保留显式命令

**Identifier:** DOCKER-DELIVERY-013

CLI Docker 镜像在默认无参数启动时 SHALL 等待所选 Core 的 /readyz?profile=docker-delivery，成功后进入交互终端，不启动 Desktop、不打开浏览器。等待 SHALL 有最多 600 秒的总预算，失败时非零退出并给出不包含秘密的状态/日志方向，不能进入可误认为已就绪的默认试用终端。

提供显式参数时 SHALL 直接执行原 piwork-cli 入口，保留 help/version、业务命令及显式 Desktop 的参数和退出码，不强制其先等待网络或进入 shell。入口 SHALL 正确转交信号；Core/CLI 的运行工具边界、用户凭证存储和原生 CLI 默认 Desktop 保持。

#### Scenario: 默认进入交互终端
- **WHEN** 用户执行默认交互 CLI Docker 命令且 Core 完整就绪
- **THEN** 进入可运行 piwork-cli 的终端，保留独立用户状态，未启动 Desktop

#### Scenario: 离线查询版本或帮助
- **WHEN** Core 不可达但用户向 CLI 镜像传入 --version 或 --help
- **THEN** 命令立即按既有无网络入口返回，不等待 Core 或进入交互终端

#### Scenario: 显式业务或 Desktop 参数
- **WHEN** 用户向 CLI 镜像提供原有业务命令或 desktop --no-open
- **THEN** 完整转发参数、退出码与信号，终端默认值不改变显式命令及原生客户端行为
