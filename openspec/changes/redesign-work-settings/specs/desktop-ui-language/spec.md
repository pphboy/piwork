# Spec Delta

## MODIFIED Requirements

### Requirement: Work 打开后直接进入 Service 与 Agent 工作区

**Identifier:** DUL-002

Desktop SHALL 以独立 Work 列表为首层；打开 Work SHALL 进入该 Work 专属面板，常规布局顶部持续显示 Work 名称、真实状态、返回列表和生命周期操作，侧边 SHALL 不列其他 Work。同一有效身份重新进入时 SHALL 优先恢复上次明确选择且仍有效的 Services/Files/Chat 区域及对象；首次进入或没有有效区域记录时，若有可访问 Service，默认 SHALL 优先显示上次选中且仍可用的 Service，否则显示一个已就绪的默认 Web 入口；其真实可交互页面为主区域，Agent 当前 Session 对话为可输入的辅助栏。首次进入或无可恢复区域，且没有可访问 Service、Work 对话准入成功时，Agent 对话 SHALL 成为主区域，Chat 不常驻显示 Service 空态或无可访问 Service 的 Alert；Service 状态和原因在所属 Services 上下文可查；Work 停止时 SHALL 显示启动与历史保留提示，不承诺读取 Session/Run。Desktop SHALL 不设置必须先经过的 Work 总览页。多个 Service SHALL 能在 Work 内切换并看到各自状态；聊天可聚焦为主区域，返回后恢复 Service/端口选择、当前 Session 及 Desktop 自己的阅读位置和非敏感草稿；任意 Service 网页内未保存表单、滚动和跨窗口同步 SHALL 不被外壳作通用保证。Service 可弹出独立窗口，Work 对话仍保留。Work 身份栏下 SHALL 有 Services / Files / Chat 同级入口及明确的 Settings，Workspace files 与设置 SHALL 在同一 Work 中打开；文件主区域可保持 Agent 辅助栏。Run、Operation 与日志按所属对象打开详情。

各容器 SHALL 遵守以下职责与返回规则：

| 容器 | 内容与返回 |
| --- | --- |
| Work List | 搜索、创建、导入、账号和状态快捷动作；返回列表不停止 Work 或 Run |
| Service 工具栏与应用视口 | 前者展示服务名、状态、域名、选择器和浏览器访问动作；应用自己的导航、按钮和数据留在独立视口 |
| Agent 辅助栏 / 聚焦 Chat | 同一份当前 Session、回复、执行反馈和输入；Focus chat 不复制会话或产生两个独立输入框 |
| Files | 当前 Work 的路径、文件树/列表、选中项与动作；文件树是局部导航，返回保留 Work 上下文 |
| Settings | Skills、Pi Packages、AGENTS.md 三个分类及保存/Apply；分类、对象与文件选择分层，Back to Work 返回原区域，未保存编辑先处理 |
| 对象详情 | Service、Run、Operation、日志或身份诊断；Close/Back 返回来源，关闭只结束详情展示/观察，明确导出交付的协调观察按 DUL-009 继续；必要时放大为主区域 |
| 输入与确认弹层 | 目标、字段/影响、提交与取消；取消不提交，成功返回来源并刷新，已接受操作不因关闭而取消 |

Session 选择器 SHALL 仅列当前 Work 的 Sessions，并在顶部提供 New session。Chat Header 右上角 SHALL 是选择 Session 的唯一入口；当前 Session 名称可作为非交互身份显示，不再另设名称下拉或在更多菜单重复 Sessions/New session。Service Header 的选择 Pop SHALL 同时承接该 Work 的服务切换和管理子视图，不再经过独立的 Manage services 总列表；管理目标与当前应用选择分别表达，返回恢复原 Service/端口选择。既有独立 Service 外壳的 Back to Work 和关闭不停止服务的行为继续保留。

模型选择 SHALL 进入既有 Agent 辅助栏或聚焦 Chat；Service 处理记录与证据 SHALL 进入所属 Work 请求检查面板和对象详情；脑包编辑与候选状态 SHALL 进入 Files / Settings 的 Pi Packages。入口不得新增必须先经过的总览；选中 Services 时常规布局保持 Service 主区域；各区域继续保持 Services / Files / Chat 同级导航、单一 Session 输入上下文及返回规则。

