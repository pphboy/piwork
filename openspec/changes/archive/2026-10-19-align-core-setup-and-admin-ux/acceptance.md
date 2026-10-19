# 实施与验收事实

验证日期：2026-10-19。平台为 Linux/amd64、Go 1.25.5、Node 24.20.0、Chromium。以下记录本变更实际执行结果；临时日志、完整截图及镜像收集记录位于被忽略的 `dist/align-core-setup/`。

## 已实现的用户路径

私有设置链接 → Create administrator（Password / Confirm password）→ 普通 Sign in → 新增或选择模型 → **Save and continue** → 分别确认模型保存和 Runtime 绑定 → 实际依赖准备 → Open workbench。

- CoreSetup 与登录采用既有 Logo、控件和单列任务容器；Admin 保留原导航、页面轨道及字段网格。镜像长地址与保存值对比归只读诊断。
- 密码原文比对、本地首错定位、失败后双密码清理、单个在途创建请求通过浏览器验证；请求只含 account/password，普通登录仍为单密码。
- Test 为显式独立操作。测试失败、结果过期、关闭后晚响应和不同视图的锁隔离均有覆盖；保存不隐式 Test 或创建 Work。
- 模型创建确认后绑定失败只继续绑定；未知写入先读回，不重放 POST/PUT。已保存模型、重启恢复和不可用目录原因保留。
- Core 的 admin/control、Console 和 operator 在线/离线路径使用服务端内嵌发行引用。旧 HTTP 同值字段兼容，异值或坏发行元数据零写入；旧 operator 镜像参数在读取 secret/连接前拒绝。
- 普通读取与启动不迁移旧 Runtime 或已有 Work。Work 自身、operator 默认 Work 和 helper 的原高级边界保留。

## 已执行检查

| 检查 | 实际结果 |
| --- | --- |
| `make generate`、跨语言契约 | 生成 223 DTO、7,250 契约夹具；契约 TS 41 项及 Go 校验通过 |
| `make test`（含 `make build`） | 全部 Go 包、87 项脚本测试、TS 单元测试与两端 typecheck 通过；5 个业务 workspace 合计 257 项单元测试通过 |
| Console 浏览器入口 | 76/76 通过，包含现有 Skills、Packages、AGENTS.md、模型目录及 Runtime 保存回归 |
| Desktop 浏览器入口 | 862 项：860 通过、2 项按既有条件跳过；本变更真实 Engine 项随后显式启用并通过 |
| 统一程序首次设置专项 | 显式启用真实 Engine 后 18/18 通过；覆盖授权、双密码、单次继续、丢响应/读回失败、后台输入与焦点、重启、普通用户、helper 降级、导航与控件计算样式 |
| 最终局部修正回归 | 网络恢复提示、目录恢复、控件视觉与准备状态用例通过；嵌入资产 Go 测试通过 |
| 原生边界、文档归属 | `check-native-boundary.mjs`、`check-repository-docs.mjs` 通过 |
| 构建输入 | 统一程序、CLI、独立 Console 的 `--version` 内嵌 UI hash 与当前共享资源输入一致 |

完整 Desktop 入口中的跳过项分别为需要实际等待五分钟的 unused ticket 过期专项和默认不启用的真实 Engine 专项；后者已在本机单独实际运行。五分钟浏览器长等专项本次未启用，相关授权拒绝、来源/CSRF 与未知创建恢复由其余 Go/浏览器用例覆盖。测试使用合成账号、Key 和模型配置，没有读取 `.env.test` 或发送付费模型请求。

## 通配监听与真实 Engine

实际程序使用独立数据目录监听 `0.0.0.0`，Chromium 通过网卡的非回环 IPv4 访问设置、登录、Admin 和工作台。保留了缺失 Engine socket 的配置场景，另使用宿主 **Docker Engine 26.1.5+dfsg1 / API 1.45** 完成固定发行依赖准备，基础及完整交付 readiness 均确认，再由用户动作创建并打开一个 ready Work。配置阶段 Work 创建数为零，模型 Test 数为零；显式 Work 创建数为一。

