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

Session 选择器 SHALL 仅列当前 Work 的 Sessions，并在顶部提供 New session。Manage services SHALL 从应用视图进入同 Work 服务列表/详情，返回恢复原 Service/端口选择；独立 Service 窗口 SHALL 保留 Back to Work，关闭不停止 Service。

模型选择 SHALL 进入既有 Agent 辅助栏或聚焦 Chat；Service 处理记录与证据 SHALL 进入所属 Work 请求检查面板和对象详情；脑包编辑与候选状态 SHALL 进入 Files / Settings 的 Pi Packages。入口不得新增必须先经过的总览；选中 Services 时常规布局保持 Service 主区域；各区域继续保持 Services / Files / Chat 同级导航、单一 Session 输入上下文及返回规则。

Service 工具栏 SHALL 提供 Focus 进入当前 Work 的专注布局。专注布局 SHALL 隐藏常规 Work 身份栏、模块导航及全局低频动作，以紧凑工具栏保留当前对象身份、真实状态、Exit focus 和布局切换入口；仅 Chat 时由 Agent 头部承接可见退出动作；默认保留同一当前 Chat，Hide chat 进入仅 Service 视图。此布局是常规导航规则的明确例外，返回 SHALL 恢复原 Work、模块及对象选择。仅改变布局 SHALL 不改变应用 origin、不重载同一 Service/端口的 iframe、不创建 Session、不停止观察或执行；任意应用自身刷新、跨窗口同步和网络故障仍不属于外壳保存保证。Settings、Files 或其他模块导航 SHALL 先恢复常规布局，再沿原返回规则打开。
Focus chat SHALL 从常规或 Service 专注布局放大同一 Session，Restore layout 返回放大前区域或专注布局，Exit focus 直接恢复首次进入专注前常规区域。两者目标可辨且持续可见，不依赖被隐藏的 Service 工具栏，不将返回统一固定为 Services。返回保留用户在专注期间明确作出的对象选择；失效对象给真实原因与可用出口。

当前 Service 存在已确认的请求记录时，Desktop SHALL 在现有 Service 工具栏右侧操作区、Focus/独立打开等访问动作之前显示带可访问名称和悬浮提示的 Agent requests 图标按钮。确认没有记录时 SHALL 隐藏该新增按钮，不预留空白区域；已完成、已取消和 historical 记录仍属于存在记录。该入口 SHALL 不附带计数、摘要条、最近状态卡或额外顶层导航；初次读取未确认及读取失败不得被表述为真正空集合，已确认存在记录时读取失败 SHALL 保留入口及既有错误恢复。

Agent requests SHALL 复用同一请求检查面板，默认范围为当前 Work 和当前 Service，不按网页端口拆分；全 Work 的 Pi Requests SHALL 位于 Work 导航右侧的辅助动作，不作为当前 Session 历史或第四个必经主区域。Service + Chat 和仅 Service 专注布局中，符合显示条件的 Service 入口 SHALL 保持可达；全 Work 入口在仅 Chat 或其他专注布局中 SHALL 从可见的 Work/对象辅助菜单保持可达，并明确 Work 范围。打开、取消后的刷新及关闭 SHALL 保持同一 Service iframe、当前用户 Session、草稿和阅读位置；返回及键盘焦点按 DUL-007 恢复，不创建第二个输入上下文。

请求详情读取失败时，Desktop SHALL 在原容器保留同一请求最后确认的回复与执行信息，并叠加读取失败及最后确认时间；首次没有取得内容与已有内容暂时无法刷新 SHALL 分开表达。列表取消中的记录 SHALL 在原列表或对应详情可见时核对真实收尾，更新原记录而不重置分页、过滤或阅读位置；关闭只停止观察，不改变远端取消。

证据分页的晚响应 SHALL 不覆盖同一请求较新的已确认状态、结果或回复关联。已确认终态后补齐证据及返回列表 SHALL 保持该终态、原分页和返回上下文，不重新显示 cancelling，不改变原取消收尾观察标记，也不重发取消。