Service 工具栏 SHALL 提供 Focus 进入当前 Work 的专注布局。专注布局 SHALL 隐藏常规 Work 身份栏、模块导航及全局低频动作，以紧凑工具栏保留当前对象身份、真实状态、Exit focus 和布局切换入口；仅 Chat 时由 Agent 头部承接可见退出动作；默认保留同一当前 Chat，Hide chat 进入仅 Service 视图。此布局是常规导航规则的明确例外，返回 SHALL 恢复原 Work、模块及对象选择。仅改变布局 SHALL 不改变应用 origin、不重载同一 Service/端口的 iframe、不创建 Session、不停止观察或执行；任意应用自身刷新、跨窗口同步和网络故障仍不属于外壳保存保证。Settings、Files 或其他模块导航 SHALL 先恢复常规布局，再沿原返回规则打开。
Focus chat SHALL 从常规或 Service 专注布局放大同一 Session，Chat Header 只显示一个当前上下文适用的 Focus/恢复控件，不在更多菜单重复同一动作。仅 Chat 中由该控件恢复放大前区域或专注布局；恢复目标已是常规布局时不另显示等效 Exit focus。若先进入 Service 专注再放大 Chat，则先恢复原专注布局，再由恢复后可见的 Service Header 退出到最初常规区域。窄屏已占满内容区的 Chat 使用当前层级适用的退出/恢复动作，避免并排重复 Focus。各层始终存在可见退出路径，目标由来源确定，不固定跳往 Services；返回保留专注期间明确作出的对象选择，失效对象给真实原因与可用出口。

当前 Work 的 Agent 请求 SHALL 折叠在 Chat Header 的辅助菜单中，使用唯一的全 Work 请求检查入口；Work 行、Work 更多菜单、Service 工具栏及 Service 更多菜单不再重复提供请求入口。入口不因暂时无记录而制造摘要条、计数或自动弹窗；首次读取未确认、读取失败和已确认空集合分别表达。

Agent 请求 SHALL 复用同一请求检查面板，初始范围为当前 Work，可在其中显式按 Service 来源过滤，不按网页端口拆分。入口不是当前 Session 历史或第四个必经主区域。仅 Service 专注或 Chat 收起时，用户经现有 Show chat/模块导航进入同 Work Chat 后访问该菜单，不额外增加另一个请求按钮。打开、刷新、取消后的核对及关闭保持同一 Service iframe、当前用户 Session、草稿和阅读位置；返回及键盘焦点按 DUL-007 恢复，不创建第二个输入上下文。

请求详情读取失败时，Desktop SHALL 在原容器保留同一请求最后确认的回复与执行信息，并叠加读取失败及最后确认时间；首次没有取得内容与已有内容暂时无法刷新 SHALL 分开表达。列表取消中的记录 SHALL 在原列表或对应详情可见时核对真实收尾，更新原记录而不重置分页、过滤或阅读位置；关闭只停止观察，不改变远端取消。

证据分页的晚响应 SHALL 不覆盖同一请求较新的已确认状态、结果或回复关联。已确认终态后补齐证据及返回列表 SHALL 保持该终态、原分页和返回上下文，不重新显示 cancelling，不改变原取消收尾观察标记，也不重发取消。

任务完成后的出口 SHALL 回到用户要使用的对象：Start 成功及能力确认后提供 Open Work；Service 控制保留所属详情/应用入口；Open brain source 经未保存确认后直达 Files 的目标文件。Operation 详情是可恢复的技术入口，不成为这些简单动作完成后唯一出口；普通 Start 不强制跳转，用户明确 Start and open 才衔接导航。

Pi Requests SHALL 区分业务目标、一次 Run 和当前 Session：列表按目标、来源、请求状态和更新时间组织，historical 明确只读；详情先目标/结果/等待或错误，再按需查看关联执行、证据与技术 ID。列表和详情 SHALL 在同一检查面板中切换，返回保持来源过滤、已读分页、阅读位置和焦点。等待结果/Apply 或需处理状态不可被执行成功掩盖；没有关联 Run 的请求不得虚构执行，缺少 runId 的历史消息不得猜测关联。Run Details SHALL 跟随真实对应的一轮消息/Activity 或明确的活动执行状态，不常驻于无对象上下文的输入区；同一 Run 多段消息不重复堆叠诊断卡。其他 Session/Service 占用执行槽仍须明确来源，不误挂到当前消息。