这记录当前宿主的实际执行，不把部署文档的 Docker Engine 28+ 基线改为 26。未升级宿主；网页验收没有部署公网入口或配置 DNS；测试退出后按本次 installation ID 核验标签并清理受管容器、网络、卷及临时数据，没有全局 prune。

## 本地制品

候选镜像按当前真实 commit、dirty 状态、源码与 UI 输入 hash 构建并收集校验。Core 镜像包含本版两端资源和编译时固定依赖；CLI、Agent 与 file/snapshot helper 同组生成。候选材料会使用新身份，原已发布 release 记录及已有镜像标签保持原字节身份。

本变更只进行本地构建、检查和打包，没有镜像推送、官网发布、Git commit 或归档。最终本地候选为 `0.0.7-6fc7e50df2c9-a0d67ef3e10b-dirty`，来源 commit 为 `6fc7e50df2c9a03de94a10a6517248d6152acb70`，modified 为 true，完整源码 hash 为 `a0d67ef3e10be735b7c15b5fc3751c750cb7ec56a2baea69630b25b778d88ffa`。实际本地 image ID 和两端 UI hash 见 [candidate-manifest.json](evidence/candidate-manifest.json)。`release.json` 与 HEAD 的字节一致，旧发布身份未改写。

`check-docker-quickstart.mjs`、其 30 项测试、材料完整性与候选预检均通过；预检只读查询注册表 tag，未执行 push。构建下载基础镜像/依赖不属于网页公网部署验收。中英文 README、部署说明、Core-only Compose 及单机部署示例引用同一新本地候选。

最终开发二进制的 Engine/IP 复验通过，执行结果及内嵌 UI hash 见 [engine-browser.json](evidence/engine-browser.json)。开发二进制使用其内嵌的上次公开发行依赖；新的候选 Core 镜像则由构建器内嵌本次同组依赖，均通过 Core 的同一固定引用写入边界。候选容器在无 Engine 条件下的实际启动、登录、CoreSetup/Admin/Desktop 资源和编译时 Agent 默认查询也已通过，见 [candidate-container.json](evidence/candidate-container.json)。

## 视觉证据

检查 1440px 与 360px，键盘标签顺序、可见 focus、长字段/错误的换行、普通/紧凑/图标/危险角色，以及 hover、active、selected、disabled、loading。普通按钮为 40px，紧凑角色为 34px；同角色的字体、padding、小圆角和图标间距通过浏览器计算样式核对。

| 场景 | 截图 |
| --- | --- |
| 创建账号、失焦与首错反馈 | [360px](evidence/create-admin-360.png) |
| 模型表单、协议帮助与长名称 | [1440px](evidence/model-1440.png)、[360px](evidence/model-360.png) |
| 单次继续的保存中状态 | [360px](evidence/model-saving-360.png) |
| 保存与真实准备分开（缺失 Engine） | [1440px](evidence/preparation-1440.png) |
| Admin 原布局与只读镜像诊断 | [1440px](evidence/admin-runtime-1440.png)、[360px](evidence/admin-runtime-360.png) |
| 托管 Desktop 的 Sign in 与 focus | [360px](evidence/desktop-connect-360.png) |

截图只包含合成配置与密码框掩码，不包含真实 secret 或设置证明。本次没有覆盖 Windows 服务端、其他浏览器/完整读屏矩阵；也没有扩展 Service Cookie 隔离、模型模板或新 UI 库的范围。

## 第 7 节使用反馈的实施与验收

验证日期：2026-10-19。本节记录等待反馈、全部 Ready 的完成出口和账户菜单修订；上文及原 evidence 文件保留首轮实际身份与结果，不替换为本轮制品。

