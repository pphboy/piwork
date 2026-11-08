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
| Settings | Skills、Pi Packages、AGENTS.md、Advanced 与 Apply；Back to Work 返回原区域，未保存编辑先处理 |
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

### Requirement: Service 在浏览器内和独立窗口一键可用

**Identifier:** DUL-004

Desktop SHALL 以 Service 工具栏的唯一外部打开动作访问当前同一运行中 Service，不在更多菜单重复 Pop out/打开独立窗口；复制可直接打开链接继续保留。既有独立外壳直达路由及 Back to Work 兼容行为不因入口整理而删除。浏览器内嵌和外部打开 SHALL 继续遵守 browser-service-access、DWUI-HOSTED-001 及所属部署方式的既有 URL、身份、Cookie 和真实 Work/Service 准入；独立 CLI Desktop 仍使用受保护本地浏览器入口和 Core 映射身份，用户无需配置浏览器代理/PAC。域名身份与实际浏览器链接分开，不把托管同源路径改成另一套访问方式。HTTP、SSE、WebSocket、应用导航、跳转、会话及既有隔离边界保持。禁止嵌入时使用同一外部打开动作，不删除安全响应头；没有合法 Web 端口时说明原因，不假装成功。现有外部工具的 CLI forward proxy 继续独立提供。

在提供该域名的独立 CLI 部署中，域名按 Core 的 `service_name.work_network_name.work` 映射展示；Work 网络标识、用户显示名称与完整 Work ID SHALL 分开，复制身份不替代复制可直接打开的链接。Work/Service 变为不可用时，正常独立外壳 SHALL 显示所属对象、不可用原因和 Back to Work，不保留虚假的成功状态。禁止嵌入的应用 SHALL 可直接在独立标签页打开，保留其安全策略与原应用界面；该模式的返回入口保留在原 Work 面板，下一次真正到达本地入口且被拒绝的文档导航 SHALL 返回带 Work 身份和 Back to Work 的不可用页，活动网络连接仍遵守 Core 撤销边界。外壳不承诺实时覆盖任意应用已渲染或离线缓存的画面。

#### Scenario: 打开正在运行的 Service
- **WHEN** 用户在未设置浏览器代理/PAC 的环境中打开 Work Service，并点击工具栏唯一外部打开图标
- **THEN** 内嵌与外部浏览器页面访问同一 Service，访问身份和真实准入不变；更多菜单不再重复独立窗口，原直达外壳和链接仍可使用

#### Scenario: Service 拒绝嵌入
- **WHEN** Service 的响应不允许被 WebUI 嵌入
- **THEN** Work 保留 Service 身份和真实状态，给出直接打开原应用的独立标签页入口并保留原 Work 返回位置，不删除 CSP/X-Frame-Options，不将空白框当作成功预览

#### Scenario: Service 无默认 Web 入口或已停止
- **WHEN** 当前 Service 无可用默认 Web 入口或 Work/Service 已停止
- **THEN** 界面说明原因及可执行下一步，不提供虚假的交互页面


#### Scenario: 禁止嵌入应用在停止后重新访问
- **WHEN** 用户已在独立标签页直接打开禁止嵌入的应用，随后 Work 停止，下一次文档导航到达本地入口
- **THEN** 入口显示所属 Work、不可用原因和 Back to Work；已渲染或离线缓存页面不被承诺自动替换，活动连接按 Core 撤销规则关闭

### Requirement: 浮层按交互职责选择容器

**Identifier:** DUL-OVERLAY-ROLE-001

Desktop SHALL 使用 Dropdown 承载命令、Popover 承载 Service/模型/Session 选择和简单设置，Modal 承载必要阻断决策或独立子任务；持续且超出轻量管理范围的对象诊断继续使用所属详情容器。Service 选择 Pop 内可展开管理与有界日志子视图，不再强制先打开独立管理总列表。Tooltip 只解释元素。Dropdown/Popover 锚定实际触发控件、适配视口、无背景遮罩或焦点陷阱；外侧点击保持原目标动作，Escape 恢复合法触发器，命令菜单支持方向键/Home/End 和 Tab 离开。账户语言是有明确父子关系的二级单选 Pop：先返回父菜单再关闭父层，身份/上下文变化一并清理，不能形成无归属叠层。现有危险确认及写入保护不变，Modal 即时开关，不引入动画。

#### Scenario: 选择Service不打断工作区
- **WHEN** 用户点击Service Header名称选择Service
- **THEN** 在该名称旁打开Popover，保留真实状态和选中项，技术端口归详情；外侧导航一次即可生效，草稿及同一Service iframe保留，不自动启动Service

账号、Work、Agent、Service及文件对象Dropdown的明确命令行 SHALL 使用一致的前置装饰图标与可读文字，包括Agent布局和浏览器全屏分支；属性值列表、提示文字及普通Dialog footer不适用此图标要求。

