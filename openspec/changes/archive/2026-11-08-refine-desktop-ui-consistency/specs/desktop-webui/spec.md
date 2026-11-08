# Spec Delta

## MODIFIED Requirements

### Requirement: Service 管理与数据上下文清楚分离

**Identifier:** DWUI-005

Desktop SHALL 实现 DUL-004、006、013：Service 列表/详情包含禁用、失败、非 Web 服务，提供公开域名/端口、Start/Stop/Restart/Retry/Remove 和有界日志刷新，访问行为遵循 `browser-service-access`。Stop 是持久禁用，Start 不启动停止的 Work，Remove 保留共享文件且无法以 Start 撤销。日志 SHALL 显示取得时间、截断及不可用原因，不伪装实时终端。无效动作说明原因，控制完成以原 Operation 为准。

所选 Service SHALL 只提供明确的身份上下文，不自动读取或上传页面 DOM、输入、截图和内存。用户请求分析时 SHALL 通过 Agent 的实际文件/API 能力取得数据，并要求回答说明来源；无来源时说明不可访问，不声称浏览器已同步数据。现有 Service 创建/定义更新仍由 Agent 工作流完成。

Pi 开发且实现交互契约的 Service SHALL 可以主动记录页面路径和业务动作，并向 Agent 提交显式请求；这些事实由 Service 的事件/API 提供，不是 Desktop 对任意网页的监听。Service 详情和 Work 请求检查面板 SHALL 能查询该 Service 的处理记录、事件来源和证据；仅有普通事件不启动自动 Run。未接入契约的外部 Service SHALL 只显示平台已经确认的状态、日志、可访问性以及 Agent 实际读取到的外部信息，不声称掌握其内部用户操作。

打开 Service 详情 SHALL 先呈现该对象已知身份、状态和按真实准入可用的控制，日志作为独立内容加载。日志慢响应或失败 SHALL 仅影响日志区域，提供日志重试及取得时间；不得阻止进入详情或把合法控制一并隐藏。旧 Service/身份的日志晚结果不能覆盖当前对象。

Starting、Failed、Disabled 和无 Web 入口 SHALL 分别说明真实原因；仅已确认未启用才使用 Disabled 解释。用户 Start/Restart/Retry Service 后 SHALL 保留原 Service 上下文和原 Operation 入口，结果确认后可返回该 Service，并在真实浏览器入口可用时提供 Open Service。详情/处理记录关闭使用 Close，真正取消请求仍使用 Cancel request，不混淆关闭观察与业务取消。

Service 选择器 SHALL 将应用切换和原管理能力纳入同一锚定 Pop，使用确认的名称、observed、enabled、声明 Web 端口及明确管理目标；单端口轻显示，多端口选择归对应详情，非 Web/Removed 对象不伪造应用入口。管理一个 Service 不自动切换当前应用，控制及日志绑定该确切对象。返回、布局和只读刷新保持当前 Service/端口与 Chat，晚准备结果不覆盖新选择。不可用服务仅选择并解释原因，不自动 Start。Service 工具栏保留原图标职责，外部打开只有一个入口，更多菜单不重复打开独立窗口、管理总列表或全 Work 请求；访问链接、详情中的可复制身份和原独立外壳兼容能力保持。

#### Scenario: 非 Web 和禁用 Service
- **WHEN** 服务没有可用 Web 端口或被禁用
- **THEN** 仍可查看详情/日志和有效控制动作，不能因为不可预览就隐藏服务

#### Scenario: 移除后文件仍保留
- **WHEN** 用户确认 Remove Service 并观察到成功
- **THEN** 服务消失但共享 workspace 不被 UI 描述为已删除，恢复定义仍需 Agent 操作

#### Scenario: 请求分析 Service 数据
- **WHEN** 用户操作应用后在聊天中请求分析
- **THEN** 明确传递 Service 身份而非页面内容，实际读取文件/API 后说明来源，数据不可达时不编造结果

