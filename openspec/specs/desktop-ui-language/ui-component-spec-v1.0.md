# Piwork UI Component Specification v1.0

> Status: Proposed · Scope: Piwork desktop-oriented Web UI · Language: zh-CN · Updated: 2026-10-14
>
> 目的：使设计者、AI Agent、开发者和 Reviewer 以一致的交互语义选择组件；降低误用、返工和局部 UX 缺陷。此文档是产品级约束，不是 UI 库 API 清单。

## 0. 规范使用方式

**MUST** 必须遵守；**SHOULD** 默认遵守，例外需说明；**MAY** 可按场景选择。每次新增或修改交互，先确定 `user intent → task scope → interruption → interaction pattern → component → states`，不得从组件长相反推用途。

优先级：① 用户任务与语义 ② 无障碍及输入方式 ③ 状态和失败路径 ④ 空间层级 ⑤ 视觉样式及动画。禁止因现有组件“容易写”而改变用户任务语义。产品约定不是 W3C 强制规范；如与 WAI-ARIA / WCAG 要求冲突，以可访问性要求为准。

### 0.1 组件选择的六个问题
1. **意图**：执行命令、导航、输入、选择、查看信息，还是反馈状态？
2. **作用域**：当前字段、对象、面板、工作区，还是全局？
3. **中断性**：是否必须先处理此事才能继续背景任务？
4. **持续性**：一次性的短任务，还是要持续工作、参照背景内容？
5. **风险**：可逆、不可逆、权限/资金/数据损失；是否需要确认？
6. **复杂度**：容器是否容纳得下内容、错误、键盘操作和小屏？

### 0.2 快速路由
- 解释元素 → Tooltip；预览对象 → Hover Card / Preview。
- 触发立即动作 → Button；导航 → Link / NavItem。
- 多条**命令** → Dropdown Menu；右键命令 → Context Menu。
- 选一个**值** → Select / Radio / Combobox；选多个独立值 → Checkbox。
- 轻量局部内容/编辑且保留背景任务 → Popover；持续编辑且需要参照背景 → Side Panel / Split View。
- 必须暂时阻断背景的短任务 → Modal Dialog；不可逆决定 → Alert Dialog（仅在确需事前确认时）。
- 长且复杂的流程 → Page / Wizard；不要把完整工作空间塞进 Dialog。
- 短暂操作结果 → Toast；需要持续关注的局部问题 → Inline Alert；页面级持续信息 → Banner。

## 1. Actions｜操作组件

| 组件 | 正确语义 / 适用 | 禁止或避免 | 最低交互契约 |
|---|---|---|---|
| Button | 执行命令、提交、保存、打开对话框 | 用作页面导航链接；没有行为的装饰 | 文字是动词/明确结果；支持 disabled/loading；防重复提交 |
| Primary Button | 当前任务的首要行动 | 同一局部区域出现多个同权重主按钮 | 优先级由任务决定，不由品牌色决定 |
| Secondary / Tertiary Button | 次要、可选或低强调行动 | 把破坏性行动伪装成普通行动 | 风格需在系统中一致 |
| Destructive Button | 删除、永久重置等破坏操作 | 所有负面文案都染红 | 风险真实；必要时配确认和可恢复策略 |
| Icon Button | 图标含义清晰的紧凑行动（展开、关闭） | 无 accessible name；含义模糊又无提示 | aria-label；Tooltip 补充；热区达标；pressed/expanded 状态准确 |
| Link | 去往页面、资源、外部地址 | 借 `<a>` 执行副作用 | 可复制目标 URL；可新标签打开；外链行为明确 |
| Toggle Button | 工具状态切换，如显示/隐藏辅助层 | 用作普通提交、长期开关设置 | `aria-pressed`；图标和名称表达当前状态或下一动作需一致 |
| Toggle Group | 在一组工具模式中切换 | 混用成表单单选但无法表达标签 | 明确单选/多选；键盘行为符合实现模式 |
| Split Button | 主动作 + 相关替代动作（如 Export + 格式菜单） | 只有一项、动作没有明确默认值 | 主动作与菜单按钮均可独立访问 |
| Floating Action Button | 窄屏单一突出创建动作（可选） | 桌面端到处悬浮、覆盖重要内容 | 不遮挡内容或键盘焦点 |