任务完成后的出口 SHALL 回到用户要使用的对象：Start 成功及能力确认后提供 Open Work；Service 控制保留所属详情/应用入口；Open brain source 经未保存确认后直达 Files 的目标文件。Operation 详情是可恢复的技术入口，不成为这些简单动作完成后唯一出口；普通 Start 不强制跳转，用户明确 Start and open 才衔接导航。

Pi Requests SHALL 区分业务目标、一次 Run 和当前 Session：列表按目标、来源、请求状态和更新时间组织，historical 明确只读；详情先目标/结果/等待或错误，再按需查看关联执行、证据与技术 ID。列表和详情 SHALL 在同一检查面板中切换，返回保持来源过滤、已读分页、阅读位置和焦点。等待结果/Apply 或需处理状态不可被执行成功掩盖；没有关联 Run 的请求不得虚构执行，缺少 runId 的历史消息不得猜测关联。Run Details SHALL 跟随真实对应的一轮消息/Activity 或明确的活动执行状态，不常驻于无对象上下文的输入区；同一 Run 多段消息不重复堆叠诊断卡。其他 Session/Service 占用执行槽仍须明确来源，不误挂到当前消息。

宽屏 Service/Chat SHALL 保持左应用右对话，并提供可拖动及键盘可操作的分隔线、最小可读宽度和重置默认布局入口。普通 Collapse Chat SHALL 只收起辅助栏，保留 Work 导航；Show chat 恢复当前身份页面内该 Work 的比例、Session、草稿和阅读位置。Focus chat、Restore layout、Exit focus 与普通折叠 SHALL 是不同动作。窄屏 SHALL 使用单面板或可关闭覆盖层，隐藏不可用的分隔线；返回宽屏恢复上次比例并按可用宽度限制，不新增跨重启恢复承诺。

Service 选择器 SHALL 将名称、真实状态及选中标记按一致列表结构呈现；主Header与选择器不展示技术端口，声明端口与合法多入口选择归Service详情，Manage services 为管理出口。切换不自动启动不可用 Service，不切换当前 Chat Session，不猜测未声明端口；不可用项给真实原因，长名称与键盘/窄屏可操作。独立 Service 窗口不因布局改进新增 Chat。

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
- **WHEN** 用户依次进入 Focus、Focus chat、Restore layout、Exit focus
- **THEN** 仅 Chat 中恢复和退出均可见，恢复返回原专注布局，退出恢复常规导航，Session 与草稿保留

#### Scenario: 从 Files 放大 Chat 后恢复
- **WHEN** 用户从 Files 辅助 Chat 进入 Focus chat 并恢复布局
- **THEN** 返回原 Files 和未保存编辑，不强制切换 Services 或创建新 Session

#### Scenario: 有记录才显示 Service 请求入口
- **WHEN** 当前 Service 的读取分别确认无记录、有待处理记录或只有已完成/已取消/historical 记录
- **THEN** 无记录时工具栏没有新增按钮及占位，其余情况在工具栏右侧显示 Agent requests，主区域没有摘要条、计数或状态卡

#### Scenario: 从 Service 入口查看再返回
- **WHEN** 用户从 Service 工具栏打开 Agent requests、查看详情并关闭
- **THEN** 列表初始只显示该 Work/Service 的记录，返回保留原 Service/端口和 Main Chat 的 Session、草稿及阅读位置，同一 iframe 不重新加载

#### Scenario: 专注和窄屏中的请求入口
- **WHEN** 有记录的 Service 进入 Focus、隐藏 Chat，或窗口为 360px
- **THEN** 工具栏中的 Agent requests 与 Exit focus 仍可操作，必要时工具栏换行，不另建页面；仅 Chat 时全 Work Pi Requests 辅助入口仍可达

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

### Requirement: 操作进度和问题留在所属任务界面

**Identifier:** DUL-OPREC-001

