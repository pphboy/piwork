# Docker Delivery Specification

## Purpose

提供能够从空安装完成使用的 Core 与 CLI Docker 交付契约，明确入口镜像、运行依赖、平台、网络、数据、完整操作文档与验收证据，使用户无需掌握内部容器编排即可使用既有 Work、Service、Files 和快照功能。

## Requirements

### Requirement: 交付两个入口镜像及可独立使用的发行包

**Identifier:** DOCKER-DELIVERY-001

新版本 SHALL 以一个统一 Linux 服务端入口镜像和一条 Docker 启动命令作为默认安装方式，镜像运行同版统一 Go 程序，包含 Core、管理/工作台/引导资源和非敏感 Agent/helper 引用。Agent 引用 SHALL 随版本内嵌并由服务端自动用于 runtime，不提供用户手填、选择或高级覆盖。默认入口无需 CLI/Console 容器、必填业务环境变量、发行压缩包、release.env、环境模板或源码；用户通过本机/远程浏览器完成配置。

piwork-cli 镜像、原生用户 CLI 及高级终端使用 SHALL 继续作为独立可选入口，不能成为默认网页安装前置条件。Core 自动准备匹配运行依赖，用户不手工启动内部 Agent/Service/helper。

入口及依赖 SHALL 固定实际发行版本/digest，记录同一源码、两套 UI、协议和存储身份，不覆盖旧标签或使用 latest 掩盖身份。缺依赖、身份/协议或相应验收时不得标记交付完成。本地 candidate 与 published 分开；构建/验证不授权 push、上传或官网发布。旧压缩包、校验、离线材料及下载地址保持版本归属，不伪装成新默认交付。

#### Scenario: 直接使用已发布镜像
- **WHEN** 用户已有受支持 Linux Docker，执行当前发行的默认命令
- **THEN** 一个入口容器提供引导和完整远程工作台，无必填 env 或另启 CLI/Console 的步骤

#### Scenario: 只连接已有服务器
- **WHEN** 用户打开已有统一服务器网页，或独立使用原 CLI
- **THEN** 浏览器无本机 Docker/CLI 依赖，CLI 按原契约连接，不持有 Core 初始化秘密

#### Scenario: 运行依赖没有发布
- **WHEN** 必需镜像不可取得、协议不匹配或标签指向不同输入
- **THEN** 候选检查失败，不覆盖标签、不把本地候选称为已公开可用

#### Scenario: 仅修复问题且未请求发行
- **WHEN** 用户查阅旧安装包，或维护者只完成本地构建
- **THEN** 旧材料保留原校验及版本归属，本地工作不自动 push/发布官网

#### Scenario: 下载发行包而不是构建源码
- **WHEN** 用户持有旧发行包及对应可信校验信息
- **THEN** 按旧版本入口完成校验与安装，无需构建源码；旧材料不被伪装成新镜像已具备的默认配置

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

#### Scenario: 只取得一个 Compose 文件
- **WHEN** Linux 用户只取得当前统一服务端 Compose 并已有受支持 Engine
- **THEN** 无需旁置 YAML/env 或必填业务 env 即可启动完整网页，CLI 为显式可选

### Requirement: 明确 Core 与客户端的平台边界

**Identifier:** DOCKER-DELIVERY-002

统一服务端 Docker SHALL 在本机 Linux Docker Engine 上运行，首版沿用 linux/amd64、Engine 28+ 基线；实际平台状态须有对应证据。直接 Docker run 不要求 Compose，可选 Compose 要求 v2.24+。本次不交付 Windows 原生 Core 或 Windows 容器镜像。

本机或另一台电脑的浏览器 SHALL 能直接访问统一服务端，包括 Windows 浏览器，不要求客户端 Docker/CLI/代理或域名。独立 CLI Docker 仍支持 Linux Engine、Windows Docker Desktop 的 Linux 容器模式并连接可达 Core；该能力不表示在 Windows 本机部署 Core 已验收。

#### Scenario: Windows 用户连接 Linux Core
- **WHEN** Windows 用户直接打开 Linux 服务端 IP
- **THEN** 可登录并使用完整托管工作台，无客户端 Docker/CLI 或 WSL 命令前置步骤

#### Scenario: 使用 Windows 容器模式
- **WHEN** 用户试图用 Windows 容器模式运行 Linux 镜像
- **THEN** 说明平台不匹配和受支持入口，不以构建或模拟结果冒充支持

#### Scenario: Linux 终端试用未安装 Compose
- **WHEN** Linux 已有 Docker Engine 但未安装 Compose
- **THEN** 默认单条 Docker run 仍可启动完整应用

### Requirement: Core 管理运行过程并保留准确的宿主路径

**Identifier:** DOCKER-DELIVERY-003

