# Spec Delta

## Purpose

为 CLI 在本机启动的 Desktop WebUI 建立可复核的产品、交互和视觉基线，使 Work 所有者能通过 Service、Agent 对话与共享文件完成实际任务。以基础能力完整、状态与动作正确、界面整洁一致约束 MVP，明确静态规范交付、未来运行体验和现有 CLI 能力的边界，避免基础产品错误与过度设计。

## ADDED Requirements

### Requirement: Desktop 有独立且可追溯的语言基线

**Identifier:** DUL-001

仓库 SHALL 以中文 `desktop-ui-language` Spec 作为 Desktop 产品、交互和 UI 硬规则的唯一规范来源，集中规定目标用户、场景、对象、容器、视觉、状态与验收行为。变更期间规则由本 change 的 delta spec 表达，同步后由 `openspec/specs/desktop-ui-language/spec.md` 承接。规范 SHALL 自足，不以额外的三份 Desktop docs 作为必须查阅或同步维护的规则来源；重复 Desktop 语言文档 SHALL 在迁移完成后移除。

后续 Desktop 功能变更 SHALL 引用本规范的需求编号，说明所属对象、在 Service/聊天/文件/详情容器中的位置、入口与返回、空/加载/停止/失败/未知状态、键盘和窄屏行为；偏离时 SHALL 记录理由与替代方式。原型与能力矩阵 SHALL 作为规则的图示和覆盖证据，设计理由由 change 的 design 记录。原型 SHALL 区分未来目标与现有 CLI 能力；本变更完成 SHALL 只表示规范与静态原型完成。

#### Scenario: 设计后续功能
- **WHEN** 设计者为 Desktop 增加一个 Work 能力
- **THEN** 可从本 Spec 的需求和场景判定容器、文案、状态、视线顺序及视觉约束，原型用于核对画面，偏离理由记录到对应变更

#### Scenario: 查找 Desktop 的规范来源
- **WHEN** 维护者设计或验收 Desktop 的产品、交互与视觉行为
- **THEN** 能在 `desktop-ui-language` Spec 中找到完整硬规则及场景，无需继续维护三份独立 Desktop 语言文档；原型说明与仓库入口指向同一规范能力

#### Scenario: 评审静态原型
- **WHEN** 评审者按 8 个独立模块查看 36 个编号画面与能力覆盖矩阵
- **THEN** 能定位登录、创建、Session/Run、Service 管理、Files、Settings、迁移和恢复的入口与状态；能区分互斥状态研究、静态设计完成与未来运行实现

### Requirement: Work 打开后直接进入 Service 与 Agent 工作区

**Identifier:** DUL-002

Desktop SHALL 以独立 Work 列表为首层；打开 Work SHALL 进入该 Work 专属面板，顶部持续显示 Work 名称、真实状态、返回列表和生命周期操作，侧边 SHALL 不列其他 Work。若有可访问 Service，默认 SHALL 优先显示上次选中且仍可用的 Service，否则显示一个已就绪的默认 Web 入口；其真实可交互页面为主区域，Agent 当前 Session 对话为可输入的辅助栏。没有可访问 Service 且 Work 对话准入成功时，Agent 对话 SHALL 成为主区域并解释 Service 空态或不可用原因；Work 停止时 SHALL 显示启动与历史保留提示，不承诺读取 Session/Run。Desktop SHALL 不设置必须先经过的 Work 总览页。多个 Service SHALL 能在 Work 内切换并看到各自状态；聊天可聚焦为主区域，返回后恢复 Service/端口选择、当前 Session 及 Desktop 自己的阅读位置和非敏感草稿；任意 Service 网页内未保存表单、滚动和跨窗口同步 SHALL 不被外壳作通用保证。Service 可弹出独立窗口，Work 对话仍保留。Work 身份栏下 SHALL 有 Services / Files / Chat 同级入口及明确的 Settings，Workspace files 与设置 SHALL 在同一 Work 中打开；文件主区域可保持 Agent 辅助栏。Run、Operation 与日志按所属对象打开详情。

各容器 SHALL 遵守以下职责与返回规则：

| 容器 | 内容与返回 |
| --- | --- |
| Work List | 搜索、创建、导入、账号和状态快捷动作；返回列表不停止 Work 或 Run |
| Service 工具栏与应用视口 | 前者展示服务名、状态、域名、选择器和浏览器访问动作；应用自己的导航、按钮和数据留在独立视口 |
| Agent 辅助栏 / 聚焦 Chat | 同一份当前 Session、回复、执行反馈和输入；Focus chat 不复制会话或产生两个独立输入框 |
| Files | 当前 Work 的路径、文件树/列表、选中项与动作；文件树是局部导航，返回保留 Work 上下文 |
| Settings | Skills、Pi Packages、AGENTS.md、Advanced 与 Apply；Back to Work 返回原区域，未保存编辑先处理 |
| 对象详情 | Service、Run、Operation、日志或身份诊断；Close/Back 返回来源，关闭只停止观察；必要时放大为主区域 |
| 输入与确认弹层 | 目标、字段/影响、提交与取消；取消不提交，成功返回来源并刷新，已接受操作不因关闭而取消 |

Session 选择器 SHALL 仅列当前 Work 的 Sessions，并在顶部提供 New session。Manage services SHALL 从应用视图进入同 Work 服务列表/详情，返回恢复原 Service/端口选择；独立 Service 窗口 SHALL 保留 Back to Work，关闭不停止 Service。

#### Scenario: 有可用 Service 的 Work
- **WHEN** 用户从 Work 列表打开已运行、拥有可访问 Service 的 Work
- **THEN** 直接看到 Service 真实页面和可输入的 Agent 对话；可切换 Service、聚焦聊天或打开文件，其他 Work 不在侧边

