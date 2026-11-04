# Spec Delta

## MODIFIED Requirements

### Requirement: 容器层级与内容职责跨页面一致

**Identifier:** UIL-009

Serve 管理面板 SHALL 按容器角色而非路由名称决定内容布局：页面轨道承载标题、范围说明及一级 section；每个一级 section SHALL 对应一个可说明的管理目的和所属操作；表单及字段组 SHALL 在该 section 内承载输入、限制、字段错误与提交动作；列表行或表格行 SHALL 保持对象名称、当前状态及该对象动作的关联；详情 SHALL 先呈现可判断的摘要，再呈现可展开或局部滚动的原始配置、来源、错误标识及 Operation 技术内容。

加载、空、失败、警告、提交中和未知结果 SHALL 保持所属页面、section、字段或对象关系。普通等待 SHALL 使用原控件/对象固定槽，任务结果与可恢复问题的通知 SHALL 按 UIL-NOTICE-001 使用统一浮动宿主，不为反馈插入推动内容的普通 Alert 卡片或另建不同宽度的一级卡片。字段错误仍 SHALL 在字段附近；页面级连接错误、section 读取/提交失败与未知结果 SHALL 保留原对象身份、最后确认事实及所属恢复入口，浮动通知关闭后仍可找回；安全诊断标识位于主说明之后。上传进度及异步 Operation 详情 SHALL 与触发表单或所查询对象保持明确关联，不因通知展示变成全局历史。

仓库级 UI 与产品语言 SHALL 为现有顶栏、页面标题及说明、一级 section、摘要、表单、字段组、选择与排序行、列表及表格、详情、技术披露、反馈与操作区分别提供容器规则。新增对话框、浮层或侧栏 SHALL 先声明对象、范围、宽度归属、焦点、窄屏与关闭/恢复规则，不改变页面主轨道；浏览器原生确认框继续按目标与后果文案规则使用，不作为可由 CSS 测量的页面卡片。危险确认、必要影响和私有数据风险说明不因取消普通 Alert 插入而移除。

#### Scenario: 列表、表单与字段错误
- **WHEN** 用户页同时展示账号列表、创建表单及一个无效字段
- **THEN** 列表与表单保留所属容器，字段错误留在对应输入附近；任务通知不插入另一张卡片推动列表

#### Scenario: 技术详情与长内容
- **WHEN** 默认 Work、Package 或 Operation 详情展示长名称、公开配置或技术 JSON
- **THEN** 先可读取摘要及主要动作，完整技术内容在所属容器换行/滚动，页面轨道不变

#### Scenario: 状态切换不改变容器位置
- **WHEN** 同一页面从加载变为空集合、读取失败、提交中或结果待核实
- **THEN** 保持对应对象和恢复入口，首读/真实内容各自可辨；普通状态通知不推移原按钮、表单或列表

#### Scenario: 关闭失败通知
- **WHEN** 用户关闭一次保存失败或结果未知的浮动通知
- **THEN** 原表单/对象仍有原因详情和安全恢复入口，草稿及未知写入保护保持，不自动重提

#### Scenario: 后续新增容器
- **WHEN** 后续浏览器 UI 引入确认对话框、浮层或侧栏
- **THEN** 对应变更先明确对象、内容职责、宽度/响应式、焦点与关闭恢复，保留页面主轨道和既有一级 section 对齐


### Requirement: Console 与 Desktop 统一项目 Logo 并移除页头产品名文字

**Identifier:** UIL-010

Console / Serve 管理界面与 CLI Desktop 登录页、Works 列表的现有品牌顶栏 SHALL 使用仓库已有的 Piwork 项目 Logo 作为页头品牌图形；固定使用 `apps/ui-shared/assets/piwork-logo.png` 对应的原 PW 图形，不重绘、换字形或用近似图形替代，Console 登录区域的品牌图形 SHALL 使用同一 Logo。页头品牌区域 SHALL 移除 Logo 旁单独显示的 `PiWork` / `piwork` 产品名文字，以及原先作为占位 Logo 的箱形图标或 `pi` 字符图形；现有 `Serve` / `Desktop` 产品区域标签 SHALL 保留。

