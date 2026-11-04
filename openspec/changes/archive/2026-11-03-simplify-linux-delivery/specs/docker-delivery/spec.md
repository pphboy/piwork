## MODIFIED Requirements

### Requirement: Core 管理运行过程并保留准确的宿主路径

**Identifier:** DOCKER-DELIVERY-003

统一服务端 SHALL 挂载同一 Linux Engine 的 Unix socket，默认 /var/run/docker.sock，并设置 DOCKER_HOST=unix:///var/run/docker.sock，不依赖宿主 Docker CLI 或不完整 Docker context 文件。Core 数据目录 SHALL 在宿主和容器使用相同绝对路径；默认 Docker run 与 Core-only Compose 使用 /var/lib/piwork/quickstart/core，单机部署示例使用独立的 /var/lib/piwork/examples/single-host/core；已有高级 Core Demo 的 /var/lib/piwork/core 保持独立，以满足 Engine 创建 Agent/helper bind mount 的宿主路径语义。Core SHALL 按既有安装/Work 身份管理 Agent、Service/helper、Work 私网及私有/workspace 卷，不由用户 Compose 管理这些内部对象。

新空数据路径 SHALL 可由默认启动挂载自动创建，并由现有安全初始化设定私有权限，不要求用户先执行 mkdir。Core SHALL 保留私有目录/文件权限和单实例锁；新安装默认以 UID 0 创建独占数据目录，已有数据须匹配其所有者及 socket 访问权限，禁止无条件改变已有文件所有者或放宽校验。缺失 socket 不得被 Compose 自动建成目录。原生 CLI 不需要 Docker socket、Core 数据或 Work 私有卷。默认统一程序所需业务配置由默认值/显式参数及页面提供，不以模型 env 作为挂载正确性的前提。

#### Scenario: Core 启动一个 Work
- **WHEN** 登录用户创建 Work，Core 需要创建 Agent 和只读配置挂载
- **THEN** 宿主 Engine 找到相同绝对路径的配置，Core 自动管理网络和 Work 卷，CLI 无需访问 Engine

#### Scenario: 不同绝对路径或 socket 不可用
- **WHEN** 源/目标绝对路径不同，socket 缺失或权限不足，或已有数据不满足所有者和权限检查
- **THEN** 启动或就绪检查安全失败，不创建伪 socket 目录、不修改已有数据所有者、不报告完整就绪

#### Scenario: 首次使用没有数据目录
- **WHEN** 用户按默认命令启动新安装且独立试用数据路径尚不存在
- **THEN** 挂载和安全初始化创建合法私有目录，不额外要求宿主准备目录，不影响其他安装

### Requirement: 保留安装状态并明确备份与回退边界

**Identifier:** DOCKER-DELIVERY-008

Core 停止、重建和 down 的默认说明 SHALL 保留 Core 目录及 Core 管理的 Work 卷，原生 CLI 的私有配置按客户端契约保留。Core 正常关闭 SHALL 沿用 work-lifecycle 的既有有界排空与停止 Agent/Service 流程，保持 Work desiredState、Service 启用意图及数据，不隐式将持久目标改为 stopped 或删除 Work；重启按安装身份恢复 desiredState=running 的 Work 及启用的 Service。CLI 停止 SHALL 不停止 Work。持续业务停机 SHALL 显式执行 Work stop；常规升级/卸载不得使用 down -v、全局 prune 或删除未核对的运行卷。

Core 正常关闭成功 SHALL 以本安装全部受管 Work 运行容器已停止为前提，不要求 Work 在 Core 退出期间继续运行。某 Work 关闭失败仍须尝试其他 Work，无法确认停止时按既有非零退出及恢复诊断契约处理；异常退出不能记为已确认正常关闭。默认独立入口、Core Compose 和单机部署示例 SHALL 给予 Core 60 秒关闭窗口。CLI 的启动、退出和重进 SHALL 不创建、启动、停止或重建 Core；此约束在单机部署示例中同样成立。

升级 SHALL 固定新的发行身份并保留旧镜像引用、对应 Compose 文件及发行清单。升级前 SHALL 检查数据格式与迁移规则，初始化 env 不覆盖持久管理员/模型，默认配置修改使用统一管理页或既有受保护管理 API。回退 SHALL 仅在格式兼容时恢复旧镜像；不兼容时恢复一致性确认的 Core 数据和匹配 Work 卷。.work 导出/import 是产生新 Work 的 Work 级迁移，不能称为保留原 ID 的安装回滚。

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

