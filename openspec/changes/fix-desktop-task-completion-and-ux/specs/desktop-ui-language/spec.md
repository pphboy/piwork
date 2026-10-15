# Spec Delta

## MODIFIED Requirements

### Requirement: Work 打开后直接进入 Service 与 Agent 工作区

**Identifier:** DUL-002

Desktop SHALL 以独立 Work 列表为首层；打开 Work SHALL 进入该 Work 专属面板，常规布局顶部持续显示 Work 名称、真实状态、返回列表和生命周期操作，侧边 SHALL 不列其他 Work。同一有效身份重新进入时 SHALL 优先恢复上次明确选择且仍有效的 Services/Files/Chat 区域及对象；首次进入或没有有效区域记录时，若有可访问 Service，默认 SHALL 优先显示上次选中且仍可用的 Service，否则显示一个已就绪的默认 Web 入口；其真实可交互页面为主区域，Agent 当前 Session 对话为可输入的辅助栏。首次进入或无可恢复区域，且没有可访问 Service、Work 对话准入成功时，Agent 对话 SHALL 成为主区域并解释 Service 空态或不可用原因；Work 停止时 SHALL 显示启动与历史保留提示，不承诺读取 Session/Run。Desktop SHALL 不设置必须先经过的 Work 总览页。多个 Service SHALL 能在 Work 内切换并看到各自状态；聊天可聚焦为主区域，返回后恢复 Service/端口选择、当前 Session 及 Desktop 自己的阅读位置和非敏感草稿；任意 Service 网页内未保存表单、滚动和跨窗口同步 SHALL 不被外壳作通用保证。Service 可弹出独立窗口，Work 对话仍保留。Work 身份栏下 SHALL 有 Services / Files / Chat 同级入口及明确的 Settings，Workspace files 与设置 SHALL 在同一 Work 中打开；文件主区域可保持 Agent 辅助栏。Run、Operation 与日志按所属对象打开详情。

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

Works、Open Work、Services与Chat SHALL 仅在所属内容首次未确认时使用局部静态骨架；已有确认列表、空集合、消息及Service iframe在背景读取时保留，手动刷新等待回到原控件。失败与未知保留原对象恢复入口，不闪现假空列表或欢迎。Service首次信息或合法入口尚未取得时 SHALL 有局部占位；取得入口后直接显示iframe，不以等待导航load遮挡已可交互内容。导航load不等同于业务就绪，不因后续读取重建已显示iframe。Packages及Work/Service属性行 SHALL 保持名称、说明、状态和动作的对齐与分组，长内容与窄屏可换行。

#### Scenario: 缓存刷新与首次读取分开呈现
- **WHEN** 用户刷新确认过的Works列表，或首次打开未读取的Service/Chat
- **THEN** 前者保留列表与搜索、按钮原位busy；后者局部骨架，确认后才展示内容或真实空态，失败提供原位置恢复

#### Scenario: 有可用 Service 的 Work
- **WHEN** 用户首次或没有可恢复区域时，从 Work 列表打开已运行、拥有可访问 Service 的 Work
- **THEN** 直接看到 Service 真实页面和可输入的 Agent 对话；可切换 Service、聚焦聊天或打开文件，其他 Work 不在侧边

#### Scenario: 空 Work 或 Service 不可用
- **WHEN** 用户首次或没有可恢复区域时，打开没有可访问 Service、但 Work 对话准入成功的 Work
- **THEN** 对话成为主区域，Service 的空、启动中、停止或无默认 Web 入口原因与下一步可辨，不出现空白或虚构预览

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

每个当前任务 SHALL 只突出一个主动作，其余使用次级样式：文件未选择时由紧凑更多命令菜单承接 Upload/New folder，空目录可保留文字引导，已选时就近提供批量动作，停止 Work 时突出 Start Work，快照就绪后突出 Download .work；Pop out 可作为 Service 工具栏主动作。同工具栏的输入和按钮 SHALL 等高、间隔一致，按钮文字居中；当前选择同时由位置、文字与柔和选中态表示，悬停弱于选中。状态、操作 ID、取得时间和恢复动作 SHALL 位于同一上下文，不能用旋转图标代替执行状态或在无关区域显示成功。

