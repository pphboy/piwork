# Spec Delta

## Purpose

提供能够从空安装完成使用的 Core 与 CLI Docker 交付契约，明确入口镜像、运行依赖、平台、网络、数据、完整操作文档与验收证据，使用户无需掌握内部容器编排即可使用既有 Work、Service、Files 和快照功能。

## ADDED Requirements

### Requirement: 交付两个入口镜像及可独立使用的发行包

**Identifier:** DOCKER-DELIVERY-001

每个发行版本 SHALL 提供 Core 与 CLI 两个 `linux/amd64` 入口镜像和 `piwork-docker` 压缩包。包 SHALL 包含 `release.env`、`core.env.example`、`client.env.example`、`compose.core.yaml`、`compose.cli.yaml`、`compose.cli.linux.yaml`、`README.zh-CN.md` 及校验清单；`release.env` SHALL 写入该次实际发布的 Core、CLI、Agent、package/file/snapshot helper 固定 digest 引用。package helper 可复用满足其契约的 Agent 镜像。入口镜像和运行依赖 SHALL 来自同一可核查的源码版本与协议组合；CLI SHALL 内嵌该版本 Desktop 资源。

用户 SHALL 只需手动启动 Core 和 CLI；其余运行镜像和容器由 Core 按需准备，不要求用户运行额外管理容器或手动拉取 helper。发行镜像 SHALL 可按发行说明读取；缺少实际地址、digest、协议验证或必需平台证据的版本不得宣称交付完成。发行包 SHALL 不包含真实账号密码、模型 key 或用户 token。

发行材料 SHALL 附带压缩包 SHA256 和包内 SHA256SUMS；Linux Bash 与 Windows PowerShell 的安装命令 SHALL 比较可信预期 checksum，成功后才解压并核对内部清单。已有本地包的用户无需提供下载 URL。用户已有实际包和校验文件地址时，手册 SHALL 提供可选下载步骤，并在下载失败或校验不符时终止。本次验证后的修复 SHALL 仅更新本机材料与使用命令，不执行镜像 push、包上传、Release 创建或托管配置，不要求提供发布地址/凭证，不新增公共下载入口或将实际对外发行作为完成条件；既有授权发行及使用证据保留。

已经取得完整发行包及对应可信 SHA256 的离线用户 SHALL 有独立的核对、解压、包内校验和后续安装入口，无需先访问下载页或构建源码。离线取得发行包不表示所有镜像离线可用，后续拉取仍使用既有 Docker 网络和 registry 条件。

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
- **WHEN** 维护者实施 Core 关闭规范和安装文档修复，未请求实际发行
- **THEN** 更新本机材料和修复证据，不上传、不 push、不创建 Release；缺少公共下载地址不能成为本次修复的阻塞项

### Requirement: 明确 Core 与客户端的平台边界

**Identifier:** DOCKER-DELIVERY-002

Core Docker SHALL 在 Linux Docker Engine 的 host 网络下运行；CLI Docker SHALL 在 Linux Docker Engine 和 Windows Docker Desktop 的 Linux 容器模式运行，浏览器位于 CLI 所在电脑。首发支持 `linux/amd64` 镜像，发行说明 SHALL 记录实际测试的 OS、Docker Engine/Desktop、Compose 和架构；基线要求 Engine 28 或更新、Compose v2.24 或更新。Windows Core、Windows 容器和其他镜像架构不属于本次交付。宿主不支持相应镜像/模式时 SHALL 给出明确前置检查及修正方向，不能通过模拟验收宣称兼容。

#### Scenario: Windows 用户连接 Linux Core
- **WHEN** Windows Docker Desktop 使用 Linux 容器，CLI 配置可达的 Linux Core 地址
- **THEN** 同机浏览器可登录并使用 Desktop，不依赖 Windows 原生 CLI、容器内部浏览器或 Core 的 Docker socket

#### Scenario: 使用 Windows 容器模式
- **WHEN** `docker info` 报告 Windows 容器模式
- **THEN** 文档明确要求切换 Linux 容器并重新检查，不指导在该模式启动 Core/CLI Linux 镜像

### Requirement: Core 管理运行过程并保留准确的宿主路径