品牌链接 SHALL 保留原有返回目标、键盘操作和可见焦点，并提供所选界面语言的可访问名称，使屏幕阅读器仍能识别产品及返回用途。图片 SHALL 保持比例与透明效果，不拉伸、不裁掉图形、不添加改变原 Logo 外观的滤镜。桌面与 360px 视口下，Logo SHALL 清晰可见，且不遮挡导航、账号或主要操作，不引起整页横向滚动。

Logo SHALL 作为本地静态资源随统一 Linux Core 与 Linux CLI 程序交付；未登录页及已登录页均能取得正确图片，深链接不依赖当前页面路径，不需要外部图片站点、源码目录或相邻资源文件。视觉更新 SHALL 保留浏览器文档标题、页面功能标题、Work 名称、业务说明中的产品名称，以及现有认证和 Service 访问边界。

Desktop Work 常规页面 SHALL 使用 V12/V13 的单个紧凑身份栏，在原位置保留 PW 标记、返回、Work 名称与适用动作，不再禁止该已存在的 PW 标记，但不得为其增设第二层品牌或全局顶栏；专注布局继续遵循 DUL-002。

#### Scenario: 管理登录页与已登录管理页
- **WHEN** 管理员打开 Console 登录页，并登录后进入 Overview 或其他管理路由
- **THEN** 顶栏及登录区域的品牌图形使用现有项目 Logo，顶栏品牌区域不再显示独立 Piwork 文字，Serve 标签和原导航仍可辨识

#### Scenario: Desktop 登录与 Work 页面
- **WHEN** 用户启动受支持的 Linux CLI Desktop 或通过受支持浏览器访问托管 Desktop，查看连接页、Work 列表和某个 Work 的常规布局
- **THEN** 登录页和 Works 列表的品牌顶栏使用同一项目 Logo 且移除旁边的独立 piwork 文字，保留 Desktop 标签；Work 页面保留单个紧凑身份栏内原 PW 标记、Work 名称、状态及返回和其他操作，不新增第二层品牌顶栏

#### Scenario: 品牌返回与无障碍名称
- **WHEN** 用户以键盘聚焦品牌链接或使用屏幕阅读器浏览页头
- **THEN** 品牌链接有可见焦点和所选界面语言的可访问名称，激活后沿原规则返回管理首页或 Work 列表，Logo 本身不产生重复的可访问名称

#### Scenario: 深链接与独立二进制交付
- **WHEN** 用户打开管理详情深链接，或从无源码及无相邻资源文件的目录启动已构建 CLI
- **THEN** Logo 从对应 Console 或本机 Desktop 的固定静态资源地址成功取得，返回 PNG 图片，图形与现有项目 Logo 一致，不请求外部图片站点

#### Scenario: 窄屏与原功能标题
- **WHEN** 用户在 360px 宽屏访问两端登录页和已登录页面
- **THEN** Logo 保持比例且不被裁切，导航与账号入口可达，页面无新增横向溢出；功能标题、Work 名称与浏览器文档标题保持原有意义

### Requirement: CoreSetup 与 Admin 延续 Desktop 的完整控件语言

**Identifier:** UIL-SETUP-001

CoreSetup、统一登录和 Admin SHALL 沿用现有 Piwork Desktop 的 Logo、共享浅色语义令牌、字体、图标笔画、按钮角色、小圆角与细分隔，并使用所选界面语言。CoreSetup 保留快速配置职责，登录后以 Admin 中的 Quick setup 呈现；Admin 名称及管理职责保留，品牌与返回入口可识别。采用规范遵循现行 UI 组件规范，不引入另一套主题或以新增框架作为对齐前提。

同类控件 SHALL 保持字阶、字重、高度、padding、图标尺寸/间距、文字基线和 default/hover/focus-visible/active/disabled/loading/selected（适用时）规则一致。主动作、次级、轻量图标与危险动作保持不同角色；同一任务最多一个突出主动作。不同密度必须由容器角色明确区分，不能因为所属程序不同而产生无依据的新变体。新链接导航使用链接语义并取得与同角色按钮一致的外观，托管 Desktop 的 Sign in 等入口不得遗漏现有样式。图标动作有与所选界面语言一致的名称与提示，等待在原控件/区域可感知，不能仅把所有按钮变灰。

