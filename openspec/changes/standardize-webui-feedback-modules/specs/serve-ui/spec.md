# Spec Delta

## MODIFIED Requirements

### Requirement: 提供一致的管理员导航和表单状态

**Identifier:** SUI-004

面板 SHALL 采用用户交付的三个顶层工作区：`Overview`、`User access`、`Work setup`。`Overview` SHALL 使用 `/admin`，运行时配置 SHALL 保留 `/admin/runtime` 并可从 Overview 进入；`User access` SHALL 使用 `/admin/users`；`Work setup` SHALL 将 `/admin/default-work`、`/admin/skills`、`/admin/packages` 分别组织为 `Starting point`、`Skills`、`Packages`。`Find operation` SHALL 保留 `/admin/operations` 和已有 Operation 详情深链接，作为辅助导航，不声称提供全局操作历史。旧管理深链接 SHALL 映射到对应管理前缀；新路由 SHALL 继续支持直接打开、刷新及浏览器前进后退；窄屏 SHALL 通过可操作的导航菜单提供相同入口。

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
- **THEN** 页面保持对应功能及当前会话检查，窄屏菜单能进入三个工作区和 Operation 查询

#### Scenario: 高风险变更经确认
- **WHEN** 管理员禁用账号、重置密码或移除资源
- **THEN** 确认步骤显示目标及真实影响，取消不发送变更请求

#### Scenario: 同页刷新和轮询保持上下文
- **WHEN** 管理员编辑Runtime/Default Work/模型或展开详情，显式刷新或后台健康读取随后返回
- **THEN** 正文及交互节点保持，不整页闪白或重置选择；只更新有效状态，未保存草稿、焦点、展开和滚动保持，旧数据与新确认可区分

普通临时动作结果 SHALL 使用 UIL-NOTICE-001 的单一浮动通知，不插入推动表单/列表的Alert；字段错误、首次读取失败、连接/准入原因和未知恢复保留所属无框内容与入口。Admin Header 的 Workbench 为直接真实链接，Desktop Administration 只在全局账号菜单提供；不改变权限校验。

### Requirement: 管理员手动动作与文件预检有明确等待反馈

**Identifier:** SUI-005

Serve SHALL 沿用 UIL-008/009 及 UIL-PENDING-001，在有效异步动作开始后的首个可绘制机会、结果返回前，在原对象/表单显示所选界面语言的动作和等待状态，提供可访问的状态说明及 busy 语义；只禁用按钮不构成反馈。手动 Refresh status、Verify runtime、Retry connection、Refresh/Resume Operation、Read current runtime/defaults 和 Sign out SHALL 均覆盖，重复入口只能有一个在途请求。不同对象的合法导航和操作保持可用，读操作不得与后台轮询叠加成并行查询同一对象。

选择 Skill 目录、Package 目录/ZIP、AGENTS 文件后，浏览器本地读取/预检 SHALL 显示 Checking selected files，未完成不能提交本次未确认选择；取消选择保持原输入，预检失败保留旧选择，替换/关闭后的晚结果不能恢复旧文件。已有登录、保存、上传和 Package Operation 反馈 SHALL 保持真实；上传、验证、接受、后台准备与发布分别表达。

检查成功即使值未改变 SHALL 有新的确认时间或简短已确认说明。十秒以上未取得响应按真实任务类别表达等待；关键初始会话/准入读取到达既有预算则转为未确认与安全恢复，长期已接受任务不被按时长虚构为失败。明确失败、结果未知、旧缓存和成功空数据 SHALL 区分；错误不得使用成功措辞/图标。身份/路由变更后旧请求不覆盖当前页面，密码/key 处理仍遵守既有规则。快速动作不人为延迟，普通导航和复制不要求额外 toast。

请求的成功、失败及最终清理回调 SHALL 均受发起时的身份与视图归属约束；离开后返回同一路由也属于新的视图。旧请求不得清理新页面的敏感输入、改变新草稿或释放新动作的提交锁。

统一等待 SHALL 覆盖首次引导读取/创建/登录、Quick setup保存与显式Test、准备观察，以及所有Admin/独立Console列表和详情、模型目录回读、模型添加/保存/启用/停用/删除/设为默认、Runtime/Defaults、用户/Skill/Package动作、Operation与About。独立表单或动作状态不能因未使用通用动作组件而缺失；三点 SHALL 附着实际发起的按钮或对象，启停模型不能仅让无关的Save按钮呈保存中。读取失败、明确结果和未知结果仍按原契约处理。

#### Scenario: 手动检查等待与重复点击
- **WHEN** 用户点击 Verify runtime、Refresh status、Read current configuration 或 Refresh Operation，响应被延迟并再次触发同一入口
- **THEN** 原区域已显示 Checking/Reading，只有一个对应请求；返回相同内容仍可确认本次检查完成，后台轮询不使等待提示提前消失