#### Scenario: 两类 Service 的观测边界
- **WHEN** 同一 Work 包含接入契约的应用和未接入的外部 Service
- **THEN** 前者可显示其提供的页面路径、业务事件与请求回执，后者仅显示已经取得的外部信息，界面不自动采集两者 DOM 或输入内容

#### Scenario: 日志失败仍可管理服务
- **WHEN** 用户打开 Service 详情，日志 GET 挂起或返回 503
- **THEN** 身份与状态立即可读，符合当前准入的控制可用，日志区域有等待/错误及重试；日志重试仅读取日志

#### Scenario: 切换服务后旧日志返回
- **WHEN** Service A 日志未返回时用户查看 B
- **THEN** B 的身份、控制和日志不被 A 的晚结果覆盖，旧结果不弹回 A

#### Scenario: 服务开始运行后可继续使用
- **WHEN** Service 控制达到确认结果且入口可用
- **THEN** 当前详情保留对应对象并提供访问入口；Starting/Failed 无额外错误字段时仍不误称 Disabled

#### Scenario: 关闭请求详情不取消执行
- **WHEN** 用户在活跃 Pi request 详情点击 Close
- **THEN** 只关闭详情，未发送取消请求；只有明确 Cancel request 才改变原请求

#### Scenario: 紧凑选择器保留真实状态与端口
- **WHEN** 多个Service具有长名称、不同状态或多个声明端口，用户快速切换及用键盘关闭选择器
- **THEN** 名称/状态/端口与选中项对齐可读，焦点回触发器，只打开当前合法目标；无自动Start、未声明端口或Chat切换

#### Scenario: 在同一个选择 Pop 管理另一服务
- **WHEN** 当前显示 Service A，用户在选择 Pop 管理 Service B 并读取日志或确认停止
- **THEN** 控制和日志只绑定 B，不因全局选中项误作用于 A；原 A 应用和用户 Chat 保留，关闭观察不取消已经接受的控制


### Requirement: Service 处理记录与证据在现有工作区闭环

**Identifier:** DWUI-FEEDBACK-001

Desktop SHALL 在 Chat 及对象详情中提供当前 Work 的处理记录列表与详情，可按 Service 范围分页查看真实请求、来源事件、关联 Runs、等待对象、终态、错误和证据；证据 SHALL 表达观测时间、状态/代码版本及验证结论。分页 SHALL 使用服务端有界查询和游标，不在浏览器加载全部历史。自动 Session SHALL 可以进入现有 Session/Run 观察，不新增顶层工作流导航或独立执行控制台。

Cancel request 和 Retry request SHALL 是明确且作用域可辨的操作。取消 SHALL 阻止后续自动 Run；重试 SHALL 使用稳定的新 submissionKey 生成关联原请求的新请求，而不是复用未知结果的 Action。响应丢失 SHALL 查询原请求/提交结果，不自动生成第二次重试。导入的 historical 请求 SHALL 展示历史标记并禁用直接 Retry；用户可另行明确提出新的目标。Stop/Apply/Delete 准入失败 SHALL 显示真实原因，不暗中 Start、Apply 或取消其他 Run。

该工作区 SHALL 延续 master 的本地反馈、对象级锁、关闭只停止观察、跨身份清除及已受理 ID 恢复规则；页面状态刷新 SHALL 不重载 Service iframe。处理记录是领域记录，SHALL 不混入通用 UI 读取成功流水；请求状态未知 SHALL 显示最近确认值与 Check status，不能猜测成功或失败。

Desktop SHALL 从当前 Work 的 Chat 辅助菜单提供唯一 Agent 请求入口，不再在 Service 工具栏或 Work 更多菜单重复。用户打开后使用有界 Work 查询和显式 Service 来源过滤确认数据，筛选不按网页端口拆分；确认空集合、初次未确认和读取失败分别表达。没有记录时不新增空态工具栏按钮或占位，有记录也不增加计数、摘要条、顶层导航或自动弹窗。请求观察仅在相应检查上下文可见且当前身份/Work 允许查询时按既有规则进行。

