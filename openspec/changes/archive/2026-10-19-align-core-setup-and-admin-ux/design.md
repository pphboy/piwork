# Design

## Context

动机与范围见 [proposal.md](proposal.md)。下表保留首轮提案阶段的源码基线；首轮及第 7 节实施事实见 [acceptance.md](acceptance.md)。当前新增的 Admin 内 Quick setup、Admin 账户菜单和 Workbench 顶栏整合由 tasks 第 8 节承接；现行行为以本设计与更新后的 delta 为准，既有验收不代表第 8 节已实现或通过。

首轮实施前的连接点：

| 当前实现 | 本次设计依据 |
| --- | --- |
| `apps/console-webui/src/onboarding.ts` 自建 field/button、全页 innerHTML 和单个 busy；模型/Runtime/准备三个 section 同页常驻 | 字段结构没有遵循 Console 的 field-body，动作缩进和输入宽度难保持；状态与用户步骤需要分开 |
| `apps/desktop-webui/src/app.ts` 托管连接页的 Sign in 使用 btn，Desktop 样式定义 button | 新入口没有取得现有按钮规则，需修复并做实际样式核对 |
| `apps/ui-shared/tokens.css` 已共享颜色，两个 WebUI 仍分别定义基础控件；copy-static 仅拼接 tokens 和本地 CSS | 颜色相同不足以保留完整控件语言；共享基础控件需要同时进入打包及输入 hash |
| `model-management.ts` 已处理完整模型、256 字符、协议地址帮助、Test 弹窗、草稿版本及身份/视图隔离 | 复用模型表单和结果语义，避免引导再维护一套不同校验及反馈 |
| `internal/consoleapp/console_api.go` 给 Runtime DTO 补入服务端发行镜像，但 Core 的 selection/legacy 路径仍接受指定镜像 | 固定镜像必须落在 Core 写入边界，独立 Console、直接 API 和 operator 才能一致 |
| `internal/coreoperator/arguments.go`、`run.go` 仍要求 config set --agent-image，离线直接调用 Settings | 在线/离线同时收紧；现有运维说明、合成验收脚本也需要调整 |
| `apps/desktop-webui/test/onboarding.test.ts` 已以真实统一程序监听通配地址，再通过实际 IP 浏览器测试，主要使用缺失 Engine 和合成模型 | 可以扩展现有入口验证授权、分段恢复与界面，并另补真实 Engine 的准备/工作台出口 |

使用反馈复核时的源码显示：准备页每 5 秒读取一次快照，但第 4 步仍固定标作 Ready for Work，主要提示只说明未 ready，基础 status.ready 后就强调 Open workbench；底部仍有 Change model 和 Review Runtime in Admin。服务端已有包含六个组件的 preparation.ready，以及 state、attempt、code、retryAfterSeconds，不含下载字节或百分比。Desktop 账户菜单新增的两个 a 链接使用 btn quiet，而现有菜单布局依赖 button 样式类，且现有菜单项语义注入只处理 button，造成外观和键盘遍历不一致。

第 8 节规划前重新核对当前源码：CoreSetup 仍由独立 onboarding 页面承载；Admin 的 shell 使用 details/summary 和独有 account-popover，而 Desktop 已有可键盘遍历的锚定命令菜单；托管 Workbench 在 shell 构造后追加到顶栏末尾。模型字段已共享，顺序保存、未知读回及完整准备状态已实现，可在拆开身份入口和配置内容后复用，避免复制另一条保存链。

有效基线为 web-onboarding、ui-language、serve-ui-configuration、core-admin-api、serve-control-plane、core-service-startup，以及 DUL-003/007/011、DUL-OVERLAY-ROLE-001 和现行 UI 组件规范。旧 Runtime API/运维示例允许提供镜像，本次在对应 delta 明确变更；其他管理能力、Work 独立配置和网络职责沿用现行契约。

## Goals / Non-Goals

**Goals:**

