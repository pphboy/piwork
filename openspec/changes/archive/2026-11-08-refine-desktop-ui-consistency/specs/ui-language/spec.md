# Spec Delta

## MODIFIED Requirements

### Requirement: 浏览器界面自动选择并允许手动选择语言

**Identifier:** UIL-I18N-001

Desktop 工作台、Serve 管理界面、登录和首次初始化 SHALL 支持 `zh-CN` 简体中文和 `en` 英文界面。浏览器当前 origin 没有有效的显式选择时，界面 SHALL 按浏览器语言偏好顺序匹配：中文语言标签使用简体中文，英文语言标签使用英文；均不匹配时使用英文。语言选择 SHALL 提供“跟随浏览器”、`简体中文` 和 `English` 三项并标识当前偏好，并在登录前、登录后可由键盘访问；Desktop 登录后的手动语言入口 SHALL 集中在全局账户菜单，Work 行菜单、Work 详情菜单及 Work Settings 不再另设入口；选择只改变界面呈现。选择 SHALL 立即应用；显式语言保存在当前浏览器的 origin 内并优先于浏览器语言。“跟随浏览器”为默认偏好，选择后 SHALL 清除原显式语言并重新匹配浏览器偏好，不将当前匹配语言另存为手动选择。

登录及首次初始化页 SHALL 保留带地球图标、当前偏好和下箭头的轻量语言入口。登录后的账户菜单保留一行带图标、当前偏好和展开提示的语言项，并侧向展开为其明确归属的二级单选 Pop，父菜单保持展开；空间不足时翻转/约束到视口。该有父子关系的语言选择是允许的菜单层级例外，不是无归属叠层，不新增模态遮罩或焦点陷阱。选择项继续为跟随浏览器、简体中文、English，选中项勾选；选择后关闭子层并更新真实界面及原偏好。支持方向键、Home/End、Enter/Space，右方向进入子层，左方向或首次 Escape 返回父项，再次 Escape 关闭父菜单；Tab/外侧关闭保持合理焦点移交。360px 下两层均可操作且不溢出，身份/导航变化关闭旧层。

同一 origin 的托管登录、初始化、Desktop 和 Serve SHALL 读取同一语言偏好；其他 IP、端口或独立 CLI Desktop origin SHALL 按各自浏览器来源保存，不要求跨设备或账号同步。存储被拒绝或不可用时 SHALL 不阻止使用或切换，本页维持选择，下次访问按可取得的偏好重新确定语言；无效保存值 SHALL 被忽略。偏好 SHALL 不包含账号凭证、业务草稿或其他用户数据。

#### Scenario: 按浏览器偏好选择
- **WHEN** 首次打开任一界面且没有保存的选择，浏览器首个可匹配语言依次为 `zh-CN`、`zh-TW` 或 `en-US`
- **THEN** 前两者使用简体中文，英文标签使用英文；未匹配的语言按后续偏好继续检查，完全不匹配时使用英文

#### Scenario: 显式选择覆盖自动选择
- **WHEN** 中文浏览器从菜单选择 `English`，随后刷新并在同一 origin 进入工作台、管理界面或登录页
- **THEN** 界面使用英文且菜单标识该选择；其他 origin 不因此被修改

#### Scenario: 登录前选择及存储不可用
- **WHEN** 用户在登录或首次初始化时通过键盘选择语言，或浏览器拒绝本地存储
- **THEN** 当前页面可切换且仍可使用；不可保存时不宣称偏好已持久化，后续页面按可取得的偏好与浏览器语言确定

#### Scenario: 恢复跟随浏览器
- **WHEN** 中文浏览器已手动选英文，用户打开语言选择并选择跟随浏览器
- **THEN** 原显式偏好被清除，立即使用中文；同源刷新继续按浏览器偏好匹配，其他来源不被修改

#### Scenario: 统一入口与轻量选择
- **WHEN** 用户在登录/初始化或全局账户菜单访问语言选择，也查看 Work 行、Work 详情与设置
- **THEN** 登录前入口继续可用；账户语言以侧向二级 Pop 选择并正确返回父层，Work 两处菜单及 Settings 没有重复语言项；偏好即时生效且键盘/360px 可用


### Requirement: 图标语义与紧凑头部跨入口一致

**Identifier:** UIL-V13-CHROME-001

Desktop/Serve SHALL 沿用当前共享浅色语言、紧凑头部层级与原 PW 资源，不因等待、通知或增加评审入口而增高头部或新增无用途空白。宽屏 Desktop 首页与 Admin Header SHALL 等高为52px，并共享水平对齐基线；Work 身份 Header 同为 52px，Service Toolbar 保持 39px 的次级密度。首页 Header 的既有 B 控件保持 icon-only，Work 列表/卡片的 Open 使用明确的轻量文字导航，必要的进入图形按同一语义取得，不强制再附图标。窄屏按必要布局折行为88px双行而不隐藏主要操作；其他本次未涉及的管理页面与表单继续使用自己的有效布局。