该入口 SHALL 复用现有请求列表与详情，默认范围为原 Work；用户可显式筛选某个 Service，端口变化不产生另一份请求范围。列表展示目标、来源、更新时间、真实状态及原可用动作；详情先显示目标/结果/等待或错误，再按需读取执行、证据和技术身份。无回复、读取失败、业务目标未完成及某次 Run 已结束分别表达，不取其他请求回复，不用 Run succeeded 冒充请求完成。关联回复只来自原请求已确认的 runIds，不展示共用 Session 的无关历史。

合并入口仅改变发现位置，不增加补充对话或第二个输入框。既有 Work 级显式 Retry 及其准入保持，来源过滤不增加动作权限，不为请求自动重试。pending 或等待的 live 请求可按原规则取消，执行中保持 cancelling 直到真实收尾；终态完成先提交则保留原结果，historical 只读。取消 Agent 处理不撤销已提交业务 Job 或数据。

列表/详情的查看、分页、状态刷新与关闭 SHALL 不修改用户 Session 选择，不重载同一 Service iframe，不启动 Run。关闭详情返回原请求列表及其过滤、阅读位置，关闭列表返回发起入口并恢复焦点；Work/Core/账号切换使旧响应失效。读取或取消未确认 SHALL 沿既有错误与原请求 Check status 恢复，不自动重发消息或新建请求。

同一身份、Work 和原请求范围内，关联 Run 读取失败 SHALL 保留该 Run 最后确认的回复、实际模型与 Thinking，并显示读取错误及最后成功读取时间；首次未取得回复、已取得后刷新失败及其他 Run 成功刷新 SHALL 分别表达。部分失败不得清空其他已确认回复，不得使用其他请求缓存填充内容；关联仅以该原请求当前确认的 runIds 为准。

原 Chat 显式 Retry 的接受响应未知时，Desktop SHALL 保留原 Work、原 requestId、原 submissionKey 和对应未知操作锁，并通过纯读取核对该次 Retry 的受理结果。确认受理时 SHALL 验证新请求属于该 Work 且 retryOf 指向原请求，展示该已受理新请求并仅解除匹配的未知锁；读取旧请求本身或另一个新请求不得视为该次 Retry 已确认。同一身份内未找到映射、读取失败或旧组件不支持时 SHALL 保留未知表达、原键和匹配锁，不自动重发 Retry、不新建键、不解除其他操作锁。身份改变 SHALL 使旧响应失效，不把旧意图或内容迁移到新身份，不以旧结果解除新身份的锁。只读核对不得唤醒处理、创建请求/Run 或隐式 Start/Apply；来源过滤不增加新的 Retry 准入。

用户在列表取消后，Desktop SHALL 在列表或对应详情可见且 Work 可查询时，对该原记录立即及正常每五秒进行有界、去重的只读收尾核对，并将最新确认状态合并回原分页缓存。确认终态后结束该记录的收尾观察；读取失败保留最后确认状态和错误恢复入口，不将取消请求显示为已取消。隐藏页面、离开该 Work 或关闭列表/详情 SHALL 停止本地收尾观察，重新打开时核对原记录，不重发取消；完成先提交时保留真实完成结果。

证据分页响应 SHALL 仅合并对应请求的证据项和分页游标，使用响应返回时该原请求的当前缓存，不以发起分页时的旧详情替换缓存。分页附带的旧请求投影 SHALL 不回写最新确认的 state、updatedAt、runIds、result、error、状态确认时间或读取错误，不据此过滤已确认回复或修改取消收尾观察标记。已确认终态 SHALL 不因晚分页回退为非终态；详情和列表继续保持同一最新确认投影，不通过重新启动收尾观察补救旧状态回写。