- 把服务端确认状态映射为可操作的首次任务，用户每次只处理当前缺项，已确认的步骤可恢复。
- 准备步骤解释正在等待的对象和后续动作，全部交付依赖 Ready 后再完成首次引导；托管账户管理链接与原有菜单命令一致。
- 将登录后模型与准备任务放进 Admin 的 Quick setup，使快速配置、完整管理和工作台返回共享导航；Admin 账户菜单采用 Desktop 的同类控件及关闭规则。
- 将共用控件、模型表单行为、用户步骤编排和 Core 固定镜像写入分开，使各层有单一明确职责。
- 在真实统一程序、Go 嵌入资源、Admin 与可选 CLI Desktop 中验证同类控件与返回路径。

**Non-Goals:**

- 不新增 Agent CoreFlow/CoreLoop 调度、Provider 模板、模型自动探测、隐式 Test、后台任务队列或自动创建 Work。
- 不改变管理员创建/登录的权限边界，不引入二次认证、短信或 OTP；密码二次确认属于浏览器输入校验。
- Admin 顶层工作区保持顺序，仅在 Overview 内增加 Quick setup；不全量重写 Desktop 工作区，不增加 UI 库、主题系统、动画阶段或独立无障碍认证。
- 不改变 Linux/Windows 支持、Docker 版本支持基线、Service Cookie 隔离或公网部署方案；不升级宿主 Docker，不发布镜像。
- 不取消 Work 自身及 operator 默认 Work 既有高级配置，也不取消 helper 的显式参数；固定范围为全局 CoreRuntime。

## Decisions

### 1. 用持久事实决定当前步骤，CoreFlow 用于描述操作链

采用“目标、输入、动作、确认、恢复、出口”的用户流程。CoreFlow 在这里不成为平台业务调度器。保留 `/setup` 的身份入口、`/login`、`/admin`、`/admin/runtime`、旧管理深链接映射及工作台入口；登录后的配置规范路径增加 `/admin/setup`，由 Overview 的 Quick setup 进入。

```text
Open entry
    |
    +--> Setup access --> Create admin --> Sign in
    |                                      |
    +--------------------------------------+
                                           v
                                  Admin / Quick setup
                                           |
                                   Add / choose model
                                           |
                                    Save and continue
                                           |
                                  Confirm saved model
                                           |
                                    Bind Core runtime
                                           |
                                  Observe preparation
                                           |
                                 All dependencies ready
                                           |
                                     Open workbench

Unknown write --> Read original state --> Confirm / explicit recovery
Known failure --> Keep confirmed result --> Correct / resume missing step
```

读取和导航按以下顺序处理：

| 已确认状态 | 页面与动作 |
| --- | --- |
| 尚无首管理员且无有效设置授权 | 显示取得/更新设置链接的方向；普通访问不公开生成链接或创建权限 |
| 尚无首管理员且设置会话有效 | Create admin，密码二次确认 |
| 已有身份但当前未登录 | 普通 Sign in；创建成功也走此路径 |
| 普通用户登录、Core 未配置 | 说明需要管理员配置，可查看工作台的可用部分 |
| 管理员登录、Runtime 未配置/引用不可用 | 在 Admin Quick setup 的模型阶段使用持久模型或新增，保留具体不可用原因 |
| 管理员显式打开已配置安装的 Quick setup | 当前模型可见，可选择/新增并显式保存，不因存在 Runtime 隐藏配置入口 |
| 当前任务已确认 Runtime，进入准备观察 | 显示 Preparing Piwork…、当前准备项与等待说明，完成区 Open workbench 未全部 Ready 时不可激活 |
| 基础 Work ready、完整交付未 ready | 继续等待剩余 helper，保留具体原因及恢复，完成出口仍不可激活 |
| 基础及完整交付均 ready | 显示 Piwork is ready，准备步骤完成，完成区 Open workbench 为可用主动作 |