#### Scenario: 空 Work 或 Service 不可用
- **WHEN** 用户打开没有可访问 Service、但 Work 对话准入成功的 Work
- **THEN** 对话成为主区域，Service 的空、启动中、停止或无默认 Web 入口原因与下一步可辨，不出现空白或虚构预览

#### Scenario: 从 Service 聚焦对话再返回
- **WHEN** 用户聚焦当前 Session、继续输入，再返回 Service
- **THEN** Work 身份、Session、Desktop 非敏感草稿与原 Service/端口选择保持可恢复，不声称保存了任意 Service 的页面内存状态

#### Scenario: 查看详情后返回
- **WHEN** 用户从当前 Work 打开 Service、Run 或 Operation 详情再关闭
- **THEN** 回到原工作区及对象选择；关闭不取消执行、不停止服务，不产生另一个 Session 输入上下文

### Requirement: 对象和状态按真实能力表达

**Identifier:** DUL-003

Desktop SHALL 稳定使用 `Core`、`Work`、`Session`、`Run`、`Operation`、`Service`、`Workspace files` 等对象名称；UI 自有文案与无障碍名称 SHALL 用英文，用户内容和技术标识 SHALL 保留原文。界面 SHALL 区分空、加载、已保存、已接受、执行中、已就绪、降级、停止、失败、被新目标取代和结果未知。未知结果 SHALL 保留对象身份和最后已知时间、提供按原 ID 重新查询，不自动重提或声称完成。禁用动作 SHALL 说明原因和可执行下一步。尚无 CLI 能力的 Work 终端、Work 重命名及全局 Operation 列表 SHALL 不表现为可用入口。

UI SHALL 区分 Work package（`.work`）与 Pi Package、Open Work 与 Start Work、Save changes 与 Apply changes、Save file 与配置保存、Cancel run 与 Stop Work。反馈 SHALL 先说明操作对象、已确认状态及下一步；技术 ID、端口、错误码 SHALL 可查看复制，但不替代上述信息。

对象语义 SHALL 固定：Core 是当前提供身份与 Work 能力的服务；Work 是包含配置、对话、Service 与共享文件的 AI 工作单元；Session 是 Work 内对话；Run 是一次 Agent 执行；Operation 是创建、控制、Apply 或传输等持久异步操作；Service 是 Work 中运行的网络应用；Workspace files 是 Work 共享目录。不得用 Project、Thread、Task 混称这些对象。

界面内容 SHALL 按 Work 身份、当前任务标题、用户内容/操作、辅助说明、按需技术详情的顺序组织。按钮 SHALL 说明动作及作用对象，避免无对象的 Run/Stop/Reset；上下文中的 Copy/Move 等短词 SHALL 有完整无障碍名称。危险确认 SHALL 写目标名称、具体影响及恢复限制，不能只写 Are you sure；普通导航、读取和复制链接 SHALL 不要求确认。日常页面 SHALL 不用教学口号或永久技术警告挤占任务区域。

加载、空集合、读取失败和未知 SHALL 各自表达，保留对象标题和可用返回。未知计数不得写成零，Session 数量只在可靠取得时展示；缓存值 SHALL 标明取得时间。无改动的表单 SHALL 不提交；字段错误贴字段、非字段错误留在当前表单，保留输入；提交中 SHALL 阻止重复动作。已接受、执行与终态分别反馈，危险动作默认不自动触发。

#### Scenario: 保存配置但未应用
- **WHEN** 用户保存 Work desired 配置但尚未 Apply
- **THEN** 界面将 desired 与 active 分开，说明已保存但未生效；Apply 作为独立 Operation，接受后保留稳定 ID 与查询入口

#### Scenario: Operation 观察中断
- **WHEN** 已接受 Operation 的后续观察中断
- **THEN** 展示未知结果与最后已知状态，按原 Operation ID 查询，不自动再次提交

#### Scenario: Work 停止或 Core 不可达
- **WHEN** Work 停止或 Core 失联
- **THEN** 保留可取得的对象身份及最后已知状态；当前页面此前加载的历史标为旧内容，不承诺重新读取；受影响的 Service、文件与对话动作给出英文原因和恢复入口

#### Scenario: 读取失败与空列表
- **WHEN** Work、文件或能力列表分别返回空集合、读取错误或旧缓存
- **THEN** 空集合提供首个有效动作，错误提供原因与恢复入口，旧缓存带取得时间；三者不使用同一个零计数或成功提示

#### Scenario: 表单校验与重复提交
- **WHEN** 用户提交的字段校验失败，或已提交请求仍在等待响应
- **THEN** 校验失败保留输入并定位错误；等待期间阻止重复提交，状态留在当前表单；取消普通编辑不产生数据修改

### Requirement: Service 在浏览器内和独立窗口一键可用

**Identifier:** DUL-004

Desktop SHALL 在当前 Service 工具栏展示 Core 映射的 `.work` 域名、真实状态和可复制身份；域名与浏览器实际可打开链接 SHALL 明确区分。WebUI 内嵌 Service、`Pop out` 独立窗口和复制可打开链接 SHALL 通过 CLI 提供的受保护本地浏览器入口访问同一运行中的 Service，用户 SHALL 无需配置浏览器代理/PAC。入口 SHALL 支持 HTTP、SSE、WebSocket 及正常应用导航、路径、跳转和会话行为，隔离不同 Service 的浏览器状态，并遵守 Work/Service 的真实准入。目标禁止嵌入时 SHALL 给出独立窗口入口；无默认 Web 端口时 SHALL 引导选择可用入口或说明无法预览，不假装成功。现有外部工具的 CLI forward proxy 继续作为独立访问方式。

域名按 Core 的 `service_name.work_network_name.work` 映射展示；Work 网络标识、用户显示名称与完整 Work ID SHALL 分开，复制身份不替代复制可直接打开的链接。Work/Service 变为不可用时，独立窗口 SHALL 显示所属对象、不可用原因和 Back to Work，不保留虚假的成功状态。