键盘焦点 SHALL 有至少 2px 可见轮廓。模态弹层 SHALL 获得并限制焦点，非提交中的普通弹层可用 Escape 关闭，危险确认的 Escape 等于取消，关闭后焦点回到触发控件；未保存编辑离开须先处理 Save/Discard/Keep editing。弹层开关 SHALL 立即到终态，不使用入场/退场动画、快照、展示层或延迟清理；普通与 `prefers-reduced-motion` 设置行为一致，不改变提交保护或业务完成条件。

本变更的交互验收 SHALL 保留基本键盘、焦点与可访问名称，不以真实NVDA/VoiceOver运行或认证作为交付前提；移除该人工实测范围不表示已取得真实读屏通过证据。

Response settings的背景能力更新导致原聚焦控件变为禁用或不可聚焦时，若仍属同一Work/Session、身份和浮层，且用户没有主动移到其他位置，Desktop SHALL 将因该更新丢失的焦点恢复到该浮层现有的合法控件；Thinking不可用时提供恢复动作或Close等可操作回退，不将焦点遗留在BODY。原控件仍可用时保持焦点；用户已移焦、浮层已关闭/更换或对象/身份变化时 SHALL 不恢复旧焦点。该保护不改变Popover的非模态Tab行为、不触发设置保存或Run提交。

窄屏 SHALL 保留 Work 身份、返回、主要动作与 Pop out；文件树可收进可关闭面板，表格和代码只在局部滚动。Import 可全宽滚动，底部动作不能遮住私有包提醒；Export 步骤纵向排列。详情先目标与结果，再影响/恢复，最后技术 ID；错误不得通过缩小正文或挤掉名称容纳。

Works 搜索和 Chat 输入 SHALL 保持至少 2px 的可见键盘焦点；使用容器焦点样式时同样能辨认输入位置。Pi Package Remove 等危险文本动作 SHALL 使用既有 danger 语义并在 hover/focus 保持，disabled 状态仍可辨，不受普通链接色覆盖。

只有已明确列入轻量菜单/只读信息白名单、无草稿且非 busy 的弹层 SHALL 支持外部指针关闭；指针按下和抬起均在弹层外才关闭，拖选跨越边界不误关。危险确认、覆盖/丢弃、编辑、Inspect/Import 及提交/未知恢复流程不纳入该白名单；Escape、显式 Close/Cancel、焦点限制和返回规则保持。关闭观察的动作 SHALL 用 Close，Cancel request/run 保留真实执行对象。Files 选择命中区 SHALL 至少 32px 且与文件名的打开动作分离，选择工具栏不推移文件行。

全局 About Piwork 与 Known operations SHALL 放在 Admin/账号下拉，不在 Work 顶栏常驻。Stop Work 与 Work information SHALL 放在所属 Work 更多菜单；Ready Work 列表主动作 SHALL 是 Open Work，Stopped 保留 Start。已有 Works 列表底部 SHALL 不重复展示 Create a Work，空列表创建引导仍保留。账号下拉自身无编辑草稿，外侧关闭 SHALL 不因背景草稿或后台任务被阻断；不扩大其他危险确认窗的外侧关闭范围。Files 无选择时 SHALL 不显示 Select files 提示条，选中后的批量动作 SHALL 使用现有工具栏，不推移文件行。全 Work Pi Requests SHALL 依 DUL-002 归 Work 级辅助入口，保持与 Service 请求过滤入口不同的范围；不以常驻主按钮或未读计数抢占使用主流程。

Works 的 Refresh/Import/New SHALL 使用一致的图标动作组，前两者为次级、New 保留主动作角色；tooltip、可访问名称、键盘焦点与空列表文字引导保持。账号菜单 SHALL 只显示一次清楚账号身份，角色如需展示使用明确标签而非重复裸名称，Core 信息和管理动作仍可达。

所有 Modal footer 的同类动作 SHALL 使用一致高度、字阶、padding、图标间距及角色顺序，确认/取消配对尺寸协调；长标签和窄屏可换行而不裁切。主动作、次级、危险及禁用原因 SHALL 保持差异。菜单行、正文小动作和头部关闭控件不得被强制变成 footer。停止影响说明 SHALL 明确非交互，不用像未勾选 Checkbox 的装饰；已有真实确认框和停止/删除确认要求保持。

弹层开关 SHALL 即时完成，不改变请求提交、焦点返回和模态/非模态边界；快速关闭后重开、切换内容或身份时，无旧退场callback，旧异步结果不得移除新弹层或夺走新焦点。关闭后不得遗留不可见遮罩或不可交互背景；Export 保持非模态。