初次进入按当前事实继续。独立身份页完成授权、创建与普通登录，已登录 Quick setup 只呈现模型、准备两步。显式配置入口可以选择/编辑当前模型；继续准备、刷新和返回使用当前路由视图及持久事实恢复，不能把路由阶段视为已保存或 Ready 证明。已完成的管理员创建不作为待办重新执行。准备页通过 Admin 壳导航离开处理配置，完成出口按全部 Ready 启用，正常状态刷新不强制导航。该完成条件不改写 Core 的基础 Work 准入或已有安装的工作台降级访问规则。没有有效授权的匿名访问、会话失效、网络读取失败、发行依赖错误使用不同状态，避免顶层 catch 把任意错误都变成设置授权问题。

相比继续在一页堆叠三个独立 section，该方式让任务顺序与持久事实对应；相比把引导塞进 Modal，页面能容纳必要错误、返回和窄屏内容。

### 2. 共享基础控件，保留容器的布局职责

以 Desktop 现有普通按钮与 small 角色为基准，将两端共用的按钮、图标按钮、输入边框/焦点与反馈角色收束到 `apps/ui-shared/` 的轻量基础样式；继续使用现有原生控件和模板函数。基础角色可兼容现有 button/btn、quiet/ghost 命名，但不能让旧选择器覆盖掉已统一的状态。删除或收束重叠基础定义，应用 CSS 只负责布局及明确的密度变体。

普通按钮以现有 40px 为基线，紧凑角色以现有 34px small 为基线；相同动作组内的图标、文本按钮和输入等高，菜单行与关闭控件保留自身角色，不统一放大成 footer。颜色、字重、padding、图标间距、边框、小圆角、可见 focus、hover、active、disabled、loading 和 selected 分别核对；不为这次对齐添加动效。

Admin 内 Quick setup 共用现有最大 1100px 的外层页面轨道，标题和一级 section 与其他管理页对齐；任务内容在 section 内收束为最大约 640px 的单列。独立创建账号/登录沿用最大 420px 窄表单。标签位于输入上方，帮助、错误和动作共用起点，步骤与任务内容在同一内部轨道内。其他 Admin 表单继续使用各自字段网格及断点；内部单列例外不扩散到完整管理页，也不把 Desktop 工作区结构扩散到 Admin。

Logo 使用现有本地资源，品牌返回与产品标签结构保留；Quick setup 使用 Admin 顶栏和当前身份，不嵌套原 CoreSetup 顶栏。独立身份页仍能识别产品、当前任务及返回。修复 Desktop 托管 Sign in 的样式角色，并检查新增跨页面链接，导航仍使用 a 元素。

Desktop 账户下拉继续使用现有锚定命令菜单。账号标题只显示一次，Role 和 Core 地址留在次级身份区；Administration、Quick setup 采用现有菜单行基础类、前置图标、文字对齐和 hover/focus 规则，保持与 About Piwork、Known operations 一致。导航仍是带真实 href 的 a，同时加入 menuitem 和原菜单的键盘遍历/激活，避免仅给 button 补语义。保留分组与 Sign out 危险角色、管理员可见条件及独立 CLI Desktop 的 Switch Core/Reset browser access；不以菜单对齐为由重排 Admin 导航。

Admin 的账户菜单沿用相同的命令菜单行和行为，Workbench 采用顶栏紧凑导航角色，具体组合和范围见决策 9。复用轻量样式/行为，不导入 Desktop 的全局工作区控制器。

相较直接导入整个 Desktop stylesheet，基础样式共享可以避免工作区、弹窗或 Service 视口 CSS 进入管理页；相较只复制一段按钮 CSS，可避免下一次调整再次分叉。

### 3. 密码二次确认留在创建表单

Create admin 使用 Account、Password、Confirm password。两项密码均使用 new-password 自动填充语义，允许粘贴；不改变用户原文。确认框首次失焦或提交后开启一致性反馈，后续任一密码变化重新核对。提交本地校验失败聚焦首个错误字段，修改后清除已不成立的错误；未操作时不展示提前报错。