#### Scenario: 打开正在运行的 Service
- **WHEN** 用户在未设置浏览器代理/PAC 的环境中打开 Work Service 并点击 `Pop out`
- **THEN** 嵌入视图和独立窗口都能一键访问同一 Service；工具栏显示 Core 域名，复制的浏览器链接可直接打开

#### Scenario: Service 拒绝嵌入
- **WHEN** Service 的响应不允许被 WebUI 嵌入
- **THEN** Work 保留 Service 身份和真实状态，给出可用的独立窗口入口，不将空白框当作成功预览

#### Scenario: Service 无默认 Web 入口或已停止
- **WHEN** 当前 Service 无可用默认 Web 入口或 Work/Service 已停止
- **THEN** 界面说明原因及可执行下一步，不提供虚假的交互页面

### Requirement: 文件是 Work 内的可操作主区域

**Identifier:** DUL-005

`Workspace files` SHALL 归属 Work 的共享 `/var/data/workspace`，并在 Work 内作为文件主区域显示。仅 Work 运行且文件准入成功时 SHALL 提供可执行读写动作。浏览器文件操作 SHALL 通过受保护的 CLI 本地入口转接 Core WebDAV，支持列目录、打开/下载、上传/保存、建目录、移动/重命名、复制和删除。浏览器 Files SHALL 无需手工配置代理或独立客户端凭证；外部 WebDAV 连接、文件表单、确认和传输恢复按 DUL-015 执行。Service 停止或移除 SHALL 不被表现为删除共享文件；Work 停止后文件不可访问。

协议映射 SHALL 沿用既有 Core WebDAV：列目录使用 PROPFIND，打开/下载使用 GET，上传/保存使用 PUT，建目录使用 MKCOL，移动/重命名使用 MOVE，复制使用 COPY，删除使用 DELETE。文件动作始终作用于当前 Work，浏览器界面不改变后端权限与准入。

#### Scenario: 浏览器中管理 Work 文件
- **WHEN** 用户在运行中的 Work 打开 Workspace files，上传文件、编辑保存并移动文件
- **THEN** 对应操作经 Core WebDAV 完成，文件区域显示真实结果，用户无需手工配置代理或输入独立客户端的临时 Basic

#### Scenario: 外部 WebDAV 客户端
- **WHEN** 用户选择用独立客户端访问 Work 文件
- **THEN** 可得到使用完整 Work ID 的现有本地 WebDAV URL，并通过单独的临时凭证流程连接；凭证不进入普通 URL 或列表

#### Scenario: Work 停止或部分失败
- **WHEN** Work 已停止，或 WebDAV 批量操作返回部分失败
- **THEN** 停止时文件读取与写入均不可执行；部分失败时指出受影响路径而非声称全部成功

### Requirement: Agent 对 Service 数据的来源清晰

**Identifier:** DUL-006

Desktop SHALL 将选中 Service 仅视为对话身份上下文，SHALL 不自动把浏览器页面 DOM、输入、选中项或内存状态交给 Agent。用户明确请求后，Agent MAY 读取自身可见的共享 workspace 文件或调用 Service 已提供的 API，并 SHALL 在回答中标明实际来源。Service 只有显式挂载共享 workspace 时才与 Agent 共享该目录；仅在容器内部或进程内存的数据 SHALL 不被描述为 Workspace files，缺少可读文件或 API 时 SHALL 明确说明无法读取。

#### Scenario: 用户操作 Service 后请求分析
- **WHEN** 用户修改 Service 数据并在聊天中明确请求 Agent 分析
- **THEN** Agent 通过实际可达的 workspace 文件或 Service API 读取，回答标明来源，不声称看到了浏览器当前画面

#### Scenario: Service 数据不可达
- **WHEN** 数据只保存在 Service 内部且没有 Agent 可用的文件或 API
- **THEN** 界面说明无法访问该数据，不根据页面当前内容编造分析

### Requirement: Desktop 视觉沿用 Serve 浅色令牌并保持主次

**Identifier:** DUL-007

Desktop SHALL 沿用 Serve 浅色语义令牌，包括 `#F5F8FC` 画布、`#F8FBFF` 次级背景、白色主表面、`#DCE7F2` 分隔、`#1B2634` 正文和 `#0969DA` 交互强调。Work 列表 SHALL 占独立页面；Work 内 SHALL 让真实 Service 或当前文件/聚焦对话占主区域，Agent 辅助栏保持可用，Work 身份和 Service 状态/域名分别处于稳定且较低干扰的工具栏。Work 列表行 SHALL 以一个当前状态快捷动作及低频菜单组织生命周期入口，已知 Operation 的活动区 SHALL 按需出现且不占永久导航。Import 审核与 Export 进度 SHALL 保持步骤、私有包提醒和恢复动作的层级。应用视口与 Desktop 外壳 SHALL 清楚区分，普通消息和列表行 SHALL 以留白、对齐及细分隔组织。窄屏 SHALL 将 Service、Chat、Files 变成可达的同级切换或覆盖层，不强挤窄列；360px 宽屏 SHALL 无整页横向滚动。焦点 SHALL 可见，普通文字对比度至少 4.5:1、大字至少 3:1，并尊重减少动态效果设置。

同类控件 SHALL 使用一致的样式与状态规则：共享视觉角色调整后，所有对应 Desktop 使用处 SHALL 一致变化，局部布局及 Service 应用内部样式 SHALL 保持独立。Work 列表 SHALL 以名称摘要、状态、快捷动作、菜单的顺序组织，状态圆点与文字成组，行内垂直居中、跨行同列对齐；动作控件 SHALL 不同时触发行导航。实现 SHALL 用实际字体、长内容、键盘与窄屏核验，静态坐标不得替代验证，已知错位、遮挡和不可读问题 SHALL 在交付前修正。

