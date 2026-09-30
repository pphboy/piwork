# piwork CLI Desktop WebUI 原型说明

建议从 [按模块 Review 目录](desktop-review/README.md) 开始：**36 个具名 Frame 分成 8 个独立模块，每组最多两列**，模块和画面之间留出明显空白。目录提供各模块的 Excalidraw/PNG，以及 36 张单画面的原尺寸预览，沿用 01–36 编号。

完整可编辑源：[piwork-desktop.excalidraw](piwork-desktop.excalidraw)。[全部模块总览](piwork-desktop.excalidraw.png) 内嵌相同场景，用于定位；细节评审请打开模块或单画面。原型画布是静态设计基线；下文「运行映射」记录 Desktop WebUI 变更的实际实现与验收，不把原型按钮视为功能完成。

本轮设计以 MVP 的基础功能完整、产品语义正确和 UI 整洁一致为标准；不增加独立高保真样板阶段。01 的列表已统一信息、状态、按钮与菜单的对齐，状态圆点与文字合并到同一区域，使用细分隔和一致控件尺寸。后续实现复用样式变量与控件，按真实字体和宽度验证可读性及操作反馈；静态图的像素位置不作为机械复刻要求。

## 产品基线的画面解读

以下解读与能力矩阵以 OpenSpec 能力 `desktop-ui-language` 的 DUL-001 至 DUL-016 为依据，用于定位画面和核对覆盖。产品、交互与 UI 的完整规则及验收场景以该 Spec 为唯一规范来源；本说明不另立硬规则。

首要用户是希望完成具体任务、让 AI 建立并持续维护工具、亲自操作 Service 和文件的 Work 所有者。日常路径不要求懂 Docker、代理或命令行。高级配置服务于需要调整能力的用户；平台管理属于 Serve。

核心路径是：创建 Work → 通过对话建立工具 → 直接使用 Service/文件 → 明确请求 AI 分析或改进 → 持续使用 → 停止并导出或导入另一个独立 Work。一个 Work 是一个 AI 工作单元，打开独立面板，没有必经总览，也没有其他 Work 的侧边列表。

- 有可用 Service 时应用为主区域，Agent 是辅助栏；没有可用 Service 且 Work 对话准入成功，或用户聚焦可用 Chat 时，对话占主区域（DUL-002）。
- Services / Files / Chat 同级切换，Settings 明确可达；Service 内部导航与 Desktop 导航分开。
- 浏览器内嵌和独立窗口一键访问，不要求代理/PAC 配置；Core 域名与实际浏览器链接分别表达。
- Files 根为 `/var/data/workspace`，仅运行并获准的 Work 可访问；Service 显式挂载才共享该目录。
- AI 只在明确请求后读取可达文件或 Service API，回复标明来源；页面 DOM、输入、选中项不自动共享。
- 保存配置、Apply、当前运行加载是不同状态；Cancel run 与 Stop Work 是不同动作。
- 停止保留历史数据，但当前 Core 不支持停止后加载 Session/Run；第五幅已改为真实启动提示。
- 英文 UI，中文规范；Serve 浅色令牌，任务内容优先，技术详情按需展开。

## 阅读画布

按 A 连接与创建、B 工作区与独立窗口、C 会话与 AI 执行、D Service 管理、E 文件与 WebDAV、F 设置与能力配置、G Work 生命周期与恢复、H Work 导入导出逐组查看。模块内按标注的 REVIEW ORDER 阅读；反馈可引用「E / 18：文件保存按钮」。分区仅用于原型评审，不代表新增产品导航。

01–08 延续已评审的主工作区视觉基线并修正导航、停止历史和统计；09–36 补齐功能与状态。部分画面右侧或并列区域展示**互斥状态变体**，例如登录/已登录、Apply 成功/失败、确认前/接受后。它们用于评审，不要求在产品中同时出现；不能照抄为状态仪表盘。模拟 Notes 是 Service 应用内容，不是 Desktop 内建笔记功能。