Desktop 账户下拉 SHALL 沿用 DUL-007 与 DUL-OVERLAY-ROLE-001 的命令菜单结构，账号只作为标题显示一次，`Role: Administrator` 和 Core 地址作为次级身份信息。`Administration`（中文为“管理”）SHALL 仅在 Desktop 全局账号菜单提供，并与 `About Piwork` 使用一致的菜单行高度、padding、前置装饰图标尺寸/间距、文字起点、字阶及 hover/focus-visible 状态，不得退化为居中的普通按钮或裸链接。管理导航 SHALL 保留真实链接目标和链接语义，同时取得菜单项语义并参与现有方向键、Home/End、激活、Tab 离开及 Escape 返回触发器的规则；不能只把 button 纳入菜单键盘遍历。仅有效托管管理员显示 Administration；Quick setup 从 Admin 的所属导航进入，不另在 Work 行/Work 菜单增加管理入口，普通用户与独立 CLI Desktop 的既有动作保持；Sign out 仍可辨为危险动作，菜单保持锚定且无模态焦点陷阱。

Admin 中包含 About Piwork 的账户下拉 SHALL 使用同一 Desktop 命令菜单 UX：头像触发器、展开状态、单次账号标题、Role/Core 次级信息、带前置图标的完整菜单行，以及危险 Sign out。Core 地址 SHALL 表示当前实际连接的 Core，缺少已确认信息时明确未取得，不能把独立 Console 自己的地址冒充 Core。About Piwork 保留导航链接语义和现有版本内容；Sign out 保留动作语义、真实等待/错误及会话撤销边界。

Admin 菜单 SHALL 锚定头像，无背景遮罩、模态焦点陷阱或开关动画；支持方向键、Home/End、Enter/Space、Tab 离开及 Escape 返回触发器。外侧关闭 SHALL 保持原点击目标动作，不抢走用户已移交的焦点，拖选跨越菜单边界不误关。导航或身份变化后不得保留旧菜单动作。托管和独立 Console 的同类菜单规则 SHALL 一致，不把 Desktop 专用切换 Core/浏览器授权动作复制到 Admin。

托管 Admin 的 `Workbench` SHALL 是带现有工作台图标的轻量导航链接，固定在头像左侧，与顶栏密度、间距、hover/focus-visible 和禁用/等待规则协调，不能抢占配置表单主动作。链接 SHALL 保留真实工作台目标、可复制/新标签打开语义及现有草稿离开保护。独立 Console 无对应托管工作台时不展示指向自身首页的替代 Workbench。准备结果区的 Open workbench 继续遵守 ONBOARD-003 的完成主动作和全部 Ready 条件，不把该条件扩展到顶栏导航。

Quick setup SHALL 共用 Admin 的顶栏、当前导航和最大 1100px 外层页面轨道，不嵌套另一套 CoreSetup 顶栏。模型与准备任务内容 SHALL 在所属 section 内采用最大约 640px 的单列，标签在输入上方，帮助、字段错误和操作沿同一内容边界排列；独立创建账号/登录继续使用最大 420px 的窄表单。Quick setup 的内部单列不改变其他 Admin 页的 UIL-003/012 网格；标题及一级 section 保持管理外层对齐。步骤、表单和错误变化不得产生无用途横向位移。

基本键盘、可见焦点、原生控件、未保存保护及异步写锁 SHALL 保持。360px 宽屏下输入、长名称、步骤、错误与主动作可达，无整页横滚；长技术值仅在所属区域换行/滚动。后台正常读取静默或局部更新，保存成功使用简短结果，错误与未知结果保留可执行恢复。现有弹层开关保持立即完成，不为视觉对齐增加动画等待、伪进度或额外确认。

#### Scenario: 跨入口的同类按钮
- **WHEN** 用户依次打开 Create admin、Sign in、CoreSetup、Admin Runtime 和托管 Desktop 登录入口
- **THEN** 同角色按钮的字体、图标、边框、圆角、尺寸与交互状态属于同一语言，页面职责和返回目标仍清楚

#### Scenario: 新增导航入口取得完整样式
- **WHEN** 用户在托管 Desktop 的连接页访问 Sign in
- **THEN** 链接取得 Desktop 主动作外观及键盘焦点，目标可复制/打开；不显示未应用控件样式的裸链接