**关键区分：** `Button ≠ Link`；`Toggle Button ≠ Switch`；`Icon Button` 不是“无文字按钮”的免责理由。

## 2. Overlays｜浮层与暂态容器

| 组件 | 正确语义 / 适用 | 禁止或避免 | 最低交互契约 |
|---|---|---|---|
| Tooltip | 对控件提供简短说明 | 承担必读说明、表单或可点击核心操作 | 悬停与键盘焦点可触发；可退出；不要遮蔽触发对象 |
| Hover Card | 非关键对象预览（链接、用户、文件摘要） | 用于必须点击的操作或仅 hover 才能取得的信息 | 指针可进入预览区域；移动设备另有路径 |
| Popover | 锚定触发元素的轻量表单、筛选、快捷设置 | 大型配置页、危险确认、纯命令菜单 | 清晰触发/关闭；锚点与边界定位；焦点管理；外部点击策略明确 |
| Dropdown Menu | 一组命令（Rename / Duplicate / Delete） | 用它模拟任意复杂表单；用来冒充 Select 值选择 | 上下方向键、Enter/Space、Esc；命令后关闭策略；危险项区分 |
| Context Menu | 对当前对象的上下文命令 | 唯一操作入口；键盘和触屏无替代 | 右键及键盘入口（如 Shift+F10）；与 `…` 菜单命令一致 |
| Select Popup | 从选项中选择一个值 | 以“命令菜单”代码存储选定值 | 选中状态、键盘导航、typeahead（适用时） |
| Non-modal Dialog | 浮动的独立工具窗口，同时需操作背景 | 不明确的焦点交接；随意叠加浮层 | 明确焦点与层级；背景仍可操作 |
| Modal Dialog | 短暂、独立且必须先完成/取消的任务 | 长期工作、背景参照、仅展示轻量提示 | 背景不可交互；焦点进入与约束；关闭后恢复焦点；标题/说明 |
| Alert Dialog | 需要明确响应的高风险/不可逆决定 | 所有普通确认、成功提示 | 精确后果、取消路径、审慎默认焦点；不可误触 |
| Drawer / Side Sheet | 侧边展示详情、检查器或编辑 | 把非模态 Drawer 硬做成不可理解的遮罩 | **必须声明 modal 或 non-modal**；焦点规则与声明一致 |
| Bottom Sheet | 触屏窄屏的操作/内容容器 | 不加判断套用于所有桌面功能 | 拖拽、滚动、焦点和安全区域处理 |
| Full-screen Dialog | 在小屏上承载需独立完成的任务 | 以“全屏”代替复杂信息架构 | 返回、保存草稿、未保存离开策略 |

**重要：** Popover 也能被实现成 modal；Dialog 也可 non-modal；Drawer 是空间位置，不自动表示是否阻断。此 Spec 规定的是**产品选择默认值**，不能把组件库 API 名称当作语义判定。

**禁止：** 用 Toast 代替危险操作确认；用 Tooltip 放唯一功能入口；用 Dropdown Menu 包复杂表单；两个 Popover/Modal 相互覆盖却没有层级和焦点策略。Dialog 不应默认“点击背景即关闭”：有未保存内容、进行中的危险操作等必须防误关。

## 3. Inputs｜输入与选择