| 编号 | 画面 | 入口、动作与返回 | Desktop 运行映射与验收状态（2026-09-29） |
| --- | --- | --- | --- |
| 01 | Work 列表 | 搜索、打开、New Work、Import Work、连接账号、按 ID 查 Operation；状态快捷动作随 Work 变化 | `loadWorkList`；Chrome/Edge 模拟 Core 登录、搜索、状态动作和已知 Operation 通过；真实 Core 创建、Stop、Delete 已验收 |
| 02 | Service 与 Agent | Services 默认工作区；域名、选择器、Copy link、Pop out、Manage services；Files/Chat/Settings 常驻 | `showServices`；Chrome/Edge 模拟 Core 双 Service 通过；真实 Core 双 Work/双 Service 预览、应用登录和 SSE/WS 通过 |
| 03 | Service 独立窗口 | 从 Pop out 打开；保留 Work 对话、Back to Work；关闭窗口不停止 Service | `showServices` Pop out；Chrome/Edge 真实 Core 应用独立标签和应用内登录通过；返回路径经模拟 Core 通过 |
| 04 | Files 与 Agent | Files → 目录和选中项；Upload/New folder/Download/Edit/Rename/Move/Copy/Delete/WebDAV | `mountFiles`；Chrome/Edge 模拟 Core 文件动作、冲突/207/断线通过；真实 Core 上传、编辑、下载字节通过 |
| 05 | 新打开的 stopped Work | Start、配置、Export、Work 信息；历史保留提示，不伪装已加载对话 | `loadWorkPanel` stopped 分支；浏览器验证 Files/Chat 不发起新操作且 Settings 可进入；真实 Core Stop 后 Export 已验收 |
| 06 | Export 就绪 | Stop 已完成 → Prepare package → Download；原 Operation/snapshot 可查询 | `prepareExport`/`prepareSnapshot`；真实 Core Chrome 验证 Stop、Export 锁拒绝、原快照 ID 恢复与下载 SHA-256；模拟 Core 验证损坏/过期 |
| 07 | Import 审核 | 选文件 → 完整校验 → 可选名称 → Import；可仅检查后关闭 | `showImport`；真实 Core Chrome 对原包离线 Inspect 后显式 Import；浏览器模拟 Core 重名字段错误；进程测试验证损坏/超限包和关闭清理 |
| 08 | Import 成功 | 新 Work 停止；Open 与 Start 分开；保留本地已知 Import Operation | `showImport`；真实 Core Chrome 验证原 Operation 成功→stopped→单独 Start→workspace 字节一致；模拟 Core 验证失败不显示新 Work |
| 09 | 连接和账号 | Core 地址/登录；健康与运行环境分开；身份、退出、过期恢复、离线 Inspect | `render`/身份 API；浏览器登录登出、切换 Core、离线 Inspect 不接触 Core 通过 |
| 10 | New Work | 默认配置与高级入口；镜像、Skills/Packages 默认/选择/空、AGENTS、JSON；准备与失败状态 | `showCreateWork`；浏览器验证默认与显式空 payload、accepted/pending/失败分离；真实 Core 创建到 ready 已验收 |
| 11 | 空 Work / 新 Session | 无 Service 时完整对话区；明确任务提示，发送后进入执行 | `showChat`；Chrome 浏览器验证无 Web Service 时 Chat 成主区；真实空 Work 首次会话待验 |
| 12 | Session 列表与切换 | 新建、历史选择、摘要/时间标题；其他 Session 的 Run 导致 Work busy | `showChat`；Chrome 浏览器验证真实标题、Session 草稿隔离、busy 保留草稿且不排队；真实 Core 旧 context 待验 |
| 13 | Run 执行与取消 | 文本/工具进度、详情、Cancel run、Cancelling；取消对象明确 | `showChat`；Chrome 浏览器验证文本/工具反馈、取消与成功竞争、单次提交；真实 Agent 待验 |
| 14 | Run 恢复与失败 | 断线先 Check status；失败、中断、旧 context 不可用；保留原 Run 身份 | `showChat`；Chrome 浏览器验证断流按游标恢复、410 后查询原 Run/Session、不重发；真实 Agent 待验 |
| 15 | Service 管理列表 | 全部未移除服务，包括禁用/失败/无网页；Open/Start/Details | `showServices`；Chrome 浏览器验证禁用、失败、无 Web 端口项可管理及停止 Work 下保存列表；真实 Core 服务待验 |
| 16 | Service 详情和日志 | Stop/Restart/Retry/Remove、公开端口/状态、有限日志及刷新 | `showServiceDetails`；Chrome 浏览器验证启停移除、状态前提、截断/不可用日志；真实 Core 服务待验 |
| 17 | Service 入口与失败回退 | Web 端口选择、嵌入被拒后独立打开、无入口、停止、本地访问不可用 | `service-access.ts`；Chrome/Edge 真实 Core 验证应用登录、SSE/WS、独立标签；CSP/XFO、端口和停止页经模拟 Core 验证 |
| 18 | 文本文件编辑 | Save file/Discard/Download、未保存状态、覆盖风险；Agent 保留 | `files.ts`；Chrome 浏览器验证 BOM/CRLF 保存、二进制/超限拒绝、草稿确认、412 冲突与下载字节；真实 Core 基本编辑通过 |
| 19 | Rename/Move/Copy | 名称与同 Work 目的目录输入；取消回来源，成功刷新结果 | `files.ts`；Chrome 浏览器验证 Rename/Copy、覆盖取消、返回列表；进程测试验证跨 Work Destination 拒绝和单 Work 并发 |
| 20 | 文件传输与删除结果 | 逐文件上传、部分失败路径、目录删除确认、未知结果先重读 | `files.ts`；Chrome 浏览器验证上传/删除/207 逐路径、断线 PUT 不重放及草稿保留；真实 Core 上传/下载字节通过 |
| 21 | 外部 WebDAV | 可选独立工具连接：现有 proxy 命令、完整 Work URL、用户名、终端临时密码流程 | `files.ts` 辅助流程；Chrome 浏览器 Files 与真实 CLI proxy 的 WebDAV 客户端交替读写同一文件、密码重启失效通过；真实 Core 交替读写待验 |
| 22 | Settings | In use/Saved changes/Loaded 各有语义；Skills、Packages、AGENTS、Advanced 和独立 Apply | `showSettings`；Chrome/Edge 真实 Core 验证 AGENTS.md 保存与独立 Apply；其他字段、busy 和失败回退经模拟 Core 验证 |
| 23 | Skills | 真实目录名称、详情、选择、清空、保存、已加载但模型不可见 | `showSettings` Skills；浏览器验证目录与 Work 选择/清空、未知 Skill 错误后更正、runtime loaded/modelVisible；真实目录详情待验 |
| 24 | Pi Package 安装 | 已安装包与安装表单状态；所有来源、准备进度、独立 Apply | `showSettings`；浏览器验证 Core/npm/Git、ZIP、本地目录五类来源的拒绝→更正→提交；进程测试验证 Work 范围上传，真实 Core 安装终态待验 |
| 25 | AGENTS.md | 当前/待应用内容、文件导入、编辑、Save/Discard | `showSettings` AGENTS；Chrome/Edge 真实 Core 验证保存与 Apply；超限、未保存离开及 active/desired 区分经模拟 Core 验证 |
| 26 | 高级配置 | 镜像、模型、MCP、资源、工具等完整配置 JSON 编辑/导入及字段错误 | `showSettings` Advanced；浏览器验证完整 JSON 导入、modelRef 错误后更正、Save 后单独 Apply；真实 Core 字段准入待验 |
| 27 | Work 生命周期 | 对象菜单、Stop 影响确认、停止中与停止失败；Export 受状态约束 | `performWorkAction`；浏览器验证 Stop 失败时 Retry/Export 不可用，真实 Core Stop 成功已验收 |
| 28 | Work 删除 | 明确目标与数据留存边界；接受后 Work 离开列表，清理仍可跟踪 | `performWorkAction` Delete；浏览器验证无 purgeData、列表隐藏后原 Operation 可查；真实 Core 删除测试资源已验收 |
| 29 | Operation 查询和详情 | 完整 ID 查询，结果/阶段/错误/恢复方向；适用于所有受支持控制操作 | `watchOperation`/`known-operations`；浏览器验证 pending/succeeded/failed/superseded/404/断线及重载恢复，实例隔离通过 |
| 30 | Import 进行中和失败 | 上传与接受分开；校验、名称、依赖错误；成功前无半成品 Work | `showImport`；真实 Core Chrome 验证上传/接受/原 Operation 终态与 stopped 结果；浏览器模拟 Core 验证名称、依赖和权限错误 |
| 31 | Export 恢复 | 下载失败使用原包；按 snapshot ID 找回、未停止/锁冲突/过期 | `prepareSnapshot`；真实 Core Chrome 跨 Desktop 重启按原 snapshot ID 下载并校验 digest；模拟 Core 验证损坏/空间不足/过期 |
| 32 | 360px 工作区 | Service/Chat/Files 互斥视图，Settings 与主要动作可达 | `style.css` 窄屏规则；Chromium 四页切换、无横向溢出及 Chat 独立视图通过；已人工复核键盘焦点和主要动作遮挡 |
| 33 | Service 危险操作 | Stop/Remove 确认，启用但 Work 停止、Restart 前提不足 | `showServiceDetails`；Chrome 浏览器验证 Stop/Remove 确认、停止 Work 下 Start 不隐式启动 Work、Restart 被禁用；真实 Core 服务待验 |
| 34 | 文件表单与确认 | New folder、覆盖、未保存离开、特殊文件和后端不可用 | `files.ts`；Chrome 浏览器验证新目录、覆盖取消、未保存离开、特殊项、条件冲突及断线后草稿留存；真实 Core 特殊项待验 |
| 35 | Pi Package 详情与更新 | desired/active/runtime、Enable/Update/Remove；来源对应字段与目录/ZIP 选择 | `showSettings`；浏览器验证 scoped 名称详情、启停、更新、移除后 active 历史、五类来源失败恢复；真实 Core 更新待验 |
| 36 | Apply 进行中和结果 | 接受与完成、后续编辑仍待应用、Run busy、失败回退/回退失败 | `showSettings` 与 Operation；Chrome 浏览器验证 busy 不取消 Run、失败后 active 不变、回退失败可见、新编辑仍 pending、stopped Apply 不 Start；真实 Core 回退待验 |

