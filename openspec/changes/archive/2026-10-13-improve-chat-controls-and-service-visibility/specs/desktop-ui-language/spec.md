# Spec Delta

## MODIFIED Requirements

### Requirement: Work 打开后直接进入 Service 与 Agent 工作区

**Identifier:** DUL-002

Desktop SHALL 以独立 Work 列表为首层；打开 Work SHALL 进入该 Work 专属面板，常规布局顶部持续显示 Work 名称、真实状态、返回列表和生命周期操作，侧边 SHALL 不列其他 Work。若有可访问 Service，默认 SHALL 优先显示上次选中且仍可用的 Service，否则显示一个已就绪的默认 Web 入口；其真实可交互页面为主区域，Agent 当前 Session 对话为可输入的辅助栏。没有可访问 Service 且 Work 对话准入成功时，Agent 对话 SHALL 成为主区域并解释 Service 空态或不可用原因；Work 停止时 SHALL 显示启动与历史保留提示，不承诺读取 Session/Run。Desktop SHALL 不设置必须先经过的 Work 总览页。多个 Service SHALL 能在 Work 内切换并看到各自状态；聊天可聚焦为主区域，返回后恢复 Service/端口选择、当前 Session 及 Desktop 自己的阅读位置和非敏感草稿；任意 Service 网页内未保存表单、滚动和跨窗口同步 SHALL 不被外壳作通用保证。Service 可弹出独立窗口，Work 对话仍保留。Work 身份栏下 SHALL 有 Services / Files / Chat 同级入口及明确的 Settings，Workspace files 与设置 SHALL 在同一 Work 中打开；文件主区域可保持 Agent 辅助栏。Run、Operation 与日志按所属对象打开详情。

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

模型选择、Service 处理记录与证据 SHALL 进入既有 Agent 辅助栏、聚焦 Chat 和对象详情；脑包编辑与候选状态 SHALL 进入 Files / Settings 的 Pi Packages。入口不得新增必须先经过的总览；常规布局保持 Service 主区域、Services / Files / Chat 同级导航、单一 Session 输入上下文及返回规则。

Service 工具栏 SHALL 提供 Focus 进入当前 Work 的专注布局。专注布局 SHALL 隐藏常规 Work 身份栏、模块导航及全局低频动作，以紧凑工具栏保留当前对象身份、真实状态、Exit focus 和布局切换入口；仅 Chat 时由 Agent 头部承接可见退出动作；默认保留同一当前 Chat，Hide chat 进入仅 Service 视图。此布局是常规导航规则的明确例外，返回 SHALL 恢复原 Work、模块及对象选择。仅改变布局 SHALL 不改变应用 origin、不重载同一 Service/端口的 iframe、不创建 Session、不停止观察或执行；任意应用自身刷新、跨窗口同步和网络故障仍不属于外壳保存保证。Settings、Files 或其他模块导航 SHALL 先恢复常规布局，再沿原返回规则打开。
Focus chat SHALL 从常规或 Service 专注布局放大同一 Session，Restore layout 返回放大前区域或专注布局，Exit focus 直接恢复首次进入专注前常规区域。两者目标可辨且持续可见，不依赖被隐藏的 Service 工具栏，不将返回统一固定为 Services。返回保留用户在专注期间明确作出的对象选择；失效对象给真实原因与可用出口。

当前 Service 存在已确认的请求记录时，Desktop SHALL 在现有 Service 工具栏右侧操作区、Focus/独立打开等访问动作之前显示 Agent requests 按钮。确认没有记录时 SHALL 隐藏该新增按钮，不预留空白区域；已完成、已取消和 historical 记录仍属于存在记录。该入口 SHALL 不附带计数、摘要条、最近状态卡或额外顶层导航；初次读取未确认及读取失败不得被表述为真正空集合，已确认存在记录时读取失败 SHALL 保留入口及既有错误恢复。