首版 SHALL 使用以下浅色角色，状态色始终配文字；未来主题需逐角色定义等价关系与对比度，不得简单反色或重排任务层级。

| 视觉角色 | 基线值 | 用途 |
| --- | --- | --- |
| 画布 | `#F5F8FC` | 面板外层、中性输入底色 |
| 次级背景 | `#F8FBFF` | Agent 辅助栏、低权重区域 |
| 主表面 | `#FFFFFF` | Work、Service 外壳、文件与对话 |
| 分隔 | `#DCE7F2` | 区域与列表行边界 |
| 控件边框 | `#BAC9D8` | 输入与次级控件 |
| 正文 / 次级文字 | `#1B2634` / `#526477` | 内容与辅助说明 |
| 交互强调 / 选中背景 | `#0969DA` / `#EAF3FF` | 主动作、链接、焦点与当前选择 |
| 危险 / 警告 | `#B42332` / `#8A5A00` | 明确影响或问题，配文字 |

宽屏默认身份栏约 64–72px，Agent 辅助栏约占 28–34%；这些 SHALL 作为层级基线，允许随内容和宽度调整以保证可读与可操作，不能把 Service 缩成辅助预览卡。系统无衬线字体、4px 倍数间距、小圆角和细分隔 SHALL 保持一致；页面标题以 24–30px、正文 14–16px、辅助文字 12–13px 为基线。路径、域名、ID、日志与代码 SHALL 使用等宽字并能完整读取或复制。列表行不叠加重复大卡片；Agent 回复保持连贯，用户消息可用柔和浅底。

每个当前任务 SHALL 只突出一个主动作，其余使用次级样式：文件区域突出 Upload，停止 Work 时突出 Start Work，快照就绪后突出 Download .work；Pop out 可作为 Service 工具栏主动作。同工具栏的输入和按钮 SHALL 等高、间隔一致，按钮文字居中；当前选择同时由位置、文字与柔和选中态表示，悬停弱于选中。状态、操作 ID、取得时间和恢复动作 SHALL 位于同一上下文，不能用旋转图标代替执行状态或在无关区域显示成功。

键盘焦点 SHALL 有至少 2px 可见轮廓。模态弹层 SHALL 获得并限制焦点，非提交中的普通弹层可用 Escape 关闭，危险确认的 Escape 等于取消，关闭后焦点回到触发控件；未保存编辑离开须先处理 Save/Discard/Keep editing。可选过渡以 120–180ms 为基线并尊重 `prefers-reduced-motion`，不以动画伪装就绪。

窄屏 SHALL 保留 Work 身份、返回、主要动作与 Pop out；文件树可收进可关闭面板，表格和代码只在局部滚动。Import 可全宽滚动，底部动作不能遮住私有包提醒；Export 步骤纵向排列。详情先目标与结果，再影响/恢复，最后技术 ID；错误不得通过缩小正文或挤掉名称容纳。

#### Scenario: 宽屏 Service 与 Agent
- **WHEN** 用户在宽屏打开有可用 Service 的 Work
- **THEN** Service 的实际内容成为视觉主角，聊天输入持续可用，域名和状态可读而不抢占内容，配色遵循 Serve 令牌

#### Scenario: Work 列表的对齐与独立动作
- **WHEN** 宽屏列表同时显示 Ready、Stopped、Stopping 和 Failed 的 Work
- **THEN** 名称与摘要左对齐，状态圆点紧邻文字；状态、快捷按钮与菜单在各自行内垂直居中且跨行同列对齐，按钮尺寸一致；点击 Start、Retry 或菜单不同时打开行；长名称与窄屏布局不遮挡状态和动作

#### Scenario: 统一调整 Desktop 样式
- **WHEN** 后续实现修改共享颜色、字阶、间距变量或共用按钮样式
- **THEN** 所有引用对应变量或组件的 Desktop 界面同步呈现变化，页面局部排列仍保留其作用范围；Service 应用内部样式不被外壳覆盖

#### Scenario: 窄屏与键盘
- **WHEN** 用户在 360px 宽屏通过键盘或触摸切换 Service、Chat、Files 并返回
- **THEN** Work 身份、主要操作、对话输入、文件动作和返回入口均可达且焦点可辨，整页不横向溢出

#### Scenario: 弹层关闭后的焦点与草稿
- **WHEN** 用户用键盘打开编辑或危险确认弹层并尝试关闭
- **THEN** 焦点保持在弹层内，取消危险确认不执行操作；未保存编辑先明确处理，关闭后焦点返回触发控件

#### Scenario: 主次与长内容
- **WHEN** Work、Service 或文件名称很长，页面同时有主要动作、次要动作和错误
- **THEN** 主动作可辨，同类控件尺寸与对齐稳定，完整名称和技术标识可读取；错误贴近目标且不遮挡按钮或迫使整页横向滚动

### Requirement: Work 生命周期在列表和面板中可操作且可追溯

**Identifier:** DUL-008

Desktop SHALL 在 Work 列表行与独立 Work 面板展示 Core 已确认的 observed 状态，并在 desired 目标与 observed 不一致时明确区分。列表整行 SHALL 可进入所属 Work，右侧仅给当前状态的一个快捷动作和低频菜单；ready/degraded 的 Work 可打开并停止，stopped 的 Work 可打开控制信息、配置和 Export 并启动，只有 desired=running 且启动/恢复失败的 Work 才能显示 `Retry Work` 快捷动作。desired=stopped 但停止失败时 SHALL 引导检查原 Stop Operation，不以 Work Retry 将目标改回 running。创建、启动、停止、重试和删除的接受响应 SHALL 显示稳定 Work/Operation ID、阶段与最后确认时间，完成前不得声称 Ready/Stopped/Deleted；被新目标取代的旧 Operation SHALL 显示 superseded。Delete SHALL 经明确确认，说明 Work 将移出列表且 Core 默认保留持久数据、Desktop 不提供撤销保证；即使列表在 Delete 接受后不再返回该 Work，已知 Operation 的进度入口仍 SHALL 可找回。Degraded Work 的 Agent 可用性与各 Service 错误 SHALL 分别表示。