同一原生表单承接 Enter 和按钮提交，创建请求在本地验证通过后最多发送一次。服务器仍只收到现有 WebCredentialsInput 的 account/password；授权证明、来源/CSRF、持久用户为空的原子约束、12 字符及其他服务端密码校验不变。创建响应未知只读核对初始化结果，不自动重建。请求终结、离开身份或跳转后清理两项敏感输入，登录保持单密码。

相较增加 confirmPassword 服务端字段，浏览器校验无需扩展 bootstrap、env 或 operator 协议，服务端继续承担真实安全校验。

### 4. 模型编辑复用行为，新增和选择分别呈现

从 `model-management.ts` 提取可复用的模型输入、字段长度/协议地址帮助、本地错误映射与 Test 结果呈现，置于 Console WebUI 的轻量模型表单模块；现有 ModelManagement 保留列表及启停/删除等管理职责。CoreSetup 通过显式回调接入同一表单行为，使用自己的会话/视图上下文，避免直接复用带全局 document 监听的完整管理控制器造成重复事件。

空目录只显示新增表单；有保存项时默认显示选择和明确 Add model 入口，两个模式不会同时要求填写。模型字段保持 API type、Base URL、Model ID、API Key 与可选名称的完整契约；不增加 provider、能力模板、Thinking 或目录收录前置条件。不可用项保留名称和原因。

Test 使用现有短消息、结果弹窗、关闭/返回及草稿版本隔离，显式点击才调用；失败不阻止合法保存。引导和 Admin 的测试回复、安全错误、字段定位、结果过期与敏感清理规则一致。Base URL 帮助随协议变化，但不擅自改写用户已经填写的 URL。

非敏感草稿只在当前页面会话中保留；密码/Key 不写 Web Storage。Test 结果或后台状态变化只更新相应容器，不重建正在输入的 DOM。切换模式、离开到其他管理页/Workbench 或返回时按未保存规则处理；有确认 modelRef 后不再次要求输入 Key。

### 5. 一个继续动作编排两次写入，保留各自事实

保留现有 POST models 和 PUT runtime，不新增聚合写入接口或假事务。`Save and continue` 是同时授权这两步的一个明确用户意图；选择已有模型时直接开始绑定。当前动作记录发起身份、视图代次、提交目标、模型确认引用和 Runtime 确认结果，普通 busy 不承担全部业务状态。

```text
Draft --> Saving model --> Model confirmed --> Saving runtime --> Preparing
              |                                  |
              v                                  v
        Rejected / unknown                 Rejected / unknown
              |                                  |
        Correct / read only                Resume bind / read only
```

模型创建确认后立即记录 modelRef、清理本次提交的 Key，并按原意图绑定。绑定失败显示“模型已保存；Runtime 未绑定”，显式恢复只重试绑定。确认保存后的状态刷新失败不撤销保存结果。写入响应未知时中断自动推进，先只读核对原引用/保存状态；只有唯一事实能证明原步骤已完成才显示确认，恢复继续仍由用户明确发起，不根据匹配名称猜测或重发 POST。

每次继续动作独立记录当前保存阶段；新的执行链不继承上一链的 Runtime 提交目标。明确拒绝后清理该目标，仅未知 Runtime 写入保留目标用于读回，避免切换新增模型后把模型保存错误归入旧 Runtime 绑定。

页面刷新后从当前视图及持久事实恢复：模型存在而 Runtime 缺失时可以选择已保存项继续，准备视图读回已保存 Runtime；显式打开 Quick setup 仍可配置当前模型，不因已有 Runtime 强制只看准备结果。同一模型及当前发行均未改变时继续动作只读取准备，不重复 PUT。无需持久化半途动作队列、secret 或浏览器完成标记。旧回调的成功、失败和 finally 都核对身份及视图代次，不清理新 Key、覆盖新草稿或释放新请求锁。

单纯更换主按钮文案不会解决重复提交与中断问题；将两步改成服务端事务会引入新的 API 和部分失败迁移成本，因此采用现有接口的显式连续意图。

