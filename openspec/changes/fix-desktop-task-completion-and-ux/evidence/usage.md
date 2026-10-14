# Desktop 连续任务与恢复使用说明

本附件随 `fix-desktop-task-completion-and-ux` 维护，描述本次界面行为。基于 main `28bfdfa56b4c84b10ade9a63fedb7c2b75c04a90` 整合；实际验证范围和限制见[整合验收记录](acceptance.md)。

## Desktop export intent and exact snapshot recovery

当前导出动作面向一次完整目标：在Work options选择Export Work，已确认stopped时直接生成并下载；运行中先显示Stop and export的Run、Service和文件连接影响确认，取消不提交Stop或Export。已在停止中的Work沿原Stop Operation核对，实际未stopped前不提交Export；不会暗中Apply、另行Cancel Run或Start。 如果其他控制改变了这次停止的目标或控制版本超出原意图的保守边界，流程结束并要求重新核对、显式导出；不会借后来另一次Stop继续旧意图。

进度显示原Work、Stop/Export Operation、snapshot、transfer和实际阶段。已有快照不遮蔽新导出入口；通过Known operations的snapshot ID查询或View original snapshot只查看该原对象，Download this snapshot不会改成另一份或称为最新内容。大小和expires来自可靠metadata，缺失不伪造；完整成功但无可下载package元数据时显示unavailable，不猜测过期时间。

Close只隐藏进度，同身份换Work仍能完成原页面的一次交付。Pause会保留已接受操作但不推进未提交阶段或自动content；Check只核对，Resume先读原结果再继续有效授权。重复状态、晚准备响应和只读重开不重复自动下载。Save file/Download again使用同一已验证transfer，不重新Export或准备。

下载准备收到明确的本地空间、校验、繁忙或原包读取失败时，可以对原snapshot显式Retry download并使用新transfer；没有可靠失败响应的未知准备保持原ID，Check只查原transfer，不能靠404或关闭重开变成自动重试。未知Stop/Export同样不重放。当前Work的实际Stop/Export提交仍与原生命周期动作互斥；已接受操作继续按原资格观察，独立的旧快照下载不会长期锁住运行Work的Stop。

Core/账号切换、注销、本地授权失效及pagehide撤销旧自动交付资格；重新登录或重载后按原ID查询并显式下载。没有跨关页或CLI进程的后台续传队列。包可能包含私有文件或凭据；界面只说Download started，实际是否保存请在浏览器确认。真实Core/native与本轮合成验收的区别及未验范围见 [本变更验收记录](acceptance.md)，不能由本使用说明推断它们已经通过。

### Work 状态、草稿和文件操作恢复

曾确认可用的Work遇到临时状态读取失败时，已打开的应用、聊天与文件区域继续显示，并局部提示状态未确认。新Run、Service控制和文件写入仍要求当前可靠准入；已接受Stop、确认停止/删除或权限撤销会限制相关视口。保留页面不保证应用崩溃、浏览器强制关闭或真实网络中断后的数据恢复。

所选Service变为Ready时会为原Work/Service/声明端口准备一次入口。入口错误在该区域显示；Retry是显式重新核对入口，不会通过普通Ready列表读重新授予已撤销的入口。独立窗口保留其请求端口，无效端口不自动改为另一个端口。Service详情先显示原对象与合法控制，日志单独加载；Retry logs只重新读取该Service日志。

返回Works或页面重新可见会刷新列表，也可使用Refresh Works。失败保留旧行和搜索条件，错误不表示空列表。同身份内所有Work/Session未发送的聊天文本、图片及未确认提交会参与浏览器离页提示；取消离页保留页面草稿。该保护依赖浏览器的用户激活与离页确认支持，不把图片或文本持久保存，也不能保证强制关闭后的恢复。

Create Work可靠受理后，下次明确打开New Work使用空名称和Core默认高级设置。拒绝或未知结果保留原输入；未知请求不因关闭、改名或重开而重复提交。同名提交仍去重；沿用上游显式改名后的独立提交及名称错误隔离。旧请求晚结果不覆盖已编辑的新草稿。Open brain source复用文件和设置的未保存更改确认，只在原文件读取成功后进入Files并退出Settings，不隐式Save或Apply。

Copy、Move和Delete的结果显示在原操作弹窗内。每个路径的成功、失败或未知独立保留；再次处理失败项需先明确选择，成功项不会随失败项再次提交。目录递归操作的部分成功不能安全重放整个目录，需要读取现状后选择具体待处理路径。未知结果须先Refresh original paths核对原来源和目标；关闭不撤销已经完成的修改，也不解除未知路径保护。上传选择器与覆盖确认绑定打开时的Work、目录和身份，目标变化会阻止提交。上传过程中Work失去准入时，后续文件不再写入，先前已完成或未知的结果仍保留。


### 页面内区域恢复与完成出口

