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

### Requirement: 管理员手动动作与文件预检有明确等待反馈

**Identifier:** SUI-005

Serve SHALL 沿用 UIL-008/009 及 UIL-PENDING-001，在有效异步动作开始后的首个可绘制机会、结果返回前，在原对象/表单显示所选界面语言的动作和等待状态，提供可访问的状态说明及 busy 语义；只禁用按钮不构成反馈。手动 Refresh status、Verify runtime、Retry connection、Refresh/Resume Operation、Read current runtime/defaults 和 Sign out SHALL 均覆盖，重复入口只能有一个在途请求。不同对象的合法导航和操作保持可用，读操作不得与后台轮询叠加成并行查询同一对象。

选择 Skill 目录、Package 目录/ZIP、AGENTS 文件后，浏览器本地读取/预检 SHALL 显示 Checking selected files，未完成不能提交本次未确认选择；取消选择保持原输入，预检失败保留旧选择，替换/关闭后的晚结果不能恢复旧文件。已有登录、保存、上传和 Package Operation 反馈 SHALL 保持真实；上传、验证、接受、后台准备与发布分别表达。

检查成功即使值未改变 SHALL 有新的确认时间或简短已确认说明。十秒以上未取得响应显示仍在等待及已等待时间，不虚构超时失败。明确失败、结果未知、旧缓存和成功空数据 SHALL 区分；错误不得使用成功措辞/图标。身份/路由变更后旧请求不覆盖当前页面，密码/key 处理仍遵守既有规则。快速动作不人为延迟，普通导航和复制不要求额外 toast。

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