#### Scenario: 账户菜单的管理链接与其他命令对齐
- **WHEN** 托管管理员打开账号下拉，查看 About Piwork、Administration 及其他当前允许的账号命令
- **THEN** 同类命令的行高、图标、文字起点、padding 和 hover/focus 规则一致；账号、Role 与 Core 信息层级清楚，管理链接仍指向对应真实页面，Sign out 保留危险角色

#### Scenario: 用键盘访问账户菜单中的链接
- **WHEN** 管理员使用方向键及 Home/End 遍历账户下拉，激活管理链接或按 Tab/Escape 离开
- **THEN** Administration 等合法导航链接不被跳过，可正常打开目标，关闭沿现有规则返回或移交焦点，不增加背景遮罩或焦点陷阱

#### Scenario: 账户菜单的角色与窄屏
- **WHEN** 普通用户或独立 CLI Desktop 用户打开账户菜单，或管理员在 360px 下查看长账号和 Core 地址
- **THEN** 菜单只提供当前身份/部署方式允许的动作，身份文字与链接可完整访问且不撑宽页面；账户菜单样式修正不改变原切换 Core、浏览器授权或注销语义

#### Scenario: Admin 与 Desktop 的账户菜单一致
- **WHEN** 管理员在 Admin 打开包含 About Piwork 和 Sign out 的账户菜单，并与 Desktop 账户菜单比较
- **THEN** 头像触发、菜单行高度/padding、图标、文字起点、字阶、hover/focus 和身份层级一致；About 是真实链接，Sign out 有危险角色，当前 Core 地址真实可读

#### Scenario: Admin 菜单的键盘和外侧关闭
- **WHEN** 管理员使用方向键/Home/End/Enter/Space、Tab/Escape 或外侧指针操作账户菜单
- **THEN** 菜单项可遍历和激活，Tab 正常离开，Escape 关闭后回到头像；外侧关闭保持原目标动作及其焦点，拖选跨界不误关，页面无背景遮罩或焦点陷阱

#### Scenario: Workbench 属于顶栏导航
- **WHEN** 管理员在任一托管 Admin 页面查看或激活 Workbench
- **THEN** 头像左侧显示带图标的轻量链接，真实目标为工作台且不竞争表单主动作；有草稿时遵守离开保护，无草稿时正常导航，独立 Console 不显示错误目标

#### Scenario: 快速配置使用管理区容器
- **WHEN** 管理员从 Overview 进入 Quick setup，再切换 Runtime 或其他管理页
- **THEN** 顶栏、导航、标题及一级 section 的外层边界保持，Quick setup 内部使用单列任务布局，不出现嵌套顶栏或重复账号创建进度；其他管理表单网格保持

#### Scenario: 字段、错误与主动作对齐
- **WHEN** 模型表单出现帮助文字、某字段错误及提交中反馈
- **THEN** CoreSetup 单列对齐，Admin 沿所属控件列对齐，各自产生稳定结构；错误不挤掉输入或主动作

#### Scenario: 键盘、悬停与禁用
- **WHEN** 用户以鼠标或键盘操作普通、悬停、聚焦、禁用和等待中的同类按钮
- **THEN** 每种状态可辨，焦点可见，禁用有具体原因或下一步，等待不重复提交，选中状态不与焦点混用

#### Scenario: 窄屏与长内容
- **WHEN** 浏览器为 360px 且模型名、错误或诊断镜像引用很长
- **THEN** Logo、输入、管理导航、Workbench 和头像主要动作仍可达，正文与标签可读，长值在所属容器内处理且页面不横滚

#### Scenario: 原有工作区和独立 Console
- **WHEN** 共享控件样式更新后打开既有 Desktop 工作区或独立 Console
- **THEN** 同角色控件一致，Service 应用内部样式、管理导航、危险确认和各自布局保持既有职责，没有全局 CSS 串扰或旧构建资源残留

Work 列表行及其菜单 SHALL 不提供 Administration 或 Requests；打开 Work 后的 Requests 沿 DUL-NAVSCOPE-001 处理。删除这些跨层级入口不删除当前适用的语言入口、Work 信息、危险操作确认或诊断恢复。

## ADDED Requirements

### Requirement: Desktop 与 Serve 使用有对象归属的统一浮动通知

**Identifier:** UIL-NOTICE-001