统一服务端 SHALL 挂载同一 Linux Engine 的 Unix socket，默认 /var/run/docker.sock，并设置 DOCKER_HOST=unix:///var/run/docker.sock，不依赖宿主 Docker CLI 或不完整 Docker context 文件。Core 数据目录 SHALL 在宿主和容器使用相同绝对路径；默认 Docker run 与 Core-only Compose 使用 /var/lib/piwork/quickstart/core，单机部署示例使用独立的 /var/lib/piwork/examples/single-host/core 和专属 CLI 状态卷；已有高级 Core Demo 的 /var/lib/piwork/core 保持独立，以满足 Engine 创建 Agent/helper bind mount 的宿主路径语义。Core SHALL 按既有安装/Work 身份管理 Agent、Service/helper、Work 私网及私有/workspace 卷，不由用户 Compose 管理这些内部对象。

新空数据路径 SHALL 可由默认启动挂载自动创建，并由现有安全初始化设定私有权限，不要求用户先执行 mkdir。Core SHALL 保留私有目录/文件权限和单实例锁；新安装默认以 UID 0 创建独占数据目录，已有数据须匹配其所有者及 socket 访问权限，禁止无条件改变已有文件所有者或放宽校验。缺失 socket 不得被 Compose 自动建成目录。可选 CLI SHALL 不挂载 Docker socket、Core 数据或 Work 私有卷。默认统一程序所需业务配置由默认值/显式参数及页面提供，不以模型 env 作为挂载正确性的前提。

#### Scenario: Core 启动一个 Work
- **WHEN** 登录用户创建 Work，Core 需要创建 Agent 和只读配置挂载
- **THEN** 宿主 Engine 找到相同绝对路径的配置，Core 自动管理网络和 Work 卷，CLI 无需访问 Engine

#### Scenario: 不同绝对路径或 socket 不可用
- **WHEN** 源/目标绝对路径不同，socket 缺失或权限不足，或已有数据不满足所有者和权限检查
- **THEN** 启动或就绪检查安全失败，不创建伪 socket 目录、不修改已有数据所有者、不报告完整就绪

#### Scenario: 首次使用没有数据目录
- **WHEN** 用户按默认命令启动新安装且独立试用数据路径尚不存在
- **THEN** 挂载和安全初始化创建合法私有目录，不额外要求宿主准备目录，不影响其他安装

### Requirement: 容器网络覆盖本机和外部服务

**Identifier:** DOCKER-DELIVERY-004

统一服务端 SHALL 沿用 Linux host 网络和同机 Unix socket，支持 Core 访问 Work 私网、Agent 经既有受验证 mTLS 控制端口回连 Core；不发布每个用户 Service 的 Docker 宿主端口。默认网页入口允许同机和远程 IP 访问；应用网关有界 listener 的实际监听和放行范围 SHALL 在同一启动材料说明，并遵守 BSA-IP-001 的来源、Cookie、所有者和撤销边界。

默认访问不要求通配域名、公共 DNS 转换、CLI 本机代理、PAC 或 hosts。主站/Service URL SHALL 使用远程客户端可达的服务器地址，不把 Docker/客户端 localhost 当作上游或客户端目标。HTTPS/受信反向代理部署 SHALL 对主站及实际 Service 入口一并验证来源、证书和流式连接，不关闭证书校验或信任任意 Forwarded 头。

高级独立 CLI 保留 host-gateway、远端 Core URL、自定义 CA、终端和显式本机 Desktop 契约；模型/MCP 可达性仍从 Work 网络判断，不能因 CLI 宿主地址改变而放宽模型 URL 校验。

#### Scenario: 同机和远程 IP 访问
- **WHEN** 默认 Docker 服务端运行，浏览器分别在宿主和另一电脑使用
- **THEN** 两者均可访问完整工作台与 Service，入口不指向客户端 localhost 或要求域名，受管容器无新增用户 Service 端口直出

#### Scenario: HTTPS 或入口池缺项
- **WHEN** 代理/防火墙只支持主站而实际 Service 入口不可达
- **THEN** 界面和验收指出缺项及恢复，不能仅凭首页成功声称完整远程可用

#### Scenario: 高级客户端和模型网络
- **WHEN** CLI 连接远端 Core，Work 调用模型或 MCP
- **THEN** CLI 原连接/CA 契约保持，模型地址由 Work 网络与既有协议校验，不借宿主别名放开规则

#### Scenario: Linux 同机 Core 和 CLI
- **WHEN** 用户显式选择高级独立 CLI、可选 Compose 或单机示例连接统一服务器
- **THEN** 原 host-gateway、独立凭证和网络语义保持，CLI 不成为默认网页依赖