宽屏 Service/Chat SHALL 保持左应用右对话，并提供可拖动及键盘可操作的分隔线、最小可读宽度和重置默认布局入口。普通 Collapse Chat SHALL 只收起辅助栏，保留 Work 导航；Show chat 恢复当前身份页面内该 Work 的比例、Session、草稿和阅读位置。Focus chat、Restore layout、Exit focus 与普通折叠 SHALL 是不同动作。窄屏 SHALL 使用单面板或可关闭覆盖层，隐藏不可用的分隔线；返回宽屏恢复上次比例并按可用宽度限制，不新增跨重启恢复承诺。

Service 选择器 SHALL 以轻量触发器和紧凑 Pop 显示名称、真实状态、固定选中槽及管理动作列，选中项变化不得挤动其他行的列。主 Header 与选择器不展示技术端口，声明端口与合法多入口选择归所属管理详情。无 Web 入口或不可用服务仍可被管理，不伪造应用入口；切换不自动启动、不改变当前 Chat Session、不猜测端口。管理子视图可在该 Pop 内展开，日志和长技术信息在其所属区域滚动，危险确认仍使用原确认容器。Service 工具栏保留既有布局、Focus、外部打开与更多图标职责，外部打开只保留一个明确动作，不在更多菜单重复独立窗口或管理命令。复制访问链接和独立外壳兼容行为保持，长名称、键盘和窄屏可操作。

Works、Open Work、Services与Chat SHALL 仅在所属内容首次未确认时使用局部结构骨架，可使用低对比渐变，减少动态效果时为静态；已有确认列表、空集合、消息及Service iframe在背景读取时保留，手动刷新等待回到原控件。失败与未知保留原对象恢复入口，不闪现假空列表或欢迎。Service首次信息或合法入口尚未取得时 SHALL 有局部占位；取得入口后直接显示iframe，不以等待导航load遮挡已可交互内容。导航load不等同于业务就绪，不因后续读取重建已显示iframe。Packages及Work/Service属性行 SHALL 保持名称、说明、状态和动作的对齐与分组，长内容与窄屏可换行。

#### Scenario: 缓存刷新与首次读取分开呈现
- **WHEN** 用户刷新确认过的Works列表，或首次打开未读取的Service/Chat
- **THEN** 前者保留列表与搜索、按钮原位busy；后者局部骨架，确认后才展示内容或真实空态，失败提供原位置恢复

#### Scenario: 有可用 Service 的 Work
- **WHEN** 用户首次或没有可恢复区域时，从 Work 列表打开已运行、拥有可访问 Service 的 Work
- **THEN** 直接看到 Service 真实页面和可输入的 Agent 对话；可切换 Service、聚焦聊天或打开文件，其他 Work 不在侧边

#### Scenario: 空 Work 或 Service 不可用
- **WHEN** 用户首次或没有可恢复区域时，打开没有可访问 Service、但 Work 对话准入成功的 Work
- **THEN** 对话成为主区域，Chat 不插入 Service 空态或无可访问 Service 的常驻 Alert；Service 的空、启动中、停止或无默认 Web 入口原因及下一步在所属 Services 上下文可辨，不虚构预览

#### Scenario: 从 Service 聚焦对话再返回
- **WHEN** 用户聚焦当前 Session、继续输入，再返回 Service
- **THEN** Work 身份、Session、Desktop 非敏感草稿与原 Service/端口选择保持可恢复，不声称保存了任意 Service 的页面内存状态

#### Scenario: 查看详情后返回
- **WHEN** 用户从当前 Work 打开 Service、Run 或 Operation 详情再关闭
- **THEN** 回到原工作区及对象选择；关闭不取消执行、不停止服务，不产生另一个 Session 输入上下文

#### Scenario: 从应用查看自动处理依据再返回
- **WHEN** 用户在 Service 主区域打开该 Service 的处理记录和证据，随后关闭详情
- **THEN** 返回原 Service 和当前 Session，应用视口不因查询被刷新，也不产生新的独立聊天输入框

#### Scenario: 专注应用后恢复工作区
- **WHEN** 用户在 Service 中进入 Focus、隐藏 Chat、再次显示 Chat 并返回工作区
- **THEN** 同一应用视口和当前 Session 持续存在，原模块导航恢复，草稿和 Desktop 阅读位置保留，没有生命周期或对话提交副作用

#### Scenario: 专注后聚焦聊天仍可退出
- **WHEN** 用户依次进入 Service Focus、Focus chat、恢复布局，再退出专注
- **THEN** Chat Header 只提供当前适用的一个恢复控件；先回原专注布局，再使用已可见的 Service Header 退出，Session、草稿和 iframe 保持，没有两个等效 Focus/退出入口

