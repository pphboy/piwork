# Spec Delta

## MODIFIED Requirements

### Requirement: 交付两个入口镜像及可独立使用的发行包

**Identifier:** DOCKER-DELIVERY-001

每个发行版本 SHALL 提供 Core 与 CLI 两个 `linux/amd64` 入口镜像和 `piwork-docker` 压缩包。包 SHALL 包含 `release.env`、Docker run 专用 `core.run.env.example`、Compose 专用 `core.env.example`、`client.env.example`、`compose.core.yaml`、`compose.cli.yaml`、`compose.cli.linux.yaml`、中英文安装手册及校验清单；`release.env` SHALL 写入该次实际发布的 Core、CLI、Agent、package/file/snapshot helper 固定 digest 引用。package helper 可复用满足其契约的 Agent 镜像。入口镜像和运行依赖 SHALL 来自同一可核查的源码版本与协议组合；CLI SHALL 内嵌该版本 Desktop 资源。

用户 SHALL 只需手动启动 Core 和 CLI；其余运行镜像和容器由 Core 按需准备，不要求用户运行额外管理容器或手动拉取 helper。发行镜像 SHALL 可按发行说明读取；缺少实际地址、digest、协议验证或必需平台证据的版本不得宣称交付完成。发行包 SHALL 不包含真实账号密码、模型 key 或用户 token。

发行材料 SHALL 附带压缩包 SHA256 和包内 SHA256SUMS；Linux Bash 与 Windows PowerShell 的安装命令 SHALL 比较可信预期 checksum，成功后才解压并核对内部清单。已有本地包的用户无需提供下载 URL。用户已有实际包和校验文件地址时，手册 SHALL 提供可选下载步骤，并在下载失败或校验不符时终止。文档和材料修复 SHALL 仅更新本机材料与使用命令，不执行镜像 push、包上传、Release 创建或托管配置，不要求提供发布地址/凭证，不新增公共下载入口或将实际对外发行作为完成条件；既有授权发行及使用证据保留。

已经取得完整发行包及对应可信 SHA256 的离线用户 SHALL 有独立的核对、解压、包内校验和后续安装入口，无需先访问下载页或构建源码。离线取得发行包不表示所有镜像离线可用，后续拉取仍使用既有 Docker 网络和 registry 条件。

新的 Quick Start SHALL 兼容已发行且缺少 `core.run.env.example` 的旧包：使用内嵌的空白原始值示例创建独立 Docker run 配置，不转换或覆盖真实的已填写配置。未发布的新候选 SHALL 明确为本机材料，不能宣称既有下载包已经包含新模板。

#### Scenario: 下载发行包而不是构建源码
- **WHEN** 用户取得正式发行包并使用支持的 Docker 环境
- **THEN** 能按包内命令拉取、配置并启动两个入口，无需 Go、Node、Python、源码构建或手动编排运行容器

#### Scenario: 运行依赖没有发布
- **WHEN** Core/CLI 已有镜像但必需的某个 helper digest 无法取得或协议不匹配
- **THEN** 该版本不能通过发布检查，不能让用户临时自行寻找镜像补齐

#### Scenario: 已有下载地址时使用可选下载步骤
- **WHEN** Linux 或 Windows 用户已有压缩包及 SHA256 文件的实际地址
- **THEN** 按对应 shell 命令下载并比较可信预期 SHA256，成功后解压并验证包内清单，无需源码构建；提供这些命令不触发维护者的发行操作

#### Scenario: 已取得离线发行包
- **WHEN** 用户已经通过离线交付取得本版完整压缩包和对应可信 SHA256
- **THEN** 从离线入口完成相同校验及解压，直接进入 Core/CLI 安装；说明后续镜像仍须可拉取，不要求再次下载同一包

#### Scenario: 下载或校验失败
- **WHEN** 可选下载失败，或在线/已有本地包的 checksum 与可信预期值不符或格式非法
- **THEN** 命令失败并停止解压和安装，不只输出计算出的 hash 后继续；用户没有 URL 时可直接使用已有包入口