Agent requests SHALL 复用既有请求列表与对象详情，默认范围为当前 Work 和当前 Service，不按网页端口拆分；Chat 中原有全 Work 请求入口保持可用。Service + Chat 和仅 Service 专注布局中，符合显示条件的按钮 SHALL 保持可达；仅 Chat 布局使用原 Agent 请求入口。打开、取消后的刷新及关闭 SHALL 保持同一 Service iframe、当前用户 Session、草稿和阅读位置；返回及键盘焦点按 DUL-007 恢复，不创建第二个输入上下文。

请求详情读取失败时，Desktop SHALL 在原容器保留同一请求最后确认的回复与执行信息，并叠加读取失败及最后确认时间；首次没有取得内容与已有内容暂时无法刷新 SHALL 分开表达。列表取消中的记录 SHALL 在原列表或对应详情可见时核对真实收尾，更新原记录而不重置分页、过滤或阅读位置；关闭只停止观察，不改变远端取消。

证据分页的晚响应 SHALL 不覆盖同一请求较新的已确认状态、结果或回复关联。已确认终态后补齐证据及返回列表 SHALL 保持该终态、原分页和返回上下文，不重新显示 cancelling，不改变原取消收尾观察标记，也不重发取消。

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
- **THEN** 工具栏中的 Agent requests 与 Exit focus 仍可操作，必要时工具栏换行，不另建页面；仅 Chat 时原 Agent 请求入口仍可达

#### Scenario: 读取失败不伪造空态
- **WHEN** 已确认有记录后请求读取失败，或首次读取尚未确认
- **THEN** 前者保留按钮并沿既有错误恢复，后者不展示虚构记录或空状态卡，均不将读取失败说明为没有请求

#### Scenario: 回复读取失败后仍可阅读最后确认内容
- **WHEN** 用户已读到原请求的 Agent 回复，再次读取对应 Run 失败
- **THEN** 原回复和实际执行信息仍可读，读取错误与最后确认时间可辨，不伪造没有回复或改变 Main Chat

#### Scenario: 晚到证据页后返回列表仍显示终态
- **WHEN** 用户在取消中的请求详情翻页，状态核对先确认 cancelled，而旧证据页随后返回，用户再返回原列表
- **THEN** 证据正常追加，详情与列表仍显示 cancelled，原分页、过滤、焦点、阅读位置、Main Chat 草稿和同一 Service iframe 保持，不重新请求取消

### Requirement: Session 与 Run 的交互完整且不重复执行

**Identifier:** DUL-012

原型 SHALL 展示当前 Work 的 Session 列表、新建、读取/切换和对话提交，以及 accepted/running/cancelling/succeeded/failed/cancelled/interrupted。Session 标题 SHALL 来自已加载首消息摘要或创建时间/ID，不假定现有接口支持持久 title/改名。一个 Work 的活跃 Run 限制 SHALL 在其他 Session 中有 busy 说明并保留草稿，不能暗示隐藏队列。

Cancel run SHALL 是明确请求，取消中保留状态直至终态；切换、关闭或断线不等于取消。观察恢复 SHALL 使用原 Run ID/游标，过期读结果/历史，未知不得自动重发 prompt。旧 context 导致 Session 不可用 SHALL 给原因和 New session，不能自动迁移或承诺仍可继续。stopped Work SHALL 不被承诺可以加载 Session/Run；之前加载的消息可标注为旧内容。

Chat SHALL 表达模型选择只作用于下一次新手动 Run，展示每次 Run 实际模型与用户/Service 来源。自动请求的 pending、等待、验证及终态 SHALL 与 Run 执行状态分开呈现：等待不是模型一直运行，不是手动消息隐藏队列。Cancel run 与 Cancel request SHALL 分别解释取消当前执行及直接取消请求的范围；取消有关联请求的 Run 也终止原未完成请求的后续自动处理。