#### Scenario: 查看一次异步处理的闭环
- **WHEN** Service 请求从受理、Action、等待 Job、验证到完成
- **THEN** 详情关联来源事件、真实 Run/Action/Job 与结果证据，等待期间可继续手动聊天，终态能追溯验证依据

#### Scenario: 重试响应丢失
- **WHEN** 用户显式 Retry request 后失去响应
- **THEN** 保留原请求、本次 submissionKey 与对应未知锁，只读核对该键；确认后定位已受理且 retryOf 匹配的新请求，只解除匹配锁，不重发 Retry 或自动生成第二个请求

#### Scenario: 导入历史不参与自动处理
- **WHEN** 用户打开导入 Work 的来源请求与证据
- **THEN** 能完整阅读历史，直接重试不可用，Work 启动不会因此产生自动 Run

#### Scenario: 空 Service 后收到首个请求
- **WHEN** 某 Service 尚无请求，后来收到首个请求，用户从 Chat 请求面板选择该来源
- **THEN** 入口保持折叠在 Chat 菜单，不自动弹出；可见检查器的下一次正常有界读取显示真实记录，Service 工具栏没有新按钮或摘要

#### Scenario: 只有终态或导入历史
- **WHEN** 用户在 Chat 的 Work 请求面板中筛选只有已完成、已取消或 historical 记录的来源
- **THEN** 可查看原结果及来源，终态/historical 不提供取消，historical 不进入自动执行

#### Scenario: Service 范围和晚响应
- **WHEN** 用户在同一个请求面板从 Service A 来源筛选改为 B，A 的旧读取随后返回
- **THEN** A 的端口变化不产生新范围，B 只使用 B 的读取，旧响应不覆盖 B 或新的用户身份

#### Scenario: 请求回复和 Main Chat 保持独立
- **WHEN** 用户打开多个自动请求之一的详情，自动 Session 同时保存其他请求的历史
- **THEN** 只显示该请求可确认关联的回复与结果，Main Chat 的 Session、草稿及阅读位置不变，同一 iframe 不增加文档加载，没有新模型提交

#### Scenario: 取消等待或正在处理的请求
- **WHEN** 用户在 Chat 的 Agent 请求检查器中取消一个 pending、waiting_result 或 running 的 live 请求
- **THEN** 无活动执行时按原请求取消，执行中先显示 cancelling，确认后才显示 cancelled 并阻止续接；原业务 Job 与已提交结果继续表达自己的状态

#### Scenario: 取消回执或查询失败
- **WHEN** 已有记录的刷新失败，或取消返回结果未确认
- **THEN** 原入口、请求身份和最后确认内容保留，现有错误与 Check status 可用，不把失败显示为无记录或已取消

#### Scenario: 只读详情关闭与专注布局
- **WHEN** 用户在 Service + Chat、仅 Service 或360px布局需要查看/取消请求并返回
- **THEN** 经现有 Show chat/模块导航访问唯一 Chat 请求入口；返回和当前布局出口可达，Service iframe、当前 Session、草稿与焦点保持

#### Scenario: 已确认回复的重新读取失败
- **WHEN** 原请求已有可见回复和实际执行信息，重新读取对应 Run 返回错误
- **THEN** 保留最后确认内容并标明读取失败和最后确认时间，不改成未取得回复，不加载其他 Session 全部历史

#### Scenario: 多个关联 Run 部分读取失败
- **WHEN** 同一请求的多个已确认关联 Run 中，一部分刷新成功而另一部分刷新失败
- **THEN** 成功部分更新，失败部分保留各自最后确认内容并说明错误，不相互覆盖且不串入其他请求回复

#### Scenario: Retry 核对尚未确认或旧组件不支持
- **WHEN** 原 Retry 回执未知，按原键查询未找到映射、失败或报告不支持
- **THEN** 保留原键、未知结果和匹配锁，可继续只读核对，不把未找到视为失败，不发送 Retry POST 或自动更新镜像

