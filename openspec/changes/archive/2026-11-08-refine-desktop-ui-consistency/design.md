# Design

## Context

动机和范围见 proposal.md；行为合同见本变更三个 capability 的 delta specs。既有 Requirement/Scenario 名称保留为追踪标识；涉及旧入口或历史视觉编号的 Scenario 正文已按本次行为更新，不据原标题继续要求旧布局。本设计从当前源码而非历史验收图推导实现，记录基线为 `1b8e48a9378ee8bda41fa095a331207b9934b2d3`，其中已经包含 Agent 的 Service 选择/刷新控制。

当前 Desktop 是真实 adapter、草稿/任务 owner 和字符串呈现器组成的浏览器应用。菜单命令的目标约束已在 work-chrome 中区分 global-account、work-row、work-header、service；浮层角色由 overlay-role 区分；布局与返回由 workspace-layout 和现有导航状态管理。shared tokens/controls、i18n、feedback-primitives 同时被 Desktop 与 Console 构建复制，最终嵌入 Go。界面变更必须沿这些责任应用，不能直接把原型对函数、DOM 和 CSS 的覆盖带进产品。

关键现状与本次差异：

| 当前要求/实现 | 本次规划 |
| --- | --- |
| DUL-002、DWUI-FEEDBACK-001 要求 Service 工具栏请求按钮 | 请求发现集中到 Chat 更多菜单，同一个检查器显式筛选 Service |
| Session 名称下拉、头部时钟、更多菜单及 Focus 存在重复入口 | 头部唯一 Session；当前上下文唯一 Focus/恢复；保留原状态机 |
| 选择 Service 后再打开 Manage services 总列表 | 选择 Pop 内管理子视图，当前应用与管理对象分别绑定 |
| DWUI-OPREC-004 要求直接从 Work 菜单进入操作记录 | Work 信息高级诊断承接历史，未决任务仍在原位 |
| 语言散布 Work 菜单/Settings，打开后替换父菜单 | 全局账户的二级单选 Pop，保留明确父子层级 |
| UIL-V13-CHROME-001 约束 Open 附图标、Refresh 单箭头、Files 39px | 列表 Open 可用文字；共享循环双箭头仍为18px；Files局部44px |
| Quick Setup 从 Admin Overview 进入 | 有权托管管理员增加同一 /admin/setup 的快捷链接 |
| Work Header 目前不显示路由三点，只保留无布局读取说明 | 未确认字段/预留读取槽允许骨架，已确认事实与错误不被覆盖 |

## Goals / Non-Goals

**Goals:**

- 在默认字体、配色、PW 资源和控件角色上应用局部密度，能明确指出每个改变所属对象和容器。
- 入口去重后，原能力仍有清楚归属；每个动作携带确切 Work/Service/Session/Request 身份，并由原 owner 执行。
- 将视觉对齐与业务回归分别验收，保证真实 iframe、Session、草稿、未决任务及版本检查连续。
- 将原型作为可复查的设计来源，同时明确它没有覆盖的业务和失败分支。

**Non-Goals:**

- 不引入 UI 框架/图标库、全仓重排、第三套主题、命令中心、首次使用向导或全量无障碍认证。
- 不更改 Core/CLI 地址优先级、认证权限、Service URL/Origin/Cookie、容器运行、Work 数据或历史格式。
- 不把隐藏菜单项解释成删除 Operation/Request/快照能力，不把退出观察改成业务取消。
- 不重做 Console 管理页面、Quick Setup 模型/准备流程、Agent harness 或第三方 Service 内部页面。
- 不自动应用、提交、归档或发布本变更；本次 propose 只交付规划和冻结附件。

## Decisions

### 1. 呈现改动接在原状态与操作 owner 之后

数据和操作仍沿现有链路，新增展示模型只接收所需只读事实与确切目标，不接整份 adapter 或万能 view/context：

```text
Public API -> adapter / draft / flow owner -> read-only presentation -> UI
                       ^                           |
                       +--- explicit target/action-+
```