Stop Work SHALL 确认具体 Work 及对当前执行、全部 Service 和文件访问的影响。完整 Work ID 与网络标识 SHALL 可在 Work 信息中查看与复制；名称和状态保留主要视觉位置。

#### Scenario: 列表中的运行与停止 Work
- **WHEN** 用户在 Work 列表看到 ready、stopped、degraded 三种 Work
- **THEN** 行都可打开所属 Work，快捷动作和真实状态各自正确；stopped 显示历史已保留但需 Start 才能加载，当前窗口先前加载的消息只能标为旧内容，聊天与 Service/文件动作不可用；degraded 的 Agent 准入与失败 Service 分别显示

#### Scenario: 启动或停止已接受但尚未完成
- **WHEN** 用户启动或停止 Work 并收到 Operation ID，但 Core 仍在执行
- **THEN** 界面显示 accepted/阶段及原 ID，不预告终态；观察中断时保留最后已知状态并按原 ID 查询，不自动再次提交

#### Scenario: Stop 取代未完成的 Start
- **WHEN** 用户在 Start 未完成时接受 Stop，旧 Start Operation 最终为 superseded
- **THEN** 当前 Work 以新的停止目标和 Stop Operation 为准，旧 Start 不被显示为启动成功

#### Scenario: 停止失败
- **WHEN** Work 的 desired 为 stopped、observed 尚未确认 stopped，Stop Operation 失败或结果未知
- **THEN** Export 不可执行，界面提供原 Stop Operation 与安全处理方向，不显示会把目标改为 running 的 `Retry Work` 快捷动作

#### Scenario: 删除接受后列表不再返回 Work
- **WHEN** 用户确认 Delete，Core 接受并从 Work 列表隐藏该 Work，但资源清理仍在执行
- **THEN** 界面保留已知 Delete Operation 的查询入口，不提前声称清理完成，也不提供虚假的撤销或永久清除保证

### Requirement: Work 导入导出是可恢复的分步传输

**Identifier:** DUL-009

Desktop SHALL 将 Export 表达为用户分别发起的 Stop、Export snapshot、Download 三阶段。只有 desired/observed 均 stopped 且无已知冲突控制任务时 SHALL 显示可执行 `Export Work`，但 SHALL 以 Core 的实际停止及快照准入结果为准；Export SHALL 不自动 Stop、Apply、取消 Run 或启动 Work。Export 接受后 SHALL 保留 Operation ID 与 snapshotId，快照成功并验证后才提供 `.work` 下载；下载中断 SHALL 在保留期内用原 snapshotId 重试，过期 SHALL 明确提示，不能静默重新 Export。Import SHALL 从 Work 列表进入，对本地包完整校验并展示安全摘要、私有内容提醒及可选名称；名称留空 SHALL 保持省略，使 Core 自动使用包名并处理重名，显式名称冲突 SHALL 指向字段。接受后 SHALL 保留原 Operation ID，完整发布前不显示新 Work；成功后显示 Core 返回的最终名称、新 Work ID、stopped 状态以及分开的 `Open Work` 与 `Start Work`，不自动运行包内代码或 Service；失败时不显示半成品 Work。Desktop SHALL 仅本地保存当前 WebUI 已知操作的 Core/用户、类型、Work/Service/Operation/snapshot ID 与时间，页面重载后按 ID 恢复查询，不保存包字节或凭证，也不声称是 Core 全局 Operation 列表；切换身份时不得混入其他用户记录。

用户 SHALL 可仅在本地 Inspect 后关闭，不需登录 Core 或被迫导入；兼容性与权限仍由 Core 在导入时检查。上传未接受前 SHALL 不虚构 Operation，错误 SHALL 区分包损坏、名称、依赖/容量、运行时与未知结果。导入/下载前 SHALL 说明 Work 包可能包含代码、配置、共享数据、Session 与凭证；浏览器只能确认发起下载时，不得宣称文件已完整落盘。界面主步骤使用 Stop Work、Prepare package、Download，技术详情保留 snapshotId。

#### Scenario: 运行中的 Work 申请导出
- **WHEN** 用户在 ready 或正在停止的 Work 选择 Export
- **THEN** 界面要求先单独 Stop 并等待确认；没有新 Export 请求、自动停止或半成品包

#### Scenario: Stop 完成后 Export 被 Core 拒绝
- **WHEN** 列表显示 stopped，但 Core 在 Export 准入时发现服务/文件写入者仍在运行、快照锁或其他冲突
- **THEN** 界面展示 Core 的安全错误和处理方向，不显示已下载或再次自动 Stop/Export

#### Scenario: 快照完成而下载中断
- **WHEN** Export Operation succeeded，浏览器保存 `.work` 时连接中断
- **THEN** 原 Operation 和 snapshotId 保留，用户在保留期内从同一快照重新下载；包已过期时提示需要新的用户操作

#### Scenario: 省略或显式填写导入名称
- **WHEN** 用户导入一个与现有 Work 同名的合法 `.work`，分别保持名称留空或填写冲突名称
- **THEN** 留空时显示 Core 自动选定的不冲突名称；显式冲突时指出字段错误，不覆盖旧 Work 或擅自改名

#### Scenario: 导入进行中、成功或失败
- **WHEN** Import 已接受且包尚未发布，随后 Operation 成功或失败
- **THEN** 进行中和失败时无新 Work 行且可查询原 Operation；成功时新 Work 行为 stopped，用户显式 Start 后才运行