#### Scenario: Retry 核对范围失配或晚响应
- **WHEN** 核对结果的 Work、原请求或提交键不匹配，或用户已切换身份/Work
- **THEN** 不采用该结果、不解除当前或其他操作锁，不展示另一作用域内容、不触发新的执行

#### Scenario: 列表取消跟踪真实终态
- **WHEN** 用户在列表取消 running 请求，收到 cancelling 后原执行实际收尾
- **THEN** 可见列表在下一次正常只读核对后更新为原真实终态，取消动作随终态禁用，分页、过滤、阅读位置、Main Chat 和同一 iframe 保持

#### Scenario: 关闭列表停止收尾观察
- **WHEN** 列表取消中的原请求尚未收尾，用户关闭列表或隐藏页面后再打开
- **THEN** 离开时停止本地周期读取而不撤销远端取消，重新打开只读核对原记录，不重发 Cancel 或新建请求

#### Scenario: 证据分页与取消终态核对并发
- **WHEN** More evidence 已读取 cancelling 的旧请求快照但响应延迟，原 ID 状态读取先确认 cancelled 并结束收尾观察，然后旧分页响应返回
- **THEN** 只将该页证据和游标合并到当前缓存，详情及各列表缓存保持 cancelled、最新结果、错误和 runIds，取消观察标记不被旧页改变；返回列表并经过正常刷新周期仍保持终态，只有一次 Cancel 且没有新 Run

### Requirement: Service 专注视图与浏览器全屏有独立且可恢复的状态

**Identifier:** DWUI-FOCUS-001

Desktop SHALL 在可嵌入 Service 的工具栏提供 Focus，进入填满当前浏览器内容区域的 Service + Chat 布局，隐藏常规导航。Hide chat / Show chat 在同一专注布局切换仅 Service 或 Service + Chat，聊天仍为当前 Session。Exit focus SHALL 始终可达并恢复进入前的常规区域、对象选择、草稿、阅读位置和焦点来源。没有可嵌入 Service、尚未取得入口、明确禁止嵌入或入口失败时 SHALL 给出对应等待/原因与既有独立打开入口，不将 Focus 变成绕过嵌入限制的方法；可保留当前视口的未确认预览仍可进入 Focus，并继续显示真实未知状态。

Focus chat SHALL 从常规区域或 Service 专注布局放大同一 Chat；Chat Header 只显示一个当前适用的 Focus/恢复/退出控件，不在更多菜单重复。仅 Chat 中恢复放大前常规区域或专注布局；目标已是常规布局时不另显示等效退出按钮。先进入 Service 专注再放大 Chat 时，先恢复原专注布局，再由已可见的 Service Header 退出到首次常规区域。窄屏已占满内容的 Chat 使用当前层级适用的恢复/退出动作。各层退出路径可见、可通过键盘完成；内部切换不覆盖最初返回目标，普通 Chat 模块不等同于 Focus chat。

仅因 Focus chat 及恢复改变布局 SHALL 保持同一 Service iframe/祖先和 Chat 节点连接，隐藏而不卸载、不改 src、不重取入口；正常跨模块导航仍按原规则处理。用户明确切换 Service/端口或 Session 后返回保留该新选择，失效对象给原因且仍可退出。退出与恢复以现有图标按钮和所选界面语言的准确 tooltip/无障碍名表达，不藏在溢出菜单。

Full screen SHALL 是专注工具栏中的额外、明确用户动作，使用当前同一视图。浏览器不支持、拒绝或退出全屏时 SHALL 保留可用的专注布局并给出就地说明。浏览器 Esc 退出全屏只取消全屏状态，不自动退出专注或丢失数据；Exit focus 在本视图全屏时先请求退出，再恢复常规布局。普通专注视图中，外壳取得键盘事件且没有优先菜单/弹层时 Esc 可返回；跨源应用内部键盘事件不能保证传给外壳，始终保留返回按钮。

