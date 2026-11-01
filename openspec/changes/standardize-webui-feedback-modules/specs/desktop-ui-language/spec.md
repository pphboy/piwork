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

宽屏身份栏采用已确认 V12/V13 的 56px 紧凑密度，Desktop 首页与 Admin 等高对齐、Service Toolbar 为 39px（替代旧约64–72px默认值），Agent 辅助栏约占 28–34%；这些 SHALL 作为层级基线，允许随内容和宽度调整以保证可读与可操作，不能把 Service 缩成辅助预览卡。系统无衬线字体、4px 倍数间距、小圆角和细分隔 SHALL 保持一致；页面标题以 24–30px、正文 14–16px、辅助文字 12–13px 为基线。路径、域名、ID、日志与代码 SHALL 使用等宽字并能完整读取或复制。列表行不叠加重复大卡片；Agent 回复保持连贯，用户消息可用柔和浅底。

图标、原 PW 标记和紧凑头部 SHALL 遵守 UIL-V13-CHROME-001；通知与固定槽遵守 UIL-NOTICE-001。

每个当前任务 SHALL 只突出一个主动作，其余使用次级样式：文件未选择时由紧凑更多命令菜单承接 Upload/New folder，空目录可保留文字引导，已选时就近提供批量动作，停止 Work 时突出 Start Work，快照就绪后突出 Download .work；Pop out 可作为 Service 工具栏主动作。同工具栏的输入和按钮 SHALL 等高、间隔一致，按钮文字居中；当前选择同时由位置、文字与柔和选中态表示，悬停弱于选中。状态、操作 ID、取得时间和恢复动作 SHALL 位于同一上下文，不能用旋转图标代替执行状态或在无关区域显示成功。

键盘焦点 SHALL 有至少 2px 可见轮廓。模态弹层 SHALL 获得并限制焦点，非提交中的普通弹层可用 Escape 关闭，危险确认的 Escape 等于取消，关闭后焦点回到触发控件；未保存编辑离开须先处理 Save/Discard/Keep editing。弹层开关 SHALL 立即到终态，不使用入场/退场动画、快照、展示层或延迟清理；普通与 `prefers-reduced-motion` 设置行为一致，不改变提交保护或业务完成条件。

本变更的交互验收 SHALL 保留基本键盘、焦点与可访问名称，不以真实NVDA/VoiceOver运行或认证作为交付前提；移除该人工实测范围不表示已取得真实读屏通过证据。

Response settings的背景能力更新导致原聚焦控件变为禁用或不可聚焦时，若仍属同一Work/Session、身份和浮层，且用户没有主动移到其他位置，Desktop SHALL 将因该更新丢失的焦点恢复到该浮层现有的合法控件；Thinking不可用时提供恢复动作或Close等可操作回退，不将焦点遗留在BODY。原控件仍可用时保持焦点；用户已移焦、浮层已关闭/更换或对象/身份变化时 SHALL 不恢复旧焦点。该保护不改变Popover的非模态Tab行为、不触发设置保存或Run提交。

窄屏 SHALL 保留 Work 身份、返回、主要动作与 Pop out；文件树可收进可关闭面板，表格和代码只在局部滚动。Import 可全宽滚动，底部动作不能遮住私有包提醒；Export 步骤纵向排列。独立诊断详情先目标与结果，再影响/恢复，最后技术 ID；Export Details 及所有既定仅进度 drawer 不承载技术 ID、旧快照或诊断卡，必要诊断在所属对象独立恢复上下文可达；错误不得通过缩小正文或挤掉名称容纳。

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

### Requirement: Work 导入导出是可恢复的分步传输

**Identifier:** DUL-009