#### Scenario: 仅修复问题且未请求发行
- **WHEN** 维护者实施文档和材料修复，未请求实际发行
- **THEN** 更新本机材料和修复证据，不上传、不 push、不创建 Release；既有 registry 登录不构成发行授权

#### Scenario: 旧包缺少新模板
- **WHEN** 用户使用校验通过的旧发行包，其中缺少 Docker run 专用示例模板
- **THEN** Quick Start 给出通过空白原始值示例创建独立配置的完整命令，用户填入自己的初始化信息，Compose 模板和已有真实配置不被改写

### Requirement: 明确 Core 与客户端的平台边界

**Identifier:** DOCKER-DELIVERY-002

Core Docker SHALL 在 Linux Docker Engine 的 host 网络下运行；CLI Docker SHALL 在 Linux Docker Engine 和 Windows Docker Desktop 的 Linux 容器模式运行，使用 Desktop 时浏览器位于 CLI 所在电脑。首发支持 `linux/amd64` 镜像，发行说明 SHALL 记录实际测试的 OS、Docker Engine/Desktop、Compose 和架构；Engine 基线为 28 或更新。默认 Docker run 终端流程 SHALL 不要求 Compose，选择 Compose Demo 或高级 Compose 部署时才要求 Compose v2.24 或更新。Windows Core、Windows 容器和其他镜像架构不属于本次交付。宿主不支持相应镜像/模式时 SHALL 给出明确前置检查及修正方向，不能通过模拟验收宣称兼容。

#### Scenario: Windows 用户连接 Linux Core
- **WHEN** Windows Docker Desktop 使用 Linux 容器，CLI 配置可达的 Linux Core 地址
- **THEN** 同机浏览器可登录并使用 Desktop，不依赖 Windows 原生 CLI、容器内部浏览器或 Core 的 Docker socket

#### Scenario: 使用 Windows 容器模式
- **WHEN** `docker info` 报告 Windows 容器模式
- **THEN** 文档明确要求切换 Linux 容器并重新检查，不指导在该模式启动 Core/CLI Linux 镜像

#### Scenario: Linux 终端试用未安装 Compose
- **WHEN** 同机 Linux 用户拥有支持的 Docker Engine 和可用发行镜像，但没有 Compose
- **THEN** 能完成默认的 Core/CLI 启动、登录、创建 Work 和聊天；Compose 依赖仅出现在可选 Demo 的前置条件中

### Requirement: 客户端状态和文件交换可跨容器重建

**Identifier:** DOCKER-DELIVERY-005

CLI SHALL 使用独立持久状态卷保存登录和 Desktop 偏好，通过 `PIWORK_CONFIG_PATH=/var/lib/piwork/client/credentials.json` 复用现有私有文件和并发控制。终端首次试用 SHALL 只要求此状态卷，创建或重建容器时自动复用它，无需手工创建卷。文件交换 SHALL 作为导入、导出、文件配置和自定义 CA 的可选高级步骤，使用独立 `/exchange` 存储及完整 Docker 复制或挂载操作；浏览器上传/下载使用既有 Desktop 流程。文件交换卷不是 Work 存储，也不是 Core 数据备份。

Desktop 与无 Desktop 命令 SHALL 可共享同一状态卷。运行中的 Desktop 不承诺自动采纳另一个 CLI 新写入的账号/Core；文档 SHALL 要求在这种切换后重启 Desktop 并重新 open。`PIWORK_CORE_URL` 的调用覆盖与 Desktop 偏好优先级保持原契约。

#### Scenario: 重建 CLI
- **WHEN** 用户停止并重新创建 Desktop CLI，保留状态和交换卷
- **THEN** 已保存的账号/Core 偏好和交换文件仍存在，旧启动票据/浏览器实例授权不用于新进程，用户执行 open 获取新授权

#### Scenario: 从宿主导入并导出 Work
- **WHEN** 用户将 `.work` 复制进 `/exchange` 并导入，或将导出结果复制回宿主
- **THEN** 操作使用该容器路径并保留原有停机、所有权、目标文件不得存在等规则，不要求挂载 Work 卷到 CLI

