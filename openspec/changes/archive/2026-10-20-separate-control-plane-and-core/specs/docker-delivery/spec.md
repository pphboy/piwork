# Spec Delta

## MODIFIED Requirements

### Requirement: 交付两个入口镜像及可独立使用的发行包

**Identifier:** DOCKER-DELIVERY-001

新版本 SHALL 以一个统一 Linux 服务端入口镜像和一条 Docker 启动命令作为默认安装方式，镜像运行同版统一 Go 程序，包含 Core、管理/工作台/引导资源和非敏感 Agent/helper 引用。Agent 引用 SHALL 随版本内嵌并由服务端自动用于 runtime，不提供用户手填、选择或高级覆盖。默认入口无需 CLI/Console 容器、必填业务环境变量、发行压缩包、release.env、环境模板或源码；用户通过本机/远程浏览器完成配置。

piwork-cli 镜像、原生用户 CLI 及高级终端使用 SHALL 继续作为独立可选入口，不能成为默认网页安装前置条件。Core 自动准备匹配运行依赖，用户不手工启动内部 Agent/Service/helper。

入口及依赖 SHALL 固定实际发行版本/digest，记录同一源码、两套 UI、协议和存储身份，不覆盖旧标签或使用 latest 掩盖身份。缺依赖、身份/协议或相应验收时不得标记交付完成。本地 candidate 与 published 分开；构建/验证不授权 push、上传或官网发布。旧压缩包、校验、离线材料及下载地址保持版本归属，不伪装成新默认交付。

统一镜像 SHALL 在同一进程内启动独立 ControlPlane 17891 和 Core 17871。默认浏览器入口、内嵌工作台/Admin/引导及 Service Proxy 属于 ControlPlane；CLI/operator 直接调用 Core，不经 UI 端口。新版本不提供旧 7171 合并入口或托管 Service 端口池兼容监听；无参数仍一键启动。

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

### Requirement: 容器网络覆盖本机和外部服务

**Identifier:** DOCKER-DELIVERY-004

统一服务端 SHALL 沿用 Linux host 网络和同机 Engine Unix socket，Core 直接访问受管 Work 私网，Agent 通过既有 WorkServices mTLS 回连。用户 Service 容器不发布 Docker 宿主端口。ControlPlane 默认监听 `0.0.0.0:17891`，浏览器只通过该端口完成工作台、Admin、文件、事件与 `/services/<workId>/<serviceId>/<port>/`；不要求额外 Service 端口池、域名、DNS/PAC/hosts 或客户端代理。

Core SHALL 保留独立 HTTP 端口，默认 `127.0.0.1:17871`，供同机 ControlPlane、用户 CLI 与 operator 使用。需要远程或 bridge 容器 CLI 时，部署 SHALL 显式选择可达的 `--core-listen` 地址和相应网络范围，客户端直接指定该 Core origin；不得把 loopback Core 当作 bridge 容器已可访问或要求 CLI 经过 ControlPlane。浏览器的默认完整使用不以远程 Core 可达为前提。

Agent WorkServices 7172 SHALL 保留当前 mTLS 安装/Work/代次/角色校验与容器可达性，不用 Core HTTP 17871 替代，不因浏览器单端口而关闭或仅绑定容器不可达的 loopback。部署材料 SHALL 区分浏览器端口、可选远程 Core 端口和仅容器需要的 RPC 网络范围；保留必要回连，不能把内部监听宣称为浏览器入口或“整个系统仅一个 TCP listener”。

主站及 Service 浏览器 URL SHALL 使用实际客户端可达的 ControlPlane origin，不指向 Core/容器或客户端 localhost。HTTPS/受信反向代理 SHALL 在同一浏览器入口验证前缀、来源、证书和流式连接，不关闭校验、不信任任意 Forwarded 头。高级 CLI 的 HTTP(S)、host-gateway、自定义 CA、终端和显式本机 Desktop 契约保留；模型/MCP 可达性仍从 Work 网络判断，不因 CLI 宿主别名放宽 URL 校验。

#### Scenario: 同机和远程 IP 访问
- **WHEN** Docker 服务端运行，独立客户端网络只允许访问服务器 17891
- **THEN** 能使用完整工作台与多个支持前缀的 Service，浏览器不请求 17871、7172 或其他 Service listener，用户容器无宿主端口直出

#### Scenario: 同机和远程 CLI
- **WHEN** 同机 CLI 使用默认 Core 地址，或部署者显式开放可达 Core 地址供远程 CLI
- **THEN** CLI 直接通过 17871 按原身份工作，不使用浏览器 Cookie 或 ControlPlane 代理

