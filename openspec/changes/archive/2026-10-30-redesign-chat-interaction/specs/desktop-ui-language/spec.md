# Spec Delta

## MODIFIED Requirements

### Requirement: Desktop 视觉沿用 Serve 浅色令牌并保持主次

**Identifier:** DUL-007

Desktop SHALL 沿用 Serve 浅色语义令牌，包括 `#F5F8FC` 画布、`#F8FBFF` 次级背景、白色主表面、`#DCE7F2` 分隔、`#1B2634` 正文和 `#0969DA` 交互强调。Work 列表 SHALL 占独立页面；Work 内 SHALL 让真实 Service 或当前文件/聚焦对话占主区域，Agent 辅助栏保持可用，Work 身份和 Service 状态/域名分别处于稳定且较低干扰的工具栏。Work 列表行 SHALL 以一个当前状态快捷动作及低频菜单组织生命周期入口，没有可见 Work 的创建、导入和已移除 Work 任务提示 SHALL 在 Works 列表按需出现，不占永久导航。Import 审核与 Export 进度 SHALL 保持步骤、私有包提醒和恢复动作的层级。应用视口与 Desktop 外壳 SHALL 清楚区分，普通消息和列表行 SHALL 以留白、对齐及细分隔组织。窄屏 SHALL 将 Service、Chat、Files 变成可达的同级切换或覆盖层，不强挤窄列；360px 宽屏 SHALL 无整页横向滚动。焦点 SHALL 可见，普通文字对比度至少 4.5:1、大字至少 3:1，并尊重减少动态效果设置。

同类控件 SHALL 使用一致的样式与状态规则：共享视觉角色调整后，所有对应 Desktop 使用处 SHALL 一致变化，局部布局及 Service 应用内部样式 SHALL 保持独立。Work 列表 SHALL 以名称摘要、状态、快捷动作、菜单的顺序组织，状态圆点与文字成组，行内垂直居中、跨行同列对齐；动作控件 SHALL 不同时触发行导航。实现 SHALL 用实际字体、长内容、键盘与窄屏核验，静态坐标不得替代验证，已知错位、遮挡和不可读问题 SHALL 在交付前修正。

首版 SHALL 使用以下浅色角色，除下述 Chat 提交图标例外外，状态色始终配文字；未来主题需逐角色定义等价关系与对比度，不得简单反色或重排任务层级。

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

About Piwork SHALL 放在 Admin/账号下拉，不在 Work 顶栏常驻；Known operations 不作为账号菜单或其他全局入口。Stop Work 与 Work information SHALL 放在所属 Work 更多菜单；Ready Work 列表主动作 SHALL 是 Open Work，Stopped 保留 Start。已有 Works 列表底部 SHALL 不重复展示 Create a Work，空列表创建引导仍保留。账号下拉自身无编辑草稿，外侧关闭 SHALL 不因背景草稿或后台任务被阻断；不扩大其他危险确认窗的外侧关闭范围。Files 无选择时 SHALL 不显示 Select files 提示条，选中后的批量动作 SHALL 使用现有工具栏，不推移文件行。全 Work Pi Requests SHALL 依 DUL-002 归 Work 级辅助入口，保持与 Service 请求过滤入口不同的范围；不以常驻主按钮或未读计数抢占使用主流程。

Works 的 Refresh/Import/New SHALL 使用一致的图标动作组，前两者为次级、New 保留主动作角色；tooltip、可访问名称、键盘焦点与空列表文字引导保持。账号菜单 SHALL 只显示一次清楚账号身份，角色如需展示使用明确标签而非重复裸名称，Core 信息和管理动作仍可达。

所有 Modal footer 的同类动作 SHALL 使用一致高度、字阶、padding、图标间距及角色顺序，确认/取消配对尺寸协调；长标签和窄屏可换行而不裁切。主动作、次级、危险及禁用原因 SHALL 保持差异。菜单行、正文小动作和头部关闭控件不得被强制变成 footer。停止影响说明 SHALL 明确非交互，不用像未勾选 Checkbox 的装饰；已有真实确认框和停止/删除确认要求保持。