Desktop 与 Serve SHALL 使用单一浮动通知宿主呈现适合通知的短结果和可恢复问题，替代额外插入、推动正文的普通状态 Alert 框。普通请求等待仍在原控件/对象固定槽；首次读取、确认空集合、首次读取失败、旧数据及其刷新失败、连接/准入限制 SHALL 保留所属无框内容和恢复出口，不能因移除 Alert 而只剩会消失的 toast。字段错误、危险/未保存确认、私有包提醒和必要安全说明不被通知取代。Files/Chat普通成功读取与正常后台轮询不产生成功通知。

通知 SHALL 带原身份、对象、任务/动作及代次归属与稳定事件 key，按状态变化去重而非每次 render/轮询重新触发；同一事件只播报一次。普通成功短暂收敛；错误/未知通知不自动计时消失，可显式关闭；关闭后原状态与安全恢复仍在。错误/未知不被无关成功或同对象的另一动作抹去，仅匹配原任务的新确认才能替代旧未知。关闭/超时/替换只改变展示，不取消业务、不解除未知锁、不重放写入；必要恢复在所属对象仍可访问。通知不得收集跨对象历史成为全局 Operation 中心，不承载凭证或未经处理的服务端文本。

浮动位置 SHALL 采用所属 V13 的稳定 overlay 位置，并经宽屏/360px、长中英文、打开进度面板/模态的实测决定必要避让；不得推移页头/正文、遮挡主要动作、抢焦点或增加第二个遮罩。通知的具名恢复动作由所属功能重新核实身份和原任务后执行；普通 Check 仅查询。已有 package 协议明确允许的稳定幂等键 Resume 保持其范围，不推广为通用自动重放。

#### Scenario: 已保存但关联刷新失败
- **WHEN** Serve 已确认修改成功而后续列表/状态读取失败
- **THEN** 通知与原对象准确区分修改已确认和当前状态未确认，只读刷新不再次执行修改，原草稿与敏感清理规则保持

#### Scenario: 未知与另一动作并发
- **WHEN** 一个写入结果未知，随后另一对象或同对象另一动作返回成功
- **THEN** 后者不清除原未知、原写入锁及恢复入口；相同任务的有效新确认才可更新旧反馈

#### Scenario: 身份切换或关闭通知
- **WHEN** 用户关闭通知或切换账号/Core
- **THEN** 关闭不影响任务，身份切换清除旧身份内容与动作；晚结果不能覆盖新身份或触发未授权恢复

#### Scenario: 首读失败与字段错误
- **WHEN** 内容首次读取失败或提交出现字段校验错误
- **THEN** 所属区域保留真实原因/恢复，字段旁保留修正提示；不以空态、旧成功或短暂通知代替它们

#### Scenario: 错误和未知通知显式关闭
- **WHEN** 一个失败或结果未知通知持续显示，之后用户显式关闭它
- **THEN** 它不曾因普通成功计时自动消失；关闭只移除通知，原对象原因/安全恢复与原未知锁继续保留

#### Scenario: 模态与窄屏中的通知
- **WHEN** 360px 或打开确认窗时出现必要通知
- **THEN** 只有一个可访问宿主，主动作可达、焦点不被抢走、页面不横向溢出；通知关闭不关闭确认或取消任务

### Requirement: 图标语义与紧凑头部跨入口一致

**Identifier:** UIL-V13-CHROME-001

Desktop/Serve SHALL 沿用已确认的 V12 紧凑头部层级与原 PW 资源，不因等待、通知或增加评审入口而增高头部或新增无用途空白。宽屏 Desktop 首页与 Admin Header SHALL 等高为最新批准 V14 的 52px，并共享水平对齐基线；Work 身份 Header 同为 52px，Service Toolbar 保持 39px 的次级密度。首页 Header 的既有 B 控件保持 icon-only，Work 列表的 Open 仍为图标加文字。窄屏按 V14 必要布局折行为 88px 双行而不隐藏主要操作，不将旧约64–72px身份栏基线强加给新的紧凑 Work Header。

Work 的 Open SHALL 使用表示进入工作区的箭头形，不使用播放或外链箭头；Start 仍表示生命周期启动，Service 新标签打开仍使用外链语义。Refresh SHALL 共用单圆箭头路径，常规可见 Refresh 图形为18×18 CSS px，不回退双向/双箭头或因 `.small` 覆盖缩成16px；图形尺寸不缩小原可操作热区。两端所有同语义 Refresh 使用同一来源，状态切换保持固定槽、可访问名称与 tooltip。