#### Scenario: CLI 在 Windows 而模型在其他机器
- **WHEN** Windows CLI 连接 Linux 统一服务器而 Work 调用远端模型/MCP
- **THEN** 模型/MCP 须从 Work 网络可达，客户端宿主别名不替代目标，原 URL 校验保持

#### Scenario: 显式启动高级 Desktop
- **WHEN** 用户按高级材料运行显式 CLI Desktop
- **THEN** 保留 loopback 发布、内外端口及本地授权，不作为远程网页前置步骤

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

双语发行材料 SHALL 给出统一程序和 Docker 默认网页流程、访问地址/首次设置授权的取得、初始化、状态/日志、正常关闭、重建、升级/回退及数据保留命令。默认流程零必填业务环境变量；PIWORK_ADMIN_ACCOUNT/PIWORK_ADMIN_PASSWORD 只在测试/自动部署的可选说明出现，成对创建首管理员并遵守原密码规则，不作为持续密码来源。

模型连接、Key 和 CoreRuntime SHALL 通过网页配置，不再要求 PIWORK_MODEL_PROVIDER/MODEL/MODEL_ID/API_KEY/MODEL_API_KEY/MODEL_BASE_URL 或镜像 env。说明 SHALL 区分代码构建所用变量、独立 CLI/系统环境与被移除的服务端业务初始化输入，不误删用户 Service 环境。

命令 SHALL 完整可复制，说明执行位置、固定发行身份、socket/同路径数据挂载、主站及 Service listener 网络条件、60 秒关闭预算和空安装链接取得方式。高级 operator/CLI/文件交换和旧版安装材料保留独立导航及原身份/格式边界；密码不放命令参数，真实秘密和 setup 证明不进入静态材料或验收输出。

#### Scenario: 新用户按文档操作
- **WHEN** 用户只执行默认 Docker 命令并打开输出的有效地址/设置链接
- **THEN** 可以创建管理员和配置模型/runtime，无安装包、env 编辑、CLI 登录或第二入口容器前置步骤

#### Scenario: 测试可选 ADMIN env
- **WHEN** 测试者成对传入有效 ADMIN 值
- **THEN** 只初始化持久管理员，模型仍走网页，重启不覆盖已有账号，普通教程不因此要求 env

#### Scenario: 秘密包含特殊字符
- **WHEN** 测试 ADMIN 值包含特殊字符，或只提供一项/非法值
- **THEN** 合法值按原字面传递，非法值安全拒绝，不执行 shell 内容、不回显秘密

#### Scenario: 采用无 Desktop CLI Docker
- **WHEN** 用户以显式 Docker 命令调用同一 CLI 镜像的业务入口
- **THEN** 说明覆盖身份、配置、Work/Operation、Session/Run/chat、Service、快照、proxy 及文件交换，不要求先启动 Desktop

#### Scenario: 必填值不合法
- **WHEN** 测试者选择可选 ADMIN 初始化但只提供一项、空或非法值
- **THEN** 安全拒绝且不输出值；默认网页安装不存在模型必填 env 或旧模型 env 校验

### Requirement: 原生 CLI 交付继续独立存在

**Identifier:** DOCKER-DELIVERY-007

既有 Linux/Windows 原生 CLI 产物、命令名、默认 Desktop、可信 open/logout 和发行链 SHALL 保留；原生安装不得新增 Docker、Go、Node 或 Python 的用户运行依赖。未启用显式容器模式时 SHALL 保持原生 loopback 监听、浏览器打开和错误语义。Docker 验收不得代替 `support-cross-platform-cli-and-default-desktop` 中尚未完成的原生平台检查。

#### Scenario: 用户继续使用原生 CLI
- **WHEN** 用户按照既有方式安装并运行原生 `piwork-cli`
- **THEN** 仍可使用全部原有入口，监听和打开浏览器行为保持，Docker 包是额外可选交付

### Requirement: 保留安装状态并明确备份与回退边界

**Identifier:** DOCKER-DELIVERY-008

Core/CLI 停止、重建和 down 的默认说明 SHALL 保留 Core 目录、客户端卷及 Core 管理的 Work 卷。Core 正常关闭 SHALL 沿用 work-lifecycle 的既有有界排空与停止 Agent/Service 流程，保持 Work desiredState、Service 启用意图及数据，不隐式将持久目标改为 stopped 或删除 Work；重启按安装身份恢复 desiredState=running 的 Work 及启用的 Service。CLI 停止 SHALL 不停止 Work。持续业务停机 SHALL 显式执行 Work stop；常规升级/卸载不得使用 down -v、全局 prune 或删除未核对的运行卷。