### 6. 固定镜像在 Core 保存边界统一解析

复用 `internal/distribution.Defaults()`，在 Core 的 Runtime 保存入口统一解析可信 Agent 引用。`packages/contracts/` 的引用式输入允许只含 modelRef，既有完整模型输入不再要求 agentImage；该旧字段可选且仅允许等于 Core 内嵌值。不同值、空值或非法类型在任何模型/Runtime/default 写入前拒绝；内嵌元数据错误用现有安全发行错误方向处理，不回退旧 Runtime、客户端版本或 env。

涉及两条当前写入路径：`configureRuntimeSelection` 的数据库引用式保存，以及 Legacy RuntimeInput/Settings 路径。所有公开 admin/control HTTP、Console 适配和 operator 离线初始化必须在进入持久化前调用同一解析规则；Settings 内部结构可以继续承载已解析引用，内部合成测试不构成用户配置入口。保持原授权复验及 Runtime/default 原子提交边界，契约通过 make generate 同步 Go DTO/schema 和跨语言数据。

Console 新请求只传 modelRef，去除适配层承担镜像选择的职责；原 runtime-defaults 读取保留兼容和诊断，不再成为浏览器构造写入字段的前提。缺失发行信息不应阻断登录、已保存模型的读回或整个引导壳；快照读取应分别表达可确认状态和发行错误。

operator 参数解析删除 --agent-image，并将模型字段的本地合法性检查与发行镜像解析分离。在线请求省略镜像，由目标 Core 解析；离线以本地服务端发行信息解析后沿原锁与 Settings 保存。help/usage 不读 secret/网络，未知在线结果不触发离线回退。

固定是“随当前发行程序内嵌”，不使用跨版本常量或 latest。读取旧 Runtime 不改写；显式保存相同模型但采用新发行引用属于真实配置更新，UI 可给简短范围说明，镜像长地址和新旧对比只在诊断中查看。普通未修改表单不重复提交。已有 Work 镜像/模型、operator 默认 Work 独立配置和 helper 参数继续遵守现有边界。

仅在 Console 补默认值会留下直接 API 与离线入口，启动时强制迁移则会改动已有安装；因此采用统一写入边界并保留显式保存语义。

### 7. 准备阶段明确等待，全部 Ready 后完成引导

继续使用后台准备、现有组件状态及 1/5/15/30/60 秒封顶退避，不为页面轮询新建拉取任务或进度 API。使用同一有效快照中的 `status.ready === true && preparation.ready === true` 判断本准备页完成；缺项、读取失败或仅基础 ready 均不能带来新的完成确认。Docker Engine、Agent、Packages、Work defaults、Files 和 Snapshots 均为服务端完整交付状态的组成，客户端不根据返回集合为空或部分组件 Ready 自行推断完成。

等待期间，准备步骤与内容区使用 Preparing Piwork… 等进行中文案和可见等待指示。Admin 内该步骤是模型之后的第二步，原独立引导的第 4 步编号仅保留在历史验收中。主要说明使用 `Please wait while Piwork prepares the required components. This page updates automatically.`，就近显示当前实际准备项；只采用 API 能证明的粒度，例如 Checking Docker Engine、Preparing Agent 或 Waiting for Agent and Packages，不能把粗粒度 preparing 编造成特定下载阶段。可说明首次运行可能需要下载资源，但不虚构百分比、速度或预计剩余时间；单一 spinner 不承担长期反馈。等待指示与共享图标/状态语言一致，不引入新的切换动画阶段。