#### Scenario: 退出并重新进入终端 CLI
- **WHEN** 用户退出 `--rm` 交互 CLI 容器，再用同一状态卷启动新容器
- **THEN** 原用户凭证仍可用于对应 Core，Work 不因 CLI 退出而停止，首次试用不需要交换卷或 Desktop 进程

### Requirement: 提供完整的中文操作命令与新增操作清单

**Identifier:** DOCKER-DELIVERY-006

发行手册 SHALL 给出 Linux Bash 与 Windows PowerShell 的安装、环境文件编辑、镜像选择、启动/等待、状态与日志、重建、停止、保留数据卸载和升级/回退步骤，拉取由启动命令自动完成或作为独立诊断步骤。Desktop open/logout 与浏览器操作 SHALL 保留为高级入口，不进入默认 Quick Start 或 Core Compose Demo 的试用主流程。

Core operator 和无 Desktop 用户业务命令 SHALL 列出可直接执行的完整 Docker 前缀和原有命令参数；交互容器方式 SHALL 给出完整进入命令，随后明确标注 `piwork-cli` 命令在容器内执行。变量的取得方式、平台差异、文件输入输出、Operation/Work/Session/Run/Service ID 的取得与使用 SHALL 明确，不用省略号、省略必要命令前缀或未知脚本代替必要步骤。

新增操作 SHALL 明确标出：取得发行包、填写对应环境文件、Core 同绝对路径数据持久化、CLI 状态卷、Linux host-gateway、完整交付就绪等待，以及高级入口的 open、文件复制和升级保留数据。Docker run 配置 SHALL 使用原始环境值，Compose 专用配置 SHALL 使用其引用和插值规则；文档 SHALL 提醒用户不混用这两种模板、不 source 秘密配置、不在原始值外加语法引号。必填初始化值和至少 12 位管理员密码要求 SHALL 在启动前说明，可选模型 Base URL 须符合既有 HTTPS/可达性规则，省略与空值不能混淆。

文档 SHALL 使用 `docker compose`、`docker run`、`piwork-serve`、`piwork-cli`，不引入 `pcore`、`poperator`、`pcli`、新业务顶层命令或用户 wrapper。密码/key 的交互输入 SHALL 使用 TTY 或 stdin，不放进命令参数。真实秘密 SHALL 不进入 CLI 环境、公开材料或验收输出。

#### Scenario: 新用户按文档操作
- **WHEN** 用户只有支持的 Docker、发行包和有效账号/模型初始化信息
- **THEN** 能在终端完成配置、就绪等待、登录、创建 Work 和收到回复，每一步知道在哪台机器或容器内执行及如何获得输入

#### Scenario: 采用无 Desktop CLI Docker
- **WHEN** 用户选择 `docker run` 调用同一 CLI 镜像的业务命令
- **THEN** 文档完整覆盖身份、配置、Work/Operation、上下文、Session/Run/chat、Service、快照、proxy 和文件交换；不要求先启动 Desktop

#### Scenario: 秘密包含特殊字符
- **WHEN** 用户的密码或模型 key 包含 `$`、空格或引号
- **THEN** 对应模板和填写说明让容器取得用户实际值，不发生 shell 执行、Compose 插值或额外语法引号注入；检查使用合成值且不输出真实秘密

#### Scenario: 必填值不合法
- **WHEN** 管理员或模型初始化字段缺项、密码过短，或填写了不合法的模型地址
- **THEN** 文档对应的启动/就绪步骤不能报告成功，提示修正配置；不通过关闭校验、使用默认密码或写入 CLI 环境绕过错误

### Requirement: 以 Core 与 Desktop 实际使用验证交付闭环

**Identifier:** DOCKER-DELIVERY-009

发行验收 SHALL 使用实际交付镜像，从无安装数据且无本版本运行依赖缓存的 Linux Core 开始；验证自动拉取、管理员/模型初始化、完整就绪、依赖失败及自动恢复。既有 Compose/Desktop 全功能发行验收 SHALL 继续保留：Linux 和 Windows Docker Desktop 客户端分别使用同机真实浏览器验证打开/登录、创建就绪 Work、模型 Run、Service HTTP/WebSocket、Files、停机导出/Inspect/import、重新 start、Desktop 本地授权恢复/注销和 Core/CLI 重建后的数据保持。