必做网络验收 SHALL 采用 `0.0.0.0` 通配监听，再从另一电脑或独立客户端网络命名空间通过服务器实际非回环 IP 完成上述流程和规定功能；基础默认路径不预填 `--public-origin`，可使用局域网或隔离网络，无需公网地址或公网连通性实测。多网卡实际 IPv4 与本机入口按 core-service-startup 验证，Host/Origin/CSRF 保持，托管 Service 使用明确的同源信任边界。IPv6 URL/来源保留单元/契约检查，实际 IPv6 网络不作为本变更完成前提。

引导页、Runtime 管理页和旧 `/runtime` 深链接 SHALL 均无需也不能输入 Agent 镜像；验收核对已保存 runtime 的引用与实际服务端制品内嵌的发行默认一致。镜像准备失败的验收使用隔离 Engine/registry 故障夹具，不以给产品增加镜像覆盖入口来制造或修复故障。

完整验收 SHALL 覆盖两个用户/浏览器的平台身份隔离、多个 Service 同名响应 Cookie 分区、带 Service 前缀的资源/页面/API、受支持的应用认证、SSE/WebSocket、独立窗口、Files 条件写入、配置 Save/Apply、包、Stop/Export/Inspect/Import/Start、注销/撤销与服务器正常关闭重启恢复。document.cookie/Cookie Store 兼容与脚本写入 Cookie 跨 Service 串用按 BSA-003/BSA-004 记录为首版已确认限制，保留复现结果且不作为一键启动阻塞；不能将历史失败改写为通过。应用存活、编译、fixture 回复、HttpOnly 单例登录或同机 localhost 成功不得替代完整远程证据；支持范围内未通过项保持失败/未执行，不能追加 DNS 前提或放宽 Core 所有者鉴权与响应 Cookie 分区要求。

候选 SHALL 核对源码/二进制/两套 UI/依赖/镜像/协议/Compose/官网材料身份。真实模型、真实浏览器、Windows 浏览器及原生 CLI 平台证据分别标记，不由 Linux 或模拟结果推断其他平台。缺 Windows 浏览器实机时不能声称对应验证完成，也不能因此将 Windows Core 加入范围。

本地验证不授权推送；获明确发行授权后另验匿名读取、远端 digest 和全部依赖身份，不改写旧候选/历史证据。

网络验收 SHALL 明确区分两条路径：浏览器网络只放行 ControlPlane 17891、禁止直连 Core/旧端口池时完成完整网页流程；CLI/operator API 使用 Core 17871 完成对应真实用户/管理请求。单纯改变端口常量或编译通过不能证明双服务边界，须有实际网络调用及两个 listener 的启动/失败/关闭证据。

默认 Web base、模板和脑包路径契约变化 SHALL 使用同一实际候选验证：多个 Service 并发、深层刷新、自定义资源/API、应用 Cookie/Authorization、SSE/WebSocket、反馈、自动更新与 Stop/Export/Inspect/Import/Start。旧根路径应用限制明确，不自动迁移源码/镜像，不用旧独立 origin 的成功记录代替新同源前缀验收。

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
- **WHEN** 维护统一网页默认安装、可选 Compose 与Linux 原生 CLI/Core Demo
- **THEN** 默认验证远程完整网页，仍交付的高级路径按各自版本/身份验证，不成为默认前置

#### Scenario: 候选无法通过既有发行门禁
- **WHEN** 源码、二进制、两套 UI、镜像或材料不一致，或无法确认关闭
- **THEN** 阻止候选通过，保留安全诊断，不重提业务操作、不伪造证据或自动推送

#### Scenario: Core 与 UI 分别验证
- **WHEN** 相同候选的浏览器通过 17891 完成使用，CLI 通过 17871 执行业务，operator API 通过 17871 执行管理
- **THEN** 各自使用正确身份和实际 HTTP 链路，浏览器没有 Core 请求，CLI 无需 ControlPlane；仍只有一个持久 Core 所有者

#### Scenario: 官方应用导入后仍支持前缀
- **WHEN** 本版模板应用完整导出、导入为新 Work 并显式启动
- **THEN** 新身份前缀下的资源、业务和 WebSocket 实际可用，原数据和固定镜像保持，不手改包内 URL