#### Scenario: 更多命令与持续管理使用正确容器
- **WHEN** 用户打开账号/Work/Agent/Service/文件更多操作，或从 Service 选择器进入管理与详情
- **THEN** 命令使用紧凑 Dropdown，轻量服务管理在选择 Pop 的明确子视图中进行，长内容按所属区域滚动；删除/停止仍打开原阻断确认，不继承轻触关闭

#### Scenario: Service Header原位切换Chat
- **WHEN** 用户在宽屏或窄屏切换Show/Hide Chat
- **THEN** 同一个Service Header控件原位显示正确状态，Work导航不重复该按钮，窄屏可恢复Service且不重建iframe或丢草稿

### Requirement: 全局账号与 Work 菜单具有显式作用域

**Identifier:** DUL-NAVSCOPE-001

Desktop 的 Administration（中文“管理”）及 Quick Setup 快捷导航 SHALL 仅在有权的托管管理员全局账户菜单出现，分别进入既有 /admin 和 /admin/setup，不放在 Work 行、行菜单或 Work 更多菜单；Serve/Admin Header 继续直接提供返回 Workbench 的真实链接。Work 请求只通过已打开 Work 的 Chat 辅助菜单进入并绑定该 Work，Service 过滤在同一检查器内显式选择；没有有效 Work 时不得复用旧选择。语言选择集中到账户菜单的二级 Pop，Work 行菜单、Work 详情菜单与 Work Settings 不再重复语言入口。

行菜单与已打开 Work 头部菜单 SHALL 以显式上下文区分，不从全局选择或草稿推测目标；两者的共有命令、名称和顺序保持一致：设置、Work 信息、导出、当前适用的停止命令、删除，危险操作分组。Start/Retry 等原快捷动作及真实状态准入继续保留。移除 Operation history、Find a previous export、Requests 和语言的直接 Work 菜单项，不删除原操作记录、快照恢复、危险确认或业务能力：低频记录与原导出找回从 Work 信息的高级诊断进入所属独立上下文，当前未决反馈仍在原对象/任务区域可达。打开/返回无生命周期或 Run 副作用，权限变化或晚回调不把旧命令带到新上下文。

#### Scenario: Work 行菜单
- **WHEN** 用户在 Works 列表打开任一行菜单
- **THEN** 没有 Administration 或 Requests，命令目标绑定该行，不受上次打开Work影响

#### Scenario: 已打开 Work 的请求
- **WHEN** 用户打开有效 Work 后从其内部访问 Requests
- **THEN** 只查询该Work及显式Service过滤，返回保留会话/草稿/阅读位置，账号和行菜单不会出现同入口

#### Scenario: 管理与返回工作台
- **WHEN** 有权用户从 Desktop 全局账号菜单选择 Administration，再查看Admin Header
- **THEN** 前者进入真实管理目标，后者直接提供Workbench链接；普通用户不因菜单改版取得权限

#### Scenario: 语言与菜单作用域互不替代
- **WHEN** 用户从全局账户菜单切换语言，或在 Work 列表行与已打开 Work 菜单间切换
- **THEN** Work 两处菜单保持相同共有命令且都没有语言入口，选择的语言仍应用到所有当前界面；管理/请求不被复制到错误层级


## ADDED Requirements

### Requirement: 紧凑工作台容器沿用默认样式与明确角色

**Identifier:** DUL-CONSISTENCY-001

Desktop SHALL 沿用当前共享浅色令牌、字体、PW Logo 和控件/图标体系，仅为命令菜单、选择 Pop 和信息 Pop 使用明确的紧凑密度。账户、Work、Files、Service、Chat 的命令行图标、文字起点、行距及焦点规则一致，按任务和风险分组；不把确认窗、编辑器或进度视图强制套成命令菜单。Service 选择的名称、状态、选中槽与管理列保持对齐；大标题和空白不挤占轻量选择，选中、悬停和键盘焦点分别可辨。Core 连接 Pop 使用属性和对齐状态行，保留真实 Core 地址、检查时间及 Core/Runtime/Services/文件的分别判断和检查动作，不能用“Core 可达”冒充能力已就绪。长值完整可访问，中英文、窄屏及必要错误不被裁切。

#### Scenario: 命令菜单密度一致
- **WHEN** 用户依次打开账户、Work 行/详情、文件操作、Service 和 Chat 更多菜单
- **THEN** 共有命令使用同一紧凑控件语言，目标身份与危险组可辨；现有确认、未知锁和动作准入保持

#### Scenario: 选择列不随选中变化错位
- **WHEN** 服务名很长、选中项改变，且列表有 Ready/Failed/Disabled/无 Web 入口服务
- **THEN** 每行固定列对齐，真实原因和有效管理动作可访问；点击切换不自动启动服务