工作区 SHALL 按实际可见头部、导航与必要提示占用剩余视口高度，Service/Chat下方不保留无用途的外壳空白；最多保留一条紧凑 StatusLine。Service页面内部空间不属于该调整；内容和输入区通过所属面板滚动保持可达，不以裁掉错误或输入区实现充满。

完成和警告 SHALL 沿用已有颜色角色、图标与简短可见标签，避免重复标题、长成功说明和多处 toast；不得仅凭颜色或不明确图标传义。必要影响、私有数据风险、错误原因、未知状态与安全下一步仍须可理解，不仅藏在 tooltip 或随成功提示一起消失。

#### Scenario: 全局与Work管理分层
- **WHEN** 用户查看Works或使用Work
- **THEN** About/Known operations在Admin，Stop/Work information在当前Work更多菜单；Ready行可直接Open，Stopped可Start；已存在Work时没有底部重复创建CTA

#### Scenario: 头像菜单仅收起展示
- **WHEN** 用户打开Admin后在外侧按下并抬起或按Escape，包含背景存在草稿或任务的情况
- **THEN** 账号菜单关闭且焦点回头像，内部点击不误触外侧关闭，不触发注销/停止/取消，不扩大其他确认窗规则

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

#### Scenario: 搜索与输入焦点可见
- **WHEN** 用户仅用 Tab/Shift+Tab 到达 Works 搜索和 Chat 输入
- **THEN** 输入位置有至少 2px 可见轮廓，既有设置摘要/菜单焦点规则保持，不出现无法辨认的焦点

#### Scenario: 危险文本操作颜色正确
- **WHEN** 用户查看 Pi Package Remove 的常态、hover/focus 和 disabled
- **THEN** 危险角色与普通蓝色链接区分，状态变化不恢复错误颜色，必要确认仍保留

#### Scenario: 轻量菜单允许安全外部关闭
- **WHEN** 用户对无草稿且非 busy 的白名单信息窗在外部按下并抬起
- **THEN** 关闭并正确回焦点；跨边界拖选不关闭，危险/编辑/传输确认不通过该规则退出或提交

#### Scenario: 选择命中与布局稳定
- **WHEN** 用户点击文件复选框周边留白、文件名或用 Space 切换选择
- **THEN** 独立至少 32px 命中区切换选择，文件名只打开，首次/末次选择不让后续指针目标移动

#### Scenario: 主页图标与账号身份简洁可达
- **WHEN** 用户用鼠标或键盘访问 Works 三个操作及账号菜单，账号名称与角色值相同或不同
- **THEN** 操作目的和主次可辨，创建/导入/刷新仍可用，账号不重复裸列，必要角色与 Core 信息清楚且长内容可读

#### Scenario: 弹层动作统一但不混角色
- **WHEN** 打开请求、包详情、创建、Stop、Delete、Import、Export及菜单型弹层
- **THEN** footer同类动作尺寸与间距一致，危险/禁用语义不变，菜单行不被改成footer；Stop范围没有假Checkbox，真实Delete确认框仍有效

#### Scenario: 弹层退场不影响新视图
- **WHEN** 用户快速关闭并重开弹层，切换对象/身份，或状态刷新在退场时返回
- **THEN** 关闭立即结束原展示，不创建退场状态，焦点仅回合法目标一次，无遗留遮罩；提交不重复，Export背景操作不被阻断

#### Scenario: 减少动态效果立即完成展示切换
- **WHEN** 系统启用减少动态效果后打开或关闭弹层
- **THEN** 无微位移等待，直接进入相应可操作终态，焦点与关闭规则不依赖动画事件

#### Scenario: 工作区底边随真实可用高度贴合
- **WHEN** 常规/专注布局、Chat显隐或窄屏切换，且必要错误/降级提示出现或消失
- **THEN** 无额外底部空白，最多一条StatusLine，输入区和必要提示可达，iframe内部业务布局与同一文档保持

#### Scenario: 短反馈不省略必要信息
- **WHEN** 刷新或保存成功，或出现警告、失败与未知结果
- **THEN** 正常结果用图标和短标签，警告保留理解影响与下一步所需内容；关闭颜色或使用辅助技术仍能分辨，未知锁不因提示收起释放