Core 正常关闭成功 SHALL 以本安装全部受管 Work 运行容器已停止为前提，不要求 Work 在 Core 退出期间继续运行。某 Work 关闭失败仍须尝试其他 Work，无法确认停止时按既有非零退出及恢复诊断契约处理；异常退出不能记为已确认正常关闭。默认独立入口、Core Compose 和单机部署示例 SHALL 给予 Core 60 秒关闭窗口。CLI 的启动、退出和重进 SHALL 不创建、启动、停止或重建 Core；此约束在单机部署示例中同样成立。

升级 SHALL 固定新的发行身份并保留旧镜像引用、对应 Compose 文件及发行清单；旧安装继续保留其 release.env。升级前 SHALL 检查数据格式与迁移规则，初始化 env 不覆盖持久管理员/模型，默认配置修改使用统一管理页或已有 operator 入口。回退 SHALL 仅在格式兼容时恢复旧镜像；不兼容时恢复一致性确认的 Core 数据和匹配 Work 卷。.work 导出/import 是产生新 Work 的 Work 级迁移，不能称为保留原 ID 的安装回滚。

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

新候选 SHALL 使用实际统一镜像、独立空安装及无本版依赖缓存的 Linux Engine，分别验证默认 Docker run 和可选 Compose 的零业务 env 网页安装；每种方式均须网页创建首管理员、保存模型/runtime、准备依赖、创建 Work 并取得首条真实模型回复。测试/自动部署的 ADMIN env 路径另行验证；Compose 加 ADMIN env 的通过记录不能代替 Compose 零 env 记录，Docker run 的零 env 记录也不能代替 Compose。

必做网络验收 SHALL 采用 `0.0.0.0` 通配监听，再从另一电脑或独立客户端网络命名空间通过服务器实际非回环 IP 完成上述流程和规定功能；基础默认路径不预填 `--public-origin`，可使用局域网或隔离网络，无需公网地址或公网连通性实测。NAT/受信代理的显式 origin 覆盖作为对应高级场景单独记录，精确 Host/Origin/CSRF 和 Service 来源隔离保持。IPv6 URL/来源保留单元/契约检查，实际 IPv6 网络不作为本变更完成前提。

引导页、Runtime 管理页和旧 `/runtime` 深链接 SHALL 均无需也不能输入 Agent 镜像；验收核对已保存 runtime 的引用与实际服务端制品内嵌的发行默认一致。镜像准备失败的验收使用隔离 Engine/registry 故障夹具，不以给产品增加镜像覆盖入口来制造或修复故障。

完整验收 SHALL 覆盖两个用户/浏览器的平台身份隔离、多个 Service 同名响应 Cookie 分区、根路径资源、受支持的应用认证、SSE/WebSocket、独立窗口、Files 条件写入、配置 Save/Apply、包、Stop/Export/Inspect/Import/Start、注销/撤销与服务器正常关闭重启恢复。document.cookie/Cookie Store 兼容与脚本写入 Cookie 跨 Service 串用按 BSA-003/BSA-004 记录为首版已确认限制，保留复现结果且不作为一键启动阻塞；不能将历史失败改写为通过。应用存活、编译、fixture 回复、HttpOnly 单例登录或同机 localhost 成功不得替代完整远程证据；支持范围内未通过项保持失败/未执行，不能追加 DNS 前提或放宽平台鉴权与响应 Cookie 分区要求。

候选 SHALL 核对源码/二进制/两套 UI/依赖/镜像/协议/Compose/官网材料身份。真实模型、真实浏览器、Windows 浏览器及原生 CLI 平台证据分别标记，不由 Linux 或模拟结果推断其他平台。缺 Windows 浏览器实机时不能声称对应验证完成，也不能因此将 Windows Core 加入范围。

本地验证不授权推送；获明确发行授权后另验匿名读取、远端 digest 和全部依赖身份，不改写旧候选/历史证据。

#### Scenario: 两种默认入口均完成终端闭环
- **WHEN** 实际候选分别以 Docker run 和 Compose 在独立空 Linux 安装零业务 env 启动，监听通配地址，另一电脑或独立客户端网络通过实际 IP 访问
- **THEN** 两种方式各自完成网页创建管理员至首条真实模型回复和规定功能，分别记录状态/对象/发行默认 Agent 引用及隔离证据，不依赖公网、本机 CLI、域名或缓存

#### Scenario: Compose 的 ADMIN 路径不能替代零 env 验收
- **WHEN** 已有 Compose 使用 ADMIN env 的成功记录，但没有 Compose 零业务 env、网页创建首管理员的独立记录
- **THEN** Compose 零 env 安装仍标记未完成，对应任务保持待完成，补齐实际候选完整初始化证据后才可通过

#### Scenario: ADMIN env 和升级
- **WHEN** 候选分别在空安装使用可选 ADMIN env，以及复用已有安装重建
- **THEN** 前者只创建管理员，后者保留账号、模型、Work 身份和数据，不受初始化值改变影响