| 组件 | 正确语义 / 适用 | 禁止或避免 | 最低交互契约 |
|---|---|---|---|
| Text Input | 短文本、名称、搜索条件 | 长文编辑 | Label、placeholder 非唯一标签、错误描述 |
| Textarea | 多行自然语言、描述、Prompt | 代码编辑或富文本需求 | 可扩展高度、换行、必要时字符限制 |
| Search Field | 搜索数据集合 | 用于提交业务表单但标成搜索 | 清空、空结果、加载、筛选范围明确 |
| Password Field | 密码/密钥的输入 | 敏感值自动显示或写日志 | 显隐按钮标签、自动填充策略、错误安全 |
| Number Input | 数值及范围约束 | 电话、版本号、邮编等有格式但非数量的标识 | 输入法/精度/上下限/单位清晰 |
| Checkbox | 多选、同意、独立布尔字段 | 单选互斥组、即时环境开关不合适时 | checked/unchecked/indeterminate；标签可点击 |
| Radio Group | 数量有限、互斥且应同时可见的选项 | 海量数据列表 | 同组只能选一个；完整描述；方向键导航 |
| Switch | 立即生效的开/关设置 | 提交命令、删除；与保存按钮配合但状态语义不清 | 当前状态清楚，改变即时反馈，必要时可撤销 |
| Select | 固定单选项，选项一般不用自由输入 | 任意搜索/创建新值；命令集合 | 当前值、空值、Disabled 项、键盘选择 |
| Combobox | 可输入搜索 + 选择建议/候选值 | 普通文本框无需候选；简单固定三选一 | 输入与弹层关联、上下键、选中/清除、无匹配提示 |
| Multi-select | 多值选择，选项多时可搜索 | 仅两个布尔开关却用标签选择器 | 已选数、标签移除、全选的含义及状态 |
| Slider | 连续或等间隔范围，重视直观调整 | 需要准确键入金额/端口/高精度值而无数值输入 | 当前值/界限/步长/方向键；必要时配输入框 |
| Date / Time Picker | 日期、时间及日期范围 | 短且易键入的数值被强制只能点日期格 | 时区、格式、范围、无效日、手动输入策略 |
| File Input / Picker | 选择本地文件 | 文件上传与导入业务任务混为一谈 | 类型/大小/多选规则，取消后保留既有状态 |
| Color Picker | 颜色选择 | 用颜色独自表达业务状态 | 可读颜色值/对比度及其他文字表达 |
| Field / Form | 字段组、验证、提交 | 无语义分组或错误与字段脱节 | 标签、必填、错误位置、提交中、成功/失败处理 |

**区分口诀：** Checkbox=独立选项/多选；Radio=互斥选择；Switch=即时改变开关；Toggle Button=工具/展示模式的按压状态；Select=固定值；Combobox=可输入查找候选值。

## 4. Navigation｜导航与定位

| 组件 | 正确语义 / 适用 | 禁止或避免 | 最低交互契约 |
|---|---|---|---|
| App Sidebar / Nav Rail | 应用级目的地与主要模块 | 把每条临时命令做成路由入口 | 当前位置、收起态、键盘、狭窄屏处理 |
| Navigation Menu | 多目的地、层级性导航 | 替代 Dropdown Menu 命令集合 | Link 语义、当前层级、打开/关闭策略 |
| Tabs | 同一上下文里切换并列内容面板 | 步骤向导、执行操作、完全不同应用目的地 | 当前 tab、箭头键导航、焦点与状态保持策略 |
| Segmented Control | 少量互斥视图/模式选择 | 多步骤流程或海量选项 | 选择状态清楚；说明影响范围 |
| Breadcrumb | 表达当前层级和回溯上层 | 用于平级选项切换 | 真实层级、最后一级当前项 |
| Pagination | 分页定位大型静态结果集 | 无状态“加载更多”的伪分页 | 页码、总量（可知时）、当前页、加载状态 |
| Stepper | 有顺序的流程步骤和进度 | 普通页面平级切换 | 当前/完成/错误/可返回状态、数据保留 |
| Tree View | 层级对象浏览（Files/Services） | 普通单层列表或纯导航菜单 | 展开/折叠、选中与焦点分离、左右箭头行为 |
| Command Palette | 全局检索动作/导航，面向效率 | 取代主界面唯一可发现入口 | 明确结果类型、快捷键、执行反馈、键盘可用 |
| Back / Close | Back 返回导航历史；Close 关闭临时容器 | 两者互换导致丢失位置/数据 | 预测一致，未保存内容处理 |

**Piwork 特别规则：** `selected`（选中对象）≠ `focused`（键盘焦点）≠ `expanded`（树节点展开）≠ `active route`（当前路由）。不得用一份布尔状态复用全部含义。

## 5. Content & Collections｜信息展示