- 准备页明确显示 Preparing Piwork…、当前准备对象、等待指示及页面自动更新说明。六个组件按实际状态显示等待前置依赖、准备、Ready、重试或明确失败，错误码留作辅助信息；没有下载百分比或预计耗时。
- 同一快照的基础与完整交付均 ready，且六个必需组件状态完整且为 ready 时，才显示 Piwork is ready、完成第 4 步并启用 Open workbench；缺失数据、helper 尚未完成、读取中断或新状态回退均不能沿用完成出口。进入由用户明确点击，不自动导航或创建 Work。
- 底部 Change model、Review Runtime in Admin 已移除；顶部 Admin、Read current state 和按需诊断保持。准备页手动读取和后台轮询不重建完成出口或折叠诊断；刷新互斥使用可访问禁用/等待状态，保留键盘焦点。读取中断显示最后确认时间和恢复方向，恢复后按真实状态继续。
- 账户菜单 Administration、Core setup 使用原有菜单行类、前置图标与文字基线，保留真实 href 并参与方向键、Home/End、Enter/Space、Tab/Escape。四个普通菜单项的几何/字阶、hover 和键盘 focus 已核对；普通用户不显示管理入口，独立 CLI Desktop 保留 Switch Core、Reset browser access，Sign out 保留危险角色。

本轮实际检查：

| 检查 | 结果 |
| --- | --- |
| 两端 WebUI 构建、浏览器测试 TypeScript 编译、Go 宿主构建 | 通过；实际二进制与两端嵌入资源及 UI 输入 hash 一致 |
| 最终统一二进制 onboarding 专项（显式启用真实 Engine） | 20/20 通过，无跳过；含等待/全部 Ready/回退/读取中断、无重复写入、菜单样式与键盘、普通用户、360px 和实际 Engine 创建 Work |
| Desktop 账户/原生认证/菜单角色定向回归 | 9 项通过，实际五分钟授权过期专项按原条件跳过；独立客户端账号动作及既有注销/授权边界保持 |
| Console 浏览器回归 | 76/76 通过 |
| Go 相关检查 | internal/webapp、internal/distribution 单元测试通过；两端嵌入资产包编译通过（无独立测试文件） |
| Quick Start 与材料 | 一致性检查及 30 项测试通过；新候选材料包的 manifest、校验和与说明完整性通过 |
| 源码与文档边界 | native-boundary、repository-docs、OpenSpec 严格校验和 diff 空白检查通过 |

真实 Engine 使用 **Docker 26.1.5+dfsg1 / API 1.45**，程序监听 0.0.0.0，浏览器从实际非回环 IPv4 访问。六个依赖全部 Ready 后显式进入工作台，再明确创建并打开一个 ready Work；模型 Test 为零，清理按本次 installation ID 核对标签后执行。使用合成凭据和模型，未读取 .env.test，没有公网部署、DNS、付费模型调用或宿主升级；不将本机结果改写为 Docker 28+ 基线调整。执行摘要见 [followup-engine-browser.json](evidence/followup-engine-browser.json)。

最终本地候选为 `0.0.7-6fc7e50df2c9-5b565fb47977-dirty`，sourceInputHash 为 `5b565fb47977d6a3bdcfca663128060c4d49d1642572f0941f369ca4cada8080`。五个镜像均已实际构建并核对版本、标签、原生运行边界与同组固定依赖，packageHelper 复用 Agent；新身份及 image ID 见 [followup-candidate-manifest.json](evidence/followup-candidate-manifest.json)。原生 dist/go/piwork 同样内嵌本次候选依赖，其 SHA256 与资源 hash 见 [followup-native-verification.json](evidence/followup-native-verification.json)。双语 README/安装说明、单机示例、生成源及 Compose 与新候选一致，说明全部 Ready 后点击进入。旧镜像及已发布 release.json 身份保持，没有推送、发布、Git 提交或归档。

代表性截图：