#### Scenario: 缺少 Windows 或模型实际调用
- **WHEN** 只有编译/fixture/首页/单一应用结果，或支持范围内的响应 Cookie 分区、远程端口、真实模型、关闭恢复未通过
- **THEN** 对应项不得勾选通过或称为正式可用，保留可定位失败，不用旧材料替代本候选

#### Scenario: 用户批准推送后核对远端
- **WHEN** 用户明确授权发布已审阅候选
- **THEN** 首次推送前完整预检，随后核对匿名读取及真实远端 digest，再生成正式材料

#### Scenario: 两种客户端平台均通过
- **WHEN** 同一候选的 Linux/Windows 远程浏览器与保留 CLI 分别取得相应真实证据
- **THEN** 只声明实际验证的客户端支持，不由浏览器或交叉编译推断 Windows Core

#### Scenario: 默认终端路径与 Core Demo 均可用
- **WHEN** 维护统一网页默认安装、可选 Compose 与高级 CLI/Core Demo
- **THEN** 默认验证远程完整网页，仍交付的高级路径按各自版本/身份验证，不成为默认前置

#### Scenario: 候选无法通过既有发行门禁
- **WHEN** 源码、二进制、两套 UI、镜像或材料不一致，或无法确认关闭
- **THEN** 阻止候选通过，保留安全诊断，不重提业务操作、不伪造证据或自动推送

### Requirement: README 提供精简项目介绍与文档入口

**Identifier:** DOCKER-DELIVERY-010

README.md/README.zh-CN.md SHALL 保持顶部互链、章节、产品含义、平台边界与文档导航对应，保留居中 Logo 及 160×160 尺寸。根 README SHALL 展示简短定位、Work / Service / Harness 各一句说明、现有演示视频和 Desktop 截图；每个说明段落最多两句，若保留 Roadmap 则至多三条。版本变更细节 SHALL 由 Releases 承接，不在介绍中累积多段发行说明。

根 README SHALL 提供官网文档、双语部署手册、Releases、Issues、Discussions 和贡献/开发约定入口。安装、启动、首次设置、模型/runtime 配置、CLI、导入导出、构建与验证步骤及详细网络/兼容性限制 SHALL 放在对应既有材料，不在根 README 内嵌命令、配置示例或折叠教程；根 README 不再要求 Architecture 图、Problem 章节或两者排序。

根 README 顶部 SHALL 包含最新 GitHub Release（包括 Preview）、Apache-2.0、Stars 和 Linux 服务端四类徽章，使用真实仓库信息、准确替代文本及有效点击目标。版本徽章 SHALL 能展示仅有预发行版本的项目，不能以只查正式版的入口错误显示无版本；Linux 徽章 SHALL 清楚表示服务端部署平台，不将浏览器或实验性客户端能力表述为 Windows Core 支持。徽章图片不可用时，产品说明与导航 SHALL 仍可阅读和使用。本要求不创建 Git tag、不修改仓库 Topics，也不展示没有实际来源的 CI 状态或支持承诺。

根 README 链接的详细 Quick Start SHALL 默认展示统一服务端的一条完整逻辑 Docker run 命令，随后打开服务器网页、取得首次设置授权、创建管理员、配置模型/runtime 并进入工作台。Agent 镜像是随版本交付的默认值，教程和页面不包含手填、选择或高级覆盖步骤。默认不要求任何业务 env、CLI 容器、Console、客户端代理、安装压缩包、源码构建或域名配置；主站及有界 Service 入口需要的网络放行在同一入口说明。首次授权链接只在实际启动端生成，静态例子不含有效秘密。

详细使用材料 SHALL 明确 IP 模式首版依赖脚本读写 Cookie 的应用可能不兼容，脚本自行写入 Cookie 不保证跨 Service 隔离；响应 Cookie 在服务端分区。该限制不新增 DNS/客户端代理步骤，也不阻塞默认网页初始化，不以“完整工作台”宣称所有网页应用透明兼容。

详细入口命令 SHALL 使用实际已发布固定镜像、Linux host 网络、同机 socket、同绝对路径持久数据及 60 秒关闭窗口。Compose 作为可选统一服务端方式，单机示例为可选高级入口；不得由初始化期间 /readyz 失败阻止网页打开。原生 Linux 应用、CLI/终端及 Windows 客户端说明 SHALL 继续在部署手册或官网的相应高级入口可取得。

详细材料的代码块 SHALL 标注 shell、完整可复制并说明执行位置、地址/ID 来源、正常停止和重进方式；已有安装复用数据、未知 Operation/Run 恢复不得靠重提创建或消息实现。

