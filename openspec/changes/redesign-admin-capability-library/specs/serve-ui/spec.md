# Spec Delta

## MODIFIED Requirements

### Requirement: 提供一致的管理员导航和表单状态

**Identifier:** SUI-004

面板 SHALL 采用用户交付的三个顶层工作区：`Overview`、`User access`、`Work setup`。`Overview` SHALL 使用 `/admin`，运行时配置 SHALL 保留 `/admin/runtime` 并可从 Overview 进入；`User access` SHALL 使用 `/admin/users`；`Work setup` SHALL 以“能力库 / 新 Work 默认”（英文 `Library / New Work defaults`）两个同级视图组织既有能力。“能力库”内包含 Skills / Packages 分类：`/admin/skills` 与 `/admin/packages` 分别直接进入对应分类，原对象详情深链接保持对应条目的选中上下文；`/admin/default-work` 进入“新 Work 默认”，复用原有默认配置，Skills、Packages 和 AGENTS.md 等既有编辑能力保持可达。两个视图通过导航切换，不以孤立的“默认 Work”文字按钮、页头更多菜单或文件工具栏菜单承载默认配置入口。沿用现有共享配色和控件，不交付原型方案切换器。网页 SHALL 移除 Find operation 辅助导航、手动 Operation ID 查询页及所有指向该页的入口。既有 `/admin/operations/<id>` 详情深链接 SHALL 保留，用于查看已知 Core package 任务；详情与任务不可用页 SHALL 提供返回 Packages 的入口，不返回已移除的查找页。原 `/admin/operations` 查找页面按既有未找到页面规则处理。旧管理深链接 SHALL 映射到对应管理前缀；新路由 SHALL 继续支持直接打开、刷新及浏览器前进后退；窄屏 SHALL 通过可操作的导航菜单提供相同入口。

UI 自有文字 SHALL 在简体中文和英文间随用户选择显示；用户内容、资源名称、技术标识和错误码保持原样。管理页面 SHALL 仅显示当前功能所需的公开数据，所有服务器返回文本 SHALL 按纯文本显示。列表 SHALL 区分加载、空集合、成功和失败；错误 SHALL 提供所选界面语言的可执行提示及可复制 correlationId（如有）。表单 SHALL 在提交中禁用重复提交，验证失败保留非敏感草稿并定位字段；成功后显示 Core 确认结果并刷新相关数据。

离开有未提交更改的页面或覆盖草稿 SHALL 提示丢弃确认。删除、禁用账号及密码重置 SHALL 有含目标名称与实际影响的所选界面语言的确认步骤。未知结果的变更 SHALL 提示先查询当前状态；只有显式重试且具备稳定幂等键的包安装/更新可以重放原提交。控件 SHALL 有所选界面语言的可访问名称、键盘操作及可见焦点；360px 宽屏下表单和主要动作仍可操作，宽表格可横向滚动。未知页面 SHALL 返回 404；不提供任意 URL/路径代理。

管理页面 SHALL 区分首次无数据、同页显式刷新和正常后台回读。首次使用稳定外壳和 UIL-PENDING-001 等待槽；当前身份已有已确认内容时，同页刷新 SHALL 保留正文及最后取得时间，不用整页 skeleton 或清空表单取代。页级读取 SHALL 协调同对象显式/后台请求，不让每个卡片另起刷新；状态局部更新保留输入草稿、安全内存中的 Key、焦点/选区、展开和滚动，身份失效与原提交敏感清理规则仍优先。新读失败保留并标明最后确认数据；晚响应不得替换新路由或编辑，修改确认与关联刷新仍遵守 SUI-006。

#### Scenario: 空列表与加载失败
- **WHEN** 列表尚未完成、返回空集合或请求失败
- **THEN** 分别显示所选界面语言的加载状态、带创建入口的空态或错误重试入口，失败不能显示为没有数据

#### Scenario: 保存失败保留编辑
- **WHEN** 表单提交被 Core 拒绝或响应丢失
- **THEN** 保留非敏感草稿、清空密码类字段，并提供所选界面语言的修正或读回入口；明确拒绝后恢复合法提交，不能把未知结果表示为已保存或自动再次提交

#### Scenario: 恶意名称与窄屏操作
- **WHEN** 数据含 HTML 字符，管理员通过键盘或窄屏访问页面
- **THEN** 字符按文本呈现，主要动作可聚焦和执行，不注入脚本或遮挡提交按钮

#### Scenario: 管理员按任务进入工作区
- **WHEN** 管理员完成登录并打开首页
- **THEN** 显示真实 Core 配置及 readiness，提供运行时配置、用户访问、默认 Work 与能力管理入口，不把未配置运行时表达为认证失败

#### Scenario: 深链接与移动导航
- **WHEN** 管理员直接打开任意既有管理路由、刷新或使用浏览器前进后退
- **THEN** 页面保持对应功能及当前会话检查，窄屏菜单能进入三个工作区；已知 Operation 详情仍可通过原任务入口或保存的详情 URL 打开，不提供手输 ID 的查询页

#### Scenario: 高风险变更经确认
- **WHEN** 管理员禁用账号、重置密码或移除资源
- **THEN** 确认步骤显示目标及真实影响，取消不发送变更请求

#### Scenario: 同页刷新和轮询保持上下文
- **WHEN** 管理员编辑Runtime/Default Work/模型或展开详情，显式刷新或后台健康读取随后返回
- **THEN** 正文及交互节点保持，不整页闪白或重置选择；只更新有效状态，未保存草稿、焦点、展开和滚动保持，旧数据与新确认可区分

普通临时动作结果 SHALL 使用 UIL-NOTICE-001 的单一浮动通知，不插入推动表单/列表的Alert；字段错误、首次读取失败、连接/准入原因和未知恢复保留所属无框内容与入口。Admin Header 的 Workbench 为直接真实链接，Desktop Administration 只在全局账号菜单提供；不改变权限校验。

#### Scenario: 移除查找页面但保留任务详情
- **WHEN** 管理员在桌面或窄屏查看导航、打开旧查找页或已保存的 Operation 详情 URL
- **THEN** 导航不含 Find operation，旧查找页不再展示查询表单；详情 URL 仍执行原授权与状态读取，返回 Packages 的链接可用

#### Scenario: 在能力库和默认配置间切换
- **WHEN** 管理员通过 Work 设置导航在能力库与新 Work 默认间切换
- **THEN** 能力库负责浏览、编辑内容和管理库条目，新 Work 默认负责原默认配置；原 AGENTS.md 编辑入口继续可用，未提交草稿遵守原离开确认，文件保存不提交默认选择

#### Scenario: 从既有对象链接进入双栏
- **WHEN** 打开 `/admin/skills/<name>`、`/admin/packages/<name>` 或由已知 Package Operation 返回 Packages
- **THEN** 在能力库中选中对应分类和有效条目；对象不存在按原不可用规则处理，原 Operation 详情和浏览器历史仍可使用，不跳入默认配置或恢复已移除的任务查找页