| 场景 | 证据 |
| --- | --- |
| 等待及当前组件（真实程序，合成状态注入） | [1440px](evidence/followup-waiting-1440.png)、[360px](evidence/followup-waiting-360.png) |
| 真实 Engine 的全部 Ready 及完成出口 | [1440px](evidence/followup-ready-1440.png)、[360px](evidence/followup-ready-360.png) |
| 账户下拉的四项命令对齐 | [1440px](evidence/followup-account-menu-1440.png)、[360px](evidence/followup-account-menu-360.png) |
| 长身份信息（合成会话显示数据） | [360px](evidence/followup-account-long-360.png) |

临时日志、完整截图及新候选构建记录在被忽略的 dist/align-core-setup/followup/。本轮按受影响范围验证，没有重跑完整 Desktop 全量矩阵、真实五分钟过期专项或其他浏览器/读屏矩阵；首轮记录与本轮实际执行分开保留。

## verify 保存恢复告警修复（任务 7.4）

验证日期：2026-10-19。复现条件为先创建模型、Runtime 绑定被明确拒绝，再切换添加另一模型，第二次模型保存被拒绝或保存后响应丢失。旧实现保留上一链的 pendingRuntime，把新模型错误误认为旧 Runtime 绑定失败；响应丢失时读回无法解锁。

现在每次 Save and continue 独立记录实际保存阶段，开始新链时清理旧 Runtime 目标；明确拒绝后不再保留该目标，只有未知 Runtime 写入才保留目标用于只读核对。新模型明确拒绝时显示模型字段错误并保留非敏感草稿；未知模型先读回，读取暂时失败仍保持锁定，确认唯一新引用后解锁，用户显式继续只绑定该引用。原模型保留，没有自动重放 POST/PUT、Test 或 Work 创建。

两项新增回归在修复前的二进制上均复现失败，修复后与原保存恢复、晚响应用例共 6 项定向回归通过。最终统一二进制完整 onboarding 入口 21 项通过，默认跳过的真实 Engine 项另外显式启用并通过，合计 22 个不同场景通过。程序监听 0.0.0.0，由实际非回环 IPv4 浏览器访问；真实 Engine 仍为 Docker 26.1.5+dfsg1 / API 1.45，确认基础和完整交付 Ready，显式创建一个 Work，模型 Test 为零，按测试安装标签清理。执行摘要见 [recovery-engine-browser.json](evidence/recovery-engine-browser.json)。测试仅使用合成凭据和模型，没有读取 .env.test、付费模型调用或改动现有安装。

Console WebUI、浏览器测试 TypeScript 与全部 Go 宿主程序重建通过；internal/webapp 测试及 consoleassets 编译通过。构建/夹具脚本 10 项、Quick Start 30 项测试通过；native-boundary、repository-docs、OpenSpec 严格校验和 diff 空白检查通过。此次未重跑未改动的 Console 全量浏览器入口、Desktop 全量矩阵、真实五分钟过期或其他浏览器/读屏矩阵。

当前原生程序为 dist/go/piwork（指向 piwork-serve），SHA256 为 `8735e81508ab8dc8adafb936d9c423f566b63080bfe6dde5720201c75b304e89`，两端嵌入资源与源码 UI 输入 hash 一致；详见 [recovery-native-verification.json](evidence/recovery-native-verification.json)。本地候选为 `0.0.7-6fc7e50df2c9-94183e076941-dirty`，sourceInputHash 为 `94183e076941716d594bcff856a698e6db1b258c136d115455b4bb0ee4df64ee`，五个镜像实际构建并校验同组依赖、版本及运行边界，材料校验和通过；身份见 [recovery-candidate-manifest.json](evidence/recovery-candidate-manifest.json)。双语现有安装材料和 Compose 仅随新候选同步身份，没有增加安装步骤。历史证据与旧候选记录保留，已发布 release.json 与 HEAD 字节相同；没有推送、发布、提交或归档。临时日志及构建记录在 dist/align-core-setup/recovery/。正在运行的用户实例未重启，需用户重启后加载新嵌入资源。


## 第 8 节 Admin Quick setup 与顶栏整合的实施及验收