| 责任 | 现有权威来源 | 本次接入与直接消费者 |
| --- | --- | --- |
| 真实 Work/Service/Request/Session、配置及读取状态 | Desktop adapter、configuration、原 ActionState/feedback/flow | app 装配只读视图；不改准入和提交重试 |
| 行/头部/账户/服务菜单身份 | work-chrome.ts 的显式菜单上下文 | 补命令及排序、记录入口定位；渲染不依赖全局选中项猜目标 |
| 父菜单/选择 Pop/确认/诊断归属 | overlay-role.ts、原 open/close 与 navigation guard | 紧凑角色及 Service 管理子视图；保留焦点与身份失效清理 |
| Focus、Chat 显隐、返回来源、比例 | workspace-layout.ts、work-navigation.ts、原布局 owner | 只决定当前应显示的一个入口；不另建布局状态机 |
| 文件草稿、版本/mtime、保存与回读 | 原 Files/fileTarget/textEditor 与 adapter 文件 owner | 合并呈现工具栏；导航和按钮继续调用原动作 |
| 设置共享草稿和 Save/Apply | configuration.ts、Settings owner、包/脑包流程 | 分类及能力行重组，不新建表单副本或布尔“已生效” |
| 导出、暂停、原 ID 和自动交付 | export-panel、export-flow、export-admission 及相关恢复 owner | 移动恢复入口，保留原独立恢复面板；不复制导出协调 |
| 默认外观、图形和语言偏好 | ui-shared tokens/controls/feedback-primitives/i18n；Desktop locale/catalog | 增加明确角色/窄 API，沿原复制链同步 Console 消费者 |
| 浏览器到宿主的交付 | workspace copy-static、sync-desktop-assets/sync-console-assets、Go assets | 从源生成，和实现/测试一起同步；不手改内嵌文件 |

可以按实际需要为 Work 列表、菜单/选择器或文件头部增加小的纯呈现模块；不为了行数拆模块，也不在生产中采用动态覆盖函数、HTML 后处理、全局 MutationObserver 或跨 owner 写 state 的做法。新增模块须服从现有 WebUI 依赖检查。

备选的整页重写会重建第二套视觉与业务判断，已在独立原型中暴露漂移风险，因此不采用。

### 2. 按容器角色收紧密度，而非全局缩小 UI

以下是实施默认值及视觉核对范围；宽度为上限，长内容/窄屏按真实可读性换行或局部滚动：

| 区域 | 规划默认 |
| --- | --- |
| 默认头部 | Work/首页/Admin宽屏52px，必要窄屏双行88px；Service/Chat39px |
| 命令菜单 | 常规约216px，账户约248px；正文行约34px；前置图形与文字列一致 |
| 语言子 Pop | 约212px；现有三个选择，父行高亮和侧向位置有明确归属 |
| Service 选择 | 约360px；普通行约38px，无 Web 的第二行允许自然增高；固定图形、名称、状态、勾选和管理列 |
| Core 连接 | 约320px，属性及能力状态行；一个检查动作承接真实等待 |
| Session/Model/Thinking | 保留各自选择语义和当前值/说明，收紧现有行距；不改为命令菜单 |
| Files 工具栏 | 列表和详情44px；左侧返回、文件身份、保存状态及刷新同一行 |
| 真实空集合 | 一个简单引导区、小 Work 图形、短用途说明、并排创建/导入 |

密度通过明确的 compact 菜单/选择/信息角色供 Desktop 使用。普通表单、警告、危险确认、长任务详情和第三方应用不继承该密度。保留可见焦点、准确名称、选中与焦点区分、合法热区、禁用原因、减少动态效果和即时开关。

Refresh 统一调整共享路径并保留18px槽与热区，更新两个消费者及现有图形断言；不复制一套 Desktop 私有 Refresh。Work 列表打开使用安静的明确文字导航，Start/Retry 和 Service 外链继续由真实动作/目标区分。布局切换使用明确的 List/Grid 图形，原型中用于占位的通用图形不自动成为图标合同。

### 3. Work 的菜单与恢复能力各有归属

Work 行和头部菜单的共有命令顺序一致：设置、信息、导出、适用停止、删除；用细分隔区分任务/危险组，原 Start/Retry 仍在其真实快捷入口。菜单目标来自当次打开的显式行或头部上下文，不能改为“当前 Work”全局查询。

Operation history 和 Find a previous export 只从直接命令菜单移除：

- Work 信息内增加默认收起的高级“操作与诊断”，复用原记录列表/原 Operation 详情。当前待确认、记录保存失败、清理失败等继续在原任务区域显示，不等用户发现高级入口才提示。
- 原导出找回从同 Work 的高级恢复进入现有独立快照恢复上下文，保持原 Work/snapshot/transfer 身份与合法校验。
- Export 的仅进度 Details 继续只放进度与必要控制，不塞历史、技术 ID 或快照输入；不为了菜单简洁重启导出或提前发起下载。

备选的删除原记录/恢复链会破坏已接受任务和未知锁；把历史都铺回菜单会重现当前问题，均不采用。

### 4. Service 选择与管理采用紧凑 A 方案

本规划提出 A 作为实施默认：一行负责明确选择，一处行尾入口展开该服务的管理子视图；B 分栏、C 行内作为研究对照冻结，不作为运行时产品设置交付。行为 spec 约束管理归属和对齐，不把 A/B/C 切换器作为需求。