#### Scenario: 重载后恢复本地已知操作
- **WHEN** 用户在 Import 未发布、Delete 已移出列表或 Export 已成功但未下载时重载 WebUI
- **THEN** 活动区仅用本地已知 ID 向 Core 查询原 Operation 或 snapshot，保持所属 Core/用户边界，不自动重提 mutation，也不把这些记录称为全局历史

#### Scenario: 仅检查包与传输边界
- **WHEN** 用户未登录而检查本地 Work 包，或随后上传尚未被 Core 接受
- **THEN** 可完成本地检查后关闭；上传阶段不显示虚构 Operation，接受后才按原 ID 恢复，私有内容提醒在提交与下载前可见

### Requirement: 产品语言以目标用户和任务场景约束后续功能

**Identifier:** DUL-010

Desktop 产品语言 SHALL 将首要用户定义为围绕具体任务、让 AI 建立并持续维护工具、亲自使用 Service/文件的 Work 所有者，日常流程 SHALL 不要求 Docker、代理或命令行知识。规范 SHALL 覆盖建立工具、持续使用、分析改进、管理资料、调整能力、保留迁移六类场景及完成标准。后续 Desktop 功能 SHALL 明确所属场景、对象、入口、影响、结果依据、失败恢复与返回；日常操作优先，配置和诊断按需展开。平台管理 SHALL 保持 Serve 职责。产品定义、信息顺序和动作语义 SHALL 作为与视觉令牌同等的评审约束，不能只以颜色或截图一致认定符合语言。

六类场景 SHALL 按以下路径与结果覆盖，所有运行操作仍受 Work 准入约束：

| 场景 | 主要路径 | 完成标准 |
| --- | --- | --- |
| 建立工具 | New Work、默认配置、Chat、Agent 部署 Service | Work 就绪后可对话；生成的 Service 可直接使用 |
| 持续使用 | 打开 Work、选择上次可用 Service、Agent 在旁 | 无需重新配置访问，Work/Service/Session 身份明确 |
| 分析改进 | 用户操作 Service、明确提问、读取 workspace 或 API | 回复给出实际来源，执行可观察、取消与恢复 |
| 管理资料 | Files 上传、编辑、移动或下载，再返回原工作区 | 操作结果可确认，失败定位路径，无需配置外部 WebDAV |
| 调整能力 | Settings 编辑/安装、Save、Apply | 已保存、已生效与已加载可辨，失败可恢复 |
| 保留迁移 | Stop、Export、Download；Inspect、Import、显式 Start | 操作与包可找回，新 Work 独立且默认停止 |

平台账号管理、模型密钥与全局默认值 SHALL 保持 Serve 职责，不成为普通用户任务前置；首版不通过原型隐含增加团队协同、后台自主任务编排或通用 IDE。

产品用词与反馈 SHALL 遵守 DUL-003，视觉一致性与可达性 SHALL 遵守 DUL-007。静态示例 Service SHALL 不被描述为 Desktop 内置应用。

MVP SHALL 以 DUL-016 能力矩阵的完整路径、正确状态与影响、有效反馈和返回、整洁一致且可操作的界面作为质量门槛。新页面、导航、控件或动效 SHALL 对应具体任务需要；不将主题编辑器、通用设计系统或独立高保真样板阶段设为 MVP 前置交付。基本流程缺失或误操作问题 SHALL 在交付前修复，不能以 MVP 或后续视觉打磨为由省略。

#### Scenario: 评审 MVP 是否可以交付
- **WHEN** 基本操作、状态、错误恢复、返回与界面可读性已通过验收，但尚未增加装饰动效或独立高保真样板
- **THEN** 不因缺少这些装饰或样板阻止 MVP 交付；基础流程缺失、状态误导或动作被遮挡仍须修复

#### Scenario: 增加一个文件分析功能
- **WHEN** 后续变更设计用户上传文件并请 AI 分析
- **THEN** 说明其管理资料/分析改进场景，沿用 Files 与 Agent 的入口和来源规则，提供真实执行与恢复，不要求普通用户先学习 WebDAV

#### Scenario: 新增技术设置
- **WHEN** 功能需要修改 MCP 或资源策略
- **THEN** 进入当前 Work Settings 的 Advanced，明确保存和 Apply；不在默认 Service 工作区增加永久技术表单或平台密钥输入

### Requirement: 连接、账号和创建具有完整基本流程

**Identifier:** DUL-011

原型与规范 SHALL 呈现有效登录直达 Works、Core 地址/账号登录、当前身份、退出和登录过期恢复，分开表示 Core 可达与运行环境可用；切换 Core/用户不得复用另一身份的记录。关闭页面/详情或退出登录 SHALL 不隐式取消 Run、停止 Work 或删除数据；本地 CLI 进程退出导致入口不可用时 SHALL 提供恢复方向。

New Work SHALL 默认只要求名称并使用默认配置，Advanced SHALL 覆盖 CLI 支持的 base image、Skills、Packages、AGENTS 内容/文件与配置 JSON。默认继承、显式选择、显式空集合 SHALL 区分，合并优先级在提交前明确。表单 SHALL 具有字段错误、取消、提交中、接受后准备、就绪与失败修正/重试路径，已发布的失败 Work SHALL 不要求再次创建。空列表 SHALL 提供 New Work/Import Work。

连接与创建表单 SHALL 以单列主要内容呈现，标签在输入上方，帮助与错误紧随字段；Advanced 收纳低频配置。Skills/Packages SHALL 以 Use defaults、Choose、None 或等价清楚表达区分省略与显式空集合；显式字段与高级 JSON 合并结果在提交前可辨，不能双重提交。退出登录不改变 Work/Run 运行目标，本地入口恢复后先查询真实状态。