#### Scenario: 浏览双语项目首页
- **WHEN** 用户打开任一语言根 README
- **THEN** 看到对应的简短项目介绍、四类真实徽章、三个核心概念及演示资源，通过文档入口取得操作说明，页面没有安装、配置、使用或构建教程

#### Scenario: 只有 Preview 版本
- **WHEN** 仓库最近版本为 Preview，尚无正式 GitHub Release
- **THEN** 版本徽章包含预发行版本，点击后进入可查看 Preview 的 Releases 页面，而不是只接受正式版的地址

#### Scenario: 徽章图片不可用
- **WHEN** 徽章图片服务无法加载
- **THEN** 准确替代文本、项目说明及文档链接仍可用，不影响取得安装入口

#### Scenario: 首次使用者完成一次对话
- **WHEN** 用户从任一语言 README 进入详细 Quick Start 并使用受支持 Linux Docker
- **THEN** 仅启动一个入口并在浏览器完成配置和对话，执行前无需 export 管理员或模型变量

#### Scenario: 查看原生 CLI 替代路径
- **WHEN** 用户从项目文档导航选择原生 Linux 应用、高级原生/容器 CLI、Windows 客户端或可选 Compose
- **THEN** 各自入口和身份边界清楚，不重新成为默认网页安装前置条件，统一原生 Linux 说明不因根 README 精简而丢失

#### Scenario: Work 等待中断或消息流中断
- **WHEN** 用户按详细 Quick Start 使用 Piwork，镜像尚在准备或原创建/Run 观察中断
- **THEN** 网页显示实际进度/恢复，说明按原 ID 核对，不复制终端就绪循环或自动重提 mutation

#### Scenario: Core 正在准备依赖
- **WHEN** 网页可用而依赖 preparation 尚未完成
- **THEN** 网页显示真实准备/恢复，详细教程不以完整 readiness 阻止引导或要求额外 CLI 等待循环

#### Scenario: 阅读和复制代码
- **WHEN** 用户从 README 进入任一语言详细安装材料并复制命令
- **THEN** 根 README 保留居中 Logo 与短导航，命令在详细材料中规整分行、两种语言对应一致，默认试用不含旧下载及配置步骤

#### Scenario: 只使用已有 Core
- **WHEN** 用户已有可达且已配置的 Core，按高级入口只执行 CLI 独立启动命令
- **THEN** 无需下载 Core Compose、启动本地 Core 或提供管理员/模型初始化变量，即可按用户身份登录和使用；CLI 退出不影响 Core 或 Work

### Requirement: 可选 Core Compose Demo 与默认材料同步维护

**Identifier:** DOCKER-DELIVERY-011

统一服务端 Compose SHALL 单独启动同一程序，默认无需业务 env，保持 Docker socket、数据路径、host 网络、主站/Service 入口条件、应用 liveness 和 60 秒关闭规则。examples/single-host 的 CLI SHALL 成为显式可选高级组件，不默认拉起、阻塞统一网页或取得 Core 初始化秘密；CLI 启退不创建/重建/停止 Core。

双语根 README SHALL 同步维护项目展示和有效文档导航，不携带当前镜像命令或重复详细教程。双语部署手册、Compose/模板、单机说明、发行默认值/清单及官网的 Quick Start、首页、安装、First Work、源码导航和当前下载材料 SHALL 继续同步维护完整运行说明，并提供可执行的一致性检查。检查使用合成值，不输出真实秘密；连续同步候选时不得残留前一个当前引用。历史发行下载保留原版本身份，不覆盖为未公开的新候选。

材料同步 SHALL 在没有根 README 安装块、原生启动块和 Architecture 章节的情况下正常完成，并保持根 README 内容不变；官网使用说明生成 SHALL 不将根 README 当作教程来源。统一原生 Linux 入口 SHALL 同时在既有双语部署手册和生成的官网材料中有效，不能生成空内容或字面量 undefined。

不同启动方式切换 SHALL 先正常停止原实例并复用所属安装路径；单机示例继续使用独立数据路径，不能自动停止冲突安装或扫描接管其他数据。材料检查失败 SHALL 阻止候选通过。

#### Scenario: 材料产生漂移
- **WHEN** 任一详细教程语言、Compose 或官网仍要求模型 env、第二默认 CLI 容器，引用与当前候选不同，或根 README 导航无效
- **THEN** 检查非零退出并定位文件/字段，修复前不能通过候选检查

#### Scenario: CLI 重进不改变 Core
- **WHEN** 用户显式启动、退出或重新进入高级 CLI
- **THEN** 只连接已运行服务器，Core 身份/启动时间和运行 Work 不变，CLI 不取得初始化秘密