上表每行的运行函数位于 [Desktop 浏览器实现](../apps/cli/src/desktop/browser/app.ts) 或 [Files 实现](../apps/cli/src/desktop/browser/files.ts)。浏览器行为证据来自 [Chrome/Edge 浏览器测试](../apps/cli/src/desktop/browser.test.ts) 的登录、生命周期、Service/Files/Chat/Settings 三组用例；本地授权、传输和退出证据来自 [Desktop 进程测试](../apps/cli/src/desktop/server.test.ts)。真实 Core 已通过及尚缺的场景逐项记录在 [本机验收记录](../docs/desktop-webui-acceptance.md)。因此每个 Frame 的“待验”表示其页面已落地而对应真实依赖场景尚未通过，不能把模拟结果写成真实验收。

2026-09-29 人工查看 Chrome 的 1280px Work List、Service、Files、Chat、Settings 画面，以及 360px Files 和 Service 画面；对照 01—36 的入口、主要动作、状态与返回路径复核。由此修正了 360px Work 标题/Service 操作的过长纵向堆叠、Skills 选择框空白高度和被全局输入宽度拉伸的复选框。浏览器测试另检查长 Work 名不横溢、焦点轮廓、Escape 后焦点返回、减弱动画、360px 四个顶层视图互斥及操作状态。BSA-005 的直接应用标签页是例外：应用自己的安全头禁止嵌入时，Desktop 保留限制并提供独立标签，不伪装为内嵌成功。
## CLI 基础能力覆盖矩阵