README 默认路径调整 SHALL 另行验证 Linux 同机的 Docker run Core 与交互 CLI，以及可选 Core Compose Demo 配合同一交互 CLI 的终端闭环。验证 SHALL 包含完整就绪、TTY 登录、自动启动 Work、终端收到真实模型回复、CLI 重建后凭证保留、Core 重启后原对象与数据保留，以及 Core 正常退出停止受管 Work。不得仅以容器运行、健康探针或确定性模型 fixture 代表已收到真实模型回复。

证据 SHALL 记录版本、镜像身份、环境、原始对象 ID、状态转移、结果及负向入口校验；缺少真实 Windows Desktop 浏览器证据不得以 Linux、终端或原生 CLI 结果代替。新增终端检查 SHALL 限于上述首次使用与恢复闭环，不扩展为全部无 Desktop 业务功能的发行验收。

本机材料核查 SHALL 记录候选清单及 SHA256，区分受控夹具、已发布镜像的命令验证和通过既有打包门禁的新候选。正式候选 SHALL 核对 release.env/manifest 一致性和现有源码/协议身份，不得伪造元数据或绕过发布 digest 校验。Bash/PowerShell 命令输入来源、失败终止路径，以及下载失败、错误/非法 checksum 和 Core 关闭失败保留诊断的检查 SHALL 保留。原 D01–D09 使用记录 SHALL 用于对应未变行为，不以本机 fixture 或静态审阅冒充新的 Windows 实机使用或公共站点验收。实际对外发行不是本次修复的完成条件。

#### Scenario: 两种客户端平台均通过
- **WHEN** Linux Core 冷启动与恢复通过，Linux/Windows Docker Desktop 都完成规定的浏览器流程，新增默认终端路径检查也通过
- **THEN** 该发行可以记录 Docker 交付闭环完成，同时独立保留原生验收结果

#### Scenario: 缺少 Windows 或模型实际调用
- **WHEN** 只有镜像构建成功、模拟网页测试、确定性模型回复或单一平台证据
- **THEN** 交付验收报告明确未完成对应项，不宣称完整闭环

#### Scenario: 默认终端路径与 Core Demo 均可用
- **WHEN** 分别在独立安装中执行默认 Docker run 路径和 Core Compose Demo，CLI 都使用交互 Docker run
- **THEN** 两条路径均能在终端收到真实模型回复，退出/重建 CLI 保留凭证，Core 重启保留原 Work、历史和数据，证据不依赖 GUI 操作

#### Scenario: 候选无法通过既有发行门禁
- **WHEN** 新材料需要重新构建或发布对应镜像才能满足源码身份、远端 digest 或完整候选检查
- **THEN** 保留门禁并明确记录未执行的正式候选步骤，仍可完成独立的材料夹具检查和已发布镜像命令验证，不自动 push 或将夹具称为正式发行包

## ADDED Requirements

### Requirement: README 提供最短的终端试用入口

**Identifier:** DOCKER-DELIVERY-010

根目录 README.md 与 README.zh-CN.md SHALL 保持顶部互链、章节和命令同步，Logo 居中且保持已有图片与尺寸。Quick Start SHALL 默认展开 Docker 终端路径，并通过默认关闭的折叠区域提供原生 CLI 连接已有 Core 的终端路径。

默认示例 SHALL 采用 Linux 同机部署，配置后分别通过一条完整的 Docker run 命令启动后台 Core 和交互 CLI。Core SHALL 使用 host 网络、同一 Engine Unix socket、相同绝对路径的独立试用数据目录及 60 秒关闭预算；新空目录沿用既有安全初始化，不能放宽现有数据目录权限校验。CLI SHALL 进入镜像已有 shell，在 Linux 配置 host-gateway，并只挂载持久用户状态；不得启动 Desktop、发布客户端端口或挂载 Core 配置、socket、Work 数据。