### Requirement: README 提供精简项目介绍与文档入口

**Identifier:** DOCKER-DELIVERY-010

README.md/README.zh-CN.md SHALL 保持顶部互链、章节、产品含义、平台边界与文档导航对应，保留居中 Logo 及 160×160 尺寸。根 README SHALL 展示简短定位、Work / Service / Harness 各一句说明、现有演示视频和 Desktop 截图；每个说明段落最多两句，若保留 Roadmap 则至多三条。版本变更细节 SHALL 由 Releases 承接，不在介绍中累积多段发行说明。

根 README SHALL 提供官网文档、双语部署手册、Releases、Issues、Discussions 和贡献/开发约定入口。安装、启动、首次设置、模型/runtime 配置、CLI、导入导出、构建与验证步骤及详细网络/兼容性限制 SHALL 放在对应既有材料，不在根 README 内嵌命令、配置示例或折叠教程；根 README 不再要求 Architecture 图、Problem 章节或两者排序。

根 README 顶部 SHALL 包含最新 GitHub Release（包括 Preview）、Apache-2.0、Stars 和 Linux 服务端四类徽章，使用真实仓库信息、准确替代文本及有效点击目标。版本徽章 SHALL 能展示仅有预发行版本的项目，不能以只查正式版的入口错误显示无版本；Linux 徽章 SHALL 清楚表示服务端部署平台，不将浏览器或实验性客户端能力表述为 Windows Core 支持。徽章图片不可用时，产品说明与导航 SHALL 仍可阅读和使用。本要求不创建 Git tag、不修改仓库 Topics，也不展示没有实际来源的 CI 状态或支持承诺。

根 README 链接的详细 Quick Start SHALL 默认展示统一服务端的一条完整逻辑 Docker run 命令，随后直接打开服务器普通 IP 地址、创建管理员、正常登录、配置模型/runtime 并进入工作台。Agent 镜像是随版本交付的默认值，教程和页面不包含手填、选择或高级覆盖步骤。默认不要求任何业务 env、CLI 容器、Console、客户端代理、安装压缩包、源码构建或域名配置；主站及有界 Service 入口需要的网络放行在同一入口说明。空安装直接创建管理员，不要求终端链接或额外浏览器 Access；启动输出和静态例子不含有效秘密。

详细使用材料 SHALL 明确 IP 模式首版依赖脚本读写 Cookie 的应用可能不兼容，脚本自行写入 Cookie 不保证跨 Service 隔离；响应 Cookie 在服务端分区。该限制不新增 DNS/客户端代理步骤，也不阻塞默认网页初始化，不以“完整工作台”宣称所有网页应用透明兼容。

详细入口命令 SHALL 使用实际已发布固定镜像、Linux host 网络、同机 socket、同绝对路径持久数据及 60 秒关闭窗口。Compose 作为可选统一服务端方式，单机示例为可选高级入口；不得由初始化期间 /readyz 失败阻止网页打开。Linux Core、原生 CLI/Desktop 及跨平台浏览器说明 SHALL 继续在部署手册或官网的相应高级入口可取得。

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
- **THEN** 仅启动一个入口并通过服务器 IP 在浏览器完成创建管理员、普通登录、配置和对话；无需取得设置链接、本地浏览器授权或 export 管理员/模型变量

#### Scenario: 查看原生 CLI 替代路径
- **WHEN** 用户从项目文档导航选择原生 Linux 应用、Linux 原生 CLI、跨平台浏览器或可选 Compose
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

统一服务端 Compose SHALL 单独启动同一程序，默认无需业务 env，保持 Docker socket、数据路径、host 网络、ControlPlane 17891、Core 17871 及内部 Agent 回连条件、应用 liveness 和 60 秒关闭规则。examples/single-host SHALL 只定义 Core 服务，不包含 CLI profile、服务、状态卷或 exchange；客户端说明使用 Linux 宿主原生 CLI，启退不创建/重建/停止 Core。