| 当前事实 | 所属区域反馈与动作 |
| --- | --- |
| pending / preparing | 展示等待的前置依赖或正在准备的对象、请稍候和自动更新说明；Open workbench 不可激活且有可读原因 |
| 基础 ready，仍有 helper 未 ready | 指明剩余准备对象，继续等待，不展示首次设置成功 |
| retrying | 显示依赖、可理解原因及服务端报告的剩余重试等待，保留自动重试及手动只读刷新 |
| failed | 显示明确失败和修复方向；不能继续用正常等待文案掩盖，不宣称所有失败会自动重试 |
| 读取中断 | 保留并标明最后确认数据、读取错误和只读恢复；不将中断解释为准备失败或新 Ready |
| 基础与完整交付均 ready | 显示 Piwork is ready，标记准备步骤完成并启用完成区主要出口 Open workbench；用户点击后进入工作台 |

准备页底部不恢复 Change model、Review Runtime in Admin，使用 Admin 壳的管理导航，保留 Read current state 与按需只读 Runtime diagnostics。正常等待不要求用户重复读取或保存；管理员可通过顶部导航处理失败。导航、刷新或完成不自动创建 Work、提交模型 Test 或启动 Run。若新快照再次不满足完成条件，按当前事实恢复等待/失败和不可激活出口，不沿用旧成功。

首次读取显示局部静态加载，背景读取只更新所属状态，保留最后确认内容和焦点。手动刷新在原控件反馈并与同对象轮询互斥；长时间 preparing 仍表达当前对象及继续等待，不仅因耗时长就推断失败。模型、Docker、发行信息和授权失败不互相冒充。此次调整只收紧 CoreSetup 准备页的完成出口，既有基础 readiness、各 helper 能力边界及普通工作台访问仍按原契约执行。

### 8. 构建输入、旧脚本和验证一起闭合

两端 copy-static 将共用基础样式按相同顺序装入资源；`scripts/build-cli.mjs`、`scripts/build-docker-release.mjs` 及对应测试需包含新共享文件的输入 hash，重新生成 `internal/desktopassets/`、`internal/consoleassets/` 并构建宿主二进制，核对深链接静态资源地址。

现有 `scripts/check-web-base-core*.mjs`、`native-host-acceptance.mjs`、`measure-work-latency.mjs` 和相关测试通过 --agent-image 设置验收镜像。移除参数时同步改为使用测试程序实际内嵌引用；必要时为隔离验收构建带合成发行元数据的程序，不能增加产品运行时镜像覆盖、旧 env 兼容或借默认 Work 配置绕过本次验收目标。既有已发布 metadata/digest 不重写。

主要验证矩阵：

| 路径 | 核对内容 |
| --- | --- |
| Create admin | 两次密码缺失/不足/不一致/改后失配、合法一次创建、来源/CSRF/证明及未知创建恢复 |
| 模型和绑定 | 空/已有/不可用目录、Test 失败仍可保存、明确绑定失败仅继续后一步、响应丢失先读回、重启继续、无隐式 Test/Work |
| 准备和导航 | Engine 缺失时可登录配置，等待指示/当前项/自动更新说明，基础 ready 且 helper 未 ready 时出口不可激活，全部 ready 后显式进入，retrying/failed/读取中断分别恢复，两个底部动作移除，CoreSetup/Admin 往返、身份失效与晚响应 |
| Admin Quick setup | 首次身份入口到管理内两步配置、旧 /setup 及 Desktop 快捷入口归一、已配置安装显式更换模型、原 Runtime/AI models 深链接、刷新/前进后退、普通用户拒绝、无重复配置或嵌套顶栏 |
| 固定镜像 | admin/control/Console/离线同一规则，旧同值字段兼容、不同值/无效元数据零变更，在线不同客户端版本取 Core 值，旧 Runtime 读取保持 |
| 视觉和构建 | 1440px/360px、键盘/焦点、同角色控件各状态、长字段/错误、账户菜单四项的图标和文字对齐及链接键盘导航、普通用户/CLI 菜单边界、独立 Console 与托管/CLI Desktop、嵌入资源/hash |
| Admin 顶栏 | 与 Desktop 菜单行的计算样式/图标基线对照，键盘和外侧关闭、长身份、About/Sign out、头像左侧轻量 Workbench、草稿保护及准备完成区按钮职责分离 |