#### Scenario: 首次创建一个工具
- **WHEN** 已登录用户使用默认配置创建命名 Work
- **THEN** 先看到被接受与准备状态，真实就绪后进入空 Work 对话，能从同一面板访问 Files/Settings

#### Scenario: 运行依赖不可用
- **WHEN** Core 可达但 runtime 无法准备 Work
- **THEN** 连接不被误写为全部 Ready，创建失败给安全原因和原 Operation；用户可检查或修正，不出现假成功

#### Scenario: 登录过期后返回
- **WHEN** 用户观察中的登录失效并重新登录同一 Core
- **THEN** 原已知操作按 ID 查询，未自动重发；另一身份的本地活动不混入

### Requirement: Session 与 Run 的交互完整且不重复执行

**Identifier:** DUL-012

原型 SHALL 展示当前 Work 的 Session 列表、新建、读取/切换和对话提交，以及 accepted/running/cancelling/succeeded/failed/cancelled/interrupted。Session 标题 SHALL 来自已加载首消息摘要或创建时间/ID，不假定现有接口支持持久 title/改名。一个 Work 的活跃 Run 限制 SHALL 在其他 Session 中有 busy 说明并保留草稿，不能暗示隐藏队列。

Cancel run SHALL 是明确请求，取消中保留状态直至终态；切换、关闭或断线不等于取消。观察恢复 SHALL 使用原 Run ID/游标，过期读结果/历史，未知不得自动重发 prompt。旧 context 导致 Session 不可用 SHALL 给原因和 New session，不能自动迁移或承诺仍可继续。stopped Work SHALL 不被承诺可以加载 Session/Run；之前加载的消息可标注为旧内容。

#### Scenario: 跨 Session 遇到忙碌
- **WHEN** 同一 Work 已有活跃 Run，用户切到另一个 Session 输入
- **THEN** 看见忙碌原因、草稿与已知活动执行入口，不隐式取消原 Run 或排队新 Run

#### Scenario: 观察连接丢失
- **WHEN** 回答中连接中断
- **THEN** 显示观察中断和最后确认时间，Check status/恢复观察针对原 Run，不把执行标为失败或再次提交

#### Scenario: 取消与成功竞争
- **WHEN** 用户请求取消但 Core/agent 已记录成功终态
- **THEN** 显示真实成功，不把它强制改成取消；取消中仅在尚无终态时显示

### Requirement: Service 管理保留真实控制语义

**Identifier:** DUL-013

原型 SHALL 展示未移除 Service 列表、公开详情、Start/Stop/Restart/Retry/Remove、有限日志与端口选择；已禁用/失败/无网页服务仍可管理。Stop SHALL 明示持久禁用，Start SHALL 明示不启动 stopped Work，Restart SHALL 受 enabled 与运行状态约束，Retry 使用原定义，Remove SHALL 确认其保留共享数据且不能通过 Start 撤销。控制结果 SHALL 以原 Operation 确认；无效动作解释原因。日志 SHALL 有取得时间、截断/不可用状态和 Refresh，不绘制实时终端或 follow。定义创建/更新保持 Agent 工作流，不新增用户 Service 编辑器。

Service 详情 SHALL 展示身份、域名、公开端口、期望启用状态、观测状态、最近错误和所属 Operation；Stop 与 Remove 确认 SHALL 显示具体 Service 与影响。服务列表先名称、状态和可访问入口，再按状态给主动作，低频控制留在详情。

#### Scenario: 停止后重启 Work
- **WHEN** 用户 Stop Service 后再停止并启动 Work
- **THEN** UI 仍把该 Service 表示为 Disabled，提供显式 Start Service，不暗示它会随 Work 自动恢复

#### Scenario: 运行中的非 Web Service
- **WHEN** Service 存在 TCP/UDP 端口但没有可浏览入口
- **THEN** 可查看/控制该 Service，不能仅根据端口存在展示假网页；端口选择只能针对声明的适用入口

#### Scenario: 移除服务
- **WHEN** 用户确认 Remove Service
- **THEN** 说明共享文件保留、移除不可通过 Start 撤销，接受后保留 Operation 恢复入口

### Requirement: Work 配置和 Pi Package 有完整保存与应用流程

**Identifier:** DUL-014

Settings SHALL 覆盖配置 show/set、Skills 目录与 Work 选择、AGENTS 内容/文件编辑、Pi Package 目录/安装/更新/启停选择/移除和 Advanced 完整配置。In use、Saved changes、Not applied SHALL 分别映射 active、desired、pendingApply；runtime loaded/modelVisible SHALL 单独表示，不把历史 active 当成当前加载。目录只显示真实可读元数据。Advanced SHALL 覆盖 agentImage/modelRef/mcpServers/resources/tools 等有效字段，完整 JSON 编辑/导入可作为高级入口，错误指向字段且不暴露平台 secret/内部 revision。

Settings SHALL 使用行与分隔组织能力项，状态条说明已保存未应用，Apply 为独立主动作；编辑页的 Save changes 与整体 Apply 不同时争夺主动作。Skills SHALL 支持查看、选择和清空，区分重选 Core 副本与保留 Work 副本；Core Package catalog 仅是可复制来源，不代表 Work 已安装。AGENTS.md SHALL 展示当前/待应用内容并支持文件导入、编辑、保存与放弃；目录数据不得编造说明、评分或当前加载状态。

Package 来源 SHALL 包含 Core、npm、Git、本地目录和 ZIP，本地使用选择器上传；Update 明确新来源或当前 Core 副本，普通配置选择不得隐式安装/刷新包。所有 Package 改动只影响 desired，移除不得声称当前 active/历史引用立即物理删除。Apply SHALL 独立显示接受、进度、成功/失败/被取代和恢复；Run busy 不暗中取消；失败保留 active，回退失败明确 Work 故障；接受后的新编辑继续待应用，stopped Work 验证后仍保持 stopped。