弹层开关 SHALL 即时完成，不改变请求提交、焦点返回和模态/非模态边界；快速关闭后重开、切换内容或身份时，无旧退场callback，旧异步结果不得移除新弹层或夺走新焦点。关闭后不得遗留不可见遮罩或不可交互背景；Export 保持非模态。

工作区 SHALL 按实际可见头部、导航与必要提示占用剩余视口高度，Service/Chat下方不保留无用途的外壳空白；最多保留一条紧凑 StatusLine。Service页面内部空间不属于该调整；内容和输入区通过所属面板滚动保持可达，不以裁掉错误或输入区实现充满。

完成和警告 SHALL 沿用已有颜色角色、图标与简短可见标签，避免重复标题、长成功说明和多处 toast；不得仅凭颜色或不明确图标传义。必要影响、私有数据风险、错误原因、未知状态与安全下一步仍须可理解，不仅藏在 tooltip 或随成功提示一起消失。

Chat 用户消息的发送中、明确失败和提交未知 SHALL 可用气泡外的状态图标表达，不要求常驻状态文字。此例外只适用于 Chat 消息反馈：图形形状、可访问名称、悬停／聚焦说明及点击后原因和恢复共同表达状态，不以颜色独自区分，也不取消错误与未知保护。其他页面和对象状态的文字规则保持。


#### Scenario: 全局与Work管理分层
- **WHEN** 用户查看Works或使用Work
- **THEN** About在Admin且不显示Known operations，Stop/Work information在当前Work更多菜单；Ready行可直接Open，Stopped可Start；已存在Work时没有底部重复创建CTA

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

#### Scenario: Chat 图标例外保持可理解
- **WHEN** 用户通过鼠标、触摸、键盘或辅助技术访问消息的失败／未确认图标
- **THEN** 无需依赖颜色即可区分状态并取得原因和有效恢复动作；其他 Work、Service 等对象仍使用原状态表达

### Requirement: Session 与 Run 的交互完整且不重复执行

**Identifier:** DUL-012

原型 SHALL 展示当前 Work 的 Session 列表、新建、读取/切换和对话提交，以及 accepted/running/cancelling/succeeded/failed/cancelled/interrupted。Session 标题 SHALL 来自已加载首消息摘要或创建时间/ID，不假定现有接口支持持久 title/改名。一个 Work 的活跃 Run 限制 SHALL 在其他 Session 中有 busy 说明并保留草稿，不能暗示隐藏队列。

Chat 输入区 SHALL 提供独立的 Cancel run 图标动作，不以非空草稿、合法新消息或 Stop and send 能力作为可取消已确认 Run 的前提；新消息发送仍遵守原准入。独立停止与 Stop and send 的图形、提示和可访问名称 SHALL 清楚区分，二者分别绑定取消和原子交接。Cancel run SHALL 是明确请求，取消中保留状态直至终态；切换、关闭或断线不等于取消。观察恢复 SHALL 使用原 Run ID/游标，过期读结果/历史，未知不得自动重发 prompt。旧 context 导致 Session 不可用 SHALL 给原因和 New session，不能自动迁移或承诺仍可继续。stopped Work SHALL 不被承诺可以加载 Session/Run；之前加载的消息可标注为旧内容。

Chat SHALL 表达模型选择只作用于下一次新手动 Run，展示每次 Run 实际模型与用户/Service 来源。自动请求的 pending、等待、验证及终态 SHALL 与 Run 执行状态分开呈现：等待不是模型一直运行，不是手动消息隐藏队列。Cancel run 与 Cancel request SHALL 分别解释取消当前执行及直接取消请求的范围；取消有关联请求的 Run 也终止原未完成请求的后续自动处理。

当前用户 Chat 有可发送的模型输入、且同 Work 存在已确认活跃 Run 时，支持该能力的 Desktop SHALL 在原发送按钮位置提供 Stop and send，目标为用户点击时明确绑定的旧 Run。用户显式提交才请求取消，取消可以针对本 Session、其他 Session 或 Service Run，仍在用户所选 Session 发送新消息。未显式执行该动作、仅切换或输入时 SHALL 保持既有 busy 与草稿规则。取消关联未完成请求后 SHALL 不自动恢复原处理，历史与已产生业务结果保持。