双语根 README SHALL 同步维护项目展示和有效文档导航，不携带当前镜像命令或重复详细教程。双语部署手册、Compose/模板、单机说明、发行默认值/清单及官网的 Quick Start、首页、安装、First Work、源码导航和当前下载材料 SHALL 继续同步维护以普通地址直接创建/登录的完整运行说明，不要求设置链接或 Desktop Access，并提供可执行的一致性检查。检查使用合成值，不输出真实秘密；连续同步候选时不得残留前一个当前引用。历史发行下载保留原版本身份，不覆盖为未公开的新候选。

材料同步 SHALL 在没有根 README 安装块、原生启动块和 Architecture 章节的情况下正常完成，并保持根 README 内容不变；官网使用说明生成 SHALL 不将根 README 当作教程来源。统一原生 Linux 入口 SHALL 同时在既有双语部署手册和生成的官网材料中有效，不能生成空内容或字面量 undefined。

不同启动方式切换 SHALL 先正常停止原实例并复用所属安装路径；单机示例继续使用独立数据路径，不能自动停止冲突安装或扫描接管其他数据。材料检查失败 SHALL 阻止候选通过。

当前详细材料 SHALL 同步新端口职责、Core 默认通配 HTTP 与外部原生客户端连接、托管 Service 路径及前缀/同源边界。默认 Docker/Compose liveness SHALL 检查 ControlPlane 17891；CLI readiness SHALL 直连 Core 17871。当前材料不得残留要求 7171 合并入口、--service-ports 或 17891–17954 入口池的步骤，也不能将独立 CLI 的 Host/PAC 功能描述成托管兼容回退。

材料检查 SHALL 覆盖监听、Core 客户端默认值、探针、Compose/单机模板和两套 UI/镜像资源身份。旧已发布版本及其历史材料保留真实身份；新端口材料在发行前须标明本地候选，不能把新使用步骤配给仍不支持的旧发布镜像。官网当前生成源及隔离预览同步，不把本地维护当作外部部署授权。

#### Scenario: 材料产生漂移
- **WHEN** 任一详细教程语言、Compose 或官网仍要求设置链接、Desktop Access、模型 env、任何 CLI 容器交付步骤，引用与当前候选不同，或根 README 导航无效
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
- **THEN** 官网仍包含完整默认安装和原生 Linux 入口，未丢失启动/数据/普通登录/关闭说明，没有 undefined，命令与部署手册一致

#### Scenario: 用户选择 Compose Demo
- **WHEN** 用户选择当前统一服务端 Compose 或单机示例
- **THEN** 说明独立安装数据和端口条件，零必填 env 启动，客户端仅使用独立 Linux 原生 CLI

#### Scenario: 新模板进入候选包
- **WHEN** 服务端 Compose、单机模板或材料被渲染分发
- **THEN** 文件与版本、摘要、清单匹配，缺失或变化使检查失败，旧发行不被覆盖

#### Scenario: 新 Compose 文件独立运行
- **WHEN** 只下载当前服务端 Compose 且已有受支持 Linux Docker
- **THEN** 无需 env 或第二 YAML 启动完整网页，不包含 CLI 容器服务，原生 CLI 可独立连接

#### Scenario: 切换默认启动方式
- **WHEN** 用户先停止 Core Docker run，再用 Core-only Compose 重新创建 Core，或反向切换
- **THEN** 同一 Core 数据目录保留原安装，独立原生 CLI 的凭证不变；不会自动迁移到单机部署示例的数据目录

#### Scenario: 高级 Demo 与旧下载保留
- **WHEN** 用户查阅已有高级 Core-only Demo、Desktop 或旧版本下载
- **THEN** 入口明确标注其用途和版本，旧地址不被覆写为未验证的新候选，也不要求默认用户使用它们

#### Scenario: 端口或发布身份漂移
- **WHEN** 当前候选手册、探针、单机原生 CLI、模板或官网生成材料仍使用旧端口池/合并入口，或新说明指向不支持的已发布镜像
- **THEN** 检查失败并定位不一致，不改写旧 release 的 commit/digest 来伪造一致性

### Requirement: 使用 Docker 命令制作可审阅的发行候选

**Identifier:** DOCKER-DELIVERY-012

维护者 SHALL 能从同一源码输入用 Docker build 构建Core 入口及 Agent/helper 运行依赖镜像，并通过 Docker 构建输出生成 统一服务端 Compose、可选单机部署示例及发行候选清单；宿主仅需相应 Docker 构建能力、Git 与终端工具，不要求安装 Go、Node、npm 或 Make，不要求先构建宿主 dist 文件。发行流程 SHALL 不新增独立发布的 Release 工具镜像，既有原生构建与发行入口继续独立存在。