扩展现有浏览器/Go 契约测试；在隔离安装上以真实统一程序监听 0.0.0.0，再从实际非回环 IP 访问完整引导与 Admin，真实 Engine 完成准备并打开工作台。使用合成模型和凭据，不发送付费模型请求，不要求公网、DNS 或为本次任务升级宿主。记录实际平台/Engine 与测试边界；只运行过的部分才记为通过。

### 9. 将登录后 CoreSetup 接入 Admin，并统一顶栏

托管 Admin 的 Overview 提供可见 Quick setup 入口，规范路径 `/admin/setup`；将其作为 Overview 下的任务页，保留当前 Overview、User access、Work setup、AI models 及辅助 Operation 导航组织。完整 `/admin/runtime`、`/admin/models` 与默认 Work 继续负责日常管理。Quick setup 内只显示模型、准备两步，并保留已配置安装的显式配置入口。

入口归属：

| 访问情形 | 入口行为 |
| --- | --- |
| 空安装 /setup 或设置链接 | 原设置授权、Create admin 与密码二次确认 |
| 已初始化但未登录 | 原普通 Sign in；需要配置的管理员登录后进入 /admin/setup |
| 已登录管理员访问旧 /setup | 兼容进入同一 /admin/setup，不保留第二套配置页面 |
| Overview 或 Desktop 的 Quick setup 快捷入口 | 真实链接到 /admin/setup，当前模型可配置 |
| Quick setup 确认保存或继续准备 | 进入同页的准备视图，当前路由视图与读回事实共同恢复，URL 不充当完成证明 |
| 普通用户访问 /admin/setup | 沿既有管理权限拒绝；旧 /setup 仍提供真实待配置/工作台方向 |

`onboarding.ts` 当前为自动执行的完整页面。实施时把独立身份流程与可挂载的模型/准备流程分开，复用 `model-form.ts` 及已有保存、Test、读回和完整准备判定；`app.ts` 提供管理壳、路由、会话上下文与导航。挂载容器、请求适配、视图/身份归属及销毁由明确边界管理，离开后停止页面轮询并失效旧回调；不能直接把现有自动执行页面嵌套进 Admin 或复制一份简化保存实现。只读准备数据沿用统一入口的现有快照，模型/Runtime 使用现有管理 API，不新增聚合写入或进度 API。

Admin 账户菜单改为头像锚定的非模态命令菜单，共用 Desktop 的行样式与轻量键盘/关闭规则。账号标题只出现一次，Role/Core 留在次级身份区；About Piwork 保留链接，Sign out 为危险动作并保持真实等待/失败反馈。Core 地址只取已确认公开连接信息，独立 Console 地址不冒充 Core，缺失时明确未取得。方向键、Home/End、Enter/Space 可遍历激活，Tab 正常移交，Escape 回到头像；外侧按下/抬起关闭保持原目标动作及其焦点，跨界拖选不误关。路由、会话或身份变更关闭旧菜单；不加遮罩、焦点陷阱或动画。

托管 Workbench 链接直接参与顶栏布局，放在头像左侧，采用现有工作台图标及紧凑轻量角色，默认图文同列，并按窄屏规则收束，保持英文名称及可见焦点。保留真实 href、修饰键/新标签语义和现有未保存保护，不能由 Admin 内部路由把目标改写为管理首页。顶栏 Workbench 保持全局导航职责，准备结果区 Open workbench 保持全部 Ready 后的主动作；不新增工作台访问门禁。

此次页面整合针对统一应用的托管 Admin。高级独立 Console 继续现有管理路线，账户菜单使用同类样式/行为，不展示无对应托管工作台的 Workbench，也不依赖统一应用专用首次授权或快照接口。

采用可挂载任务内容而不是只增加跳到旧页面的链接，是为了让配置保留 Admin 导航、会话与返回上下文；复用单一保存链可避免两套错误恢复分叉。顶栏布局和菜单职责一并收束，能直接修复当前按钮追加与独立 popover 的不一致，而不要求重写 Desktop 工作区。