容器内终端步骤 SHALL 等待 `/readyz?profile=docker-delivery` 成功，等待预算最多 600 秒，随后通过隐藏密码的 TTY 登录、`work create --wait` 和 `chat --message` 完成第一次回复。创建结果 SHALL 用于取得 Work ID，不额外要求列举 Work 或启动已自动运行的 Work；失败时停止后续步骤并给出状态/日志或原 Operation/Run 的恢复入口，不能自动重复提交创建或聊天。

README 代码块 SHALL 使用明确的 shell 语言、统一缩进和完整命令；长命令用续行分组，每个业务命令独立展示，命令前说明执行位置、变量来源和占位符替换。单条逻辑命令不要求挤成一行，不引入自定义用户 wrapper。退出交互容器及其后续重进方式 SHALL 明确说明。

#### Scenario: 首次使用者完成一次对话
- **WHEN** Linux 用户按展开的 Docker Quick Start 填写合法配置并顺序执行命令
- **THEN** 分别启动 Core 与交互 CLI 后，在终端收到首条模型回复，无需 Compose、Desktop、浏览器或交换卷

#### Scenario: Core 正在准备依赖
- **WHEN** Core 健康但完整就绪探针仍为 503，或尚未监听
- **THEN** 就绪步骤在预算内等待，不把健康或容器启动视为成功；超过预算非零退出，后续登录/创建/聊天不能自动执行

#### Scenario: Work 等待中断或消息流中断
- **WHEN** 创建 Work 已被接受但观察超时/中断，或已接受的 Run 流连接中断
- **THEN** 使用现有 Operation/Run 标识查询或恢复观察，不重新执行 mutation 来检查结果

#### Scenario: 查看原生 CLI 替代路径
- **WHEN** 用户展开原生 CLI 区域并已拥有配置完成的可达 Core
- **THEN** 可按明确的 Linux/Windows 可执行文件名称执行终端登录、创建和聊天；没有启动 Desktop 或修改原生客户端默认行为

#### Scenario: 阅读和复制代码
- **WHEN** 用户查看任一语言 README 的长命令
- **THEN** 参数按网络、配置、存储及镜像顺序分行，命令完整可复制，宿主机与容器内代码不混淆，两种语言的对应命令一致

### Requirement: 可选 Core Compose Demo 与默认材料同步维护

**Identifier:** DOCKER-DELIVERY-011

README SHALL 将 Compose 标为可选的 Core 部署 Demo，通过文档导航进入完整配置和启动说明；Demo SHALL 使用现有 Core Compose 材料和同一交互 Docker run CLI，不要求 CLI Compose 或 GUI 操作。Demo SHALL 明确只有选择它时才需要 Compose，复用相同发行镜像与既有网络、配置、存储和正常关闭语义，Core 与默认示例的试用目录须明确隔离。

发行材料和 README SHALL 提供可执行的一致性检查入口。镜像引用、必填环境变量、网络、数据目录、客户端状态存储、就绪方式或关闭预算改变时，维护者 SHALL 同步默认命令、Core Demo、安装手册、模板和打包清单。检查失败 SHALL 阻止将不同步材料作为新的正式候选，不能仅依赖未来人工记忆。

#### Scenario: 用户选择 Compose Demo
- **WHEN** 用户安装所需 Compose 并按可选 Core Demo 启动 Core
- **THEN** 能继续使用默认的交互 Docker run CLI 完成终端对话，Demo 不要求 CLI Compose、Desktop 或浏览器

#### Scenario: 材料产生漂移
- **WHEN** README 命令与模板、Core Demo、镜像默认值或打包清单的必需字段产生不一致
- **THEN** 一致性检查非零退出并指出具体材料和差异，维护者修复后才能通过候选材料检查，诊断不输出秘密值

#### Scenario: 新模板进入候选包
- **WHEN** 新版 Docker 安装材料被打包
- **THEN** 原始值模板和 Compose 模板都存在于清单及包内 SHA256SUMS，内容与仓库材料一致，修改或缺失模板导致检查失败
