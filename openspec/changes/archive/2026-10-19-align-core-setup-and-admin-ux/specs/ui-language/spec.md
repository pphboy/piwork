# Spec Delta

## ADDED Requirements

### Requirement: CoreSetup 与 Admin 延续 Desktop 的完整控件语言

**Identifier:** UIL-SETUP-001

CoreSetup、统一登录和 Admin SHALL 沿用现有 Piwork Desktop 的 Logo、共享浅色语义令牌、字体、图标笔画、按钮角色、小圆角与细分隔，并保持英文 UI。CoreSetup 保留快速配置职责，登录后以 Admin 中的 Quick setup 呈现；Admin 名称及管理职责保留，品牌与返回入口可识别。采用规范遵循现行 UI 组件规范，不引入另一套主题或以新增框架作为对齐前提。

同类控件 SHALL 保持字阶、字重、高度、padding、图标尺寸/间距、文字基线和 default/hover/focus-visible/active/disabled/loading/selected（适用时）规则一致。主动作、次级、轻量图标与危险动作保持不同角色；同一任务最多一个突出主动作。不同密度必须由容器角色明确区分，不能因为所属程序不同而产生无依据的新变体。新链接导航使用链接语义并取得与同角色按钮一致的外观，托管 Desktop 的 Sign in 等入口不得遗漏现有样式。图标动作有英文名称与提示，等待在原控件/区域可感知，不能仅把所有按钮变灰。

Desktop 账户下拉 SHALL 沿用 DUL-007 与 DUL-OVERLAY-ROLE-001 的命令菜单结构，账号只作为标题显示一次，`Role: Administrator` 和 Core 地址作为次级身份信息。新增 `Administration`、`Quick setup` SHALL 与 `About Piwork`、`Known operations` 使用一致的菜单行高度、padding、前置装饰图标尺寸/间距、文字起点、字阶及 hover/focus-visible 状态，不得退化为居中的普通按钮或裸链接。管理导航 SHALL 保留真实链接目标和链接语义，同时取得菜单项语义并参与现有方向键、Home/End、激活、Tab 离开及 Escape 返回触发器的规则；不能只把 button 纳入菜单键盘遍历。仅有效托管管理员显示两个管理入口，普通用户与独立 CLI Desktop 的既有动作保持；Sign out 仍可辨为危险动作，菜单保持锚定且无模态焦点陷阱。

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
- **WHEN** 托管管理员打开账号下拉，查看 About Piwork、Known operations、Administration 和 Quick setup
- **THEN** 四项的行高、图标、文字起点、padding 和 hover/focus 规则一致；账号、Role 与 Core 信息层级清楚，管理链接仍指向对应真实页面，Sign out 保留危险角色

#### Scenario: 用键盘访问账户菜单中的链接
- **WHEN** 管理员使用方向键及 Home/End 遍历账户下拉，激活管理链接或按 Tab/Escape 离开
- **THEN** Administration 和 Quick setup 不被跳过，可正常打开目标，关闭沿现有规则返回或移交焦点，不增加背景遮罩或焦点陷阱

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