| 组件 | 正确语义 / 适用 | 禁止或避免 | 最低交互契约 |
|---|---|---|---|
| Card | 关联的一组信息/对象摘要 | 为了装饰把每句话包卡片 | 清楚点击范围和卡片内次级动作 |
| List | 顺序条目、简单对象集合 | 多列严密比较数据 | 条目动作、选中/聚焦/空态 |
| Table | 阅读和比较行列结构数据 | 所有卡片或详情强行表格化 | 表头、排序方向/范围、可访问行列关系 |
| Data Grid | 需要单元格导航、编辑、批量选择的数据集 | 仅浏览几列数据却引入复杂网格交互 | 行/单元格焦点、编辑模式、虚拟化及键盘合同 |
| Description List | 属性—值详情 | 用输入表单展示不可编辑字段 | label/value 明确对应 |
| Accordion | 多个可独立展开的相关分组 | 页面级导航、纯显隐一个控制区域 | 标题为可访问控件、expanded 状态、键盘 |
| Collapsible | 单块内容显示/隐藏，如 Details | 需要在多个并列面板间切换 | 展开图标方向/状态准确，不暗示导航 |
| Empty State | 集合或视图无内容 | 让“无权限/加载失败”冒充为空 | 说明原因与下一步行动；区分无结果/无数据 |
| Skeleton | 内容结构已知、短时加载占位 | 无限等待或替代错误态 | 结构与实际接近；减少布局跳动 |
| Avatar / Badge / Tag | 身份、数量/状态摘要、对象标签 | 把 Badge 当按钮却无动作语义 | 仅颜色不足以表达状态；交互标签需用按钮/链接 |
| Code Block / Viewer | 呈现代码、日志、配置内容 | 大量可编辑配置假装纯 Viewer | 复制、换行、滚动、语法/保密处理 |
| Preview | 预览文件、对象或未来结果 | 实际编辑器行为藏在预览控件里 | 加载、失败、退出、下载/打开原文方式 |

## 6. Feedback & Status｜反馈与状态

| 组件 | 正确语义 / 适用 | 禁止或避免 | 最低交互契约 |
|---|---|---|---|
| Inline Validation | 字段错误、成功和注意事项 | 只在页面顶部报错却不标出字段 | 文案告诉如何修复；字段关联；适时呈现 |
| Inline Alert | 区域级可持续警告/错误 | 瞬时保存成功也占据长期版面 | 保留到问题解决或可明确消除 |
| Banner | 页面/应用级持续重要通知 | 所有普通结果都弹顶部横幅 | 影响范围、关闭/解决路径 |
| Toast | 短暂结果反馈（已复制、已保存） | 必须确认的决策、唯一错误说明、长操作监控 | 不抢焦点；可读时间；重要操作有持久替代入口 |
| Snackbar + Action | 简短反馈及一次撤销/跳转 | 复杂决策、多种行动 | Undo 真正恢复；过期后行为明确 |
| Progress Bar | 能估计完成比例的任务 | 无可用进度却假造百分比 | 值真实、任务标签、完成/失败提示 |
| Indeterminate Progress | 已启动但进度未知 | 伪装为准确百分比 | 告知正在处理什么，超时/失败策略 |
| Spinner | 极短局部等待或紧凑加载 | 作为长期空白屏唯一反馈 | 上下文，避免布局跳动 |
| Status Badge / Dot | Running、Paused、Failed 等状态 | 红绿点作为唯一信息 | 文本与图形双重表达；状态刷新一致 |
| Error State | 请求/权限/文件读取失败 | 混用空状态 | 原因（可知时）、重试、诊断或反馈路径 |
| Confirmation | 必须审慎批准的风险决定 | 所有普通保存和可逆切换 | 关键风险和影响对象；高风险强调后果 |

**反馈原则：** 触发成功 ≠ 持久完成。异步动作必须分别表达 `pending / success / failure`；Toast 不得声称尚未确认的持久化成功。

## 7. Layout & Workspaces｜布局与工作区