### 10. 保存后离开意图与挂载生命周期绑定

Save and continue 的字段/保存代次会在正常切入准备阶段时变化，因此离开意图使用独立代次，并核对当前挂载与身份有效性。每次新的离开请求、继续编辑、放弃或销毁使之前的离开意图失效；保存完成且准备读回结束后，只有同一有效意图仍属于当前挂载才执行原离开回调。已被用户新的导航取代的意图不得把页面跳回旧 Workbench 目标，也不得注销后来身份。正常显式保存后离开仍应执行。

同一 `/admin/setup` 快速任务的 Desktop 菜单、Admin Overview 及标题统一使用 **Quick setup**；完整 Runtime 的复查操作使用 **Review runtime**，避免不同任务共用含糊入口文案。独立身份页的 CoreSetup 品牌保持。

## Risks / Trade-offs

- [共享样式覆盖顺序影响旧页面] → 抽取基础角色时移除冲突定义，保留明确密度容器；检查两端原有页面及浏览器计算样式，Service 视口不注入外壳 CSS。
- [单个继续按钮掩盖部分成功] → 分别保存模型和 Runtime 的确认，未知先读回、明确失败只继续缺项，不做自动重复创建。
- [Test/状态回调清空正在编辑的输入] → 控件 DOM 稳定，读写各自有身份/视图/目标代次，敏感清理只作用原提交。
- [移除旧镜像参数使脚本失效] → 明确 breaking 迁移，更新活动说明与合成驱动；保持 stdin/file、凭证及离线门禁，拒绝用产品新覆盖参数兜底。
- [升级后旧 Runtime 与当前发行不同] → 读取如实保留；仅明确保存时使用新固定值，原 Work 捕获身份不变，必要诊断按需可见。
- [纯模拟测试漏掉嵌入或 IP 路由错误] → 对实际构建二进制做通配监听/IP 浏览器验证并保留代表性截图；实际结果与未测范围分开记录。
- [首次完整准备比基础就绪等待更久] → 明确当前剩余依赖、重试原因及修复方向；完成出口遵守全部 Ready，管理导航保持可达，Core 与已有安装不增加全局访问门禁。
- [独立页面迁入 Admin 后出现重复监听、轮询或跨页晚回调] → 配置流程以挂载/销毁边界接入同一会话与路由代次，保留现有部分成功、未知读回和每条保存链独立阶段的回归。
- [顶栏 Workbench 被误当作准备完成确认，或链接绕过草稿保护] → 顶栏采用低强调导航角色，完成区保留真实 Ready 主动作；分别验证草稿离开、链接目标及完成区不可激活规则。

## Migration Plan

1. 先支持 Core 无镜像参数写入与旧同值字段校验，再切换 Console/operator，避免组件混合版本期要求填写镜像。
2. 更新 UI、生成契约和嵌入资源；开发构建继续使用有效内嵌发行默认，隔离验收程序使用其构建时固定的合成元数据。
3. 运维脚本删除 config set 的 --agent-image，其余模型/Key 输入保持。旧 HTTP 调用若自定义镜像，改为省略镜像；已持久 Runtime 不需要为了启动而迁移。
4. 将登录后配置接入 /admin/setup，保留 /setup 的身份与兼容入口和原管理深链接；同步 Overview/Desktop 快捷入口、Admin 账户菜单与 Workbench 顶栏，旧验收附件不改写为新路由事实。
5. 核对受影响的现有双语部署材料和示例，重建嵌入资源/宿主程序并执行对应 quickstart/文档/构建检查；追加第 8 节实际验收，不改写已发布制品或历史附件的身份。
6. 本变更不做数据格式迁移；需要回退时停止统一程序并换回匹配构建，保留完整数据目录及受管卷。若已显式保存过新发行默认，按原备份和配置恢复流程处理，不自动回写旧值或清理其他安装资源。