**Identifier:** DOCKER-DELIVERY-003

Core 配置 SHALL 挂载同一 Linux Engine 的 Unix socket，默认 `/var/run/docker.sock`，并显式设置 `DOCKER_HOST=unix:///var/run/docker.sock`；不依赖宿主 Docker CLI 或不完整的 Docker context 文件。Core 数据目录 SHALL 在宿主和 Core 容器使用相同绝对路径，默认 `/var/lib/piwork/core`，以满足 Engine 创建 Agent/helper bind mount 的宿主路径语义。Core SHALL 按现有安装/Work 身份管理 Agent、Service/helper、Work 私网及私有/workspace 卷；用户不得通过 Compose 管理这些内部对象。

Core SHALL 保留私有目录/文件权限与单实例锁。新安装默认以容器 UID 0 创建独占数据目录；接入已有数据时 SHALL 使用匹配现有所有者和 socket 访问权限的用户配置，禁止无条件改变已有文件所有者或降级权限检查。CLI SHALL 不挂载 Docker socket、Core 数据目录或 Work 私有卷。

#### Scenario: Core 启动一个 Work
- **WHEN** 登录用户创建 Work，Core 需要创建 Agent 和只读配置挂载
- **THEN** 宿主 Engine 找到相同绝对路径的配置，Core 自动管理网络和两个 Work 数据卷，CLI 无需访问 Engine

#### Scenario: 不同绝对路径或 socket 不可用
- **WHEN** 用户偏离示例挂载到不同绝对路径，或 socket 不存在/权限不足
- **THEN** 安装检查/就绪状态明确失败并提供修正说明，不报告完整交付就绪

### Requirement: 容器网络覆盖本机和外部服务

**Identifier:** DOCKER-DELIVERY-004

Core host 网络 SHALL 支持 Core 直接访问其 Engine 上 Work 私网地址，以及 Agent 经 `piwork-core:host-gateway` 回连 Core 的既有 mTLS 控制端口；默认 HTTP 7171，Agent 控制 7172，不要求发布每个 Service 端口。Core Compose SHALL 对非 loopback HTTP 明确使用既有远程明文 opt-in，文档说明监听范围和已有认证/TLS 能力。

CLI Compose SHALL 使用独立 bridge，仅将 Desktop `17891:17891` 发布到宿主 `127.0.0.1`；本地浏览器 URL 和内部端口保持一致。Windows SHALL 使用 Docker Desktop 内建 `host.docker.internal`；Linux 覆盖文件 SHALL 添加 `host.docker.internal:host-gateway`。公网/LAN Core 地址 SHALL 通过 `PIWORK_CORE_URL` 配置；不将宿主 `localhost`、CLI 的 hostname 或 CLI 出站网络误认为 Agent 的模型/MCP 网络。HTTPS 自定义 CA SHALL 提供显式挂载和配置方式，不关闭证书校验。

#### Scenario: Linux 同机 Core 和 CLI
- **WHEN** Core 使用 host 网络，CLI 使用 Linux 覆盖文件且配置 `http://host.docker.internal:7171`
- **THEN** CLI 可以连接宿主 Core，同机浏览器通过 `http://desktop.localhost:17891` 访问 CLI

#### Scenario: CLI 在 Windows 而模型在其他机器
- **WHEN** Windows CLI 连接远端 Linux Core，Work 需要调用模型或 MCP
- **THEN** 模型/MCP 地址必须从 Core 的 Work 网络可达；本机 CLI 的 `host.docker.internal` 不能替代该地址，既有模型 Base URL 校验保持

### Requirement: 客户端状态和文件交换可跨容器重建

**Identifier:** DOCKER-DELIVERY-005

CLI SHALL 使用独立持久状态卷保存登录和 Desktop 偏好，通过 `PIWORK_CONFIG_PATH=/var/lib/piwork/client/credentials.json` 复用现有私有文件和并发控制。命令导入、导出、配置文件和自定义 CA SHALL 使用独立 `/exchange` 卷及完整 `docker compose cp` 操作；浏览器上传/下载使用既有 Desktop 流程。文件交换卷不是 Work 存储，也不是 Core 数据备份。