一个能力可以跨多个画面，但不能仅因存在按钮就标为完整。下表将实际命令的入口、结果与恢复落在同一流程组；命令参数对应 UI 字段或行为，`--json` 等终端呈现选项不另造按钮。

| CLI / 协议能力 | 原型 | Spec 依据 | 行为覆盖摘要 |
| --- | --- | --- | --- |
| `status`、`login`、`whoami`、`logout`、`--core` | 01、09 | DUL-003、DUL-011 | Core/运行环境/身份分开；失效重登后查询原任务；不跨身份混用本地记录 |
| `work create` 的 name/base-image/skill/no-skills/package/no-packages/agents-md/config | 10、11、23–26 | DUL-008、DUL-011 | 默认可创建；选择与显式空集合区分；接受后等待真实初始化；失败修正/重试 |
| `work list/show` | 01、05、27 | DUL-002、DUL-003、DUL-008 | 当前名称与状态、完整 ID/网络标识；未知计数不假装当前值；空列表有创建/导入入口 |
| `work start/stop/retry/delete` | 01、05、10、27–29 | DUL-008 | accepted/进行中/终态；Retry 只对应运行目标；Stop supersede、失败停止、删除后查原 Operation |
| `session create/list/show`、`chat --session/--message` | 02、11–14 | DUL-002、DUL-006、DUL-012 | 新建/切换/历史/输入；会话标签来自真实消息或时间；旧 context 不可用可新建 |
| `run show/watch/cancel` | 13、14、29 | DUL-012 | 原 Run ID 恢复、显式取消、终态竞态、游标过期读历史/结果；不重发 prompt |
| `work service list/show/start/stop/restart/retry/remove/logs` | 15–17、29、33 | DUL-004、DUL-013 | 真实状态、持久启停、移除边界、有限日志、Operation 恢复 |
| `proxy` 的 Service 访问 | 02、03、17 | DUL-004 | 原 CLI 方式保留；浏览器免配置的本地 Service origin 已在真实 Core 的 Chrome/Edge 验证 |
| WebDAV PROPFIND/GET/PUT/MKCOL/MOVE/COPY/DELETE | 04、18–21、34 | DUL-005、DUL-015 | 文件可浏览/上传/下载/编辑/建目录/重命名/移动/复制/删除；同 Work；失败逐路径 |
| `skills list/show`、`work config skills list/set` | 10、23、36 | DUL-014 | 可用 catalog 与 Work 自有选择区分；允许显式清空；active/desired/loaded/modelVisible 不混用 |
| `packages list/show` | 10、24、35 | DUL-014 | 可发现的 Core 目录仅代表可复制来源，不等于 Work 已安装 |
| `work packages list/show/install/update/enable/disable/remove` | 24、29、35、36 | DUL-014 | Core/npm/Git/目录/ZIP；更新指定来源；只改 desired；移除 active/历史留存说明 |
| `work config show/set`、`work config packages list/set` | 22、24、26、35、36 | DUL-014 | 完整配置/包选择，先安装后选取；保存不隐式启动/Apply |
| `work config agents show/set` | 25、36 | DUL-014 | 内容编辑/导入；当前与待应用；dirty 退出确认 |
| `work config apply` | 22、29、36 | DUL-014 | 显式操作、busy 不取消 Run、失败回退、后续编辑仍待应用、停止目标不变 |
| `work package inspect`、`work import` | 07–09、30 | DUL-009 | 可仅检查且无需登录；名称省略与显式冲突；导入失败无发布，成功停止 |
| `work export`、`work snapshot download` | 05、06、31 | DUL-008、DUL-009 | 先 Stop 后 Export；包准备与浏览器下载分开；用原 snapshot 查询/再下载 |
| `operation show`、各命令等待语义 | 01、08、10、20、24、27–31、36 | DUL-003、DUL-008、DUL-009、DUL-013、DUL-014 | 按 ID 查，保留未知与时间；本地已知活动不是全局历史；查询成功不等于执行成功 |