#### Scenario: 工具栏动作与弹层语义一致
- **WHEN** 用户切换Chat显隐、打开Files更多命令菜单或查看已对齐的配置
- **THEN** Chat使用同一固定工具栏面板按钮；Files更多命令菜单展开锚定非模态动作菜单，New folder才打开输入窗；正常配置不显示只有重复解释的Details，异常与待Apply动作保留；打开设置的入口不得以pressed冒充内部开关，文件移动不得使用返回箭头

#### Scenario: 退场视觉不再拥有逻辑弹层
- **WHEN** 关闭后刷新、快速重开、切换导航或身份
- **THEN** Modal立即释放背景交互，无入场/退场动画、快照、展示层或延迟清理；不关闭新弹层或覆盖新焦点，不残留遮罩

#### Scenario: Thinking能力更新禁用原聚焦控件
- **WHEN** 用户聚焦Response settings的Thinking控件，后台能力更新使该控件禁用且焦点因此丢失
- **THEN** 同一有效上下文中焦点恢复到现有恢复动作或Close等合法控件，Tab/Escape仍可用，草稿及选区保持，没有额外设置PATCH或Run提交

#### Scenario: 能力晚结果不覆盖用户后续焦点选择
- **WHEN** 能力读取尚未返回时用户主动移焦、关闭或更换浮层、切换Work/Session或身份
- **THEN** 晚结果不把焦点拉回原Thinking或原浮层；仍可用控件不因普通背景刷新失焦，不新增焦点陷阱、延迟恢复或业务请求


### Requirement: Work 导入导出是可恢复的分步传输

**Identifier:** DUL-009

Desktop SHALL 将 Export 表达为一次明确目标下连续完成的停止（需要时）、生成快照、传输校验和浏览器下载阶段，技术阶段分别可见但不要求用户逐段重复确认。只有 desired/observed 均 stopped 且无已知冲突控制任务时 SHALL 提交生成快照请求，并以 Core 的实际停止及快照准入结果为准；running/stopping 的导出流程入口仍可进入，分别提供明确停止影响确认或等待原停止；仅明确说明影响并获用户 Stop and export 确认后才可顺序提交停止和导出；普通导出不隐式停止，仍不暗中 Apply、额外取消 Run 或启动 Work。Export 接受后 SHALL 保留 Operation ID 与 snapshotId，快照成功并验证后才提供 `.work` 下载；下载中断 SHALL 在保留期内用原 snapshotId 重试，过期 SHALL 明确提示，不能静默重新 Export。Import SHALL 从 Work 列表进入，对本地包完整校验并展示安全摘要、私有内容提醒及可选名称；名称留空 SHALL 保持省略，使 Core 自动使用包名并处理重名，显式名称冲突 SHALL 指向字段。接受后 SHALL 保留原 Operation ID，完整发布前不显示新 Work；成功后显示 Core 返回的最终名称、新 Work ID、Imported · Not started 状态以及显式 `Start and open` 和仅查看/暂不启动入口，不自动运行包内代码或 Service；失败时不显示半成品 Work。Desktop SHALL 仅本地保存当前 WebUI 已知操作的 Core/用户、类型、Work/Service/Operation/snapshot ID 与时间，页面重载后按 ID 恢复查询，不保存包字节或凭证，也不声称是 Core 全局 Operation 列表；切换身份时不得混入其他用户记录。

用户 SHALL 可仅在本地 Inspect 后关闭，不需登录 Core 或被迫导入；兼容性与权限仍由 Core 在导入时检查。上传未接受前 SHALL 不虚构 Operation，错误 SHALL 区分包损坏、名称、依赖/容量、运行时与未知结果。导入/下载前 SHALL 说明 Work 包可能包含代码、配置、共享数据、Session 与凭证；浏览器只能确认发起下载时，不得宣称文件已完整落盘。界面以 Export current Work and download、Stop and export、Download this snapshot 清楚区分新导出、必要停止确认和旧包下载；进度保留真实阶段，技术详情保留原 Operation/snapshot/transfer ID。

已停止 Work 的显式导出 SHALL 在同一可收起、非遮罩的紧凑进度上下文连续完成；敏感内容提醒在交付前可见，停止确认不能被简化掉。成功快照不遮蔽导出当前内容入口；已有快照只表示其捕获时内容，不能被称为当前最新版。按明确 ID 找回 SHALL 不改选其他快照。