构建 SHALL 记录真实源码 commit、修改状态、源码输入摘要、版本、平台和 统一服务端两套内嵌 UI 资源身份，检查镜像与二进制身份及各协议一致。构建输入在候选生成期间变化、身份未知、引用不匹配或必需材料缺失 SHALL 使检查失败；真实秘密不得作为构建输入写入镜像层、标签或清单。

本地构建、候选检查和生成推送命令 SHALL 不执行 push。用户明确审核允许后，维护者才使用 Docker push 发布已检查的镜像；随后核对匿名读取、远端 digest 及候选身份，并生成对应正式材料。未完成远端检查 SHALL 不标记正式可用。

发布入口 SHALL 在首次推送前核对全部角色的实时本地镜像身份与用户已审阅候选清单，包括源码输入、平台、协议和两套 UI 资源身份，并查询远端标签的实际 manifest/config 身份。不能以本地标签名、旧检查记录或可选 existingImageId 字段代替实时核验。任一角色身份改变、远端标签冲突、认证/网络错误或查询结果无法确认 SHALL 阻止全部推送；只有明确确认标签不存在或远端身份匹配才可继续。预检及演练 SHALL 不执行 push，镜像 config ID 不得冒充 registry manifest digest。

#### Scenario: 审阅后本地标签改变
- **WHEN** 任一待推送标签被指向与已审阅候选不同的镜像
- **THEN** 发布入口在任何 push 前失败，要求重新生成和审阅候选，不发布替换镜像

#### Scenario: 远端标签冲突或查询失败
- **WHEN** 任一角色远端身份不同，或查询遇到认证、网络错误及无法确认的结果
- **THEN** 全部角色零推送，不能把查询错误当成标签不存在

#### Scenario: 宿主没有 Go 或 Node
- **WHEN** 维护者仅有支持的 Docker 构建能力、Git 和终端工具，使用干净源码输入
- **THEN** 可以构建并核查 统一服务端、Agent/helper 和候选材料，统一服务端两套内嵌资源来自同一输入，运行镜像不携带宿主编译工具链

#### Scenario: 生成候选供用户判断
- **WHEN** 本地镜像和候选材料验证完成
- **THEN** 输出实际身份、材料校验、验证结果及待执行推送命令，不自动推送、不把本地候选标为正式发行

#### Scenario: 源码或镜像身份变化
- **WHEN** 构建后输入、镜像、统一服务端资源或协议标签与记录不一致
- **THEN** 候选检查失败并要求重新制作一致候选，不能用修改清单来绕过检查

## ADDED Requirements

### Requirement: 交付统一 Core 镜像及可独立使用的发行包

**Identifier:** DOCKER-DELIVERY-001

系统 SHALL 交付一个 Linux Core 入口镜像，运行同版 piwork-core 并内嵌管理/工作台/引导及生产 Agent/helper 引用。一条 Docker 启动命令即可提供完整网页，不要求 CLI/Console 容器、业务 env、release.env、源码或另一个宿主程序。Agent 引用随版本固定，运行依赖由 Core 准备，用户不手工启动内部容器。

CLI Docker 镜像及专用容器模式、终端入口、Compose 服务、状态卷和交换卷教程 SHALL 删除；用户通过浏览器或 Linux 原生 piwork-cli 连接已有 Core。内部 Agent、fileHelper、snapshotHelper 镜像及 Agent 内 packageHelper/MCP 保留。

镜像和材料 SHALL 固定实际版本/身份，核对同一源码、两套 UI、协议及存储契约，不使用 latest 或覆盖旧标签掩盖变化。candidate/published 分离；构建验证不授权 push、上传或网站发布。历史已发布制品记录保留原身份，不混入当前发行材料或要求维护旧命令兼容路径。

Core 镜像 SHALL 遵守三参数及 HTTP 双端口契约，不提供旧 7171 合并入口、Service 端口池或 piwork-serve 别名。

#### Scenario: 空安装启动
- **WHEN** 用户在支持的 Linux Engine 上执行默认 Docker run
- **THEN** 一个 Core 容器提供完整网页引导、管理和工作台，无必填业务 env 或 CLI 容器