Work 的 Open SHALL 明确表示进入工作区，不使用播放或 Service 外链语义；列表/卡片允许只显示明确文字，其他需要图形的完成出口仍用共享进入语义。Start 继续表示生命周期启动，Service 新标签打开使用外链语义。Refresh SHALL 共用本变更确定的循环双箭头路径，常规图形为18×18 CSS px，不因小尺寸上下文缩成16px；图形尺寸不缩小原可操作热区。两端同语义 Refresh 使用同一来源，发起动作与真实目标由准确文字/无障碍名表达，busy 前后保持固定槽与几何。

本次局部呈现更新 SHALL 以当前规格和所属冻结原型为准，不从历史画面推导未声明的新行为；Service 与 Chat 次级工具栏保持39px；Files 列表/详情工具栏使用本变更明确的 44px 局部密度。Administration 的 Overview、Users、Setup、Models 四个短主导航与 Services/Files/Chat 导航 SHALL 使用对应批准的 18px SVG，保留双语可访问名称、真实权限及原导航目标；Setup 下 Defaults/Skills/Packages 次级导航 SHALL 保持 39px。Quick setup、Skills、Find operation 与已知未结束操作 SHALL 继续在所属管理入口可达，不移动到 Work 行菜单。正常密度 SHALL NOT 裁掉长错误、未知状态或必要恢复控制。

#### Scenario: V14 覆盖历史视觉数值而不覆盖业务
- **WHEN** 实施者将52px/88px头部、Files的44px局部密度及共享图形应用到产品
- **THEN** 使用真实会话、健康及模型来源，保留首次读取、陈旧与未知状态；宽屏和 360px 对照验收分别记录，不能以历史记录或合成原型模拟宣称真实实现已通过

#### Scenario: Open 与 Start 分开
- **WHEN** Ready Work 显示 Open 而 Stopped Work 显示 Start
- **THEN** 列表/卡片的 Open 是明确的轻量文字导航且仅进入工作区，Start 仍执行启动；必要进入图形不使用 Service 外链或播放语义

#### Scenario: Refresh 大小一致
- **WHEN** 用户比较 Works、Files、Serve 或详情里的常规 Refresh
- **THEN** 18px循环双箭头来自同一共享定义，热区/文字对齐及 busy 前后几何保持，不用相似图形暗中切换身份或重试业务

#### Scenario: 紧凑 Header 与原 PW 标记
- **WHEN** 宽屏或窄屏查看 Works、Work、Service 和 Admin
- **THEN** 沿 V12/V13 的紧凑层级保留必要名称与动作，PW 图形不变形不重绘，不因普通反馈新增头部行

### Requirement: Core 内嵌管理 UI 延续 Desktop 控件语言

**Identifier:** UIL-SETUP-001

CoreSetup、统一登录和 Admin SHALL 沿用现有 Piwork Desktop 的 Logo、共享浅色语义令牌、字体、图标笔画、按钮角色、小圆角与细分隔，并使用所选界面语言。CoreSetup 保留快速配置职责，登录后以 Admin 中的 Quick setup 呈现；Admin 名称及管理职责保留，品牌与返回入口可识别。采用规范遵循现行 UI 组件规范，不引入另一套主题或以新增框架作为对齐前提。

同类控件 SHALL 保持字阶、字重、高度、padding、图标尺寸/间距、文字基线和 default/hover/focus-visible/active/disabled/loading/selected（适用时）规则一致。主动作、次级、轻量图标与危险动作保持不同角色；同一任务最多一个突出主动作。不同密度必须由容器角色明确区分，不能因为所属程序不同而产生无依据的新变体。新链接导航使用链接语义并取得与同角色按钮一致的外观，托管 Desktop 的 Sign in 等入口不得遗漏现有样式。图标动作有与所选界面语言一致的名称与提示，等待在原控件/区域可感知，不能仅把所有按钮变灰。

Desktop 账户下拉 SHALL 沿用 DUL-007 与 DUL-OVERLAY-ROLE-001 的命令菜单结构，账号只作为标题显示一次，`Role: Administrator` 和 Core 地址作为次级身份信息。`Administration`（中文为“管理”）SHALL 仅在 Desktop 全局账号菜单提供，并与 `About Piwork` 使用一致的菜单行高度、padding、前置装饰图标尺寸/间距、文字起点、字阶及 hover/focus-visible 状态，不得退化为居中的普通按钮或裸链接。管理导航 SHALL 保留真实链接目标和链接语义，同时取得菜单项语义并参与现有方向键、Home/End、激活、Tab 离开及 Escape 返回触发器的规则；不能只把 button 纳入菜单键盘遍历。仅有效托管管理员显示 Administration；Quick Setup 在同一有权托管管理员的 Desktop 全局账户菜单可有直达 /admin/setup 的快捷链接，同时保留 Admin Overview 的原入口；它复用原模型/准备流程，不另建配置流程，也不进入 Work 行/Work 菜单，普通用户与独立 CLI Desktop 的既有动作保持；Sign out 仍可辨为危险动作，菜单保持锚定且无模态焦点陷阱。