| 组件 | 正确语义 / 适用 | 禁止或避免 | 最低交互契约 |
|---|---|---|---|
| Page / View | 长生命周期工作上下文 | 只为单句确认另开页面 | 标题、导航、状态保留 |
| Panel | 同页可持续查看/编辑区域 | 用作一次性微提示 | 可预期布局、焦点与尺寸 |
| Inspector Panel | 检查或编辑当前选中对象属性 | 强行阻断整个主任务 | 选中对象变化时的未保存策略 |
| Split View / Resizable Panels | 同时参照两块工作内容 | 简单查看却增加布局复杂度 | 拖拽、尺寸下限、键盘调整/替代 |
| Toolbar | 一组针对当前画布的命令/工具模式 | 和页面导航、全局设置混为一排 | 视觉分组、快捷键、禁用条件 |
| Scroll Area | 超出容器的滚动 | 嵌套多层不可发现滚动 | 滚轮、键盘、触摸、焦点可达 |
| Separator | 内容/功能组分隔 | 把纯装饰线赋予错误交互 | 需要时使用语义分隔，否则装饰 |
| Resizable Divider | 调整两区域比例 | 用普通 separator 冒充可拖拽 | 清楚拖拽暗示、键盘可操作 |
| Portal / Overlay Layer | 浮层出逃裁剪、正确层级 | 任意 z-index 竞争 | 中央管理层级、嵌套焦点、滚动锁 |

## 8. Files & Objects｜文件与对象交互

| 模式 | 推荐组件 | 关键规则 |
|---|---|---|
| 文件选择 | File Picker | 本地文件选择是输入控件，不等于完成 Import |
| 上传过程 | Dropzone + Progress | 拖放不能是唯一方式；校验类型、大小与失败 |
| 文件浏览 | Tree / List / Data Grid | 根据层级和编辑需求选择，别盲目把 Files 做成 Grid |
| 单文件预览 | Side Panel / Dialog / Page | 需边看边操作选 non-modal Panel；需专注短时看可 Dialog |
| Rename | Inline Edit 优先 | 提交/取消、重名/非法字符错误、焦点回归 |
| Duplicate | Menu Command / Button | 反馈新对象创建和所在位置 |
| Delete | Menu Command → Alert Dialog（高风险） | 确认必要性由可逆性/后果决定；有回收站时可 Undo |
| Move / Copy | Picker Dialog / Destination Page | 清楚目标路径、冲突解决、批量结果 |
| Import Work | Dialog（短流程）/ Page（长流程） | 选择文件、校验、预览、冲突、执行和结果可区分 |
| Export Work | Button / Options Dialog | 无选项则直接导出；大型任务有进度与状态 |
| Object Detail | Inspector / Page | 频繁参照对象列表优先 Inspector |

## 9. Advanced Patterns｜复合模式

| 模式 | 采用条件 | 必须实现 |
|---|---|---|
| Wizard / Multi-step Flow | 顺序依赖且需要引导的多步骤任务 | Stepper、上一步、持久化、错误恢复、中断策略 |
| Command Palette | 大量命令和导航，高频专家效率 | 检索、分组、键盘、动作说明、操作反馈 |
| Rich-text Editor | 文档含格式和结构化内容 | 编辑状态、快捷键、撤销重做、保存与错误 |
| Code Editor | 需要编程语言编辑/诊断 | 代码导航、编辑、只读、性能、大文件处理 |
| Drag & Drop | 空间排序、移动或组织 | 非拖拽替代方案、落点指示、取消、失败恢复 |
| Batch Actions | 对多个选中对象执行同类型操作 | 选中数、作用域、部分失败结果、危险动作确认 |
| Data Filters | 多条件收窄集合 | 已生效条件可见、清除、未应用/已应用状态 |
| Virtualized Collections | 大量条目影响性能 | 虚拟焦点、滚动位置、辅助技术可访问性 |
| Undo / Redo | 可撤销的编辑或对象操作 | 操作粒度、生命周期、失败与不可逆边界 |
| Optimistic UI | 高确定性且可回滚的操作 | 失败回滚与说明；绝不假装不可逆任务成功 |

## 10. Foundation｜所有组件必须遵守