#### Scenario: 连续同步两个候选版本
- **WHEN** 当前材料依次更新为候选 A/B
- **THEN** 所有详细当前入口统一指向 B，根 README 保持简短介绍和导航，历史版本下载及真实发布身份不被回填或覆盖

#### Scenario: 同步后 README 保持精简
- **WHEN** 在根 README 没有旧安装标记、原生启动标记及 Architecture 章节的隔离副本中同步材料，并重复同步相同输入
- **THEN** 同步成功且两次均不修改根 README，不追加命令、折叠教程或发行长段，详细材料仍通过一致性检查

#### Scenario: 官网不再读取根 README 教程
- **WHEN** 根 README 已精简，维护者在隔离目录生成两种语言的官网材料
- **THEN** 官网仍包含完整默认安装和原生 Linux 入口，未丢失启动/数据/授权/关闭说明，没有 undefined，命令与部署手册一致

#### Scenario: 用户选择 Compose Demo
- **WHEN** 用户选择当前统一服务端 Compose 或单机示例
- **THEN** 说明独立安装数据和端口条件，零必填 env 启动，CLI 为显式可选

#### Scenario: 新模板进入候选包
- **WHEN** 服务端 Compose、单机模板或材料被渲染分发
- **THEN** 文件与版本、摘要、清单匹配，缺失或变化使检查失败，旧发行不被覆盖

#### Scenario: 新 Compose 文件独立运行
- **WHEN** 只下载当前服务端 Compose 且已有受支持 Linux Docker
- **THEN** 无需 env 或第二 YAML 启动完整网页，仅显式选择时运行高级 CLI

#### Scenario: 切换默认启动方式
- **WHEN** 用户先停止 Core Docker run，再用 Core-only Compose 重新创建 Core，或反向切换
- **THEN** 同一 Core 数据目录保留原安装，独立 CLI 的状态卷和凭证不变；不会自动迁移到单机部署示例的数据目录

#### Scenario: 高级 Demo 与旧下载保留
- **WHEN** 用户查阅已有高级 Core-only Demo、Desktop 或旧版本下载
- **THEN** 入口明确标注其用途和版本，旧地址不被覆写为未验证的新候选，也不要求默认用户使用它们

### Requirement: 发行维护的本地候选和真实发布身份

**Identifier:** DOCKER-MAINT-001

发行维护 SHALL 以同一真实版本/commit/dirty/源码输入/Desktop 摘要制作 Core、CLI、Agent、file/snapshot helper，package helper 复用 Agent；Docker 多阶段构建内运行 Go1.25.5/Node24，维护宿主无需这些解释器。metadata/materials 构建目标不独立发布工具镜像，构建上下文不包含真实秘密/数据。

候选 SHALL 在本地完成静态/运行/协议/资源检查和 SHA256SUMS，manifestVersion2 标 candidate，不填虚构 registry digest。五角色本地 image ID、标签/协议/资源及实时远端身份在首次 push 前全部核对，任一冲突/认证/网络/无法确认均零推送。登录 registry 不代表授权；明确授权后同一入口执行 push，不能绕过预检。匿名拉取/manifest digest/publishedImageId 确认后单独生成 published 材料，保留原 candidate。

README/手册/Core-only Compose/单机示例与官网下载材料 SHALL 按同版记录核对，候选不得宣称可下载，旧发行记录不为后续源码回填身份。正式更新日志按实际版本维护，未发行内容为 Unreleased；结构检查与正式 require-current 分离。所有写外部官网、push/上传/Release 仍须用户明确请求，本次迁移不执行。

#### Scenario: 按现行契约操作与核对
- **WHEN** 用户或维护者使用上述现行入口，并满足对应身份、平台与运行条件
- **THEN** 操作、边界、拒绝及恢复遵循上述契约，不依赖已移除的开发手册；历史版本描述不覆盖当前有效 Spec

以下为已有操作/验证入口的示例，使用实际返回 ID 和隔离测试资源；命令存在不表示本次已执行或验收通过。源码构建使用 Go 1.25.5、Node 24，容器/浏览器专项须预备相应依赖。

```bash
piwork_release_commit=$(git rev-parse --verify HEAD)
piwork_release_modified=false
if [[ -n $(git status --porcelain --untracked-files=normal) ]]; then
    piwork_release_modified=true
fi

docker build -f Dockerfile.docker-release --target metadata \
    --build-arg "PIWORK_COMMIT=$piwork_release_commit" \
    --build-arg "PIWORK_MODIFIED=$piwork_release_modified" \
    --build-arg PIWORK_RELEASE_REGISTRY=docker.io/pphboy \
    --output type=local,dest=dist/docker/inputs \
    .
```