关闭进度 SHALL 只收起展示，同一有效身份下原一次交付意图继续，未被用户手动暂停时，ready/恢复最多自动发起一次；明确 Pause 暂停后续交付推进，Check 仅核对而不解除手动暂停，Resume 核对原结果后才继续原授权目标；提供同一已验证文件的手动保存回退，不把浏览器发起当作落盘完成。账号/Core 切换、注销、本地授权失效撤销该自动交付，重载后只恢复查询和用户显式下载，不增加持久后台队列。

原 Export 入口 SHALL 直接建立明确新导出意图，不先展示另一个必点 Export 按钮。默认进度/结果 SHALL 只展示当前 Work、阶段、错误及必要恢复动作；技术 ID、旧快照和诊断动作按需展开，长 ID 不覆盖标签。非遮罩面板 SHALL 不限制背景操作和 Tab；背景动作收起展示而不取消交付，切换模态窗口仍按原焦点与风险规则。

#### Scenario: 导出结果不成为第二个主流程
- **WHEN** 用户选择停止态Work的Export，随后查看结果或继续操作工作区
- **THEN** 无第二次导出确认即可生成/校验/发起下载；紧凑进度不遮罩，成功只称Download started并保留同一文件手动下载，技术详情和旧包默认折叠

#### Scenario: 运行中的 Work 申请导出
- **WHEN** 用户在 ready 或正在停止的 Work 选择 Export
- **THEN** running 时显示一次必要的 Stop and export 影响确认，确认前不停止；确认后待真实停止才沿原目标生成/校验/发起下载。stopping 时观察原停止且不重复 Stop，停止未确认无 Export/半成品下载

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

#### Scenario: 一个明确目标完成停止态导出
- **WHEN** 用户对已停止 Work 选择导出当前内容并下载
- **THEN** 生成、校验和发起下载连续完成，用户不必跳 Operation 再点 View package/Download，阶段/错误/原身份仍可查看

#### Scenario: 收起与身份切换有不同结果
- **WHEN** 用户收起下载进度，或在准备时切换账号/Core
- **THEN** 普通收起仍按原有效交付单次发起并标明原 Work；身份切换撤销旧自动交付且无内容泄漏，均不伪称文件落盘

### Requirement: 文件表单、传输和外部客户端连接可完成任务

**Identifier:** DUL-015

在 DUL-005 基础上，原型 SHALL 展示 New folder、Rename、同 Work Move/Copy 目的地、文本 Save/Discard、上传逐文件结果、Download、覆盖和递归删除确认、`207 Multi-Status` 部分失败路径与未知写入重读。二进制/超出编辑限额文本 SHALL 提供下载替代，特殊项 SHALL 按真实类型说明限制，workspace 根 SHALL 受保护；无锁/ETag 时不得承诺自动合并，不暗示目录 ZIP 下载或跨 Work 修改。具体编辑限额 SHALL 在后续实现设计中确定并作为可见拒绝原因。

文件主区域 SHALL 先展示 Work 归属和当前位置，以紧凑更多命令菜单提供 Upload/New folder，再按名称、类型、大小与状态组织列表；常规工具栏只保留一个 Refresh，选中项动作紧邻目标。目录操作的成功与失败路径 SHALL 分别呈现；符号链接/特殊项不得作为普通文件直接编辑，根目录不得删除、移动或重命名。文本离开确认提供 Save file、Discard、Keep editing，取消不写入；外部客户端连接放在辅助区域。

Connect with WebDAV SHALL 是独立客户端的可选辅助流程，使用现有 CLI proxy、完整 Work ID URL 和临时 Basic，展示启动方式、用户名、端口和临时密码获取/有效期说明。密码从启动终端一次获取，SHALL 不进入普通文件页面、URL、页面脚本或持久记录；浏览器 Files SHALL 无需执行此手工连接流程。文件能力缺失 SHALL 局部反馈，不把仍可用 Service 一并禁用。

New folder/Rename SHALL 可直接在名称字段输入并用普通 Enter 提交合法非 busy 动作；输入法组合不提交，Rename 预填原名并保留扩展名，取消不修改。上述快捷键不扩展到危险/覆盖确认。文本编辑工具栏 SHALL 可直接下载已保存版本，不自动保存草稿。文件失败/未知/部分成功结果 SHALL 在当前操作弹层内显示到具体路径并给出安全下一步，不能只提示查看被弹层遮挡的结果；成功项不盲目重复，未知先核对。

