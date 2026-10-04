## MODIFIED Requirements

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

模型选择、Service 处理记录与证据 SHALL 进入既有 Agent 辅助栏、聚焦 Chat 和对象详情；脑包编辑与候选状态 SHALL 进入 Files / Settings 的 Pi Packages。入口不得新增必须先经过的总览或改变 Service 主区域、Services / Files / Chat 同级导航、单一 Session 输入上下文及返回规则。

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

### Requirement: Agent 对 Service 数据的来源清晰

**Identifier:** DUL-006

Desktop SHALL 将选中 Service 仅视为对话身份上下文，SHALL 不自动把浏览器页面 DOM、输入、选中项或内存状态交给 Agent。用户明确请求或 Service 提交有效的显式自动请求后，Agent MAY 读取自身可见的共享 workspace 文件或调用 Service 已提供的 API，并 SHALL 在回答中标明实际来源。Service 只有显式挂载共享 workspace 时才与 Agent 共享该目录；仅在容器内部或进程内存的数据 SHALL 不被描述为 Workspace files，缺少可读文件或 API 时 SHALL 明确说明无法读取。

接入契约的 Service MAY 主动提供页面路径、业务 Event、状态、Action/Job 和请求回执，Agent SHALL 以已取得且归属正确的记录作为证据。普通事件是事实，不等于执行授权；只有显式 agent.requested 请求可以进入自动处理。未接入的外部 Service SHALL 只表述已确认的外部情况。界面 SHALL 清楚区分选中 Service 身份、Service 提供的事实和 Agent 实际读取的状态，不能把所选对象当作已知数据。

#### Scenario: 用户操作 Service 后请求分析
- **WHEN** 用户修改 Service 数据并在聊天中明确请求 Agent 分析
- **THEN** Agent 通过实际可达的 workspace 文件或 Service API 读取，回答标明来源，不声称看到了浏览器当前画面

#### Scenario: Service 数据不可达
- **WHEN** 数据只保存在 Service 内部且没有 Agent 可用的文件或 API
- **THEN** 界面说明无法访问该数据，不根据页面当前内容编造分析

#### Scenario: 显式请求允许自动取得证据
- **WHEN** 已接入 Service 提交有效的 agent.requested 事件
- **THEN** Agent 可自动查询该 Service 并执行已声明的 Action，回复列出真实来源，普通页面访问事件不会单独触发该处理

### Requirement: Session 与 Run 的交互完整且不重复执行

**Identifier:** DUL-012

原型 SHALL 展示当前 Work 的 Session 列表、新建、读取/切换和对话提交，以及 accepted/running/cancelling/succeeded/failed/cancelled/interrupted。Session 标题 SHALL 来自已加载首消息摘要或创建时间/ID，不假定现有接口支持持久 title/改名。一个 Work 的活跃 Run 限制 SHALL 在其他 Session 中有 busy 说明并保留草稿，不能暗示隐藏队列。

Cancel run SHALL 是明确请求，取消中保留状态直至终态；切换、关闭或断线不等于取消。观察恢复 SHALL 使用原 Run ID/游标，过期读结果/历史，未知不得自动重发 prompt。旧 context 导致 Session 不可用 SHALL 给原因和 New session，不能自动迁移或承诺仍可继续。stopped Work SHALL 不被承诺可以加载 Session/Run；之前加载的消息可标注为旧内容。

Chat SHALL 表达模型选择只作用于下一次新手动 Run，展示每次 Run 实际模型与用户/Service 来源。自动请求的 pending、等待、验证及终态 SHALL 与 Run 执行状态分开呈现：等待不是模型一直运行，不是手动消息隐藏队列。Cancel run 与 Cancel request SHALL 分别解释取消当前执行及直接取消请求的范围；取消有关联请求的 Run 也终止原未完成请求的后续自动处理。

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

## ADDED Requirements

### Requirement: 脑包与反馈沿用现有产品任务语言

**Identifier:** DUL-BRAIN-001

Desktop SHALL 使用现有 Work、Service、Session、Run、Operation、Pi Package 对象和 English 产品标签，表达模型选择、处理记录、证据、候选 Saved / Not applied / Loaded 以及行为验证结果；实现中用于鉴权、代次、RPC、哈希和凭证的细节 SHALL 不成为普通用户的必经决策。业务证据与经验采纳 SHALL 有清晰结果与来源，Service 状态、包加载、请求完成之间不得互相代替。

目标场景 SHALL 是用户从 Work 模板创建个人工作站并让 Pi 开发和改进服务，例如 Todo、Kanban、日记或个人复盘。Python/NiceGUI 示例 SHALL 只证明该闭环，不把其语言或框架设为平台要求。保留现有 UI 的 Apply 独立步骤、故障如实呈现与导入导出分步流程；不为示例增加新的顶层产品结构。

#### Scenario: 候选失败能够定位结果
- **WHEN** 脑包已经 Loaded 但实际行为验证失败
- **THEN** 用户看到包加载成功和行为验证失败各自状态、原因与证据，不被告知更新已完成或业务效果已自动撤销

#### Scenario: 工作站技术栈变化
- **WHEN** 用户开发的 Service 使用示例以外的语言或 UI 框架
- **THEN** 相同交互与反馈契约仍可接入，Desktop 不要求选择 Python/NiceGUI 才能创建或使用该服务