Desktop SHALL 将 Export 表达为一次明确目标下连续完成的停止（需要时）、生成快照、传输校验和浏览器下载阶段，技术阶段分别可见但不要求用户逐段重复确认。只有 desired/observed 均 stopped 且无已知冲突控制任务时 SHALL 提交生成快照请求，并以 Core 的实际停止及快照准入结果为准；running/stopping 的导出流程入口仍可进入，分别提供明确停止影响确认或等待原停止；仅明确说明影响并获用户 Stop and export 确认后才可顺序提交停止和导出；普通导出不隐式停止，仍不暗中 Apply、额外取消 Run 或启动 Work。Export 接受后 SHALL 保留 Operation ID 与 snapshotId，快照成功并验证后才提供 `.work` 下载；下载中断 SHALL 在保留期内用原 snapshotId 重试，过期 SHALL 明确提示，不能静默重新 Export。Import SHALL 从 Work 列表进入，对本地包完整校验并展示安全摘要、私有内容提醒及可选名称；名称留空 SHALL 保持省略，使 Core 自动使用包名并处理重名，显式名称冲突 SHALL 指向字段。接受后 SHALL 保留原 Operation ID，完整发布前不显示新 Work；成功后显示 Core 返回的最终名称、新 Work ID、Imported · Not started 状态以及显式 `Start and open` 和仅查看/暂不启动入口，不自动运行包内代码或 Service；失败时不显示半成品 Work。Desktop SHALL 仅本地保存当前 WebUI 已知操作的 Core/用户、类型、Work/Service/Operation/snapshot ID 与时间，页面重载后按 ID 恢复查询，不保存包字节或凭证，也不声称是 Core 全局 Operation 列表；切换身份时不得混入其他用户记录。

用户 SHALL 可仅在本地 Inspect 后关闭，不需登录 Core 或被迫导入；兼容性与权限仍由 Core 在导入时检查。上传未接受前 SHALL 不虚构 Operation，错误 SHALL 区分包损坏、名称、依赖/容量、运行时与未知结果。导入/下载前 SHALL 说明 Work 包可能包含代码、配置、共享数据、Session 与凭证；浏览器只能确认发起下载时，不得宣称文件已完整落盘。界面以 Export current Work and download、Stop and export、Download this snapshot 清楚区分新导出、必要停止确认和旧包下载；进度保留真实阶段，业务协调器保留原 Operation/snapshot/transfer ID，必要诊断在所属 Work 的独立恢复上下文查看，不放入导出进度 Details。

已停止 Work 的显式导出 SHALL 在同一可收起、非遮罩的紧凑进度上下文连续完成；敏感内容提醒在交付前可见，停止确认不能被简化掉。成功快照不遮蔽导出当前内容入口；已有快照只表示其捕获时内容，不能被称为当前最新版。按明确 ID 找回 SHALL 不改选其他快照。

关闭进度 SHALL 只收起展示，同一有效身份下原一次交付意图继续，未被用户手动暂停时，ready/恢复最多自动发起一次；明确 Pause 暂停后续交付推进，Check 仅核对而不解除手动暂停，Resume 核对原结果后才继续原授权目标；提供同一已验证文件的手动保存回退，不把浏览器发起当作落盘完成。账号/Core 切换、注销、本地授权失效撤销该自动交付，重载后只恢复查询和用户显式下载，不增加持久后台队列。

原 Export 入口 SHALL 直接建立明确新导出意图，不先展示另一个必点 Export 按钮。默认进度/结果 SHALL 只展示当前 Work、阶段、错误及必要恢复动作；Details 只展开同一导出的进度、真实阶段/进度值、必要暂停/检查/恢复/下载控制；不放技术 ID、旧快照列表、诊断卡或新导出二次确认。独立的所属 Work 诊断/原快照找回仍可达，长 ID 在那里完整读取/复制。非遮罩面板 SHALL 不限制背景操作和 Tab；背景动作收起展示而不取消交付，切换模态窗口仍按原焦点与风险规则。

#### Scenario: 导出结果不成为第二个主流程
- **WHEN** 用户选择停止态Work的Export，随后查看结果或继续操作工作区
- **THEN** 无第二次导出确认即可生成/校验/发起下载；紧凑进度不遮罩，成功只称Download started并保留同一文件手动下载，Details 仅含原进度与必要控制，技术诊断和旧包找回转到独立所属 Work 恢复上下文

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

#### Scenario: 只看进度仍保留风险与恢复
- **WHEN** 用户展开导出 Details、收起后再打开或遇到失败/未知
- **THEN** 重开同一非模态进度，不增加任务或遮罩；私有内容提醒在交付前始终可见，原ID内部保留，独立诊断/按ID恢复仍可达