#### Scenario: Core 可达不等于能力可用
- **WHEN** Core 可达但 Runtime 未就绪或文件/Service 读取失败
- **THEN** 紧凑 Pop 分别显示实际状态、时间与检查/恢复，不能统一染为成功或伪造可用

### Requirement: Work 列表布局与空态提供同一任务入口

**Identifier:** DUL-CONSISTENCY-002

Work 列表 SHALL 支持 List 与 Grid 两种视图，切换仅改变呈现，保持同一身份、搜索、对象状态、目标 Work 及合法快捷动作，不重新提交业务操作。Work 身份图标与 Service 图标语义区分；列表/卡片中的打开入口明确是导航，不能暗中 Start。只有已确认整个 Work 集合为空时显示简单的首次创建引导：说明 Work 用途，主动作创建 Work，次动作导入已有 Work，二者在同一紧凑区域。首次未确认、读取失败、无匹配结果、Core 未准备以及无可见 Work 的未决任务各沿原状态与恢复呈现；不以营销插图、虚构对象或新向导填充空白。

#### Scenario: 切换布局保留同一对象与搜索
- **WHEN** 用户搜索 Work 后在 List/Grid 之间切换，并打开某个结果的更多操作
- **THEN** 过滤、真实状态和菜单目标一致，没有新的创建、启动或停止请求

#### Scenario: 真正空集合有下一步
- **WHEN** 有效身份确认 Work 集合为空
- **THEN** 显示简短用途与明确创建/导入动作，仍可看到原有无对象任务、身份与必要恢复

#### Scenario: 无结果和失败不冒充首次使用
- **WHEN** 有 Work 但搜索无匹配，或首次读取尚未确认/失败
- **THEN** 分别保留清空搜索、所属骨架或原错误重试，不显示“创建第一个 Work”来掩盖事实

### Requirement: Files 使用单行文件身份与左侧返回

**Identifier:** DUL-CONSISTENCY-003

Files 列表和文件详情 SHALL 采用 44px 的紧凑工具栏局部密度；详情返回文件导航在左侧，文件名/路径和实际保存状态在一条工具栏中表达，不再重复一行相同文件标题。完整路径保持可访问，刷新使用统一图形、原控件和真实读取状态。文件编辑、版本/秒级修改时间保护、保存/放弃、重新读取及其失败/未知恢复保持；来自请求的返回来源继续准确，关闭/返回遇到未保存内容仍执行原保护，不因紧凑布局丢失身份、草稿或操作。

#### Scenario: 查看并返回文件
- **WHEN** 用户打开一个文本文件并返回列表
- **THEN** 左侧返回恢复原 Work/路径/阅读上下文，文件身份与保存状态只出现一次，没有隐式保存或刷新其他对象

#### Scenario: 未保存内容仍受保护
- **WHEN** 用户编辑文件后点击左侧返回或刷新
- **THEN** 原未保存决策和版本保护继续生效，取消离开保留完整草稿，刷新不暗中覆盖或重试未知写入

#### Scenario: 路径长且视口较窄
- **WHEN** 长文件路径或360px视口下查看文本/图片/不可编辑预览
- **THEN** 完整路径及必要动作仍可访问，标题不过度增高，不裁掉失败信息、编辑内容或保存动作

### Requirement: Settings 的紧凑呈现保留完整配置模型

**Identifier:** DUL-CONSISTENCY-004

Work Settings SHALL 以清楚的同 Work 分类导航和编辑区组织 Skills、Pi Packages、AGENTS.md 与 Advanced，宽屏可用侧向导航，窄屏保持分类可达。能力名称、描述、版本、来源、选中/启用、loaded/modelVisible 和详情按真实数据分层展示，未提供不可被虚构。全部分类共享同一草稿，保留完整安装来源、导入、JSON、包/脑包详情及文件跳转；Save、待应用、Apply、失败、未知和当前生效事实继续分开。一个当前任务不重复铺设等效主动作，普通一致状态保持轻量；设置底部不再提供语言切换，必要错误和当前恢复不为紧凑而折叠隐藏。

#### Scenario: 保存不等于已应用
- **WHEN** 用户修改 Skills/包/AGENTS 或有效 JSON 并保存
- **THEN** 显示真实已保存待应用，只有明确 Apply 才观察生效；目录、副本、loaded 和行为核验不被合并为成功

#### Scenario: 非法 JSON 与跨分类草稿
- **WHEN** 用户在多个分类编辑同一配置，或输入非法 JSON
- **THEN** 有效编辑共享，非法输入保留并按原规则阻止提交/分类转换；保存失败或未知保留草稿，不自动 Apply

#### Scenario: 原功能在新布局仍可达
- **WHEN** 用户安装包、查看脑包候选或从设置打开源文件
- **THEN** 原支持来源、详情字段、准入与未保存保护完整，进入同 Work 的原文件并能按原规则返回