进入、隐藏 Chat、退出全屏和返回 SHALL 不重建同一 Service/端口视口、不重置 Chat、不中断 Run 观察、不改原访问 origin、不产生 Apply/Start/Stop。仅在明确选择另一 Service/端口或服务真实失去资格时沿原访问规则转换，状态变化不伪造应用成功。专注仅为当前页面临时状态，不写入 Work 配置，不复制为另一个 Session，不影响独立窗口。

窄屏无法同时容纳 Service 与 Chat 时 SHALL 用可关闭的 Chat 覆盖层；Show chat 打开同一会话，关闭恢复 Service，焦点按来源恢复。隐藏 Chat 时 SHALL 以紧凑提示表示当前 Run 进行中、失败或观察未知，不重复自动弹出 Chat。弹层、菜单及覆盖层 SHALL 遵守明确键盘优先级和可见焦点；360px 下返回和显隐动作仍可用。

#### Scenario: 同一应用和对话切换布局
- **WHEN** Service 页面已填写未保存内容，Chat 有草稿，用户进入 Focus、隐藏并显示 Chat、返回
- **THEN** 同一 iframe 没有再次文档加载，应用输入保留，Session、草稿、展开选择和阅读位置保持，没有新提交或停止请求

#### Scenario: 浏览器全屏失败与 Esc
- **WHEN** 用户请求全屏被拒绝，或成功后按浏览器 Esc
- **THEN** 前者解释无法全屏且专注仍可用，后者回到专注；Exit focus 始终能恢复常规布局

#### Scenario: 服务不可预览或执行仍进行
- **WHEN** Service 无入口/禁止嵌入/真实停止，或 Chat 隐藏期间 Run 仍在执行
- **THEN** 显示真实访问原因和回退，隐藏聊天不改变 Run；进行中、失败和未知可从紧凑提示辨认

#### Scenario: 窄屏及弹层键盘
- **WHEN** 用户在窄屏显示 Chat 并打开命令菜单，再按 Esc
- **THEN** Esc 先关闭菜单，再关闭 Chat 覆盖层，返回按钮仍可达；浏览器全屏退出与布局返回不混为同一动作

#### Scenario: 从专注进入其他模块
- **WHEN** 用户在专注中的 Chat 执行 /settings，或选择打开 Files
- **THEN** 先恢复常规布局再打开目标，按原返回位置回到 Work；恢复专注本身不重载视口，模块导航继续遵守原容器规则

#### Scenario: Focus 与 Focus chat 完整往返
- **WHEN** Service 有未保存表单且 Chat 有草稿，用户依次进入 Focus、Focus chat、Restore layout、Exit focus
- **THEN** 每一步有可见出口，恢复回原专注布局，退出恢复常规导航，同一 iframe/Session、表单、草稿、阅读位置及 Activity 展开保持，无重复文档加载或业务请求

#### Scenario: 仅 Chat 直接退出
- **WHEN** 用户从 Service 专注放大 Chat，再使用头部唯一恢复控件
- **THEN** 先恢复真实来源的 Service 专注布局，继续从该布局可见的退出动作回最初常规区域；没有两个等效 Focus 按钮，不固定跳往 Services

#### Scenario: 返回目标随来源确定
- **WHEN** 用户从常规 Files、常规 Chat 或仅 Service 专注进入 Focus chat 并恢复
- **THEN** 分别恢复原常规区域或仅 Service 专注布局，当前 Session 与未保存内容保持，重复放大不丢返回目标

#### Scenario: 仅 Chat 的全屏与异常出口
- **WHEN** 仅 Chat 中菜单打开、浏览器全屏，或 Work/Service 失去资格
- **THEN** 菜单、浏览器全屏与布局遵守逐层键盘返回；当前恢复/退出控件持续可见，真实异常可读且退出不发业务修改


### Requirement: Work 行只展示当前状态及有效操作