Desktop 与无 Desktop 命令 SHALL 可共享同一状态卷。运行中的 Desktop 不承诺自动采纳另一个 CLI 新写入的账号/Core；文档 SHALL 要求在这种切换后重启 Desktop 并重新 open。`PIWORK_CORE_URL` 的调用覆盖与 Desktop 偏好优先级保持原契约。

#### Scenario: 重建 CLI
- **WHEN** 用户停止并重新创建 CLI，保留状态和交换卷
- **THEN** 已保存的账号/Core 偏好和交换文件仍存在，旧启动票据/浏览器实例授权不用于新进程，用户执行 open 获取新授权

#### Scenario: 从宿主导入并导出 Work
- **WHEN** 用户将 `.work` 复制进 `/exchange` 并导入，或将导出结果复制回宿主
- **THEN** 操作使用该容器路径并保留原有停机、所有权、目标文件不得存在等规则，不要求挂载 Work 卷到 CLI

### Requirement: 提供完整的中文操作命令与新增操作清单

**Identifier:** DOCKER-DELIVERY-006

发行手册 SHALL 给出 Linux Bash 与 Windows PowerShell 的安装、环境文件编辑、镜像选择、拉取、启动/等待、状态与日志、Desktop open/logout、重建、停止、保留数据卸载和升级/回退步骤。Core operator 和无 Desktop 用户业务命令 SHALL 列出可直接执行的完整 Docker 前缀和原有命令参数；变量的取得方式、平台差异、文件输入输出、Operation/Work/Session/Run/Service ID 的取得与使用 SHALL 明确，不用省略号、省略命令前缀或未知脚本代替必要步骤。

新增操作 SHALL 明确标出：取得发行包、填写环境文件、创建私有目录/卷、使用 Linux 网络覆盖、等待 Docker 交付就绪、容器内执行 open、文件复制、升级保留数据。文档 SHALL 使用 `docker compose`、`docker run`、`piwork-serve`、`piwork-cli`，不引入 `pcore`、`poperator`、`pcli`、新业务顶层命令或用户 wrapper。密码/key 的交互输入 SHALL 使用 TTY 或 stdin，不放进命令参数。

#### Scenario: 新用户按文档操作
- **WHEN** 用户只有支持的 Docker、发行包、Core 地址和有效账号/模型信息
- **THEN** 能从配置到浏览器登录、创建 Work、运行任务、访问 Service/Files 和恢复登录，每一步知道在哪台机器执行及如何获得输入

#### Scenario: 采用无 Desktop CLI Docker
- **WHEN** 用户选择 `docker run` 调用同一 CLI 镜像的业务命令
- **THEN** 文档完整覆盖身份、配置、Work/Operation、上下文、Session/Run/chat、Service、快照、proxy 和文件交换；不要求先启动 Desktop

### Requirement: 原生 CLI 交付继续独立存在

**Identifier:** DOCKER-DELIVERY-007

既有 Linux/Windows 原生 CLI 产物、命令名、默认 Desktop、可信 open/logout 和发行链 SHALL 保留；原生安装不得新增 Docker、Go、Node 或 Python 的用户运行依赖。未启用显式容器模式时 SHALL 保持原生 loopback 监听、浏览器打开和错误语义。Docker 验收不得代替 `support-cross-platform-cli-and-default-desktop` 中尚未完成的原生平台检查。

#### Scenario: 用户继续使用原生 CLI
- **WHEN** 用户按照既有方式安装并运行原生 `piwork-cli`
- **THEN** 仍可使用全部原有入口，监听和打开浏览器行为保持，Docker 包是额外可选交付

### Requirement: 保留安装状态并明确备份与回退边界

**Identifier:** DOCKER-DELIVERY-008

Core/CLI 停止、重建和 `down` 的默认说明 SHALL 保留 Core 目录、客户端卷及 Core 管理的 Work 卷。Core 正常关闭 SHALL 沿用 work-lifecycle 的既有有界排空与停止 Agent/Service 流程，保持 Work 的 desiredState、Service 启用意图及数据，不隐式将 Work 的持久目标改为 stopped 或删除 Work；重启按安装身份恢复 desiredState=running 的 Work 及启用的 Service。CLI 停止 SHALL 不停止 Work。需要持续停机的业务 SHALL 先明确执行 Work stop。不得在常规升级/卸载流程使用 `down -v`、全局 prune 或删除未核对的运行卷。