#### Scenario: 独立连接
- **WHEN** 浏览器或 Linux 原生 CLI 连接已有 Core
- **THEN** 不需要客户端 Docker、Core 安装数据或初始化秘密

#### Scenario: 旧产物不能混入候选
- **WHEN** 当前候选制作或核验时存在旧 CLI 镜像、旧材料或依赖身份不匹配
- **THEN** 当前清单只包含四个有效角色；身份不匹配则失败，不能把旧发布记录改成新候选

### Requirement: Linux 交付与跨平台浏览器访问边界

**Identifier:** DOCKER-DELIVERY-002

Core Docker SHALL 仅在本机 Linux Docker Engine 运行，沿用 linux/amd64、Engine 28+ 基线；Docker run 不要求 Compose，可选 Compose 要求 v2.24+。Core 与原生 CLI 的当前发行均为 Linux Only，不生成 Windows/macOS 程序或 CLI 容器镜像。

本机或远程浏览器 SHALL 可直接访问 Core UI，包括 Windows 浏览器；该能力不等于支持对应系统原生 Core/CLI，不要求客户端 Docker、WSL、代理或域名。

#### Scenario: Windows 浏览器访问
- **WHEN** Windows 用户打开 Linux Core 的实际 IP
- **THEN** 正常登录并使用网页，无客户端 Docker/CLI 前置条件

#### Scenario: Linux 不安装 Compose
- **WHEN** Linux 已有受支持 Engine 而无 Compose
- **THEN** 默认 Docker run 仍可使用

#### Scenario: 非 Linux 目标
- **WHEN** 维护者请求生成非 Linux 当前发行
- **THEN** 构建/发布入口拒绝不受支持目标，不留下被当作成功候选的产物

### Requirement: Core 容器的 HTTP 入口与内部回连

**Identifier:** DOCKER-DELIVERY-004

Core Docker SHALL 使用 Linux host 网络和同机 Engine Unix socket，Core 访问受管 Work 私网，用户 Service 不发布宿主端口。UI 默认 0.0.0.0:17891，Core API 默认 0.0.0.0:17871，均为 HTTP；仅通过 --ui-port/--core-port 改端口。ControlPlane 后端访问 loopback Core，浏览器只通过 UI 使用工作台、管理、文件、事件及 /services/<workId>/<serviceId>/<port>/。远程原生 CLI 直接访问 Core，不需要 --core-listen 或 ControlPlane 代理。

Agent WorkServices 7172 SHALL 保留容器可达性及原 mTLS 安装/Work/代次/角色校验，不用 HTTP 端口替代，不增加用户 RPC 参数。部署材料明确两个 HTTP 端口和内部 RPC 的职责，不声称系统只有一个 listener。

主站与 Service URL SHALL 使用本次已验证的 HTTP UI origin，按 core-service-startup 校验本机地址、Host/Origin/CSRF，不信任任意 Forwarded，不提供内置 HTTPS/public-origin 配置。Service 继续遵守路径前缀、响应 Cookie 分区和脚本 Cookie 限制。此调整不改变外部模型/MCP 的网络准入或原生 CLI 通用 HTTP(S)/CA 处理。

#### Scenario: 浏览器只访问 UI
- **WHEN** 另一网络客户端仅能访问 UI 端口，通过实际服务器 IP 使用网页
- **THEN** 工作台和支持前缀的 Service 可用，浏览器不请求 Core/RPC，用户容器无宿主端口直出

#### Scenario: 外部 Linux CLI
- **WHEN** 外部原生 CLI 指定服务器 Core HTTP origin
- **THEN** 按用户身份直接连接，不依赖 UI Cookie 或修改服务器监听参数

#### Scenario: 内部 Agent 回连
- **WHEN** Agent 创建并管理 Service
- **THEN** 通过原 mTLS RPC 核验当前 Work/代次，不借用户 token，不因 HTTP-only 删除内部身份

#### Scenario: 同机 Desktop 端口冲突
- **WHEN** Core UI 已用 17891，另行启动独立 CLI Desktop
- **THEN** 按既有 CLI --port 显式选择其他端口，默认冲突准确报错，不自动换端口或共用身份

### Requirement: 提供对应当前 Linux 交付的双语操作材料

**Identifier:** DOCKER-DELIVERY-006