#### Scenario: 从 Files 放大 Chat 后恢复
- **WHEN** 用户从 Files 辅助 Chat 进入 Focus chat 并恢复布局
- **THEN** 返回原 Files 和未保存编辑，不强制切换 Services 或创建新 Session

#### Scenario: 有记录才显示 Service 请求入口
- **WHEN** 当前 Service 的记录分别为空、存在待处理或只有已完成/已取消/historical 记录
- **THEN** Service 工具栏均不新增请求按钮；Chat 辅助菜单中的 Work 请求入口保持可发现，打开后按真实读取显示内容、空态或错误

#### Scenario: 从 Service 入口查看再返回
- **WHEN** 用户从 Chat 的 Agent 请求进入同 Work 列表，并筛选当前 Service 后查看详情再关闭
- **THEN** 范围只属于原 Work/Service，保留来源过滤、应用端口、当前 Session、草稿和阅读位置，同一 iframe 不重新加载

#### Scenario: 专注和窄屏中的请求入口
- **WHEN** 用户处于仅 Service、仅 Chat 或 360px 布局，需要查看请求
- **THEN** 经现有 Show chat/Chat 导航进入唯一请求入口，恢复与退出路径可达，没有新增 Service 请求按钮、第二个 Session 或整页横向溢出

#### Scenario: 读取失败不伪造空态
- **WHEN** 已确认有记录后请求读取失败，或首次读取尚未确认
- **THEN** 前者保留按钮并沿既有错误恢复，后者不展示虚构记录或空状态卡，均不将读取失败说明为没有请求

#### Scenario: 回复读取失败后仍可阅读最后确认内容
- **WHEN** 用户已读到原请求的 Agent 回复，再次读取对应 Run 失败
- **THEN** 原回复和实际执行信息仍可读，读取错误与最后确认时间可辨，不伪造没有回复或改变 Main Chat

#### Scenario: 晚到证据页后返回列表仍显示终态
- **WHEN** 用户在取消中的请求详情翻页，状态核对先确认 cancelled，而旧证据页随后返回，用户再返回原列表
- **THEN** 证据正常追加，详情与列表仍显示 cancelled，原分页、过滤、焦点、阅读位置、Main Chat 草稿和同一 Service iframe 保持，不重新请求取消

#### Scenario: 继续上次文件或聊天任务
- **WHEN** 用户在 Files 子目录或 Chat 工作后离开并重进相同 Work
- **THEN** 优先恢复有效区域，不因为有 Ready Service 强制回 Services，读取和资源失效在目标区域解释

#### Scenario: 完成动作有对象出口
- **WHEN** Start 或 Service 控制完成且所属对象真实可用
- **THEN** 直接提供该 Work/Service 的访问或返回，原 Operation 仍可查，不要求用户自行重走菜单

#### Scenario: 请求目标与单次执行分层
- **WHEN** 同一请求关联多次 Run，最近 Run succeeded 而请求 waiting_result，用户从全 Work 或当前 Service 入口查看
- **THEN** 来源范围明确，请求仍显示等待及原结果依据，各次执行按需展开；返回保留过滤/分页/阅读位置，不伪造请求完成或新的执行

#### Scenario: 消息执行详情不串对象
- **WHEN** 当前 Session 消息包含不同 runId，另一 Session 或 Service 存在 active Run，部分旧消息没有 runId
- **THEN** 每轮详情绑定原 Run，当前占槽来源单独可辨，无 runId 消息不错误绑定最近执行；关闭详情不取消任何 Run

#### Scenario: 拖动折叠与专注分别恢复
- **WHEN** 用户调整分栏，普通折叠并展开 Chat，再进入 Focus chat 后 Restore layout
- **THEN** 普通折叠不隐藏 Work 导航，各次返回保留合法原比例、Session、草稿及阅读位置，不重载 iframe、不创建 Session 或重启 Run

#### Scenario: 键盘及窄屏恢复分栏
- **WHEN** 用户仅用键盘调整/重置分隔线，将窗口缩至500px或360px后再回到宽屏
- **THEN** 焦点与当前比例可感知，窄屏不挤成双窄列或整页横滚，回宽屏恢复受最小宽度约束的原比例