验证日期：2026-10-19。本节对应任务 8.1–8.5；前面各轮验收及其附件保留历史事实，不替换为新路由或本轮制品身份。

登录后的配置已进入托管 Admin 的 `/admin/setup`，可从 Overview 的 Quick setup 或 Desktop 账户菜单的 Core setup 打开。首次授权、创建管理员、密码二次确认及普通登录仍使用独立身份页；已登录管理员访问旧 `/setup` 会重定向到同一 Quick setup，普通用户仍被管理权限拒绝，旧 `/setup` 保留待配置及工作台方向。原 Runtime、AI models 和其他管理深链接保留。准备视图通过 `?step=prepare` 刷新恢复，实际就绪仍取有效服务端快照。

实现将原模型与准备控制器提取为 `quick-setup.ts`，由 `app.ts` 挂载、传入会话与路由上下文并在离开时销毁；`onboarding.ts` 仅保留独立身份入口。Quick setup 沿用 Admin 1100px 轨道，内部 640px 单列表单及模型/准备两步，不嵌套第二个顶栏。显式打开已配置安装时展示当前模型；相同模型及发行值的继续仅观察准备，不重复 PUT。原模型字段、Test、顺序保存、部分成功和未知结果读回链保留，离开/身份失效后的回调不能覆盖新表单或释放新锁。准备区继续等待同一快照的 status.ready、preparation.ready 及六个组件全部 Ready，底部 Change model / Review Runtime in Admin 保持移除。

Admin 账户菜单改为头像锚定的非模态命令菜单，共享 Desktop 的菜单行、图标、字阶、身份次级信息及危险 Sign out。独立 Console 的 Core 地址来自已确认的远端 Core 配置，缺失时显示 Unavailable。保留 About 内容、方向键/Home/End/Enter/Space、Tab、Escape 及外侧按下/抬起关闭规则，跨界拖选不误关；路由、身份变化会关闭旧菜单，注销等待/失败不丢失 Quick setup 表单。未登录身份页不显示 Sign out；Admin 会话失效后回到统一 `/login` 并清理草稿。Workbench 为头像左侧带图标的紧凑轻量真实链接，支持修饰键打开新标签和草稿 Save/Discard/Keep editing；顶栏导航不受准备完成按钮的 Ready 门槛限制。独立 Console 不显示托管 Workbench 或 Quick setup。

最终制品执行事实：

- `go test ./internal/webapp ./internal/consoleapp ./internal/consoleassets ./internal/desktopassets` 通过；包含路由、管理员权限、旧入口、bootstrap 不重开及独立 Console 的真实 Core 地址检查。
- 实际统一二进制的 onboarding 入口显式启用真实 Engine，共 **28 项全部通过、零跳过**。覆盖创建/登录、空及已有模型、不可用目录、显式换模型、只读继续、未知写入与暂时读回失败、任务 7.4 两条恢复链、页面往返/刷新、晚到响应与锁、准备等待/重试/失败/中断、完整 Ready 门槛、菜单/草稿导航及会话失效。
- Console 全量浏览器入口 **79 项通过**。Desktop 菜单、overlay 与原生授权定向检查 **9 项通过**，其真实五分钟未使用 ticket 过期项仍按 opt-in 跳过。菜单计算样式、图标、键盘、外侧焦点、跨界拖选、长身份与 360px 均已核对。旧导航测试补齐加载完成等待；旧头像定位改为明确 button 角色，避免新菜单标签导致多元素匹配。
- 构建/夹具脚本 **10 项**、Quick Start **30 项**通过；native-boundary、repository-docs、OpenSpec 严格校验和 diff 空白检查通过。当前双语 README、Docker 手册、单机部署说明及同组候选引用已同步。