## 状态与恢复的画面解读

以下摘要对应 DUL-003、DUL-007 至 DUL-009、DUL-011 至 DUL-015，供核对画面中的反馈与返回；完整行为和验收场景见相应 Spec 条款。

- **加载/空/不可用**：保留对象标题和返回。空列表提供首个有效动作；读取失败不能显示为零条数据。Files 后端失败不替代 Service 状态，Core 可达不代表 runtime 可用。
- **表单**：名称与目标按原文；无改动不提交。字段错误贴字段，非字段错误在表单状态区。取消保留原数据，已提交的异步操作关闭窗口后仍执行。
- **未知**：保留最后确认时间、原对象和 ID；先查询，不自动重复创建、导入、安装或文件写入。上传尚未接受时不得虚构 Operation。
- **危险/覆盖**：确认写完整目标和影响。Stop Work 说明活跃执行/全部 Service/文件访问，Service Stop 说明持久禁用，Remove/删除不承诺 UI 撤销。
- **文件类型**：当前协议没有 ETag/锁，不承诺自动合并；特殊项不可直接编辑，目录下载不伪装为已提供 ZIP 打包；二进制/超大文本下载到外部处理。编辑大小限制与上传固定协议限额由后续实现设计明确，必须在拒绝处解释。
- **恢复**：本地已知活动保存 Core/用户、类型、Work/Service/Operation/snapshot ID 和时间；重新打开按原 ID 查询。Run 观察标识在会话上下文保留，不以全局 Run 列表找回。登出或切换身份不展示另一用户记录。
- **键盘/窄屏**：弹层焦点进入、限制、关闭后回到触发点；未保存编辑确认后才离开。360px 使用同级工作区切换，文件树/详情收进可关闭面板，主动作不被遮住。