同一页面、同一Core与账号内，再次进入Work会恢复最近选择的Services、Chat或Files；首次进入默认Services。Files同时记住目录和已打开文件，先读取原目标。明确404/410时在Files内回到最近可读父目录并说明；暂时读取失败保留目标并提供重读，不跳转到另一个区域。记忆不跨重载或身份切换；文件和设置的未保存更改仍须先确认。

Start/Retry在Works原行或Work本体显示进度，Operation details保留原操作详情。普通Start不会强制进入Work；原Operation成功且Work真实可用后，列表提供Open Work。Service控制完成后仍在原Service详情显示进度，日志独立加载，Ready且端口有效时提供Open Service。

Import完成且确认stopped时显示Imported · Not started。View Work或Close不会启动；Start and open是独立、明确的一次Start意图，原Import与Start ID分开保留。失败或未知结果不会重Import或重放Start。真实可用后仅在仍停留于原导入进度时打开；已经关闭或切换页面时不把用户带回旧Work，可在原记录核对后显式打开。

文本编辑器的Download saved version直接下载服务端当前保存字节，不保存或下载未保存草稿，也不清空草稿。界面只说明Download started，请在浏览器核对实际文件。

### 局部键盘、选择和关闭

Files没有空选择提示条；选中后在原工具栏显示数量与Copy/Move/Delete/Clear图标，文件行位置保持稳定，复选框有独立命中区；点击文件名仍是打开。Rename预填原basename并选择主名（目录选择全名）；New folder与Rename打开时聚焦输入。只有合法、可提交、非繁忙的命名表单响应普通Enter；输入法候选确认、229及覆盖确认不自动提交。

Admin账号下拉允许外侧关闭和Escape，关闭不影响后台任务或文件草稿。其他只有干净、空闲的Work options、Service options和Work information允许同一主指针在弹窗外按下并释放后关闭。未知恢复、危险确认、Import和编辑表单不适用。Pi request的Close只收起查看；Cancel request只面向当前可用Work中的原live请求。取消受理或结果未知后保持原对象锁，Check status只读核对，不因旧running状态或读回失败再次提交。

### 主流程与辅助入口

Works保留顶部New Work和Import Work，Ready行直接Open Work，Stopped保留Start。Stop与Work information在所属Work的更多菜单；About Piwork和Known operations在Works右上Admin账号下拉。列表底部不再重复Create a Work；空列表仍有创建引导。

Export Work直接开始新导出，运行中仍先明确Stop and export。右下紧凑进度卡不会遮罩工作区；Details展开原操作、快照、传输和旧包，成功只显示Download started与同文件Download again。下载准备明确失败时，Retry download使用原快照，不重新导出；未知结果只核对。继续操作背景会收起卡片，原授权交付仍继续。

Service工具栏的Agent requests图标只在已确认有记录时出现，并保持当前Service范围。全Work的Pi requests移至Work导航右侧辅助入口，覆盖Chat与Service来源，不按当前Session筛选，也不显示未读计数。宽屏在右侧检查面板查看请求；窄屏使用单层对话框。列表先展示目标、来源与真实状态，详情先展示目标与结果，Executions和Technical details按需展开。Back返回原过滤、分页和列表位置；Close只关闭查看，不取消请求。

### 工作区与执行详情

Pi request是一项目标，可以跨多个Run继续；一个Run succeeded不表示请求已Completed。waiting_result等状态可能已经释放执行槽，此时Chat仍可使用。历史Run在对应消息轮次或Activity末尾提供Run details，同一真实runId只有一个入口；缺少runId的旧消息不会猜测执行身份。其他Session或Service占用当前Work执行槽时仍显示原执行上下文，Details与Cancel针对真实Run；只有可靠活动状态支持取消。

Services采用左应用、右Chat的分栏。拖动中线可调整宽度，默认70/30；键盘左右箭头每次16px、Shift每次64px，Home/End到边界，Enter或双击中线恢复默认，Escape取消当前拖动。Service options里的Reset split也能恢复默认。Work工具栏同一个面板按钮在原位切换Show chat/Hide chat；普通Hide Chat保留Work导航，Show Chat恢复原聊天；Focus专注应用，Exit focus恢复布局，两者用途独立。Chat头部只提供布局Focus/Restore；浏览器全屏归专注状态下Agent或Service的⋯菜单，标为Browser full screen/Exit browser full screen，不与Focus并列显示同形图标。窄屏使用Service/Chat单面板切换，回到宽屏恢复此前比例。比例、显隐和草稿仅在当前页面、身份及Work内记忆，不跨重载持久化。

切换布局不会重建现有Service iframe或Chat祖先，保留其文档、文字图片草稿和阅读位置；这不等于保证业务应用崩溃、真实网络断开或浏览器强制关闭后的恢复。Work外壳按可用高度分配，不再为底部保留固定35px空白；Service自己的页面内容不被修改。

Service选择器统一显示名称、状态、声明端口与当前选择。单端口直接显示，多端口单独选择；Starting、Stopped、Failed或Disabled说明当前不可用原因。选择Service不会自动Start，也不会更换Chat会话。

### Files、设置与轻反馈