双语发行材料 SHALL 给出统一程序和 Docker 默认网页流程、普通访问地址的取得及直接创建/登录路径、初始化、状态/日志、正常关闭、重建、升级/回退及数据保留命令。默认流程零必填业务环境变量；PIWORK_ADMIN_ACCOUNT/PIWORK_ADMIN_PASSWORD 只在测试/自动部署的可选说明出现，成对创建首管理员并遵守原密码规则，不作为持续密码来源。

模型连接、Key 和 CoreRuntime SHALL 通过网页配置，不再要求 PIWORK_MODEL_PROVIDER/MODEL/MODEL_ID/API_KEY/MODEL_API_KEY/MODEL_BASE_URL 或镜像 env。说明 SHALL 区分代码构建所用变量、独立 CLI/系统环境与被移除的服务端业务初始化输入，不误删用户 Service 环境。

命令 SHALL 完整可复制，说明执行位置、固定发行身份、socket/同路径数据挂载、主站及 Service listener 网络条件、60 秒关闭预算和空安装直接创建管理员的方式。Linux 原生 CLI 使用材料保留用户身份边界；当前文档删除旧 operator 命令、CLI 容器/文件交换、独立 Console 及其他原生平台步骤，历史已发布记录单独保留其身份；密码不放命令参数，真实秘密不进入静态材料或验收输出；默认步骤不再取得、轮换或校验设置链接，不要求 setup link 命令。

#### Scenario: 新用户按文档操作
- **WHEN** 用户只执行默认 Docker 命令并在本机或远程浏览器打开服务器普通 IP 地址
- **THEN** 可以创建管理员和配置模型/runtime，无设置链接/浏览器 Access、安装包、env 编辑、CLI 登录或第二入口容器前置步骤

#### Scenario: 测试可选 ADMIN env
- **WHEN** 测试者成对传入有效 ADMIN 值
- **THEN** 只初始化持久管理员，模型仍走网页，重启不覆盖已有账号，普通教程不因此要求 env

#### Scenario: 秘密包含特殊字符
- **WHEN** 测试 ADMIN 值包含特殊字符，或只提供一项/非法值
- **THEN** 合法值按原字面传递，非法值安全拒绝，不执行 shell 内容、不回显秘密

#### Scenario: 原生客户端连接已有 Core
- **WHEN** 用户按 Linux 原生 CLI 说明连接已有服务器
- **THEN** 可默认进入 Desktop 或执行业务命令，无 Core 启停、operator 初始化或 CLI Docker 步骤

#### Scenario: 必填值不合法
- **WHEN** 测试者选择可选 ADMIN 初始化但只提供一项、空或非法值
- **THEN** 安全拒绝且不输出值；默认网页安装不存在模型必填 env 或旧模型 env 校验

### Requirement: Linux 原生 CLI 独立于容器交付

**Identifier:** DOCKER-DELIVERY-007

Linux 原生 piwork-cli SHALL 继续独立交付和构建，保留默认 Desktop、可信 open/logout、用户命令和本机恢复，不要求本机 Docker、Go、Node 或 Python。Desktop/proxy 仅使用原生 loopback 监听，不保留 CLI 容器模式环境变量分支。Docker 验收不能代替 Linux 原生 CLI 实际运行验收。

#### Scenario: 独立使用客户端
- **WHEN** 用户只安装 Linux piwork-cli 并连接已有 Core
- **THEN** 原用户能力和本机监听/浏览器行为可用，不启动 Core 或容器

### Requirement: 四角色镜像候选与真实发布身份

**Identifier:** DOCKER-MAINT-001

发行维护 SHALL 以同一真实版本、commit、dirty、源码输入、两套 UI 和协议身份制作 core、agent、fileHelper、snapshotHelper 四个镜像角色，packageHelper 复用 Agent；删除 CLI 镜像角色和相关发布假设。Docker 多阶段构建内使用 Go 1.25.5/Node 24，宿主无需这些解释器；metadata/materials 不是独立发布工具镜像，真实秘密和数据不得进入构建上下文。

本地候选 SHALL 完成静态/运行/协议/资源及 SHA256 检查，标为 candidate，不虚构 registry digest。首次 push 前核对全部四角色的实时本地 image ID、标签/协议/资源及远端身份；冲突、认证/网络错误或无法确认均零推送。登录 registry 不构成授权，明确授权后才推送，匿名拉取/manifest digest/publishedImageId 核对后另生成 published 材料，原 candidate 保留。