### 10.1 语义和可访问性
- MUST 优先原生 `button`, `a`, `input`, `label`, `table` 等语义；不得以无语义 `div` 模拟控件而不补齐行为。
- MUST 保证键盘可操作、焦点可见，重要功能不能仅靠 Hover/Drag/颜色访问。
- MUST 为 Icon Button / Close Button 提供可访问名称；图标可作视觉补充，不可独自承载不可猜测语义。
- MUST 根据真实状态提供 `aria-expanded`, `aria-selected`, `aria-pressed`, `aria-checked`, `aria-invalid` 等适当属性，不能乱用。
- MUST 把 label、error、hint 与对应字段关联；placeholder 不代替 label。
- SHOULD 对齐 WCAG 2.2 AA；可点击目标推荐最小 24×24 CSS px 或满足适用例外，产品默认设计更舒适的热区；颜色对比遵循相应 WCAG 要求。
- SHOULD 尊重 reduced-motion；动画不得造成操作等待，且不得牺牲焦点/视觉状态清晰度。

### 10.2 状态模型
每个交互组件至少检查：`default / hover / focus-visible / active / disabled / loading（若异步）/ success / error（若有结果）`；按语义补充 `selected / checked / expanded / indeterminate / readonly / empty`。这些状态不可混成一个布尔值。

### 10.3 视觉一致性
- MUST 使用设计令牌：`spacing / typography / radius / border / color / control-height / focus-ring / layer`。
- MUST 同级按钮高度、图标尺寸、内边距、标签对齐一致；不同密度要有明确分组依据。
- SHOULD 在同一动作位置使用一致的图标/文案/状态表达。
- MUST 保证弹层不会被父级裁切、不越界；同一时刻最上层交互的焦点唯一。
- SHOULD 不使用无功能价值的 Modal 收起/展开动画。动画属于表现层，可以关闭；不能改变语义与焦点契约。

### 10.4 操作安全
- MUST 在执行破坏性操作前明确目标对象、影响范围和是否可恢复；针对真正高风险才采用阻断式确认。
- MUST 防止异步请求双击重入；失败时保留可恢复的用户输入。
- MUST 对未保存内容的关闭/切换给出清晰策略：保留草稿、提示丢弃或允许取消。
- MUST 不因动画、Portal、卸载时序留下 ghost/残影或无法交互的透明遮罩。

## 11. Piwork 的落地判例（具有规范效力）

| 场景 | 正确选型 | 常见误用 |
|---|---|---|
| Chat 显示/隐藏 | Toggle Button 或明确的 Show/Hide Button | 用 Dialog/Popover 进行显隐；图标状态与实际相反 |
| Chat 模型选择 | Select；需要搜索时 Combobox；附加复杂参数时 Popover | 用 Dropdown Menu 命令集合保存模型值 |
| Services `…` | Dropdown Menu | 用任意 Popover 装三个命令 |
| Services 设置：详情 | Inspector Panel / Page | 用 Tooltip 解释已清楚的 Details 标题 |
| Service 重命名 | Inline Edit | 一律用 Modal 导致上下文切断 |
| Service 删除 | Menu → Alert Dialog（数据不可恢复时） | 直接静默删除或每次都双重确认 |
| Service Pause/Resume | Button / Menu Item + 状态反馈 | 无需理由却先弹确认框 |
| Files 树节点展开 | Disclosure/Tree 控件 | 用错误方向的 Chevron 或混淆选中与展开 |
| 文件右键 | Context Menu，命令与 `…` 对齐 | 只能右键、无法键盘使用 |
| 文件预览 | Panel / Dialog 依是否需参照其他文件决定 | 仅由容器宽度决定 Modal |
| 导入 `.work` | 有状态的 Import Dialog / Page | 一个 FilePicker 直接代替整个校验、冲突、结果流程 |
| 导出 `.work` | 简单时 Button；需要选项时 Dialog | 无意义的两层确认 |
| 日志与错误诊断 | 可持续 Panel / Code Viewer + Alert | 只以 2 秒 Toast 承载故障信息 |
| 全局命令搜索 | Command Palette | 强制用户必须在菜单里逐级寻找 |

## 12. AI 开发决策与 PR 审核协议

### 12.1 实现前必须产出（可放 PR 描述）
```yaml
component_decision:
  user_intent: "例如：切换 Chat 模型"
  task_scope: "local: chat"
  interrupt_main_task: false
  persistent_workspace_needed: false
  risk_level: reversible # reversible | recoverable | irreversible
  chosen_pattern: "Select"
  rejected_patterns:
    - "DropdownMenu: executes commands, not semantic value selection"
    - "ModalDialog: unnecessary interruption"
  states: [default, focus, open, selected, disabled, error]
  keyboard_contract: "select pattern"
  dismiss_and_focus: "Esc closes; focus returns to trigger"
  error_and_recovery: "restore prior model if switch fails"
```