隔离安装监听 `0.0.0.0`，浏览器经实际非回环 IPv4 访问。实际 Engine 为 **Docker 26.1.5+dfsg1 / API 1.45**，平台 Linux/amd64；没有公网、DNS 或宿主升级前置。流程从首次设置链接、创建/登录进入 Admin Quick setup，确认基础及完整交付 Ready 后显式进入工作台，再返回 Admin Quick setup 观察同一模型准备，最后显式创建一个 Work 并确认 ready。模型及 Runtime 各写入一次，模型 Test 为零；仅使用合成凭据和无效测试模型地址，未读取 `.env.test` 或发送真实付费模型请求。测试关闭并按本次精确 installation ID 清理容器、网络和卷；现有用户安装未重启或修改。摘要见 [admin-quick-engine-browser.json](evidence/admin-quick-engine-browser.json)。

两端 WebUI、嵌入资源及全部 Go 宿主程序重建完成。最终本地候选为 `0.0.7-6fc7e50df2c9-be81cd61b334-dirty`；五个镜像已实际构建并校验同组版本、依赖引用及运行边界，安装材料 SHA256SUMS 全部通过。原生 Core/CLI/Console 的 UI hash 一致，35 份从实际二进制取得的浏览器模块/CSS 与构建输出、嵌入资源逐一匹配。完整输入 hash、二进制 SHA256、两端 UI hash 见 [admin-quick-native-verification.json](evidence/admin-quick-native-verification.json)，镜像身份见 [admin-quick-candidate-manifest.json](evidence/admin-quick-candidate-manifest.json)。已发布 release.json 与 HEAD 字节一致；没有推送、发布、提交、规格同步或归档。当前程序在 `dist/go/piwork`（指向 piwork-serve），运行中的旧进程需按原数据目录重启后加载新资源。

代表性截图均来自最终二进制，已检查桌面/360px 的表单、等待及完整 Ready、头像左侧 Workbench、菜单身份换行和可见焦点：

| 场景 | 1440px | 360px |
| --- | --- | --- |
| Admin Quick setup 模型表单 | [模型](evidence/admin-quick-model-1440.png) | [模型](evidence/admin-quick-model-360.png) |
| 等待准备反馈 | [等待](evidence/admin-quick-waiting-1440.png) | [等待](evidence/admin-quick-waiting-360.png) |
| 真实 Engine 全部 Ready | [就绪](evidence/admin-quick-engine-ready-1440.png) | [就绪](evidence/admin-quick-engine-ready-360.png) |
| 显式返回当前模型 | [当前模型](evidence/admin-quick-engine-current-model-1440.png) | [当前模型](evidence/admin-quick-engine-current-model-360.png) |
| Admin 账户菜单 | [菜单](evidence/admin-quick-admin-account-1440.png) | [菜单](evidence/admin-quick-admin-account-360.png) |
| Desktop 账户菜单 | [菜单](evidence/admin-quick-account-menu-1440.png) | [菜单](evidence/admin-quick-account-menu-360.png) |

另保留 [创建管理员](evidence/admin-quick-create-admin-360.png)、[统一登录](evidence/admin-quick-sign-in-360.png)、[Admin 长身份](evidence/admin-quick-admin-account-long-360.png) 及 [实际工作台](evidence/admin-quick-engine-workbench-360.png)。临时日志、构建输入与材料位于被忽略的 `dist/align-core-setup/admin-quick/`。

本轮未重跑未改动的完整 Desktop 矩阵、真实五分钟等待、其他浏览器/读屏或 Windows 客户端矩阵；未进行公网或真实模型联网验收。这些不替代上述已通过的 Linux 通配监听/IP 验收，也不将本地候选视为已发布镜像。


## 第 9 节 verify 导航竞态修复与配置入口命名

验证日期：2026-10-19，对应任务 9.1–9.2。verify 复现的路径为：Quick setup 草稿 → Workbench → Save and continue，模型和 Runtime 保存完成后延迟 onboarding 准备读取，在响应返回前切到 User access，旧读取完成后却执行原 Workbench 离开回调。该回调在 await 后缺少挂载/身份及离开意图有效性复验；同样会打断重新进入 Quick setup 后的新草稿。