Files的常规Refresh只保留一次入口。读取时原按钮显示Reading…，成功恢复普通图标，不新增Status checked行或重复成功toast；失败原因与未知写入的核对入口仍可见。Upload files和New folder归入More file actions的非模态动作菜单，方向键选择、Escape回到更多按钮，Tab或点外部关闭；Upload files打开文件选择，New folder才打开名称输入窗。WebDAV归该菜单的分隔次级命令，空目录上传入口保留；Shared workspace宿主路径说明行已移除。批选动作仍在原工具栏，不插入新的选择提示行；常规更多入口与批量操作图标保持40px控件高度。

Work settings内容左上角的Back to Work独立一行，返回进入设置前的Services、Chat或Files；其下标题与Configuration in use、Refresh成组对齐，窄屏整组换行；正常已对齐配置不再提供重复解释的Details。正常配置以Configuration in use轻状态呈现；Unsaved changes、Not applied、Applying、Apply failed和Apply not confirmed继续显示相应保存、应用或核对动作。Save只保存，Apply才应用；正在应用和结果未知时不重复Apply，恢复的原Apply仍可Check。

Works右上角Refresh、Import和New改用带名称/提示的图标组，New保留主动作样式，空列表仍有文字创建引导。Clear search后焦点回到搜索框，可以立即继续输入。账号菜单显示一次账号身份，Role与Core明确标注。

Modal底部动作统一高度、间距与主次角色；菜单行和正文小按钮保留各自用途。Stop影响范围不再使用像复选框的装饰，仍需明确确认；Delete的真实确认框保留。依2026-10-14要求，所有Modal开关动画、退场快照与延迟清理已移除，普通和减少动态效果设置均立即显示/关闭；关闭先撤销旧窗口提交资格，再释放原生遮罩并恢复合法焦点一次。Export仍为非模态进度卡，不因关闭中断原授权交付。完成与警告优先使用图标、语义颜色和短标签，具体错误、必要风险与下一步不会因精简被移除。

Input options按钮只打开设置对话框，以展开语义表达；内部Include Service identity复选框仍是实际开关。文件Move使用专用移动图标，返回箭头仅用于导航。

## 2026-10-14 组件职责与局部操作

- Service名称、Session与模型/Thinking在原控件旁选择，简单输入选项也是Popover；背景可继续操作。模型值使用选择列表，不是命令菜单。
- 账号、Work、Agent、Service、File的更多操作是Dropdown；方向键/Home/End选择命令、Enter/Space执行，Escape返回入口，Tab离开。点击外部导航只需一次；执行失败保留原因。
- Service管理/详情、Operation、Run与Package诊断是非模态Inspector；关闭不取消原任务。停止/删除、覆盖、导入和独立表单仍保留原确认。Modal没有开关动画。
- Show/Hide Chat归Service Header，同一个位置切换；窄屏显示Chat时Header仍在。分隔线有常驻短握柄，可拖动，原方向键与双击重置保持。
- Service/会话读取失败显示原资源重试；缓存对话在重读期间仍在。Works名称/Open Work为真实链接，普通点击仍保护未保存内容。
- 删除文件确认明确UI不能恢复。上传失败不再一律称覆盖：只对已确认存在的目标请求替换；普通失败可重新检查，未知写入先刷新核对且不会直接重复提交。
- 后续开发按[稳定组件规范](../../../specs/desktop-ui-language/ui-component-adoption.md)选型；不以此要求全量重写或过度设计。

## 2026-10-14：读取反馈、更多命令与Service详情

Files工具栏的Refresh为固定图标：读取时原位等待，完成恢复普通图标。后台读取保留当前内容、选择及滚动；首次目录用静态占位，失败就近显示简短原因，Details展开具体错误并可Retry。Upload files与New folder在More file actions（省略号）菜单，键盘关闭与原创建/上传确认保持。

Chat普通读取不再插入“Saved conversation / retrieved”时间戳或独立读取条。已有消息和草稿保留；首次读取用局部占位，失败提供一次局部重试。发送处的中性检查图标表示正在核对当前Run，尚未确认仍不能提交依赖该状态的消息；真正错误、断连、生成和未知提交继续显示原恢复动作。

Service Header及切换列表不再显示端口。Manage services → 当前Service详情仍能检查声明端口；多入口服务可在那里选择已声明Web entry，独立应用窗口同步其合法端口路由。Reset split带重置箭头。Desktop标签页图标复用Piwork标志，无需新增资源。全部Modal仍无开关动画。


## 2026-10-14 最新补充

Agent及文件对象菜单保留文字并配套图标。Files全部成功只显示3秒Toast，不保留重复上下成功条；需要处理的失败、部分成功、unknown和回读失败继续提供原证据。Packages名称/来源/状态对齐，Details及修改动作独立成组。首页和工作区有缓存时原位读取，第一次读取才显示局部骨架。Chat的assistant正文支持Markdown表格、代码、列表和安全外链；原HTML按文字显示，Markdown图片显示说明而不自动加载，原聊天附件不受影响。