列表的状态、勾选和管理槽始终分列；无 Web/禁用/失败对象保持可管理但不伪造网页。展开 B 的管理不会切换正在显示的 A；控制、日志、Operation 和诊断绑定 B。日志错误只影响日志区域，原控制的 pending/accepted/failed/unknown 与安全恢复继续由原 owner 管理。

管理/有界详情作为同一锚定 Pop 的明确子视图，保留返回列表；长日志在所属区域滚动。停止/移除先走原确认，再回原管理对象；若真实内容复杂到必须使用原持续诊断容器，仍保留原来源返回，而不是新增独立总列表。

右侧工具栏保留原图标/职责顺序。外部打开集中到原工具栏动作，更多菜单保留复制访问链接等非重复动作；复制域名身份可在对应服务详情取得。取消独立窗口菜单项不删除原直达外壳、Back to Work、禁止嵌入回退或 CLI 访问能力。

### 5. Chat 的入口去重不改变 Session、Run 和请求模型

Session 名称保留为不可点击身份；唯一时钟入口打开原选择器，New session 只在其中出现。移除更多菜单里的同一 Sessions/New session。

Chat Header 在普通上下文显示 Focus，在仅 Chat 显示返回原来源的恢复动作；来自 Service 专注时，恢复先回 Service 专注，再从已可见的 Service Header 退出。窄屏按当前层级给唯一适用恢复/退出控件。这里不把 Restore layout、Exit focus、Chat 折叠和浏览器 Full screen 合并成一个业务状态；只去掉同一上下文的等效重复入口。Esc 继续按菜单、覆盖层、浏览器全屏和布局的原优先级处理。

Agent 请求只从 Chat 更多菜单发现，默认当前 Work，并在同一个检查器筛选来源。隐藏 Chat 时先使用现有 Show chat/模块导航，避免再造第二个请求入口。目标结果、等待 Apply/Job、Run 执行、证据和错误分层，保留分页、取消/Retry 的原准入与未知恢复；不把来源筛选改成跨 Work 查询，不新增聊天输入框。

新合入的 service-view-controls 继续只消费符合现行身份/提交/Run 关系的工具事件；菜单改版不触碰该授权链。普通回复、历史读取、视图切换和原型示例都不能伪造自动选择/刷新。

### 6. 语言二级 Pop 使用显式父子生命周期

保留共享 i18n 作为偏好读写和实际切换的唯一 owner。为现有 picker 增加可选的侧向锚定/父层配置，默认调用继续兼容；Desktop 账户按新配置打开，其他入口不自动改成嵌套菜单。

父账户菜单保持；账户语言项是子层展开，原菜单命令收尾不得将父层按普通命令成功自动关闭。右侧不够时翻到左边，窄屏约束位置。右方向/激活进入，左方向或首次 Esc 回到父项，再次 Esc 关闭父层，Tab/外侧点击合理移交焦点。父层关闭、导航/身份变化或触发器失效要清理子层，重绘时 expanded/选中状态仍正确；不能依赖观察整个 document 的变化来猜归属。

继续提供跟随浏览器、简体中文和 English，保留 origin 保存、存储失败回退及不修改业务正文。托管管理员的 Quick Setup 是现有真实链接，普通用户/独立 CLI 不因此得到管理能力。

### 7. Files、Settings、连接信息只重组呈现

Files 将原“返回文件”移至左侧，把重复的文件名与原保存状态合并进单条工具栏；完整路径仍可通过文本/提示取得。原刷新、请求来源返回、下载、保存/放弃、mtime/未知写入保护及读取失败区域仍由原动作管理。工具栏变化不能删掉文件只读/不可预览分支或编辑器底部动作。

Settings 采用宽屏侧向分类、窄屏可达的分类导航；保留真实 Checkbox、包状态、目录/Work 副本、来源/版本和 runtime 字段。重排能力行而不以开关暗示即时生效；维持单一草稿、非法 JSON 阻断及原 Save/Apply owner，普通一致状态不铺重复主动作，当前错误/未知仍直接可见。

Core 连接以属性、易读本地化时间和四个能力状态行呈现；真实值缺失/不可用保持原说明，不能因为 UI 服务可达就推断 Core、Runtime、Files 或 Services 全部可用。Core 检查继续是只读动作，不触发重新登录或配置 Runtime。

### 8. Header 骨架保持已确认事实和固定几何

在已有预留区域表达未确认字段/只读加载，保留已确认名称、状态和当前错误，骨架不增加一行或推动相邻控件。这里是统一 pending 的窄范围例外；明确按钮的 pending、真实进度和业务执行状态仍遵守原合同，一个任务只有一个主要等待指示。Core 连接中空置读取占位不再占正文一行，检查反馈由原检查动作承担，不照搬原型里可能同时出现的装饰槽。