V14 最新批准的视觉参考 SHALL 以所属 change 冻结附件为准；Service、Files 与 Agent 次级工具栏保持 39px。Administration 的 Overview、Users、Setup、Models 四个短主导航与 Services/Files/Chat 导航 SHALL 使用对应批准的 18px SVG，保留双语可访问名称、真实权限及原导航目标；Setup 下 Defaults/Skills/Packages 次级导航 SHALL 保持 39px。Quick setup、Skills、Find operation 与已知未结束操作 SHALL 继续在所属管理入口可达，不移动到 Work 行菜单。正常密度 SHALL NOT 裁掉长错误、未知状态或必要恢复控制。

#### Scenario: V14 覆盖历史视觉数值而不覆盖业务
- **WHEN** 实施者将冻结 V14 的 52px/88px 头部及 SVG 导航应用到产品
- **THEN** 使用真实会话、健康及模型来源，保留首次读取、陈旧与未知状态；宽屏和 360px 对照验收分别记录，不能以历史 V13 测试或原型模拟宣称 V14 通过

#### Scenario: Open 与 Start 分开
- **WHEN** Ready Work 显示 Open 而 Stopped Work 显示 Start
- **THEN** Open 是进入工作区箭头并仅导航，Start 是启动命令；Service 外链图标不被用于 Work Open

#### Scenario: Refresh 大小一致
- **WHEN** 用户比较 Works、Files、Serve 或详情里的常规 Refresh
- **THEN** 都是18px单圆箭头且使用共享定义，热区/文字对齐和 busy前后几何保持

#### Scenario: 紧凑 Header 与原 PW 标记
- **WHEN** 宽屏或窄屏查看 Works、Work、Service 和 Admin
- **THEN** 沿 V12/V13 的紧凑层级保留必要名称与动作，PW 图形不变形不重绘，不因普通反馈新增头部行

### Requirement: 所有来源状态均有可追溯的实际验收

**Identifier:** UIL-V13-MAP-001

本变更 SHALL 覆盖当前 Desktop 和 Serve 所有可观察的异步状态与独立表单，包括原型未画出的登录、会话失效、初始壳、失败/未知分支和托管 Quick setup。35个来源族及原型代表场景是下限索引，不是允许延后真实分支的范围上限；逐族记录源码状态、入口、恢复、测试及证据，不支持组合明确不适用。Launcher、第三方 Service 页面内部及新增宿主控制不纳入；共享初设入口须保留加载/失败/身份回归，不新增第三套视觉改版。

验收 SHALL 区分首读无确认、确认空、初读失败、已有数据刷新、刷新失败保留旧值、请求在途、已接受任务、可量化传输、慢但未失败、明确失败、未知、暂停及终态；状态语义不依赖统一 `loading` 布尔值或动画。关键初始会话/准入读取按既有有界预算恢复，不能无限以 slow 动效掩盖失败；真实长期任务不因等待时长被伪造为失败。身份/路由/对象代次、双击与多入口、旧回调、焦点/草稿/iframe、语言切换及安全恢复 SHALL 有对应测试。

原型模拟、静态检查、浏览器交互和真实 Core/helper/API/下载验证 SHALL 分开记录；每个需要的分支必须有通过证据或明确阻点，不用“V13里没有”作为静默延期理由，不声称所有后端状态已经测试。

#### Scenario: 原型未包含 Console 登录
- **WHEN** 实施者按原型清单实施统一状态反馈
- **THEN** 仍验收实际登录/未知结果、退出、会话失效及初始读取恢复，不能因V12缺该画面而遗漏

#### Scenario: 关键首读超过预算
- **WHEN** 初始会话或准入读取到达既有超时预算但尚无确认
- **THEN** 转为可恢复的未确认状态并保留安全重试/导航，不无限动画、不伪造已登录或空集合

#### Scenario: 模拟导出与真实交付
- **WHEN** 原型展示下载交接但尚未完成真实链路验收
- **THEN** 只记录模拟覆盖；生产完成仍需原ID/字节/hash、单次交付与权限边界证据，不宣称文件已落盘
