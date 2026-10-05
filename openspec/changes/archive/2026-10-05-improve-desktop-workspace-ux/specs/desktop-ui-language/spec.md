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

## ADDED Requirements

### Requirement: 工作区反馈和聊天控制保持任务层级

**Identifier:** DUL-WORKSPACE-001

Desktop SHALL 用所属内容区的骨架、就地状态或控件内等待表达普通读取；对象标题、返回与独立动作始终可见，普通导航不显示通用 Check/Checked/Confirmed 条。显式刷新和恢复核对 SHALL 留在目标附近，背景正常读取静默完成。错误与未知修改 SHALL 按 DUL-003 保留原因、原身份和可执行恢复，不能为减少噪声而隐藏风险事实。

Chat Box SHALL 在输入框底部将紧凑 Model、Thinking 与 Enter/Send 置于同一操作栏，宽度足够时同一行、等高且垂直居中，窄屏可合理换行而不隐藏必要控件，展示当前已确认、用于下一次新手动 Run 的设置；不增加独立 Save model 主动作。选择过程、失败和未知以控件附近的短文案表达，不遮挡输入，不以技术内部标识替代模型名称。

工具执行 SHALL 以默认折叠的 Activity 表达，摘要包括调用数量、进行中或已结束状态和失败数量；成功不永久占用聊天正文，失败摘要不能被折叠隐藏。展开内容保持工具名、实际状态和可取得结果，折叠不隐藏正文回复。界面标签与无障碍名称 SHALL 为英文并沿用 DUL-007 的视觉令牌，360px 下控件可换行、弹层可达且不产生整页横向滚动。

#### Scenario: 打开已有内容并后台更新
- **WHEN** 用户返回已读取的 Work 模块且后台正在更新
- **THEN** 标题与旧内容仍可阅读，取得时间和局部更新状态可查看；完成后内容更新且没有通用检查条或成功播报

#### Scenario: 输入和执行详情共存
- **WHEN** 用户阅读回复、工具仍在运行并切换下一条消息的模型或 Thinking
- **THEN** 正文和输入保持主要空间，Activity 显示真实进度，设置反馈归属当前 Chat Box，不把临时选择描述为已确认事实

#### Scenario: 窄屏与键盘操作
- **WHEN** 用户在 360px 宽度用键盘打开设置或展开工具详情
- **THEN** 焦点可见且控件完整可达，长工具名和模型名不撑宽页面，动态提示遵守减少动态效果设置


### Requirement: Focus 与新增 Chat 控件沿用现有交互语言

**Identifier:** DUL-WORKSPACE-002

Focus、Restore layout、Exit focus、Chat 显隐和 Full screen SHALL 使用现有 Open/More 的轻量图标按钮角色，尺寸、间距、图标、hover、focus、disabled 与选中状态一致。按钮 SHALL 有准确英文 tooltip 与无障碍名称，开关有可访问选中语义；退出和恢复不放入溢出菜单，不以成排文本按钮另建交互语言。

Model/Thinking、slash 菜单、Activity 及状态反馈 SHALL 沿用现有同类组件、视觉令牌、字阶、边框、圆角、键盘与选中规则。默认内容以模型名称、当前设置和简短结果组织；技术 ID、修订和详细执行依据按需查看。低频 Service identity 设置及说明可进入次级入口，资源命令不附加身份的原因仍在相应入口可见；必要错误、未知和禁用原因不能只藏在 tooltip 或折叠详情。

#### Scenario: 图标按钮一致且退出可达
- **WHEN** 用户在常规、Service 专注或仅 Chat 布局使用 Focus、恢复、退出、显隐或全屏
- **THEN** 同类按钮与已有 Open/More 具有一致尺寸与状态，hover/键盘可理解动作，退出无需先打开菜单

#### Scenario: Chat 控件属于同一产品语言
- **WHEN** 用户打开选择器、slash 菜单或 Activity，并遇到保存中、失败或未知
- **THEN** 复用现有视觉和键盘规则，说明当前对象、真实结果和下一步，必要错误持续可见而技术详情按需展开

#### Scenario: 长名称与窄屏
- **WHEN** 模型或 Service 名称很长，或窗口宽度为 360px
- **THEN** 完整名称可读取，必要动作和弹层可达，控件对齐且整页不横向滚动
