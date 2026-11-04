# Spec Delta

## MODIFIED Requirements

### Requirement: 对象和状态按真实能力表达

**Identifier:** DUL-003

Desktop SHALL 稳定使用 `Core`、`Work`、`Session`、`Run`、`Operation`、`Service`、`Workspace files` 等对象名称；UI 自有文案与无障碍名称 SHALL 使用所选界面语言，用户内容和技术标识 SHALL 保留原文。界面 SHALL 区分空、加载、已保存、已接受、执行中、已就绪、降级、停止、失败、被新目标取代和结果未知。未知结果 SHALL 保留对象身份和最后已知时间、提供按原 ID 重新查询，不自动重提或声称完成。禁用动作 SHALL 说明原因和可执行下一步。尚无 CLI 能力的 Work 终端、Work 重命名及全局 Operation 列表 SHALL 不表现为可用入口。

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
- **THEN** 保留可取得的对象身份及最后已知状态；当前页面此前加载的历史标为旧内容，不承诺重新读取；受影响的 Service、文件与对话动作给出所选界面语言的原因和恢复入口

#### Scenario: 读取失败与空列表
- **WHEN** Work、文件或能力列表分别返回空集合、读取错误或旧缓存
- **THEN** 空集合提供首个有效动作，错误提供原因与恢复入口，旧缓存带取得时间；三者不使用同一个零计数或成功提示

#### Scenario: 表单校验与重复提交
- **WHEN** 用户提交的字段校验失败，或已提交请求仍在等待响应
- **THEN** 校验失败保留输入并定位错误；等待期间阻止重复提交，状态留在当前表单；取消普通编辑不产生数据修改

### Requirement: 脑包与反馈沿用现有产品任务语言

**Identifier:** DUL-BRAIN-001

Desktop SHALL 使用现有 Work、Service、Session、Run、Operation、Pi Package 对象和所选界面语言的产品标签，表达模型选择、处理记录、证据、候选 Saved / Not applied / Loaded 以及行为验证结果；实现中用于鉴权、代次、RPC、哈希和凭证的细节 SHALL 不成为普通用户的必经决策。业务证据与经验采纳 SHALL 有清晰结果与来源，Service 状态、包加载、请求完成之间不得互相代替。

目标场景 SHALL 是用户从 Work 模板创建个人工作站并让 Pi 开发和改进服务，例如 Todo、Kanban、日记或个人复盘。默认工作站示例 SHALL 采用 Python + NiceGUI + SQLite 基础环境证明该闭环；此默认选择不成为其他 Service 的平台强制技术栈，也不改变 Desktop 自身的实现框架。保留现有 UI 的 Apply 独立步骤、故障如实呈现与导入导出分步流程；不为示例增加新的顶层产品结构或依赖安装设置页。

#### Scenario: 候选失败能够定位结果
- **WHEN** 脑包已经 Loaded 但实际行为验证失败
- **THEN** 用户看到包加载成功和行为验证失败各自状态、原因与证据，不被告知更新已完成或业务效果已自动撤销

#### Scenario: 工作站技术栈变化
- **WHEN** 用户开发的 Service 使用示例以外的语言或 UI 框架
- **THEN** 相同交互与反馈契约仍可接入，Desktop 不要求选择 NiceGUI 基础镜像或特定技术栈才能创建或使用该服务

### Requirement: 工作区反馈和聊天控制保持任务层级

**Identifier:** DUL-WORKSPACE-001

Desktop SHALL 用所属内容区的骨架、就地状态或控件内等待表达普通读取；对象标题、返回与独立动作始终可见，普通导航不显示通用 Check/Checked/Confirmed 条。显式刷新和恢复核对 SHALL 留在目标附近，背景正常读取静默完成。错误与未知修改 SHALL 按 DUL-003 保留原因、原身份和可执行恢复，不能为减少噪声而隐藏风险事实。

Chat Box SHALL 以文本输入与 Send 为常态的主要内容，在输入框底栏提供一个合并 Model 与 Thinking 的轻量配置摘要入口；两项字段标签和独立选择器 SHALL 只在按需展开的 Response settings 面板内呈现。摘要 SHALL 展示真实模型名称和当前 Thinking，例如 Work model · Medium，按内容占宽且不均分、铺满底栏。摘要、Input options 与 Send 在宽度足够时 SHALL 同行、等高且垂直居中；长名称先在摘要内截断，完整名称可在面板中读取，窄屏必要时允许摘要整组换行，所有必要动作仍可达。摘要 SHALL 不以默认强调色、大块背景、技术 ID 或额外常驻说明争夺输入权重。

Response settings SHALL 在同一面板中相邻呈现 Model 与 Thinking 的当前值，以所选界面语言的文案、轻量按钮、菜单选中态和模态焦点规则完成编辑。打开或关闭面板 SHALL 不提交修改；明确选择不同值才自动保存完整设置对，不增加 Save model 或 Apply 主动作。摘要默认表达已确认设置，未确认的选择 SHALL 有明确的 Saving、Not saved 或 Unconfirmed 状态，尚无 Session 的选择 SHALL 说明用于新 Session，不将草稿设置表达为已保存。必要的失败、未知、Thinking 不可用原因及恢复入口 SHALL 在 Composer 附近持续可见，面板关闭不隐藏这些事实；正常已确认状态不增加永久成功条。