骨架结束只代表相关读取已确认或转为失败/未知，不释放业务锁，也不把 Operation accepted、Work Ready 和应用页面可交互合并。慢读取/超时继续有实际原因与只读恢复；快速成功不人为延迟。

### 9. 原型冻结、来源与可复现方式

prototype/ 是 v11 设计实验的冻结副本；sources.json 记录真实样式输入及源码基线，snapshot.json 记录附件身份。screenshots/ 对象均为合成账号、Work、内容及状态。

- changes.js：仅给临时编译副本附加对照呈现的包装器。
- prototype.css：本轮局部对照样式。
- server.mjs：内存合成接口，不连接真实 Core、不调用模型。
- prepare.mjs：将当前仓库共享资源复制到运行目录；必须在忽略的 dist 副本执行。
- screenshots/：菜单、语言、选择器、Files、Settings、Grid、Core、空态的设计画面。

复现时在仓库根运行，下方输出全部属于 dist；原型只通过当前仓库依赖编译，不修改或同步生产内嵌资源：

```sh
mkdir -p dist/prototypes/refine-desktop-ui-consistency
cp openspec/changes/refine-desktop-ui-consistency/prototype/{prepare.mjs,server.mjs,changes.js,prototype.css} dist/prototypes/refine-desktop-ui-consistency/
node node_modules/typescript/bin/tsc -p apps/desktop-webui/tsconfig.json --outDir dist/prototypes/refine-desktop-ui-consistency/browser --tsBuildInfoFile dist/prototypes/refine-desktop-ui-consistency/build.tsbuildinfo
node dist/prototypes/refine-desktop-ui-consistency/prepare.mjs
node dist/prototypes/refine-desktop-ui-consistency/server.mjs 4175
```

打开 `http://127.0.0.1:4175/?mode=after#/works`，底部切换原版/调整版；空态可用 `?mode=after&scene=empty#/works`。当前会话的4173预览是临时进程，不是长期验收来源。主规格同步前后都保留本附件身份；源码之后变化时重新核对生成的输入记录，不能拿旧截图覆盖新事实。

**已观察到的原型证据**：中英文、320/390/768/1440视口检查；主要菜单/语言父子返回、Service列对齐、Focus/Session去重、简单空态、Files未保存导航保护；在合成接口下可操作原模型/Thinking及Save/Apply。Work/Service头部基准52/39px，Files44px；比较模式切换检查了同一iframe和草稿。

**不能从原型推导的事实**：真实Go内嵌入口、真实权限/下载落盘/容器控制/模型行为未由这些截图证明；Quick Setup仅演示原入口。Work信息高级记录/快照恢复迁移未在v11绘制，属于本设计为保留现有合同而提出的具体承接方案。原型可能简化失败/未知、Header已确认状态及检查占位，实施以delta和真实owner为准；不交付其包装器、MutationObserver、模拟业务、A/B/C工具栏或示例数据。

## Risks / Trade-offs

- [紧凑过度导致裁切/难操作] → 只按角色 opt-in；选中槽、文字和管理列固定，长内容局部处理；视觉对照同时覆盖长名称、错误、360px和键盘。
- [移除入口连带删除业务能力] → 单列 Work 信息高级记录/独立快照恢复的迁移，保留当前任务和未知保护；用原 ID 恢复及无重复提交负例验证。
- [层级语言或管理子视图遗留旧对象] → 父子和返回目标显式归属，原身份/代次失效时清理；覆盖重绘、重开、晚结果和键盘逐层退出。
- [Shared CSS/图标影响 Console] → 默认令牌和普通角色不改，紧凑角色明确 opt-in；共享 Refresh及picker接口更新同步复制和两个消费者回归，不全量重排管理页面。
- [Focus去重破坏原返回] → 保留布局状态机和来源链；验证Files来源、Service专注来源、异常、窄屏及iframe/输入节点不被重建。
- [原型模拟被误认为生产验收] → 冻结来源并标明缺口；实施重新执行契约、浏览器、生成物和真实宿主入口检查，按实际环境报告未测。

## Migration Plan

无需数据迁移、协议升级或配置键迁移。按共享角色/接口、各Desktop消费者、受影响测试和生成资源的依赖顺序实施；生成物与对应实现/测试保持同一提交边界。先核对默认样式及未涉及页面，再验收新布局、恢复和状态分支。

回退使用对应功能提交及同版生成资源，不回写或重置用户Work/凭证/原操作。布局选择默认仅当前页面临时状态；不为Grid或紧凑模式新增业务环境变量、全局偏好存储或后端迁移。外部发布、官网、MicroVM及历史归档不属于本次执行。

## 实施证据

当前生产源码的影响归属、实际检查结果、环境前提及截图见 [实施与验收](verification.md)。冻结原型仍作为设计实验保留。