`quick-setup.ts` 现在以独立 leaveGeneration 管理离开意图；新的离开请求、继续编辑、放弃和销毁使旧意图失效。保存/准备读取结束后，仅当前挂载、身份上下文及同一离开意图仍有效才执行导航。正常切入准备阶段允许改变表单视图代次，不因此误取消合法的保存后离开。

新增两条真实二进制浏览器回归在旧程序上均失败，在修复后均通过：延迟读取释放后保留新的 `/admin/users` 路线，或保留重进 Quick setup 后的新表单、Key、焦点、选区和按钮状态。模型和 Runtime 各保存一次，没有隐式 Test/Work；原正常 Save/Discard/Keep editing、保存恢复、身份失效及晚到 Test 用例继续通过。回归位于 `apps/desktop-webui/test/onboarding.test.ts` 的 delayed save-and-leave 两个场景。

Desktop 账户菜单与 Admin Overview 的同一快速配置入口统一为 **Quick setup**，目标保持 `/admin/setup`；完整 Runtime 的复查动作用 **Review runtime** 明确区分。独立身份页的 CoreSetup 品牌保留。当前 proposal/design/delta 与测试同步命名；前面各节旧菜单文案和截图保留历史事实。

本轮最终统一二进制显式启用真实 Engine 的完整 onboarding 入口 **30 项全部通过，零跳过**；Console 浏览器 **79 项通过**；Desktop 菜单/原生授权定向 **9 项通过**，真实五分钟 ticket 过期项仍按 opt-in 跳过。Go webapp/consoleapp、构建及夹具 **10 项**、Quick Start **30 项**通过；native-boundary、repository-docs、OpenSpec 严格校验及 diff 空白检查通过。

隔离安装监听 0.0.0.0，使用实际非回环 IPv4 访问；真实 Docker 26.1.5+dfsg1 / API 1.45 确认基础与完整交付 Ready、Admin Quick setup 往返及一个显式 Work ready，模型及 Runtime 各写一次，模型 Test 为零。没有公网/DNS/宿主升级前置，未读取 `.env.test` 或调用真实付费模型，按测试精确 installation ID 清理，未重启或修改用户安装。见 [leave-navigation-engine-browser.json](evidence/leave-navigation-engine-browser.json)。

两端 WebUI、Go 嵌入资源及宿主程序已重建。当前候选为 `0.0.7-6fc7e50df2c9-400a55fd56a1-dirty`；五个本地镜像实际构建，同组依赖、版本、运行边界和材料 SHA256SUMS 均通过，双语现有安装材料及示例引用同步到本轮候选。35 份从实际二进制取得的浏览器模块/CSS 与构建及嵌入资源匹配，Core/CLI/Console 的 UI hash 一致。输入 hash、二进制 SHA256 和测试摘要见 [leave-navigation-native-verification.json](evidence/leave-navigation-native-verification.json)，镜像身份见 [leave-navigation-candidate-manifest.json](evidence/leave-navigation-candidate-manifest.json)。已发布 release.json 与 HEAD 字节一致，没有推送、发布、提交、规格同步或归档。

当前菜单文案和视觉证据：[Desktop 1440px](evidence/leave-navigation-account-menu-1440.png)、[Desktop 360px](evidence/leave-navigation-account-menu-360.png)、[Admin Quick setup](evidence/leave-navigation-model-360.png)、[真实 Engine 全部 Ready](evidence/leave-navigation-engine-ready-360.png)。临时日志及候选材料位于被忽略的 `dist/align-core-setup/leave-fix/`。本轮未重跑完整 Desktop 矩阵、完整 make test、真实五分钟等待、其他浏览器/读屏或 Windows 客户端矩阵；已通过的前轮证据不改写为本轮执行。

原生程序为 `dist/go/piwork`（指向 piwork-serve）；当前用户进程未重启，需按原数据目录重启后加载新资源。