当前用户 Chat 有可发送的模型输入、且同 Work 存在已确认活跃 Run 时，支持该能力的 Desktop SHALL 在原发送按钮位置提供 Stop and send，目标为用户点击时明确绑定的旧 Run。用户显式提交才请求取消，取消可以针对本 Session、其他 Session 或 Service Run，仍在用户所选 Session 发送新消息。未显式执行该动作、仅切换或输入时 SHALL 保持既有 busy 与草稿规则。取消关联未完成请求后 SHALL 不自动恢复原处理，历史与已产生业务结果保持。

取消等待和提交 SHALL 在当前输入区表达，失败或取消等待超过 5 秒时保留待发内容并提供原状态核对，不把请求取消当作已经停止，不在超时后自动发送。普通发送、网页 slash 动作、模型设置、输入法与观察恢复 SHALL 保持原语义；旧 Agent 未确认新能力时保留原 Cancel run 及普通聊天，不暗中替换运行镜像。

Chat 正文 SHALL 不再附加按 Run ID 罗列的 Run History 列表；每次 Run 的实际模型、Thinking、来源及必要执行诊断 SHALL 通过可确认关联的按需详情保持可查。删除该展示不删除历史、不隐藏正在执行、错误或未知结果，不把历史详情的打开变成 Session 切换或新提交。

全 Work 活跃执行的来源与停止目标 SHALL 和当前用户 Session 的执行反馈分开展示。另一 Session 或 Service 占槽时，当前 Chat 原 Run 的失败、观察中断和未知提交反馈 SHALL 继续在所属输入上下文可见；核对和详情 SHALL 绑定该原 Run，Stop and send 仍只针对用户明确看到的全 Work 活跃目标。不得因为显示后台活动而移除用户错误、切换用户 Session 或将原恢复动作改绑到后台 Run。

#### Scenario: 跨 Session 遇到忙碌
- **WHEN** 同一 Work 已有活跃 Run，用户切到另一个 Session 输入
- **THEN** 看见忙碌原因、草稿与已知活动执行入口，不隐式取消原 Run 或排队新 Run

#### Scenario: 观察连接丢失
- **WHEN** 回答中连接中断
- **THEN** 显示观察中断和最后确认时间，Check status/恢复观察针对原 Run，不把执行标为失败或再次提交

#### Scenario: 取消与成功竞争
- **WHEN** 用户请求取消但 Core/agent 已记录成功终态
- **THEN** 显示真实成功，不把它强制改成取消；取消中仅在尚无终态时显示

#### Scenario: 处理记录与模型执行区分
- **WHEN** Service 请求正在等待且没有活跃 Run，用户查看 Chat
- **THEN** 可识别请求等待对象、最近确认时间和各历史 Run 的真实模型，仍可输入新手动消息

#### Scenario: 明确停止旧 Run 后发送
- **WHEN** 用户在当前 Session 输入有效消息，并点击指向同 Work 另一 Session 或 Service Run 的 Stop and send
- **THEN** 输入区显示取消等待，确认旧执行收尾后只提交一次新消息到当前 Session，原历史保留且被取消请求不自动恢复

#### Scenario: 导航与网页命令不取消 Run
- **WHEN** 用户切换 Session、编辑草稿，或执行 /new、/resume、/model、/thinking、/settings
- **THEN** 沿用原导航与设置语义，没有隐式取消或模型提交

#### Scenario: 正文简化且执行依据仍可查
- **WHEN** 用户读取包含多个 Run 的 Session
- **THEN** 正文没有 Run History ID 列表，消息与 Activity 顺序保持，真实实际模型、来源和错误可按需查看，旧关联未知时不猜测归属

#### Scenario: 后台活动不覆盖当前对话错误
- **WHEN** 当前用户 Session 的原 Run 失败或观察中断，同时另一个 Session 或 Service 有活跃 Run
- **THEN** 当前 Chat 保留原错误及原对象核对入口，同时显示后台来源和指向该后台 Run 的 Stop and send，两类动作不混用目标