#### Scenario: 切换不可用或多端口服务
- **WHEN** 用户选择 Starting/Failed/Stopped Service 或更换合法声明端口
- **THEN** 选择器保留名称/状态及当前选择，显示真实访问原因，旧响应不替换新对象，不自动 Start，不改变 Chat Session

#### Scenario: 没有 Service 时直接使用 Chat
- **WHEN** Work 已确认没有 Service，或没有可访问的 Service，且对话准入成功
- **THEN** Chat 可直接使用，不在 Session 或消息区插入无 Service 的蓝色 Alert；Services 入口仍能说明真实状态

#### Scenario: Work 控制等待保持工作区位置
- **WHEN** 用户启动或控制 Work，提交及已接受任务仍在等待
- **THEN** 提交反馈在原控件，实际阶段在原对象状态位置；标题、导航、其他交互目标及已打开的应用不因普通等待新增状态块而移位，实际失败和恢复仍可访问

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
- **THEN** 沿用现有 CLI/API 的完整配置能力；网页 Settings 仅保留 Skills、Pi Packages、AGENTS.md，不再提供 Advanced/完整 JSON；不在默认 Service 工作区增加技术表单或平台密钥输入

### Requirement: Work 配置和 Pi Package 有完整保存与应用流程

**Identifier:** DUL-014

Settings SHALL 提供 Skills、Pi Packages、AGENTS.md 三个分类，以本变更 v5 原型的分类导航、Work 对象列表及搜索、对象编辑区、紧凑工具栏和窄屏对象选择为布局与交互基线。Skills 标题旁 SHALL 常驻可点击的“添加 Skill”，Work 空态提供同一添加入口；打开选择弹窗，而不是把添加标题或常驻 Core 候选区当作动作。Skills 以 Work 自有副本为编辑对象，按 WCFG-EDIT-001—009 支持 Core 选择、本地目录导入及既有文本编辑；确认添加后立即创建已保存、待应用副本，不保存其他草稿。AGENTS.md 支持导入、编辑、保存与放弃；Package 目录、安装、来源更新、启停选择、移除与既有脑包详情保持。网页移除 Advanced、完整配置 JSON 编辑/导入和 Core Skill 副本替换动作，不新增替代技术分类。镜像、模型、MCP、工具、资源等未展示字段按 Work 最新 desired 保留，不以默认值或 active 替换；CLI/API 的现有完整能力保留。

Settings SHALL 分别表达本地未保存、已保存 desired、待应用、Apply 与 Work/runtime 的实际观测，当前文件与整个 Skill 的保存状态也可不同。单一全局“保存全部”处理共享草稿，独立 Apply 只采用已保存内容；一个任务不重复铺设等效主动作，普通一致状态仅用轻量文字。必要错误和结果未确认在所属对象可持续读取，不把历史 active、添加或保存成功当作 loaded/modelVisible。Skill 菜单绑定明确 Work/Skill，只提供详情与从此 Work 移除；清空选择可以通过移除所有项完成，不将目录复制来源混成 Work 已安装事实。目录只显示真实可读元数据，不编造说明、版本、评分或加载状态。

Package 来源 SHALL 包含 Core、npm、Git、本地目录和 ZIP，本地使用选择器上传；Update 明确新来源或当前 Core 副本，普通配置选择不得隐式安装/刷新包。所有 Package 改动只影响 desired，移除不得声称当前 active/历史引用立即物理删除。Apply SHALL 独立显示接受、进度、成功/失败/被取代和恢复；Run busy 不暗中取消；失败保留 active，回退失败明确 Work 故障；接受后的新编辑继续待应用，stopped Work 验证后仍保持 stopped。

#### Scenario: 安装后尚未 Apply
- **WHEN** 用户安装 Pi Package 成功
- **THEN** Settings 显示其 Saved/Not applied，当前运行 loaded 不凭安装成功改变，提供独立 Apply

#### Scenario: 编辑配置并离开
- **WHEN** 用户修改 AGENTS 或 Skill 文件尚未保存并尝试返回
- **THEN** 可 Save changes、Discard 或 Keep editing；保存只改变 desired，不暗中 Apply

#### Scenario: Apply 失败和后续编辑
- **WHEN** Apply 正在运行时用户又保存新配置，随后原 Apply 失败或成功
- **THEN** 新 desired 保留；成功只激活原接受候选，失败保留 prior active，真实回退结果可查看

