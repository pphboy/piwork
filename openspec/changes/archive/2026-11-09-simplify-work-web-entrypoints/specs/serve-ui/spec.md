# Spec Delta

## MODIFIED Requirements

### Requirement: 提供一致的管理员导航和表单状态

**Identifier:** SUI-004

面板 SHALL 采用用户交付的三个顶层工作区：`Overview`、`User access`、`Work setup`。`Overview` SHALL 使用 `/admin`，运行时配置 SHALL 保留 `/admin/runtime` 并可从 Overview 进入；`User access` SHALL 使用 `/admin/users`；`Work setup` SHALL 将 `/admin/default-work`、`/admin/skills`、`/admin/packages` 分别组织为 `Starting point`、`Skills`、`Packages`。网页 SHALL 移除 Find operation 辅助导航、手动 Operation ID 查询页及所有指向该页的入口。既有 `/admin/operations/<id>` 详情深链接 SHALL 保留，用于查看已知 Core package 任务；详情与任务不可用页 SHALL 提供返回 Packages 的入口，不返回已移除的查找页。原 `/admin/operations` 查找页面按既有未找到页面规则处理。旧管理深链接 SHALL 映射到对应管理前缀；新路由 SHALL 继续支持直接打开、刷新及浏览器前进后退；窄屏 SHALL 通过可操作的导航菜单提供相同入口。

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

### Requirement: Serve 全部对象与独立表单保持真实状态语义

**Identifier:** SUI-V13-STATE-001

Serve SHALL 按来源矩阵 S01–S12 及实际登录/会话/初始壳覆盖 Overview、用户、Default Work、Skills、Packages、模型列表/配置/测试、Runtime、已知 Operation 详情、About、托管Quick setup与准备的全部可观察状态；原型未含完整登录/独立表单或稀有错误不是延期理由。首读/确认空/失败/旧数据刷新及未知写入各自可辨；相同对象读请求协调去重，迟到结果不替换新路由/草稿、不清理新Key、不解除新动作锁。

保存确认、显式Test、准备与readiness SHALL 相互独立。模型Test不保存/启停资源，其未运行/成功/失败不成为Save、Enable或选择模型的通用前置门槛；编辑后旧测试结果标为过期。Runtime/Defaults保存返回配置/确认而非通用Operation，不为其捏造Package任务。Quick setup的Ready仍要求当前status与preparation均ready、全部六组件ready且无当前读取错误；未知/失败停止误导动效。Package未知受理只在既有同actor/source/稳定key协议允许时显式Resume，Check/普通通知不自动重放。

#### Scenario: 模型测试与保存分离
- **WHEN** 管理员未测试、测试失败或测试请求尚在途而保存合法模型配置
- **THEN** 不因测试结果自动禁止保存；测试不触发保存，编辑后旧测试不回写新输入或重新打开已关闭窗口

#### Scenario: Runtime 保存而readiness失败
- **WHEN** Runtime保存已确认，随后readiness读取失败
- **THEN** 保留保存结果，另示未确认状态和只读恢复，不制造Operation或重复保存，也不清理用户后来输入的新Key

#### Scenario: Quick setup部分就绪
- **WHEN** 保存已完成但六个准备组件中仍有pending/failed/unknown或当前读取错误
- **THEN** 不宣称整体Ready或自动开放完成主动作；确认条件全部满足后才沿既有有效意图完成

#### Scenario: 登录与包恢复边界
- **WHEN** 登录/退出结果未知，或Package提交受理未知
- **THEN** 前者按会话协议核对且不自动重提；后者仅保留既有明确幂等Resume范围，不以通用未知处理破坏或扩大该协议