### 12.2 PR 必查清单
- [ ] 组件语义与任务匹配；不是仅因视觉相似而混用。
- [ ] 同类行为复用现有 Design System 组件；未造出语义相同的新变体。
- [ ] 作用域正确；操作影响的是当前对象而非意外的整个工作区。
- [ ] `selected / active / focused / expanded / checked` 分离。
- [ ] Tab、Enter、Space、箭头、Esc 的行为与具体组件模式相符。
- [ ] 焦点进入/退出/关闭恢复正确；没有被遮罩隔离的活动区域。
- [ ] 所有 Icon Button 有名称；Tooltip 不承载唯一说明。
- [ ] 加载/空状态/权限不足/失败/成功状态均能解释。
- [ ] 关闭和取消不会意外丢失数据；危险操作明确作用对象和后果。
- [ ] 控件高度、图标、间距、对齐、悬停、禁用状态一致。
- [ ] 弹层翻转/碰撞/滚动/缩放/窄屏下正常，无残影。
- [ ] 键盘、触屏、鼠标均有可用操作路径；有必要时测试屏幕阅读器。
- [ ] 无自动保存与实际状态不一致的假成功反馈。

### 12.3 禁止模式（LINT-UX，人工或自动检查）
- `UX001` ACTION_AS_LINK：按钮/链接语义错位。
- `UX002` VALUE_AS_MENU：固定值选择误用命令菜单。
- `UX003` FORM_IN_TOOLTIP：Tooltip 内有必需交互。
- `UX004` MODAL_OVERUSE：无需阻断却用 Modal。
- `UX005` POPOVER_OVERUSE：复杂持续任务塞 Popover。
- `UX006` ICON_WITHOUT_NAME：Icon Button 缺可访问名称。
- `UX007` STATE_CONFLATION：selected/expanded/focus 状态混淆。
- `UX008` TOAST_ONLY_ERROR：持久故障仅靠瞬时 Toast。
- `UX009` DESTRUCTIVE_AMBIGUITY：破坏操作影响不明确。
- `UX010` FOCUS_LEAK：弹层焦点逸出、无法恢复。
- `UX011` GHOST_OVERLAY：卸载后残留视觉或阻断层。
- `UX012` INCONSISTENT_CONTROL：同级控件样式与尺寸无依据地不一致。
- `UX013` NO_NON_POINTER_PATH：仅悬停/拖拽/右键可操作。
- `UX014` UNHANDLED_ASYNC_STATE：异步缺 loading / failure / retry。

这些 UX 编号是 Piwork **拟议的本地约定**，不是外部标准编号。

## 13. 规范边界与采用方法

- 本文件是**选型与行为 Spec**，不替代具体组件 API 文档、视觉 token 文件、详细产品 PRD 和端到端测试用例。
- 不应机械地给每个动作增加 Dialog，也不应按“是否有 2 个输入框”决定 Popover/Modal；以任务连续性、中断性和风险为核心。
- 从现有代码开始，优先修复语义错误、误导性状态、键盘与焦点问题，再统一细节样式；不要为了规范一次性重写所有 UI。
- 新功能默认遵守本规范；既有例外应有记录和修复优先级。

## 14. 参考（核对语义与实现细节）

1. W3C WAI-ARIA Authoring Practices Guide: https://www.w3.org/WAI/ARIA/apg/patterns/
2. Radix UI Primitives Components: https://www.radix-ui.com/primitives/docs/components
3. Radix Dropdown Menu: https://www.radix-ui.com/primitives/docs/components/dropdown-menu
4. Radix Select: https://www.radix-ui.com/primitives/docs/components/select
5. WCAG 2.2: https://www.w3.org/TR/WCAG22/
6. Apple Human Interface Guidelines Components: https://developer.apple.com/design/human-interface-guidelines/components/

---

**核心判定句：先选任务语义，再选交互模式，再选容器，最后才选样式。**