Files 的 Upload/New folder SHALL 收入可键盘访问的更多命令菜单，常规 Refresh 不在更多菜单重复；已有 WebDAV 与空文件夹引导保持可达。刷新等待 SHALL 融入原图标控件、成功恢复普通图标并保持工具栏、文件行几何稳定，不新增成功状态行或重复toast。刷新失败/未知 SHALL 保留所属对象可理解的原因与恢复，不删除必要错误或自动重放写入。

#### Scenario: 编辑与覆盖
- **WHEN** 用户编辑文件、选择离开或覆盖已有目的文件
- **THEN** 对应确认显示准确目标，取消不写入；无锁/ETag 的并发限制不被自动保存文案掩盖

#### Scenario: 目录操作部分失败
- **WHEN** COPY/MOVE/DELETE 返回逐路径部分失败
- **THEN** UI 呈现已完成和失败项，刷新核对实际目录，不声称整体回滚或全部成功

#### Scenario: 使用外部文件工具
- **WHEN** 用户选择 Connect with WebDAV
- **THEN** 知道如何使用现有 proxy 输出及临时凭证，重启密码失效有说明；回到 Files 可继续使用浏览器内操作

#### Scenario: 文件改名只需修改已有名称
- **WHEN** 用户打开文件 Rename，编辑原名后按普通 Enter，或处于中文输入法组合
- **THEN** 分别提交一次合法名称，或仅确认候选不提交；原后缀可保留，错误后输入仍在，危险确认没有通用 Enter 提交

#### Scenario: 打开文本后直接下载已保存版本
- **WHEN** 用户在文本编辑器中有未保存草稿并选择下载
- **THEN** 下载服务器已保存版本，草稿不变且不产生 Save file 请求

#### Scenario: 当前弹层说明逐路径结果
- **WHEN** 文件操作明确失败、部分成功或未知而弹层仍打开
- **THEN** 结果与具体原因就在弹层内可读，恢复指向原路径，不要求先关闭才能找错误且不自动重复成功项

Files全部成功的非空路径批次 SHALL 使用短暂自动消退Toast，不在列表上下重复常驻成功Alert或Transfer results；混合、失败、unknown与回读失败保留必要逐路径证据和恢复。Files SHALL 移除常驻Shared workspace宿主路径说明行，WebDAV功能归现有更多菜单的次级命令，当前路径面包屑保留。

#### Scenario: 文件工具栏压缩且刷新原位反馈
- **WHEN** 用户刷新已有文件列表、打开更多命令菜单上传/新建，或连续多选后清空
- **THEN** 仅一个常规Refresh，等待/成功不增加行或推移文件目标，Upload/New folder和WebDAV仍可达；失败与未知仍有安全下一步

## ADDED Requirements

### Requirement: 浮层按交互职责选择容器

**Identifier:** DUL-OVERLAY-ROLE-001

Desktop SHALL 使用Dropdown承载一组命令、Popover承载Service/模型选择与简单设置、Modal承载必要阻断决策或独立子任务、Drawer承载持续Service管理与详情。Tooltip只解释元素。Dropdown/Popover SHALL 锚定实际触发控件、适配视口、无背景遮罩或焦点陷阱；外侧点击保持原目标动作，Escape恢复合法触发器，Dropdown支持方向键/Home/End和Tab离开。身份/上下文失效不得保留旧对象动作，现有危险确认和写入保护不变。Modal SHALL 继续立即开关，不引入动画。

#### Scenario: 选择Service不打断工作区
- **WHEN** 用户点击Service Header名称选择Service
- **THEN** 在该名称旁打开Popover，保留真实状态和选中项，技术端口归详情；外侧导航一次即可生效，草稿及同一Service iframe保留，不自动启动Service

账号、Work、Agent、Service及文件对象Dropdown的明确命令行 SHALL 使用一致的前置装饰图标与可读文字，包括Agent布局和浏览器全屏分支；属性值列表、提示文字及普通Dialog footer不适用此图标要求。

#### Scenario: 更多命令与持续管理使用正确容器
- **WHEN** 用户打开账号/Work/Agent/Service/文件更多操作，或进入Service详情
- **THEN** 分别使用键盘可操作的Dropdown或持续侧栏；删除/停止确认仍阻断且不继承轻触关闭

#### Scenario: Service Header原位切换Chat
- **WHEN** 用户在宽屏或窄屏切换Show/Hide Chat
- **THEN** 同一个Service Header控件原位显示正确状态，Work导航不重复该按钮，窄屏可恢复Service且不重建iframe或丢草稿