Admin 中包含 About Piwork 的账户下拉 SHALL 使用同一 Desktop 命令菜单 UX：头像触发器、展开状态、单次账号标题、Role/Core 次级信息、带前置图标的完整菜单行，以及危险 Sign out。Core 地址 SHALL 表示当前实际连接的 Core，缺少已确认信息时明确未取得，不能把 UI 自己的地址冒充 Core。About Piwork 保留导航链接语义和现有版本内容；Sign out 保留动作语义、真实等待/错误及会话撤销边界。

Admin 菜单 SHALL 锚定头像，无背景遮罩、模态焦点陷阱或开关动画；支持方向键、Home/End、Enter/Space、Tab 离开及 Escape 返回触发器。外侧关闭 SHALL 保持原点击目标动作，不抢走用户已移交的焦点，拖选跨越菜单边界不误关。导航或身份变化后不得保留旧菜单动作。Core 内嵌管理区同类菜单规则 SHALL 一致，不把 Desktop 专用切换 Core/浏览器授权动作复制到 Admin。

托管 Admin 的 `Workbench` SHALL 是带现有工作台图标的轻量导航链接，固定在头像左侧，与顶栏密度、间距、hover/focus-visible 和禁用/等待规则协调，不能抢占配置表单主动作。链接 SHALL 保留真实工作台目标、可复制/新标签打开语义及现有草稿离开保护。准备结果区的 Open workbench 继续遵守 ONBOARD-003 的完成主动作和全部 Ready 条件，不把该条件扩展到顶栏导航。

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

#### Scenario: 原有工作区和 Core 内嵌管理区
- **WHEN** 共享控件样式更新后打开既有 Desktop 工作区或 Core 内嵌管理区
- **THEN** 同角色控件一致，Service 应用内部样式、管理导航、危险确认和各自布局保持既有职责，没有全局 CSS 串扰或旧构建资源残留

Work 列表行及其菜单 SHALL 不提供 Administration 或 Requests；打开 Work 后的 Requests 沿 DUL-NAVSCOPE-001 处理。语言集中在全局账户的二级 Pop，Work 行/详情菜单和 Settings 不保留重复语言项；这不删除 Work 信息、危险确认或所属诊断恢复。

#### Scenario: 全局 Quick Setup 快捷入口
- **WHEN** 托管管理员、普通用户或独立 CLI Desktop 用户打开账户菜单
- **THEN** 仅有权托管管理员看到真实 /admin/setup 快捷链接；原管理/日志/语言/退出等合法动作仍可达，进入 Quick Setup 沿用原授权和未保存保护，不自动创建 Work 或配置 Runtime


### Requirement: Work 路由读取不推移共用 Header

Desktop 在进入 Work 或其 Service、Files、Chat 和 Settings 时，SHALL 不在共用 Header 显示读取三点或插入慢读取文字；必要读取以既有预留槽中的局部骨架表达，不增高头部或移动名称、真实状态和相邻动作。已确认字段在背景重读时保留，尚待确认字段使用骨架；不能把真实失败或未知状态替换成无意义的持续加载。读取保留可访问 busy/状态说明。Core 检查、Work 同步与生命周期仍表达实际事实、接受目标和必要恢复；所属正文的首次骨架、错误重试、草稿及已取得 iframe 按原规则保持。

此要求作为 UIL-PENDING-001 的窄范围呈现例外：Work 身份 Header 以及本变更涉及的 Service/Chat/连接信息头部中的只读加载槽使用固定几何骨架，减少动态效果时静态；慢读取的可访问说明不占新布局，实际超时/失败仍有可见原因和只读恢复。明确发起按钮中的 pending、生命周期任务、传输进度与 Header 以外的等待继续依所属契约；同一检查不同时增加两个主要等待动画。骨架结束不等于业务完成，不释放未知保护或重发用户动作。

#### Scenario: 进入 Service 及切换 Work 区域
- **WHEN** 用户打开 Work 或进入 Service、Files、Chat、Settings，相关字段正在读取或读取结束
- **THEN** Header 没有三点和慢读取文字；未确认区域用预留槽骨架，名称、已确认状态和相邻动作不位移，正文首读/真实错误/可访问说明保留

#### Scenario: 慢读取和失败
- **WHEN** Work 路由读取持续或其中一次读取超时、失败
- **THEN** 不插入推移 Header 的临时提示；内容区按原规则显示待确认或实际原因及只读重试，不用空集合伪装失败，也不自动重发写入

#### Scenario: Core 检查和 Work 状态同步
- **WHEN** 用户已进入 Work，Core 检查、状态同步或生命周期动作等待确认
- **THEN** 头部只读等待使用其固定槽骨架，真实状态、操作接受/失败/未知及必要恢复仍可辨；发起按钮和其他区域沿原规则，不增加重复主要等待