```bash
piwork_release_input="$PWD/dist/docker/inputs"
piwork_release_build_args=(
    --platform linux/amd64
    --build-arg "PIWORK_VERSION=$(cat "$piwork_release_input/version")"
    --build-arg "PIWORK_COMMIT=$(cat "$piwork_release_input/commit")"
    --build-arg "PIWORK_MODIFIED=$(cat "$piwork_release_input/modified")"
    --build-arg "PIWORK_DIRTY=$(cat "$piwork_release_input/modified")"
    --build-arg "PIWORK_SOURCE_INPUT_HASH=$(cat "$piwork_release_input/sourceInputHash")"
    --build-arg "PIWORK_DESKTOP_UI_HASH=$(cat "$piwork_release_input/desktopUIHash")"
    --build-arg "PIWORK_RELEASE_REGISTRY=$(cat "$piwork_release_input/registry")"
)

docker build -f Dockerfile.core "${piwork_release_build_args[@]}" \
    -t "$(cat "$piwork_release_input/core")" .
docker build -f Dockerfile.cli "${piwork_release_build_args[@]}" \
    -t "$(cat "$piwork_release_input/cli")" .
docker build -f Dockerfile.agentd "${piwork_release_build_args[@]}" \
    --target production --build-arg NPM_REGISTRY=https://registry.npmjs.org \
    -t "$(cat "$piwork_release_input/agent")" .
docker build -f Dockerfile.file-helper.native "${piwork_release_build_args[@]}" \
    -t "$(cat "$piwork_release_input/fileHelper")" .
docker build -f Dockerfile.snapshot-helper.native "${piwork_release_build_args[@]}" \
    -t "$(cat "$piwork_release_input/snapshotHelper")" .
```

```bash
docker run --rm --network none \
    --user "$(id -u):$(id -g)" \
    --volume "$PWD:/source" --workdir /source \
    node:24-bookworm-slim \
    node scripts/sync-docker-quickstart.mjs

bash scripts/collect-docker-release.sh dist/docker/inputs

docker build -f Dockerfile.docker-release --target materials \
    "${piwork_release_build_args[@]}" \
    --build-context release-input=./dist/docker/inputs \
    --output type=local,dest=dist/docker/candidate \
    .

(cd dist/docker/candidate && sha256sum --check SHA256SUMS)
```

```sh
sh dist/docker/candidate/push-commands.sh --check
```

```sh
sh dist/docker/candidate/push-commands.sh --push
```

```bash
docker build -f Dockerfile.docker-release --target published-materials \
    "${piwork_release_build_args[@]}" \
    --build-context release-input=./dist/docker/inputs \
    --output type=local,dest=dist/docker/published \
    .

docker run --rm --network none \
    --user "$(id -u):$(id -g)" \
    --volume "$PWD:/source" --workdir /source \
    node:24-bookworm-slim \
    node scripts/sync-docker-quickstart.mjs dist/docker/published/release-manifest.json

(cd dist/docker/published && sha256sum --check SHA256SUMS)
```

```sh
node scripts/check-docker-quickstart.mjs
node --test scripts/check-docker-quickstart.test.mjs
node --test scripts/build-docker-release.test.mjs scripts/docker-cli-entrypoint.test.mjs scripts/docker-publish-preflight.test.mjs
```

### Requirement: 使用 Docker 命令制作可审阅的发行候选

**Identifier:** DOCKER-DELIVERY-012

维护者 SHALL 能从同一源码输入用 Docker build 构建全部入口和运行依赖镜像，并通过 Docker 构建输出生成 统一服务端 Compose、可选单机部署示例及发行候选清单；宿主仅需相应 Docker 构建能力、Git 与终端工具，不要求安装 Go、Node、npm 或 Make，不要求先构建宿主 dist 文件。发行流程 SHALL 不新增独立发布的 Release 工具镜像，既有原生构建与发行入口继续独立存在。

构建 SHALL 记录真实源码 commit、修改状态、源码输入摘要、版本、平台和 统一服务端两套内嵌 UI 及 CLI 资源身份，检查镜像与二进制身份及各协议一致。构建输入在候选生成期间变化、身份未知、引用不匹配或必需材料缺失 SHALL 使检查失败；真实秘密不得作为构建输入写入镜像层、标签或清单。

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
- **THEN** 可以构建并核查 统一服务端、可选 CLI、Agent/helper 和候选材料，统一服务端两套内嵌资源及 CLI 资源来自同一输入，运行镜像不携带宿主编译工具链

#### Scenario: 生成候选供用户判断
- **WHEN** 本地镜像和候选材料验证完成
- **THEN** 输出实际身份、材料校验、验证结果及待执行推送命令，不自动推送、不把本地候选标为正式发行

#### Scenario: 源码或镜像身份变化
- **WHEN** 构建后输入、镜像、统一服务端/CLI 资源或协议标签与记录不一致
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