所有可输入的 Chat 容器 SHALL 共用上述层级和同一 Session 草稿。面板 SHALL 可通过键盘打开、选择与关闭，Esc 优先关闭面板并返回来源，不能同时退出 Focus chat；360px 下所有动作、状态、长名称和面板 SHALL 可达，页面无横向溢出。

工具执行 SHALL 以默认折叠的 Activity 表达，摘要包括调用数量、进行中或已结束状态和失败数量；成功不永久占用聊天正文，失败摘要不能被折叠隐藏。展开内容保持工具名、实际状态和可取得结果，折叠不隐藏正文回复。界面标签与无障碍名称 SHALL 使用所选界面语言并沿用 DUL-007 的视觉令牌，360px 下控件可换行、弹层可达且不产生整页横向滚动。

#### Scenario: 打开已有内容并后台更新
- **WHEN** 用户返回已读取的 Work 模块且后台正在更新
- **THEN** 标题与旧内容仍可阅读，取得时间和局部更新状态可查看；完成后内容更新且没有通用检查条或成功播报

#### Scenario: 输入和执行详情共存
- **WHEN** 用户阅读回复、工具仍在运行并切换下一条消息的模型或 Thinking
- **THEN** 正文和输入保持主要空间，Activity 显示真实进度，设置反馈归属当前 Chat Box，不把临时选择描述为已确认事实

#### Scenario: 窄屏与键盘操作
- **WHEN** 用户在 360px 宽度用键盘打开设置或展开工具详情
- **THEN** 焦点可见且控件完整可达，长工具名和模型名不撑宽页面，动态提示遵守减少动态效果设置

#### Scenario: Composer 常态突出输入
- **WHEN** 用户在 Agent 辅助栏、常规 Chat 或 Focus chat 输入普通消息，模型与 Thinking 已确认
- **THEN** 输入区域与 Send 保持主要层级，底栏只有一个呈现两项当前值的低权重配置摘要，没有两个常驻字段标签、铺满底栏的配置栏目或永久保存成功条

#### Scenario: 按需调整成组配置
- **WHEN** 用户通过摘要打开 Response settings
- **THEN** 同一面板相邻显示 Model 与 Thinking 的当前值，并可进入各自真实选项；使用既有按钮、选中态和焦点规则，打开不保存，关闭返回来源且保留草稿

#### Scenario: 收起面板仍能解释发送限制
- **WHEN** 偏好保存未确认、明确失败或结果未知，用户关闭设置面板
- **THEN** Composer 附近仍显示对应状态、原因与合法恢复入口；发送按真实确认状态受限，输入可编辑，不用无说明的灰色按钮或隐藏详情代替必要反馈

#### Scenario: 摘要在宽屏保持内容宽度
- **WHEN** 用户放大 Chat，当前模型名和 Thinking 都很短
- **THEN** 配置摘要只占其内容需要的宽度，Input options 与 Send 在底栏右侧，输入区不会出现两个随宽度拉开的配置字段

### Requirement: Focus 与新增 Chat 控件沿用现有交互语言

**Identifier:** DUL-WORKSPACE-002

Focus、Restore layout、Exit focus、Chat 显隐和 Full screen SHALL 使用现有 Open/More 的轻量图标按钮角色，尺寸、间距、图标、hover、focus、disabled 与选中状态一致。按钮 SHALL 有所选界面语言的准确 tooltip 与无障碍名称，开关有可访问选中语义；退出和恢复不放入溢出菜单，不以成排文本按钮另建交互语言。

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

### Requirement: 文件交付入口与 Files 查看共用一个工作区路径

**Identifier:** DUL-FILE-DELIVERY-001

Assistant 文件引用 SHALL 作为进入同 Work Files 的导航入口，以文件名或短说明表达目标，按需提供与所选界面语言一致的 Open in Files 可访问说明；不依靠 hover 才能发现主要动作。文件查看 SHALL 在既有 Files 主区域承载，保留路径、文件名、Back to files 和适用的 Download file/Download saved version；不为文件交付新增顶层附件中心、强制弹窗或第二套聊天会话。

图片 SHALL 作为只读预览呈现，文本继续使用既有编辑语义；其他文件的不可预览原因与下载入口 SHALL 明确。PDF 仅复用浏览器现成行为，不能为了文件预览要求用户安装查看器或等待转换。

从常规 Chat、辅助栏、Focus chat 和请求回复进入文件 SHALL 遵守 DUL-002、005、007、015 的容器、离开保护及返回规则；360px 下文件名/路径可读取，预览与下载不遮挡返回和输入，键盘可到达导航及下载入口。读取中在目标区域反馈，失败/缺失持续显示原因和安全下一步；正常读取成功以实际内容反馈，不堆积成功状态条。

#### Scenario: 交付文件并返回会话
- **WHEN** 用户点击回复中的图片或 TXT 文件名，查看后回到 Chat
- **THEN** 在 Files 查看真实文件，原 Session、草稿与阅读位置保留，返回及下载动作可辨，没有额外模型执行

#### Scenario: 窄屏和键盘访问
- **WHEN** 用户在 360px 或仅用键盘打开长中文文件名的入口并返回
- **THEN** 文件目标可读、焦点与返回可用，图片不造成整页横向溢出，主要动作不依赖 hover

#### Scenario: 无法预览仍有明确出口
- **WHEN** 目标是 PDF/其他普通文件、超限图片，或者读取失败
- **THEN** 所属 Files 区域表达原因，分别提供合法 Download、Retry 或返回；不把失败显示为空文件或强制发起下载