Core 正常关闭成功 SHALL 以本安装全部受管 Work 运行容器已停止为前提，不要求 Work 在 Core 退出期间继续运行。某 Work 关闭失败仍须尝试其他 Work，无法确认停止时按既有非零退出及恢复诊断契约处理；异常退出不能被记录为已确认正常关闭。

升级 SHALL 固定新发行 digest 并保留旧 `release.env`，先检查支持的数据格式与迁移规则；更换初始化 env 不覆盖持久管理员/模型，运行默认值的修改使用已有 operator 命令。回退 SHALL 仅在数据格式兼容时恢复旧镜像；不兼容时恢复经一致性确认的 Core 数据和匹配 Work 卷。`.work` 导出/import 是 Work 级迁移且产生新 Work，不得称为保留原 ID 的安装回滚。

#### Scenario: Core 重建后恢复
- **WHEN** 用户重建 Core 并保留其数据目录和匹配的运行卷
- **THEN** 用户、Work/Operation/Session/Run 标识与持久配置保留，已有运行对象经身份核验恢复，不因 env 改变重置密码或模型

#### Scenario: 只备份 Core 数据或旧镜像
- **WHEN** Work 卷已丢失，用户只持有 Core SQLite/旧镜像
- **THEN** 文档明确不能完整恢复 Work 内容，不能宣称镜像回退或数据库复制已完成安装恢复

#### Scenario: Core 停止后所有 Work 停止
- **WHEN** Core stop/down 已完成且 Core 报告正常关闭成功
- **THEN** 本安装全部受管 Agent/Service 运行容器已停止，记录、运行意图及卷保持；重新启动 Core 后按原持久意图恢复

### Requirement: 以 Core 与 Desktop 实际使用验证交付闭环

**Identifier:** DOCKER-DELIVERY-009

发行验收 SHALL 使用实际交付镜像和 Compose，从无安装数据且无本版本运行依赖缓存的 Linux Core 开始；验证自动拉取、管理员/模型初始化、完整就绪、依赖失败及自动恢复。Linux 和 Windows Docker Desktop 客户端 SHALL 分别使用同机真实浏览器验证打开/登录、创建就绪 Work、模型 Run、Service HTTP/WebSocket、Files、停机导出/Inspect/import、重新 start、Desktop 本地授权恢复/注销和 Core/CLI 重建后的数据保持。

证据 SHALL 记录版本、digest、环境、原始对象 ID、状态转移、结果及负向入口校验；缺少真实 Windows Desktop 浏览器证据不得以 Linux 或原生 CLI 结果代替。无 Desktop CLI Docker 的独立端到端测试、验收表和发布门禁 SHALL 不在本次范围内；其命令能力及文档必须仍交付，共享逻辑按必要的已有/容器模式单元检查验证。

D09 的本次修复核查 SHALL 记录本机候选包 SHA256、内部清单及 release.env/manifest 一致性，静态审阅 Bash/PowerShell 命令的输入来源和失败终止路径，并以受控本机 fixture 验证 Bash 在线/已有包入口的成功、下载失败、错误/非法 checksum 和 Core 关闭失败保留诊断。原 D01–D09 使用记录 SHALL 用于对应未变行为，不以本机 fixture 或静态审阅冒充新的 Windows 实机使用或公共站点验收。实际对外发行不在本次修复范围内，也不作为完成条件；无 Desktop Docker 不增加独立端到端门禁。

#### Scenario: 两种客户端平台均通过
- **WHEN** Linux Core 冷启动与恢复通过，Linux/Windows Docker Desktop 都完成规定的浏览器流程
- **THEN** 该发行可以记录 Docker 交付闭环完成，同时独立保留原生验收结果

#### Scenario: 缺少 Windows 或模型实际调用
- **WHEN** 只有镜像构建成功、模拟网页测试或单一平台证据
- **THEN** 交付验收报告明确未完成对应项，不宣称完整闭环