Work 列表 SHALL 根据当前确认的 observed 状态及目标显示对应状态和安全快捷动作，启动恢复中 SHALL 自动更新；上次运行保存的 Ready 或 Stopped 在当前恢复尚未核实期间 SHALL 标识未确认或恢复中，不能宣称当前已就绪或已停止。已终结的 Create、Start、Retry 等历史 Operation SHALL 不常驻 Work 行状态旁，也不得作为已无当前处理义务的失败条目堆在 Work 命令菜单中，仍可在该 Work 的操作记录与原详情中查看；未完成或未确认操作保留原身份、必要的检查入口和安全约束。读取 404 SHALL 按被查询对象表明未找到或状态未确认，不推断业务操作失败，也不能据此错误移除 Work。

#### Scenario: Core 重启自动恢复
- **WHEN** 原目标为 running 的 Work 在 Core 重启后等待恢复、启动并最终确认 ready
- **THEN** Core 恢复期间由门禁覆盖初次列表；Core 基础就绪后，列表按各 Work 实际情况展示未确认或恢复中、Starting、Ready，无需用户重复 Start 或手动刷新

#### Scenario: 自动恢复失败后重试成功
- **WHEN** 恢复尝试失败但已安排自动重试，随后 Work 恢复成功
- **THEN** 列表继续只读观察，不显示最终失败或 Retry，并自动更新为 Ready；重试耗尽则显示失败及恢复操作

#### Scenario: 历史操作已经结束
- **WHEN** 旧 Create 或 Start 已成功且 Work 当前状态发生改变
- **THEN** 行仅展示当前状态与动作，旧操作仍可在记录中查询，不附带历史成功文本

#### Scenario: 原操作查询 404
- **WHEN** 某个原 Operation 查询返回 404 而 Work 查询仍可用
- **THEN** 说明该 Operation 查询结果并保留 Work 当前事实，不将其呈现为 Work 失败

#### Scenario: Work 已恢复且菜单包含多条旧 Retry
- **WHEN** Work 当前目标与新鲜状态已确认收敛为可用，多个旧 Retry 已核实终结且无当前待确认义务
- **THEN** 行只显示当前对象状态与适用动作，通过该 Work 信息中的高级记录入口保留每条原失败结果，不逐条常驻 Check progress，不把失败改成成功

### Requirement: Work 当前任务与已结束操作历史分别呈现

**Identifier:** DWUI-OPREC-004

Desktop SHALL 在所属 Work 信息的高级“操作与诊断”上下文提供已知原操作的动作、结果、时间、原 ID 与详情，区分当前任务及已结束历史；Work 行和详情的命令菜单不再直接列 Operation history，不提供全局或跨用户历史发现。当前需要处理的任务仍经原对象状态/任务入口访问，不把每条历史操作的进度、检查和详情铺在菜单中。共有 Work 菜单保留设置、信息、Export 及合法生命周期命令。原快照找回由 Work 信息的高级恢复入口进入同 Work 的既有独立导出恢复上下文，不再直接列 Find a previous export，也不把技术 ID 或旧快照诊断塞进仅进度的 Export Details。入口移位不得删除记录、原查询能力或协调保护。

当前任务 SHALL 包括已接受仍在执行、提交结果未知、原对象或同步尚未确认，以及明确失败且仍对应当前控制问题的任务；多个未决任务 SHALL 各保留原身份，不凭时间选择一个覆盖其他任务。已结束且当前没有匹配处理义务的任务 SHALL 归为历史；原 failed 结果保持 failed。Work Ready、Operation succeeded 或本地 terminal 提示中的任意单个信号 SHALL 不足以解除接受意图、Work/列表同步义务、记录保存失败或未知修改保护。旧 Start 结果不得解除新 Stop 的义务；当前状态和历史结果分别表达。