手册、Core-only Compose、单机示例、原生两个程序和官网候选材料 SHALL 对齐本版身份；根 README 仅维护平台短说明和导航。候选不宣称可下载，不改写历史发行记录。正式日志按精确版本维护，结构检查与 require-current 分开；本地构建不自动推送或部署网站。

#### Scenario: 四角色候选
- **WHEN** 维护者从同一输入生成候选
- **THEN** 清单/收集/预检/校验均只要求四个有效角色，无 CLI 镜像遗留，packageHelper 引用与 Agent 对应

#### Scenario: 候选身份变化
- **WHEN** 任一角色标签、输入或 UI/协议身份与已审阅候选不符
- **THEN** 首次推送前失败，不改写候选掩盖差异，不推送部分角色

#### Scenario: 仅本地制作
- **WHEN** 用户只要求构建或执行 make release
- **THEN** 只得到可核对的本地候选和校验，不生成虚构 published 身份或对外发布

## REMOVED Requirements

### Requirement: 客户端状态和文件交换可跨容器重建

**Reason**: CLI 容器和专用卷交付删除。
**Migration**: 使用 Linux 原生客户端私有配置及本地文件传输，不提供卷迁移或容器兼容模式。

### Requirement: Docker CLI 默认进入终端并保留显式命令

**Reason**: CLI 镜像及终端 entrypoint 删除。
**Migration**: 使用 Linux 原生 piwork-cli 默认 Desktop 或显式用户命令；Core 不由客户端启动。

### Requirement: 交付两个入口镜像及可独立使用的发行包

**Reason**: 本变更删除旧命令、独立交付或非 Linux 路径；旧条款的相关正向场景不再成立，完整替换为“交付统一 Core 镜像及可独立使用的发行包”，保留其中有效的业务和权限约束。
**Migration**: 按新条款使用两个 Linux 程序、Core 内嵌 UI 与既有管理 API；不保留旧语法、平台或容器兼容入口。

### Requirement: 明确 Core 与客户端的平台边界

**Reason**: 本变更删除旧命令、独立交付或非 Linux 路径；旧条款的相关正向场景不再成立，完整替换为“Linux 交付与跨平台浏览器访问边界”，保留其中有效的业务和权限约束。
**Migration**: 按新条款使用两个 Linux 程序、Core 内嵌 UI 与既有管理 API；不保留旧语法、平台或容器兼容入口。

### Requirement: 容器网络覆盖本机和外部服务

**Reason**: 本变更删除旧命令、独立交付或非 Linux 路径；旧条款的相关正向场景不再成立，完整替换为“Core 容器的 HTTP 入口与内部回连”，保留其中有效的业务和权限约束。
**Migration**: 按新条款使用两个 Linux 程序、Core 内嵌 UI 与既有管理 API；不保留旧语法、平台或容器兼容入口。

### Requirement: 提供完整的中文操作命令与新增操作清单

**Reason**: 本变更删除旧命令、独立交付或非 Linux 路径；旧条款的相关正向场景不再成立，完整替换为“提供对应当前 Linux 交付的双语操作材料”，保留其中有效的业务和权限约束。
**Migration**: 按新条款使用两个 Linux 程序、Core 内嵌 UI 与既有管理 API；不保留旧语法、平台或容器兼容入口。

### Requirement: 原生 CLI 交付继续独立存在

**Reason**: 本变更删除旧命令、独立交付或非 Linux 路径；旧条款的相关正向场景不再成立，完整替换为“Linux 原生 CLI 独立于容器交付”，保留其中有效的业务和权限约束。
**Migration**: 按新条款使用两个 Linux 程序、Core 内嵌 UI 与既有管理 API；不保留旧语法、平台或容器兼容入口。

### Requirement: 发行维护的本地候选和真实发布身份

**Reason**: 本变更删除旧命令、独立交付或非 Linux 路径；旧条款的相关正向场景不再成立，完整替换为“四角色镜像候选与真实发布身份”，保留其中有效的业务和权限约束。
**Migration**: 按新条款使用两个 Linux 程序、Core 内嵌 UI 与既有管理 API；不保留旧语法、平台或容器兼容入口。