#### Scenario: Linux 同机 Core 和 CLI
- **WHEN** 单机高级示例使用独立 bridge CLI 与 host-gateway
- **THEN** 示例同时提供可达 Core listener 和正确上游地址，不把 127.0.0.1 的 Core 当成容器可达，不扩大 CLI 对 Engine/安装数据的权限

#### Scenario: Agent 回连与 HTTPS
- **WHEN** 浏览器入口配置 HTTPS，Agent 创建并管理 Service
- **THEN** 浏览器仍只使用同一个 HTTPS origin，Agent 保持原 mTLS 回连并校验当前代次，不借用浏览器或用户 token

#### Scenario: 显式启动高级 Desktop
- **WHEN** ControlPlane 已使用 17891，而用户另外启动独立 CLI Desktop
- **THEN** 材料指向其既有显式 --port 选项，默认冲突按原错误契约报告，不自动换端口或让两个实例共享错误身份

#### Scenario: HTTPS 或入口池缺项
- **WHEN** HTTPS 反向代理没有转发 Service 前缀/升级连接，或部署仍要求旧入口池端口
- **THEN** 检查指出当前同 origin 路径配置缺项，修正同一入口而不恢复端口池，不能仅凭首页成功报告可用

#### Scenario: 高级客户端和模型网络
- **WHEN** CLI 使用显式 HTTP(S) Core、自定义 CA 或 host-gateway，Work 调用模型/MCP
- **THEN** CLI 保持原地址/CA 与直接 Core 访问，模型/MCP 仍按 Work 网络和既有 URL 校验，不被宿主别名放宽

#### Scenario: CLI 在 Windows 而模型在其他机器
- **WHEN** Windows CLI 连接可达的 Linux Core 17871，而模型位于另一机器
- **THEN** CLI 直接使用 Core API，模型仍必须从 Work 网络可达，客户端宿主地址不能代替模型地址；不宣称 Windows Core 支持

### Requirement: 以 Core 与 Desktop 实际使用验证交付闭环

**Identifier:** DOCKER-DELIVERY-009

新候选 SHALL 使用实际统一镜像、独立空安装及无本版依赖缓存的 Linux Engine，分别验证默认 Docker run 和可选 Compose 的零业务 env 网页安装；每种方式均须网页创建首管理员、保存模型/runtime、准备依赖、创建 Work 并取得首条真实模型回复。测试/自动部署的 ADMIN env 路径另行验证；Compose 加 ADMIN env 的通过记录不能代替 Compose 零 env 记录，Docker run 的零 env 记录也不能代替 Compose。

必做网络验收 SHALL 采用 `0.0.0.0` 通配监听，再从另一电脑或独立客户端网络命名空间通过服务器实际非回环 IP 完成上述流程和规定功能；基础默认路径不预填 `--public-origin`，可使用局域网或隔离网络，无需公网地址或公网连通性实测。NAT/受信代理的显式 origin 覆盖作为对应高级场景单独记录，精确 Host/Origin/CSRF 保持，托管 Service 使用明确的同源信任边界。IPv6 URL/来源保留单元/契约检查，实际 IPv6 网络不作为本变更完成前提。

引导页、Runtime 管理页和旧 `/runtime` 深链接 SHALL 均无需也不能输入 Agent 镜像；验收核对已保存 runtime 的引用与实际服务端制品内嵌的发行默认一致。镜像准备失败的验收使用隔离 Engine/registry 故障夹具，不以给产品增加镜像覆盖入口来制造或修复故障。

完整验收 SHALL 覆盖两个用户/浏览器的平台身份隔离、多个 Service 同名响应 Cookie 分区、带 Service 前缀的资源/页面/API、受支持的应用认证、SSE/WebSocket、独立窗口、Files 条件写入、配置 Save/Apply、包、Stop/Export/Inspect/Import/Start、注销/撤销与服务器正常关闭重启恢复。document.cookie/Cookie Store 兼容与脚本写入 Cookie 跨 Service 串用按 BSA-003/BSA-004 记录为首版已确认限制，保留复现结果且不作为一键启动阻塞；不能将历史失败改写为通过。应用存活、编译、fixture 回复、HttpOnly 单例登录或同机 localhost 成功不得替代完整远程证据；支持范围内未通过项保持失败/未执行，不能追加 DNS 前提或放宽 Core 所有者鉴权与响应 Cookie 分区要求。

候选 SHALL 核对源码/二进制/两套 UI/依赖/镜像/协议/Compose/官网材料身份。真实模型、真实浏览器、Windows 浏览器及原生 CLI 平台证据分别标记，不由 Linux 或模拟结果推断其他平台。缺 Windows 浏览器实机时不能声称对应验证完成，也不能因此将 Windows Core 加入范围。