## 原型闭环与后续实现边界

以下保留原型定稿时的历史边界说明；当前开发进度以画面矩阵的「Desktop 运行映射与验收状态」列和 `cli-desktop-webui` Tasks 为准。

产品、交互与视觉约束统一由 OpenSpec 能力 `desktop-ui-language`（DUL-001 至 DUL-016）规定；变更期间以该能力的 delta spec 为准，同步后的主规范路径为 `openspec/specs/desktop-ui-language/spec.md`。Serve 与 Desktop 的适用边界由 `ui-language` 的 UIL-001 规定。本说明及画布提供图示和覆盖证据；后续功能按 DUL-001、DUL-016 引用需求、场景、画面编号和验收状态，偏离时记录理由与替代规则。技术方案在后续实现变更中先完成设计，再进入实现。

当前实现变更 `cli-desktop-webui` 已提供 CLI WebUI 启动、浏览器 Service 入口、Files、对话、配置、导入导出与本地已知操作记录。实际验收范围以本页逐帧映射和 [Desktop WebUI 本机验收记录](../docs/desktop-webui-acceptance.md) 为准；真实 Core 已覆盖 Service、Agent 和管理员/普通用户双 Work 场景，其他标注为模拟 Core 的失败分支不能视为真实依赖验收。此原型不新增 Core 停止历史接口，不修改 CLI 既有生命周期或 WebDAV 协议。

明确不作为当前基础能力：Work/Session 改名、Work 终端、用户手动创建/更新 Service 定义、全局 Operation/Run 列表、全局管理员配置、自动采集网页状态、自动并发合并文件、跨 Work MOVE/COPY。