#### Scenario: 本地大文件预检
- **WHEN** 用户选择 Package ZIP 或较大目录，本地校验尚未结束
- **THEN** 原表单显示文件目标与预检中，不能提交未确认的新选择；失败、换源或关闭后不恢复晚到的旧选择

#### Scenario: 注销与身份失效
- **WHEN** 注销响应缓慢或 Core 暂时不可达
- **THEN** 显示 Signing out，重复注销受限，随后按 SUI-003 区分已撤销与未完成，旧账号的晚结果不覆盖新登录页

#### Scenario: 独立模型操作有准确等待对象
- **WHEN** 管理员点击Read current data或Enable/Disable/Delete/Use for future Work且响应延迟
- **THEN** 实际操作处显示Reading或相应状态和三点，重复入口受限；不会只把Save按钮改成Saving，也不隐藏未知结果读回要求

#### Scenario: 同页刷新保留导航展开语义
- **WHEN** 管理员展开账户菜单或窄屏导航，当前身份与路由的后台状态读取返回
- **THEN** SHALL 保持菜单节点、焦点和展开，触发器 aria-expanded 与实际状态一致；离开或身份变化时关闭，不把旧菜单带入新视图

### Requirement: 已确认管理修改与关联刷新独立呈现

**Identifier:** SUI-006

Serve SHALL 在收到可靠的账号创建、启用/禁用、密码重置、Skill 添加/更新、Skill/Package 启用/禁用/移除、Runtime/Defaults 保存确认后，立即保存并显示目标与已确认结果。后续 Users、catalog、defaults、readiness 查询 SHALL 单独显示 Refreshing 和取得时间，不能阻塞成功反馈、撤销原确认或重新执行修改。

刷新失败 SHALL 显示“修改已确认；当前列表/状态未确认”及对应只读 Retry refresh，保留安全的旧数据并标记为最后已知。结果通知 SHALL 由仍有效身份/任务所属的统一宿主呈现，原页面保留状态及只读恢复；不能只写入已关闭弹层，不新增推移布局的结果Alert。更新自身凭据/状态导致撤销仍按 SUI-USR-002 返回登录，不能被普通刷新成功覆盖。响应未知继续使用既有只读核对或稳定 package key 恢复，不能据此显示确定成功。

Runtime 保存后的 API Key 清理 SHALL 仅作用于该次提交的原输入上下文。用户离开 Runtime 后重新进入并输入的新 Key 与非敏感草稿不得被旧保存请求或后续 readiness 查询的晚回调清空；原提交 Key 仍按既有敏感输入规则清理，不从后端回填，不进入动作状态、日志或验收截图。

#### Scenario: 创建用户成功但刷新缓慢
- **WHEN** Core 已返回新用户，随后用户列表查询被延迟
- **THEN** 创建结果及普通用户/管理员入口已可见，密码清空，列表显示刷新中，不要求再次创建

#### Scenario: 目录修改成功但刷新失败
- **WHEN** Skill 上传或 Skill/Package 状态修改已确认，随后 catalog/defaults 查询失败
- **THEN** 显示原成功和刷新失败，提供只读恢复；不访问已移除弹层、不抛出因其缺失而产生的异常、不再次上传或修改

#### Scenario: 保存结果与 readiness
- **WHEN** Runtime 保存成功后 readiness 查询失败，或 Defaults 保存后的辅助查询失败
- **THEN** 保留保存成功，readiness/辅助信息单独未确认，非敏感新草稿保留，key 不被回填或记录

#### Scenario: Runtime 旧保存不清理重新进入后的输入
- **WHEN** Runtime 保存请求被延迟，用户按脏草稿规则离开页面，再返回编辑并输入新 Key 与新草稿，旧保存或其 readiness 回调随后完成或失败
- **THEN** 新 Key 与新非敏感草稿保持不变，新动作的锁不被旧回调释放；旧反馈不替换新视图，原提交 Key 仍遵守敏感清理规则且不回填、不记录

## ADDED Requirements

### Requirement: Serve 全部对象与独立表单保持真实状态语义

**Identifier:** SUI-V13-STATE-001

Serve SHALL 按来源矩阵 S01–S12 及实际登录/会话/初始壳覆盖 Overview、用户、Default Work、Skills、Packages、模型列表/配置/测试、Runtime、按ID查Operation、About、托管Quick setup与准备的全部可观察状态；原型未含完整登录/独立表单或稀有错误不是延期理由。首读/确认空/失败/旧数据刷新及未知写入各自可辨；相同对象读请求协调去重，迟到结果不替换新路由/草稿、不清理新Key、不解除新动作锁。

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