#### Scenario: 能力目录与 Work 配置
- **WHEN** 用户浏览 Core 的 Skills/Packages 并修改当前 Work 的选择
- **THEN** 目录来源、Work 已有副本和当前运行加载分别表达；可显式清空 Skills，AGENTS 可导入/编辑，选择不暗中安装、刷新或 Apply

#### Scenario: 设置 JSON 的镜像边界
- **WHEN** 用户查看网页设置与文件导入方式并保存普通编辑
- **THEN** 网页没有完整配置 JSON 或镜像编辑入口；Work 原 desired 镜像及隐藏字段保留，原 CLI/API 完整配置能力继续有效

#### Scenario: 添加即形成待应用副本
- **WHEN** 用户明确添加一个可用 Skill
- **THEN** 只提交新增项，确认后可直接编辑其 Work 文件；未保存编辑与新增待应用状态同时保留，运行内容不自动改变

#### Scenario: 空态保留真实添加入口
- **WHEN** 当前 Work 没有 Skill，Core 目录也为空
- **THEN** 页面提供可点击的“添加 Skill”并可导入自己的目录，不出现“全部已添加”或仅要求选择不存在 Skill 的死路；不增加抢占正文的说明 Alert

#### Scenario: 原型界面与真实业务边界分别验收
- **WHEN** 检查正式 Settings 与 v5 原型的一致性
- **THEN** 核对导航、对象搜索、添加按钮和弹窗、文件选择、对象菜单及窄屏操作；允许真实元数据、统一等待组件及确认状态差异，不允许以原型使用示例数据为由省略基本入口


### Requirement: Settings 的紧凑呈现保留完整配置模型

**Identifier:** DUL-CONSISTENCY-004

Work Settings SHALL 以分类导航、分类内对象选择和编辑区组织 Skills、Pi Packages、AGENTS.md；分类导航不混入 Skill 文件树，文件在所属编辑区选择。宽屏使用明确分栏，窄屏保持分类、对象、文件及动作可达，键盘焦点与实际选择分开。Skill 操作菜单标明目标，只提供详情和从此 Work 移除；单项 AGENTS 导入直接呈现。全部编辑共享草稿，现有包安装来源、详情、脑包检查和 Files 跳转完整可达；不再保留 Advanced、JSON 编辑/导入或 Core 副本替换入口，底层完整配置和未展示字段仍保留。

状态与文案 SHALL 使用现有双语体系，动作名称与结果保持一致。当前文件保存、全局保存、配置应用和 Work/runtime 运行事实分别投影；未保存与待应用可同时存在，active=null 不冒充已应用。普通一致状态只显示轻量结果，常规等待由原控件/固定状态位承接，不重复铺设成功 Alert、说明卡或通用提示。一个当前任务保留明确主动作，必要错误和安全恢复不为紧凑而隐藏；明确解决的旧失败可以退出主要视界，未确认写入、读取失效和真实运行故障不得据此退休。

#### Scenario: 保存不等于已应用
- **WHEN** 用户修改 Skill 文件、包启停或 AGENTS 并保存
- **THEN** 显示真实已保存待应用，只有明确 Apply 才观察生效；目录、副本、loaded 和行为核验不被合并为成功

#### Scenario: 非法 JSON 与跨分类草稿
- **WHEN** 用户在三个设置分类编辑文本并切换，或保存响应结果未确认
- **THEN** 不存在完整配置 JSON 输入及其解析切换阻塞；实际编辑共享同一草稿，失败或结果未确认保留内容与安全恢复，不自动 Apply 或重发

#### Scenario: 原功能在新布局仍可达
- **WHEN** 用户安装包、查看脑包候选或从设置打开源文件
- **THEN** 原支持来源、详情字段、准入与未保存保护完整，进入同 Work 的原文件并能按原规则返回

#### Scenario: 当前文件与整体状态各自真实
- **WHEN** 当前文件已保存，同一 Skill 的其他文件未保存，另有已保存配置待应用
- **THEN** 三种事实可以同时表达，不用一个全局状态覆盖其他含义，也不为说明差异常驻大型 Alert

#### Scenario: 已解决提示不形成新的恢复系统
- **WHEN** 当前确认读取和必要运行观测已证明某个已知失败不再影响当前任务，应用提示的退休另需 Core 确认 pendingApply=false
- **THEN** 仅退休其呈现，原诊断和必要未知锁保持；复用既有状态核对，不引入自动重放、后台任务或新的持久草稿