已知历史 SHALL 在同身份页面重载及重新登录后仍有入口，沿用既有记录保留数量和用户显式隐藏语义。展示分类 SHALL 不通过自动隐藏或删除原记录实现；本地终态提示仅协助恢复展示和读取安排，不替代 Core 当前事实、对象归属、目标版本或实际准入。旧格式记录逐条只读核实后收敛；不能将恢复读取期间的历史一律显示为新的失败或要求再次 Retry。身份切换使旧内容和响应失效。

已核实终结的历史详情 SHALL 主要提供结果与诊断，不常驻要求推进执行的 Check progress 或 Retry；当前仍需确认的对象可单独只读检查，已终结结果也可显式重新查询原 ID。未知任务 SHALL 保留原 ID 或原对象核对入口；本次未知修改未匹配确认前不得自动重发或用无关历史释放保护。历史原 Operation 返回 404/410 SHALL 说明记录无法再核实并保留适用标识，不推断 Work 失败或无限轮询。

#### Scenario: 多条旧失败转为可查询历史
- **WHEN** 同一 Work 的五条旧 Retry 已确认 failed，当前目标与 Work/列表已确认恢复为 Ready，且不存在匹配的未知结果或同步义务
- **THEN** Work 菜单不展示五组 failed 与 Check progress，操作记录仍逐条可见其原 ID、时间及失败详情，当前任务筛选不包含这些已结束记录

#### Scenario: 当前失败仍可处理
- **WHEN** 当前运行目标的最新相关任务明确失败且 Work 仍未恢复，或失败的清理仍需处理
- **THEN** 原对象表达当前失败、原因和合法恢复方向，当前任务入口仍可达；不能因任务已终态就自动移走当前问题或将其伪装为历史已解决

#### Scenario: 提交结果未知不得被历史成功解除
- **WHEN** 新 Stop 提交响应丢失，已知记录中另有旧 Start 成功且 Work 曾经 Ready
- **THEN** Stop 的原对象核对和匹配保护保留，旧成功或 Ready 不解除该义务，历史查看与重载不会再发 Start 或 Stop

#### Scenario: 多个未决任务各自保留
- **WHEN** 同一 Work 有多个来源或阶段不同的已知未决操作
- **THEN** 当前任务入口说明存在多个需核对任务，逐一提供原 ID 和检查，不凭浏览器记录时间把任一任务认作 Core 当前目标

#### Scenario: 重载不把历史再变成故障菜单
- **WHEN** 同一账号重载页面或重新登录，存在先前确认终结并已收敛的已知操作
- **THEN** 这些记录仍可在所属历史找到，必要的只读重新核实不会把它们批量恢复成当前失败菜单或影响正常 Work 准入；当前未决与旧格式记录继续按真实核对结果恢复

#### Scenario: 本地记录或读回未确认
- **WHEN** Work 显示 Ready，但原任务记录保存失败、最新控制目标未核实或 Work/列表读回仍未完成
- **THEN** 保留对应未确认说明和恢复路径，不仅凭 Ready 或终态提示收起当前问题，不删除协调依据

#### Scenario: 记录隐藏与身份切换
- **WHEN** 用户按现有规则隐藏已结束记录，或切换 Core/账号后旧查询返回
- **THEN** 隐藏只影响原记录展示且不清除当前未决协调依据；新身份看不到旧历史，晚结果不修改新身份任务、草稿和锁

#### Scenario: 原操作已不可查询
- **WHEN** 历史 Operation 查询明确返回 404/410，而所属 Work 仍可用
- **THEN** 在该历史记录说明原结果目前无法核实及适用原 ID，停止该 ID 的无限自动观察，Work 继续按自身新鲜事实显示

#### Scenario: 查看和恢复不会制造重复重试
- **WHEN** 用户打开菜单、操作记录或详情，刷新页面，恢复连接，或多窗口观察同一原任务
- **THEN** 这些行为仅做状态核对，不创建新的 Retry/Start/Stop；用户新的明确动作才按原准入受理一次