### Requirement: 操作进度和问题留在所属任务界面

**Identifier:** DUL-OPREC-001

Desktop SHALL 将 Work、Service、Apply、Package 和导入导出的任务反馈安排在各自的列表行、面板或流程内；主要可见内容依次表达动作与对象、真实状态、必要原因与下一步，Check status 为就近只读动作，原 Operation 详情为次级入口。没有可见 Work 的创建、导入和已移除 Work 的任务 SHALL 在 Works 现有操作区使用固定几何入口和按需展开的所属任务提示，呈现必要状态与对应动作；不在搜索或列表前插入挤压内容的状态行，不新增全局导航或全局操作中心。

任务进行中 SHALL 使用既有局部等待语义，明确失败、观察中断和未知结果 SHALL 停止误导性的进行中动效，显示可理解的原因与安全下一步；当前状态、已接受目标和最后确认事实不得混写。普通成功 SHALL 保持短暂、克制，同一任务的进度或错误不在行、通用条、详情和 toast 同时重复。技术 ID、阶段明细和相关标识 SHALL 在所属对象次级诊断中按需展开；Export Details 及所有既定仅进度 drawer 只含进度和必要控制；技术诊断归独立诊断详情，Export 技术诊断/原快照找回在同 Work 独立恢复上下文、完整读取和复制，不挤占任务名称与主要动作。

多个临时任务 SHALL 各自可识别且可访问，可先显示有限的紧凑摘要并在同一位置展开其余任务；收起详情不丢失未处理状态。Work 搜索、空列表或暂时读取失败不隐藏需要处理的无对象任务。详情与反馈 SHALL 复用现有控件、语义色及非阻断的所属上下文；普通临时结果 Alert 改为 UIL-NOTICE-001 的统一浮动通知，真实首读错误/空态/准入原因保留所属无框内容和恢复，不因移除Alert而消失；危险操作仍使用已有确认，普通检查不增加确认。

任务反馈更新 SHALL 保持列表和控件可用、焦点及相关草稿，不为展示进度或错误重载既有 Service iframe。360px 宽屏、长名称及长 ID SHALL 换行或在所属区域局部滚动，不导致整页横向溢出、遮挡主要按钮或破坏键盘访问。中英文文案 SHALL 指向当前任务的恢复动作，不再引导用户前往已移除的 Known operations。

#### Scenario: 账号菜单不再出现全局入口
- **WHEN** 普通用户或管理员在托管工作台或独立 Desktop 打开账号菜单
- **THEN** About 和原有适用账号管理动作仍可达，Known operations 不出现；任务状态在对应对象或 Works 临时提示中可查

#### Scenario: Work 行内展示进行和失败
- **WHEN** 用户在列表启动 Work，随后该任务处于进行中或确认失败
- **THEN** 原行以紧凑状态和就近检查呈现结果，失败有原因与下一步；不同时堆叠重复的全局提示，独立诊断详情保留原 ID，不回填进度 drawer

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

## ADDED Requirements

### Requirement: 全局账号与 Work 菜单具有显式作用域

**Identifier:** DUL-NAVSCOPE-001

Desktop 的 Administration（中文“管理”）SHALL 仅在有权的全局账号菜单出现，不放在 Work 行、行菜单或已打开 Work 的更多菜单；Serve/Admin Header SHALL 直接保留返回 Workbench 的真实链接，不藏入账号菜单。Work 列表行及行菜单 SHALL 不显示 Requests；Requests 只从已打开 Work 内的所属入口进入，并绑定该 Work，Service 请求过滤仍在其所属范围内。没有打开有效 Work 时不得复用旧选择显示 Requests。

行菜单与已打开 Work 头部菜单 SHALL 以显式上下文区分，不通过同名按钮、当前全局选择或是否存在草稿推测。移除越级入口不改变语言选择、Work 信息、生命周期危险确认及其他适用命令；打开/返回不发起生命周期或Run副作用。权限变化或旧菜单晚回调不得把旧对象命令带入新上下文。

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
- **WHEN** 用户切换语言或从行菜单切到已打开Work菜单
- **THEN** 语言入口按双语契约保留，菜单只更新所选语言和正确scope，不复制Admin/Requests到错误层级