取消等待和提交 SHALL 在所属消息与输入控制处表达，正常受理不重复铺回执；失败或取消等待超过 5 秒时保留待发内容并提供原状态核对，不把请求取消当作已经停止，不在超时后自动发送。普通发送、网页 slash 动作、模型设置、输入法与观察恢复 SHALL 保持原语义；旧 Agent 未确认新能力时保留原 Cancel run 及普通聊天，不暗中替换运行镜像。

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

#### Scenario: 空输入下取消与新提交分离
- **WHEN** 原 Run 可取消但输入为空，或用户已有下一条草稿
- **THEN** 独立停止可用且不发新消息；用户另行明确执行 Stop and send 时才原子交接，取消不消费新草稿或冒称已成功终止

### Requirement: 工作区反馈和聊天控制保持任务层级

**Identifier:** DUL-WORKSPACE-001

Desktop SHALL 用所属内容区的骨架、就地状态或控件内等待表达普通读取；对象标题、返回与独立动作始终可见，普通导航不显示通用 Check/Checked/Confirmed 条。显式刷新和恢复核对 SHALL 留在目标附近，背景正常读取静默完成。错误与未知修改 SHALL 按 DUL-003 保留原因、原身份和可执行恢复，不能为减少噪声而隐藏风险事实。

Chat Box SHALL 以文本输入与 Send 为常态的主要内容，在输入框底栏提供一个合并 Model 与 Thinking 的轻量配置摘要入口；两项字段标签和独立选择器 SHALL 只在按需展开的 Response settings 面板内呈现。摘要 SHALL 展示真实模型名称和当前 Thinking，例如 Work model · Medium，按内容占宽且不均分、铺满底栏。摘要、Input options 与 Send 在宽度足够时 SHALL 同行、等高且垂直居中；长名称先在摘要内截断，完整名称可在面板中读取，窄屏必要时允许摘要整组换行，所有必要动作仍可达。摘要 SHALL 不以默认强调色、大块背景、技术 ID 或额外常驻说明争夺输入权重。

Response settings SHALL 在同一面板中相邻呈现 Model 与 Thinking 的当前值，以现有英文文案、轻量按钮、菜单选中态和模态焦点规则完成编辑。打开或关闭面板 SHALL 不提交修改；明确选择不同值才自动保存完整设置对，不增加 Save model 或 Apply 主动作。摘要默认表达已确认设置，未确认的选择 SHALL 有明确的 Saving、Not saved 或 Unconfirmed 状态，尚无 Session 的选择 SHALL 说明用于新 Session，不将草稿设置表达为已保存。必要的失败、未知、Thinking 不可用原因及恢复入口 SHALL 在 Composer 附近持续可见，面板关闭不隐藏这些事实；正常已确认状态不增加永久成功条。

所有可输入的 Chat 容器 SHALL 共用上述层级和同一 Session 草稿。面板 SHALL 可通过键盘打开、选择与关闭，Esc 优先关闭面板并返回来源，不能同时退出 Focus chat；360px 下所有动作、状态、长名称和面板 SHALL 可达，页面无横向溢出。

工具执行 SHALL 以默认折叠的 Activity 表达：单次调用可显示真实工具名和已取得的对象信息，多次调用摘要显示数量；进行中、已结束和失败数量可辨，失败摘要不能被折叠隐藏。主等待动效随正文或所属活动阶段出现一次，不新增 Agent 正在回复等独立文案行，成功不增加常驻 Run succeeded 行。展开内容先显示工具身份、实际状态与可取得结果，原始内容进一步按需查看；缺失参数不伪造、不额外读取私有数据，折叠不隐藏正文回复。用户展开、阅读位置和输入焦点不因过程更新丢失。界面标签与无障碍名称 SHALL 为英文并沿用 DUL-007 的视觉令牌，360px 下控件可换行、弹层可达且不产生整页横向滚动。

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

#### Scenario: 工具摘要与正文分工
- **WHEN** 一轮回复从正文生成切换到工具执行，再取得结果并继续回答
- **THEN** 主等待动效跟随所属阶段一次出现，工具默认折叠且可展开；展开后先看实际调用与结果，正常结束不增加独立 Run 状态行