#### Scenario: 安装后尚未 Apply
- **WHEN** 用户安装 Pi Package 成功
- **THEN** Settings 显示其 Saved/Not applied，当前运行 loaded 不凭安装成功改变，提供独立 Apply

#### Scenario: 编辑配置并离开
- **WHEN** 用户修改 AGENTS 或 Advanced 尚未保存并尝试返回
- **THEN** 可 Save changes、Discard 或 Keep editing；保存只改变 desired，不暗中 Apply

#### Scenario: Apply 失败和后续编辑
- **WHEN** Apply 正在运行时用户又保存新配置，随后原 Apply 失败或成功
- **THEN** 新 desired 保留；成功只激活原接受候选，失败保留 prior active，真实回退结果可查看

#### Scenario: 能力目录与 Work 配置
- **WHEN** 用户浏览 Core 的 Skills/Packages 并修改当前 Work 的选择
- **THEN** 目录来源、Work 已有副本和当前运行加载分别表达；可显式清空 Skills，AGENTS 可导入/编辑，选择不暗中安装、刷新或 Apply

### Requirement: 文件表单、传输和外部客户端连接可完成任务

**Identifier:** DUL-015

在 DUL-005 基础上，原型 SHALL 展示 New folder、Rename、同 Work Move/Copy 目的地、文本 Save/Discard、上传逐文件结果、Download、覆盖和递归删除确认、`207 Multi-Status` 部分失败路径与未知写入重读。二进制/超出编辑限额文本 SHALL 提供下载替代，特殊项 SHALL 按真实类型说明限制，workspace 根 SHALL 受保护；无锁/ETag 时不得承诺自动合并，不暗示目录 ZIP 下载或跨 Work 修改。具体编辑限额 SHALL 在后续实现设计中确定并作为可见拒绝原因。

文件主区域 SHALL 先展示 Work 归属、当前位置和 Upload/New folder，再按名称、类型、大小与状态组织列表，选中项动作紧邻目标。目录操作的成功与失败路径 SHALL 分别呈现；符号链接/特殊项不得作为普通文件直接编辑，根目录不得删除、移动或重命名。文本离开确认提供 Save file、Discard、Keep editing，取消不写入；外部客户端连接放在辅助区域。

Connect with WebDAV SHALL 是独立客户端的可选辅助流程，使用现有 CLI proxy、完整 Work ID URL 和临时 Basic，展示启动方式、用户名、端口和临时密码获取/有效期说明。密码从启动终端一次获取，SHALL 不进入普通文件页面、URL、页面脚本或持久记录；浏览器 Files SHALL 无需执行此手工连接流程。文件能力缺失 SHALL 局部反馈，不把仍可用 Service 一并禁用。

#### Scenario: 编辑与覆盖
- **WHEN** 用户编辑文件、选择离开或覆盖已有目的文件
- **THEN** 对应确认显示准确目标，取消不写入；无锁/ETag 的并发限制不被自动保存文案掩盖

#### Scenario: 目录操作部分失败
- **WHEN** COPY/MOVE/DELETE 返回逐路径部分失败
- **THEN** UI 呈现已完成和失败项，刷新核对实际目录，不声称整体回滚或全部成功

#### Scenario: 使用外部文件工具
- **WHEN** 用户选择 Connect with WebDAV
- **THEN** 知道如何使用现有 proxy 输出及临时凭证，重启密码失效有说明；回到 Files 可继续使用浏览器内操作

### Requirement: 静态原型必须具有可追溯的基础能力覆盖

**Identifier:** DUL-016

本变更 SHALL 交付本中文 Spec、36 个可定位 Frame 的 Excalidraw 与内嵌等价场景的 PNG、中文原型说明和 CLI 能力覆盖矩阵。矩阵 SHALL 覆盖身份/状态、Work 创建查询控制、Session/chat、Run、Service、proxy/WebDAV、Skills、Pi Packages、完整配置/Apply、inspect/import/export/snapshot download、Operation 查询。每项 SHALL 明确入口、输入/动作、结果、失败或未知恢复与返回；只画按钮不得认定完整。画面并列的互斥状态 SHALL 标注为评审变体，不能作为产品同时显示的要求。说明与矩阵 SHALL 引用需求编号承载验收映射，不另立与 Spec 并行维护的硬规则。

评审画布 SHALL 按 8 个功能模块分开放置，每组最多两列，模块及画面之间留出明显空白；SHALL 提供模块目录、独立模块 Excalidraw/PNG 和原尺寸单画面预览。完整总图用于定位，细节可独立阅读；重排 SHALL 保留画面编号及能力映射。评审分区不代表产品导航。

后续实现 SHALL 依据矩阵进行真实功能验收；本轮静态设计校验 SHALL 不被描述为 WebUI 已实现或浏览器认证/网关已验证。当前技术缺口 SHALL 列在后续实现设计依赖中，不作为未定义产品语义留给编码现场。

#### Scenario: 审查 CLI 基础覆盖
- **WHEN** 评审者从任一当前用户 CLI 基本命令查找 UI
- **THEN** 能找到画面编号、行为与恢复规则；终端输出选项不被机械转换成按钮，未支持能力不伪装可用

#### Scenario: 单独评审一个模块
- **WHEN** 评审者从模块目录选择 Files 或其他功能模块
- **THEN** 能独立打开该模块及其单画面原尺寸预览，按原编号反馈，无需将全部画面缩小到同一屏幕

#### Scenario: 后续新增功能
- **WHEN** 后续变更新增一个 Desktop 功能
- **THEN** 同时注明目标用户场景、产品用词、容器与视觉规则、覆盖矩阵位置、异常与返回路径，偏离基线需明确理由和替代规则