Desktop SHALL 将 Work、Service、Apply、Package 和导入导出的任务反馈安排在各自的列表行、面板或流程内；主要可见内容依次表达动作与对象、真实状态、必要原因与下一步，Check status 为就近只读动作，原 Operation 详情为次级入口。没有可见 Work 的创建、导入和已移除 Work 的任务 SHALL 在 Works 现有操作区使用固定几何入口和按需展开的所属任务提示，呈现必要状态与对应动作；不在搜索或列表前插入挤压内容的状态行，不新增全局导航或全局操作中心。

任务进行中 SHALL 使用既有局部等待语义，明确失败、观察中断和未知结果 SHALL 停止误导性的进行中动效，显示可理解的原因与安全下一步；当前状态、已接受目标和最后确认事实不得混写。普通成功 SHALL 保持短暂、克制，同一任务的进度或错误不在行、通用条、详情和 toast 同时重复。技术 ID、阶段明细和相关标识 SHALL 在次级详情中按需展开、完整读取和复制，不挤占任务名称与主要动作。

多个临时任务 SHALL 各自可识别且可访问，可先显示有限的紧凑摘要并在同一位置展开其余任务；收起详情不丢失未处理状态。Work 搜索、空列表或暂时读取失败不隐藏需要处理的无对象任务。详情与反馈 SHALL 复用现有控件、语义色及非阻断的所属上下文；危险操作仍使用已有确认，普通检查不增加确认。

任务反馈更新 SHALL 保持列表和控件可用、焦点及相关草稿，不为展示进度或错误重载既有 Service iframe。360px 宽屏、长名称及长 ID SHALL 换行或在所属区域局部滚动，不导致整页横向溢出、遮挡主要按钮或破坏键盘访问。中英文文案 SHALL 指向当前任务的恢复动作，不再引导用户前往已移除的 Known operations。

#### Scenario: 账号菜单不再出现全局入口
- **WHEN** 普通用户或管理员在托管工作台或独立 Desktop 打开账号菜单
- **THEN** About 和原有适用账号管理动作仍可达，Known operations 不出现；任务状态在对应对象或 Works 临时提示中可查

#### Scenario: Work 行内展示进行和失败
- **WHEN** 用户在列表启动 Work，随后该任务处于进行中或确认失败
- **THEN** 原行以紧凑状态和就近检查呈现结果，失败有原因与下一步；不同时堆叠重复的全局提示，详情保留原 ID

#### Scenario: 未发布或已移除的 Work
- **WHEN** 导入尚未发布、创建尚未出现 Work 行，或删除后 Work 行已经移除
- **THEN** Works 列表按需显示对应任务及检查/详情，搜索和空列表不隐藏任务；无需进入账号菜单或新建操作中心

#### Scenario: Service 与 Apply 的原位恢复
- **WHEN** Service 控制或配置 Apply 失败、观察中断或仍在运行
- **THEN** 分别在对应 Service 管理区域或 Settings 中显示对象、状态、原因及只读检查；查看详情不切换其他 Service、不重载已有应用或丢弃草稿

#### Scenario: 详情显示真实诊断
- **WHEN** 用户展开失败任务详情，后端返回部分安全诊断和一个长 Operation ID
- **THEN** 可读到实际提供的字段、可用下一步及完整 ID；缺失原因被明确说明，未知字段不被猜测或以对象字符串展示

#### Scenario: 多任务与窄屏访问
- **WHEN** Works 存在多个无对象任务，使用 360px 界面、长名称和键盘查看并收起详情
- **THEN** 可识别和展开每个需处理的任务，状态文字及操作可达；长值不覆盖按钮或造成整页横向滚动，收起不取消执行或丢失恢复入口

#### Scenario: 原位反馈不改变列表几何
- **WHEN** Work 或 Service 的原任务从待机进入提交、进行、确认完成或需要检查
- **THEN** 相应对象的原状态位和动作表达事实，列表行、邻近对象与原导航不因普通等待或完成反馈增高、错位或移动；原任务详情与必要恢复仍可达