本地验证不授权推送；获明确发行授权后另验匿名读取、远端 digest 和全部依赖身份，不改写旧候选/历史证据。

网络验收 SHALL 明确区分两条路径：浏览器网络只放行 ControlPlane 17891、禁止直连 Core/旧端口池时完成完整网页流程；CLI/operator 使用 Core 17871 完成对应真实用户/管理命令。单纯改变端口常量或编译通过不能证明双服务边界，须有实际网络调用及两个 listener 的启动/失败/关闭证据。

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
- **WHEN** 维护统一网页默认安装、可选 Compose 与高级 CLI/Core Demo
- **THEN** 默认验证远程完整网页，仍交付的高级路径按各自版本/身份验证，不成为默认前置

#### Scenario: 候选无法通过既有发行门禁
- **WHEN** 源码、二进制、两套 UI、镜像或材料不一致，或无法确认关闭
- **THEN** 阻止候选通过，保留安全诊断，不重提业务操作、不伪造证据或自动推送

#### Scenario: Core 与 UI 分别验证
- **WHEN** 相同候选的浏览器通过 17891 完成使用，CLI 通过 17871 执行业务，operator 通过 17871 执行管理
- **THEN** 各自使用正确身份和实际 HTTP 链路，浏览器没有 Core 请求，CLI 无需 ControlPlane；仍只有一个持久 Core 所有者

#### Scenario: 官方应用导入后仍支持前缀
- **WHEN** 本版模板应用完整导出、导入为新 Work 并显式启动
- **THEN** 新身份前缀下的资源、业务和 WebSocket 实际可用，原数据和固定镜像保持，不手改包内 URL

### Requirement: 可选 Core Compose Demo 与默认材料同步维护

**Identifier:** DOCKER-DELIVERY-011

统一服务端 Compose SHALL 单独启动同一程序，默认无需业务 env，保持 Docker socket、数据路径、host 网络、ControlPlane 17891、Core 17871 及内部 Agent 回连条件、应用 liveness 和 60 秒关闭规则。examples/single-host 的 CLI SHALL 成为显式可选高级组件，不默认拉起、阻塞统一网页或取得 Core 初始化秘密；CLI 启退不创建/重建/停止 Core。

双语根 README SHALL 同步维护项目展示和有效文档导航，不携带当前镜像命令或重复详细教程。双语部署手册、Compose/模板、单机说明、发行默认值/清单及官网的 Quick Start、首页、安装、First Work、源码导航和当前下载材料 SHALL 继续同步维护以普通地址直接创建/登录的完整运行说明，不要求设置链接或 Desktop Access，并提供可执行的一致性检查。检查使用合成值，不输出真实秘密；连续同步候选时不得残留前一个当前引用。历史发行下载保留原版本身份，不覆盖为未公开的新候选。

材料同步 SHALL 在没有根 README 安装块、原生启动块和 Architecture 章节的情况下正常完成，并保持根 README 内容不变；官网使用说明生成 SHALL 不将根 README 当作教程来源。统一原生 Linux 入口 SHALL 同时在既有双语部署手册和生成的官网材料中有效，不能生成空内容或字面量 undefined。

不同启动方式切换 SHALL 先正常停止原实例并复用所属安装路径；单机示例继续使用独立数据路径，不能自动停止冲突安装或扫描接管其他数据。材料检查失败 SHALL 阻止候选通过。

当前详细材料 SHALL 同步新端口职责、Core 默认 loopback 与显式远程监听、托管 Service 路径及前缀/同源边界。默认 Docker/Compose liveness SHALL 检查 ControlPlane 17891；CLI readiness SHALL 直连 Core 17871。当前材料不得残留要求 7171 合并入口、--service-ports 或 17891–17954 入口池的步骤，也不能将独立 CLI 的 Host/PAC 功能描述成托管兼容回退。

材料检查 SHALL 覆盖监听、Core 客户端默认值、探针、Compose/单机模板和两套 UI/镜像资源身份。旧已发布版本及其历史材料保留真实身份；新端口材料在发行前须标明本地候选，不能把新使用步骤配给仍不支持的旧发布镜像。官网当前生成源及隔离预览同步，不把本地维护当作外部部署授权。

#### Scenario: 材料产生漂移
- **WHEN** 任一详细教程语言、Compose 或官网仍要求设置链接、Desktop Access、模型 env、第二默认 CLI 容器，引用与当前候选不同，或根 README 导航无效
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

#### Scenario: 端口或发布身份漂移
- **WHEN** 当前候选手册、探针、单机 CLI、模板或官网生成材料仍使用旧端口池/合并入口，或新说明指向不支持的已发布镜像
- **THEN** 检查失败并定位不一致，不改写旧 release 的 commit/digest 来伪造一致性
