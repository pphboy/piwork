# Spec Delta

## MODIFIED Requirements

### Requirement: 以统一语言组织可操作的 Work 工作区

**Identifier:** DWUI-002

Desktop SHALL 落实 DUL-001—007、DUL-010、DUL-016 的对象、容器、中英文文案和 Serve 浅色视觉规则。Work List SHALL 独立展示搜索、New Work、Import、账号、按 ID 查询操作与对齐的状态/动作列。打开 Work SHALL 直接进入专属面板，无跨 Work 侧栏或强制概览；Service/Files/Chat 为同级入口，Settings 明确可达。

首次进入且无当前身份的有效上次区域时，可用 Service SHALL 为默认主区域，同一 Session 的 Agent 输入保留在辅助栏；首次进入且无有效上次区域时，无可用 Service 且对话准入成功则聚焦 Chat。停止状态 SHALL 展示 Start、配置、Export 与历史保留提示，不新读历史。切换区域 SHALL 保留当前 Service/端口、Session 和本页面非敏感草稿；不承诺任意应用内部未保存表单的恢复。所有列表 SHALL 区分加载、真正空集合、错误和带时间的旧内容。

共同颜色/字阶/间距/控件 SHALL 可集中修改；360px 无整页横向溢出，长名称和技术标识可完整读取/复制，危险/编辑弹层按 DUL-007 管理焦点及未保存确认。交付 SHALL 提供原型 36 帧/CLI 能力矩阵到实际界面与验收记录的对应关系。

同一有效身份的当前页面生命周期内，重新进入 Work SHALL 优先恢复上次明确选择的 Services、Files 或 Chat，以及仍存在且有权访问的 Service/port、Session、文件目录和已打开文件；首次进入才使用默认区域规则。恢复目标的读取使用该区域稳定外壳，不先强制切往 Services。目标失效 SHALL 说明原因并提供该模块可用回退，不能因后台加载晚到覆盖用户的新选择。离开脏文件/配置仍需既有确认；不将草稿或选择持久化到另一身份。

最后确认可用的 Work/Service 仅遇到状态观察网络错误、超时或暂时服务错误时，Desktop SHALL 保留同一已挂载应用视口与工作区，标记状态未确认及安全重查入口；不能因该读取错误卸载再创建 iframe、清除草稿或抢焦点。保留画面不表示刷新授权或确认 Ready，不扩大新动作准入；已确认停止/删除、停止目标接受、真实资格撤销及身份失效仍按原规则限制能力和撤销访问。

Desktop SHALL 按主流程、对象管理、全局管理分层：Ready Work 优先直接 Open，Stopped 保留 Start；Stop 与 Work information 在所属 Work 更多菜单；About Piwork、Known operations 在账号下拉。Files 空选择提示不占独立行，批量动作在已有工具栏；Service/Agent请求入口使用有可访问名称的就近图标，分别保留当前Service与全Work作用域。账号下拉外侧关闭不受背景草稿/任务阻碍，不扩大其他确认窗规则。

Service/Chat 工作区 SHALL 支持 DUL-002 的可拖动与键盘分隔、普通 Chat 折叠、专注返回及窄屏恢复；单纯布局变化不得切换 Session、清空文字/图片草稿、丢失 Desktop 阅读位置或重载同一授权 iframe。比例及显隐只在当前身份页面内按 Work 恢复；无有效记录或刷新使用默认布局。外壳 SHALL 使用真实剩余视口高度并按 DUL-007最多保留一条 StatusLine，不修改嵌入 Service 业务内容。Works三操作图标化及账号身份呈现 SHALL 仍提供完整操作目的和已有权限边界。

#### Scenario: 从列表进入并切换区域
- **WHEN** 用户打开有就绪 Service 的 Work，切到 Files、聚焦 Chat，再返回 Service
- **THEN** 始终保留 Work 身份，Service 为原选择，对话使用同一 Session 和草稿，不产生额外 Run

#### Scenario: 错误不是空列表
- **WHEN** Work 查询失败或返回空数组
- **THEN** 分别显示错误恢复入口或 New Work/Import 空态，不用零计数覆盖查询失败

#### Scenario: 列表与窄屏可操作
- **WHEN** 多种状态、长名称 Work 在宽屏及 360px 显示，用户通过键盘操作行按钮
- **THEN** 状态/动作保持可读且布局对齐，按钮不同时触发行导航，焦点与弹层返回位置正确

#### Scenario: 重进同一 Work 恢复上次区域
- **WHEN** 用户在 Files 的子目录或 Chat 工作后返回 Works，再打开该 Work
- **THEN** 恢复其有效区域与对象；加载不强制先展示 Services，无额外 Start、Session 创建或 Run，失效路径在 Files 内说明并回到可访问位置

#### Scenario: 一次观察失败不销毁可用视口
- **WHEN** 已挂载 Service 有输入，Work 状态 GET 暂时失败后恢复
- **THEN** 同一 iframe 及祖先保持连接，文档不重载、草稿和焦点保留，显示未确认及恢复；没有绕过服务端授权或将错误当成新的 Ready

#### Scenario: 确认停止或身份撤销不能保留可用假象
- **WHEN** 显示旧应用期间取得 Stop accepted、stopped/deleted 或可信授权失效
- **THEN** 执行原能力限制和撤销，显示对应对象与原因；旧可用快照不开放新的控制、文件或对话提交

#### Scenario: 调整布局不产生执行副作用
- **WHEN** 用户拖动/键盘调整、重置、折叠/展开Chat，经历Focus/Restore/Exit与窄屏往返
- **THEN** 原Work/Service/端口/Session保持合法选择，文字图片草稿、阅读位置及iframe文档不变，无新Session/Run/控制提交；返回不被旧响应覆盖

#### Scenario: 工作区高度不靠固定空白补偿
- **WHEN** 头部、导航、降级提示和Chat显隐改变实际可用空间
- **THEN** 主区域使用剩余高度，无额外外壳底边空白或被裁输入区；StatusLine不叠加，Service页面内部内容保持独立

### Requirement: Work 创建与生命周期使用真实控制结果

**Identifier:** DWUI-003

New Work SHALL 提供必需名称与默认创建，以及高级镜像、Skills/Packages 默认/选择/显式清空、AGENTS 文件/文本和完整配置 JSON；字段省略与空集合语义、合并顺序 SHALL 与现有用户 CLI 一致。校验失败保留输入，接受后显示 Work/Operation ID 与准备状态。

创建重名 SHALL 基于 Core 确认的名称冲突显示在 Name 字段附近，说明该名称已被使用或保留并要求选择其他名称；保留名称和全部高级输入，提供可访问错误关联，避免仅显示通用 CONFLICT 或重复错误条。显示原因不得通过客户端列表推断；其他状态冲突、配额、依赖或网络失败不得被改写为重名。已删除记录或在途导入的现有名称占用仍有效，提示不得承诺删除可见 Work 就能释放名称。

列表和 Work 面板 SHALL 支持 Start、Stop、Retry、Delete、公开身份及详情，遵守 DUL-008。Stop 确认影响当前 Run、Service 和文件连接；Delete 确认默认保留数据、不提供假撤销。仅 desired=running 的失败提供 Retry；停止失败查询原 Stop，不将目标改回运行。accepted、running、succeeded、failed、superseded 和 unknown SHALL 分开；删除后即使 Work 已不在列表，原 Operation 仍可查询。

New Work SHALL 区分未完成的创建草稿与可靠受理后的下一次新建。明确拒绝、未发送或结果未知时保留原输入和对应恢复保护；可靠取得原 Work/Operation 后，下次 New Work 默认使用新名称空值和当前默认配置，不静默继承上次高级覆盖。新建期间不得因旧创建晚结果清空较新的草稿，原已受理对象仍可找回。

Start/Retry 的进度 SHALL 留在所属 Work 上下文并保留原 Operation 详情入口。真实对象及相应能力确认可用后 SHALL 提供直接 Open Work；用户明确选择 Start and open 时才可在完成后衔接打开该 Work。普通 Start 不强制导航，不以 Operation succeeded 代替 Work Ready。

Stop确认的影响范围 SHALL 以明确非交互说明呈现，不能把装饰图标表现为不可勾选的Checkbox，也不得增加原流程没有的确认勾选门槛。真正Delete确认框、Stop/Stop and export的原动作与一次提交保护保持。

#### Scenario: 默认创建和显式空集合
- **WHEN** 用户分别使用默认配置及显式空 Skills/Packages 创建
- **THEN** 前者采用 Core 默认，后者不被默认填回；成功准备前不显示 Ready

#### Scenario: 停止取代启动
- **WHEN** Start 尚未完成时 Stop 已接受且旧 Operation 被取代
- **THEN** 当前目标为 stopped，旧操作显示 superseded，不能继续以旧结果显示 Ready

#### Scenario: 停止失败与删除
- **WHEN** 停止失败，或删除已接受而 Work 已离开列表
- **THEN** 前者不可 Export 且可查询原 Stop；后者保留 Delete 观察入口，不提前宣布清理完成

#### Scenario: 创建重名定位到名称字段
- **WHEN** 普通创建被 Core 以名称已被使用或保留拒绝
- **THEN** Name 字段附近显示可理解的所选界面语言的换名提示，名称及高级草稿保持，没有假 Operation 或自动提交

#### Scenario: 重名提示只依据确认原因
- **WHEN** 创建发生名称冲突，或发生其他 CONFLICT、配额、依赖、连接失败
- **THEN** 仅确认的名称冲突使用重名字段提示；其他错误沿既有反馈处理，不因名称在列表中存在或不存在而猜测原因

#### Scenario: 创建请求返回前修改名称
- **WHEN** 用户提交名称 A 后在响应返回前改为名称 B，随后 Core 返回 A 的名称冲突
- **THEN** 说明原请求使用的 A 被拒绝，保留 B 与高级草稿，不把 B 标为无效，不自动再次创建；名称比较与实际提交一样忽略首尾空白

#### Scenario: 两次创建冲突逆序返回
- **WHEN** 同一创建表单先提交名称 A，再由用户显式提交名称 B，B 的名称冲突先返回，A 的名称冲突随后返回
- **THEN** 保留 B 的当前名称、高级草稿、Name 字段错误及可访问关联；A 的迟到响应不得覆盖或清除 B 的表单错误，旧请求仍按原记录处理，不产生额外创建请求

#### Scenario: 已受理创建后的下一次新建
- **WHEN** 创建 A 可靠受理后用户再次 New Work
- **THEN** 新草稿不带入 A 名称、AGENTS/JSON 等高级覆盖；A 的 Operation 仍可查，没有第二次隐式创建

#### Scenario: 未知创建保留原草稿
- **WHEN** 创建响应丢失或明确拒绝，用户关闭并回到该创建流程
- **THEN** 原输入保留，未知仍核对原结果而非新建重发；晚到的原接受不会清空其他新草稿

#### Scenario: 从列表启动后可直接进入
- **WHEN** 用户从 Works 显式 Start，原操作和 Work 相继确认成功及可用
- **THEN** 原行或结果处直接提供 Open Work，不必关闭 Operation 再重新定位名称；Start 只提交一次

#### Scenario: 停止范围没有假勾选控件
- **WHEN** 用户打开Stop Work或Stop and export确认
- **THEN** 可读到整个Work、Service、Agent和Files影响，范围说明不伪装可点选项；取消零提交，确认只提交原授权动作一次

### Requirement: 完整 Work 包可以本地检查和原子导入

**Identifier:** DWUI-008

用户 SHALL 能选择 `.work` 在本地完整 Inspect，无需 Core 登录、不执行包内代码，显示既有安全摘要和私有内容提醒，允许检查后直接关闭。上传与检查 SHALL 流式处理并遵守现有 `.work` 格式、完整校验及容量限制，不将整个包放进浏览器/CLI 内存。

Import SHALL 复用检查后的同一包，提交前校验仍一致；名称留空真正省略，显式冲突定位名称字段；目标权限与模型兼容由 Core 校验。上传不虚构 Operation；接受后保留原 ID，发布前/失败时无半成品 Work。成功展示最终名称、新 ID 与 Imported · Not started，并提供显式 Start and open 和仅查看/暂不启动入口。不自动运行 Service 或包代码。取消未提交传输可清理本地暂存；取消观察不撤销已接受 Import。

同一本地浏览器会话在同一 Core 下从匿名检查进入首次登录时，SHALL 保留已完整验证且未提交的包和其本地传输身份；登录成功后可继续检查摘要并显式导入，无需重新选择文件或上传到本地 CLI。登录失败不丢弃合法匿名检查。此例外 SHALL 不保留已认证用户的 Core 内容，亦不适用于切换 Core、已认证用户切换账号、登出或本地会话失效。

用户关闭未提交检查、替换所选包或取消仍在进行的本地检查时，SHALL 中止相应本地传输/观察并请求释放原暂存；晚到的进度和结果不得重新打开旧检查或覆盖新包。删除确认成功或已不存在后才显示清理完成，失败时保留可定位的清理信息与显式重试入口，不能以隐藏弹窗代替清理。为同一 Core 登录而暂离检查不属于放弃该包。Import 提交中、接受响应未知及已接受后 SHALL 保留该次身份及恢复信息，不按未提交检查重新提交、替换或取消远端操作；关闭仅停止本地观察。

Start and open SHALL 只在用户于导入成功后明确选择时提交 Start，并在真实 Work 及能力确认后打开；导入成功、详情关闭、状态查询或查看控制信息都不能自动启动外来包。启动失败/未知保留导入成功事实、原 Start 身份及安全恢复，不重复 Import。

本地 Inspect 摘要 SHALL 提供来自已验证包的 `sourceName` 显示字段，用于本页自动改名前后的名称说明；该字段不改变包格式、校验或导入执行。

Import 名称字段 SHALL 在提交前说明：留空使用包内源名称，名称不可用时由 Core 自动添加唯一后缀；显式名称须可用。客户端不得依据列表预测或提前承诺具体后缀。受理后 SHALL 使用现有接受响应的最终 `name` 显示本次导入目标名称；只有未显式指定名称且 Core 最终名称与已确认源名称不同，才能说明自动改名并显示原名称和实际名称。用户显式选择不同名称不应被描述为 Core 因重名自动改名。

显式名称冲突 SHALL 在名称字段旁给出换名或主动留空的所选界面语言的提示，保留名称、已检查包及其他输入；不得自动清空、修改名称或重新发送 Import。修改和后续提交仍遵守既有 transfer 准入、未知结果保护与用户显式提交规则。

实际名称 SHALL 与状态一起准确表达：接受时为已选定的导入名称及准备中，只有 Operation 确认成功才称为导入完成。失败、响应丢失或恢复后尚无名称时不猜测名称或成功；可沿现有接受记录和 Work 读取显示已确认名称，不新增恢复接口或持久状态。

#### Scenario: 离线检查后关闭
- **WHEN** 未登录用户选择合法或损坏的本地包
- **THEN** 本地分别显示完整验证摘要或具体校验失败，不连接 Core 或执行内容，关闭后清理暂存

#### Scenario: 自动名称和显式冲突
- **WHEN** 导入同名包时分别留空名称或显式填入冲突名称
- **THEN** 前者由 Core 选择名称，受理后显示实际名称及适用的自动改名说明；后者保持表单并在名称字段旁提示冲突，均不覆盖旧 Work

#### Scenario: 导入完成或失败
- **WHEN** 已接受 Import 进入终态
- **THEN** 成功才显示 stopped 新 Work，失败保留 Operation 和原因，均不自动 Start

#### Scenario: 留空名称并由 Core 自动改名
- **WHEN** 包内源名称为“笔记”，用户留空名称，Core 因现有占用返回实际名称“笔记-3”
- **THEN** 提交前只说明自动后缀规则；接受后显示“笔记”与“笔记-3”的自动改名事实，不猜测“-2”，不提前宣布导入完成

#### Scenario: 显式名称冲突后保留检查与输入
- **WHEN** 用户显式指定的名称冲突，随后自行选择另一名称或留空
- **THEN** 冲突紧邻名称字段，原检查和输入保留；仅在既有准入允许且用户再次明确提交时执行 Import，不自动改名、重复上传或发送

#### Scenario: Import 请求返回前修改名称
- **WHEN** 用户提交显式名称 A 后在响应返回前改为其他名称或主动留空，随后 Core 返回 A 的名称冲突
- **THEN** 说明原请求使用的 A 被拒绝，保留当前输入与已检查包，不把当前字段标为无效，不自动清空、改名或发送；名称比较与实际提交一样忽略首尾空白

#### Scenario: 显式新名称不误报自动改名
- **WHEN** 用户明确将源名称“笔记”改为可用的“研究笔记”，Core 接受该名称
- **THEN** 显示实际导入目标为“研究笔记”，不声称 Core 因名称冲突自动改名

#### Scenario: 名称与受理失败恢复分开
- **WHEN** Import 已接受但仍在准备、随后失败，或恢复查询尚未取得实际名称
- **THEN** 已确认名称只作为该次目标名称显示，状态保持真实；失败不显示导入完成，未确认名称不从源名称或列表推测，不产生新的 Import 请求

#### Scenario: 匿名检查后登录同一 Core
- **WHEN** 本地检查成功，用户通过 Sign in to import 登录原 Core 后继续导入
- **THEN** 保留原传输及摘要，只使用原 transfer ID 提交 Import；本地检查上传不再执行，用户确认前不发送 Core 导入请求

#### Scenario: 登录失败或切换 Core
- **WHEN** 检查后登录原 Core 失败，或改为切换另一个 Core
- **THEN** 前者保持匿名检查以便重新登录；后者清理旧检查且不向新 Core 提交旧包，身份内容仍按现有隔离规则处理

#### Scenario: 检查期间取消或连续换包
- **WHEN** 检查正在传输时用户取消，或选中另一个包替换旧检查
- **THEN** 原本地传输/观察停止，原暂存被请求删除，旧响应不回填；新检查仅使用自己的 transfer ID 和结果

#### Scenario: 暂存清理失败
- **WHEN** 用户放弃未提交检查，但删除请求失败或响应丢失
- **THEN** 保留旧 transfer ID 的清理提示及显式重试入口，不宣称磁盘已释放，不影响其他 Work 或删除 Core 快照

#### Scenario: 导入接受后关闭观察
- **WHEN** 已提交 Import 的响应未知或已取得 Operation ID，用户关闭检查或操作弹窗
- **THEN** 保留该次导入及恢复身份，只停止本地观察，不调用远端取消、不发第二次 Import，也不以重新选择包替代核对原结果

#### Scenario: 导入后由用户选择启动并打开
- **WHEN** Import 已成功发布 stopped Work，用户先仅查看，随后明确 Start and open
- **THEN** 仅查看不运行任何包代码；显式选择后 Start 一次，确认可用才打开原新 Work，没有第二次 Import

### Requirement: 主流程的异步动作提供即时且归属明确的反馈

**Identifier:** DWUI-011

Desktop SHALL 采用 UIL-PENDING-001 的统一局部三点，并在有效动作开始后的首个可绘制机会、请求结果尚未返回时，显示动作、目标对象及正在读取/提交/上传/验证的所选界面语言状态；仅禁用按钮或改变颜色不构成等待反馈。按钮、表单、列表行、模块或传输区 SHALL 在原上下文呈现状态，等待区域提供可访问状态说明及 busy 语义。快速完成不得人为延迟；最终页面、对象状态或成功提示可直接成为完成反馈。普通菜单、搜索、选择、复制及无需读取的导航 SHALL 不被强制添加加载或 toast。

覆盖入口 SHALL 至少包括下表，鼠标、键盘提交、文件选择和深链接遵守同样规则；后台定时读取不能冒充用户刚发起的检查。

| 入口组 | 必须覆盖的动作 |
| --- | --- |
| 连接与身份 | Sign in、Sign out、Switch Core、Check connection/readiness、重试 Works 读取 |
| Work | Create、Start、Stop、Retry、Delete、Open、Check status、进入 Settings/深链接 |
| Work 模块 | Services/Files 读取与刷新、路径导航、Session 列表读取/创建/切换、Run 提交/取消/恢复 |
| Service | Start/Stop/Restart/Retry/Remove、详情及日志读取/刷新；浏览器入口按 BSA-005 |
| Files | 文本读取/保存/重读、上传/覆盖、建目录、Rename/Move/Copy/Delete、下载发起 |
| Settings | Save/Refresh/Apply、Skills 副本刷新、catalog 检查、AGENTS/JSON 文件读取、Pi Package 五种来源安装/更新/移除 |
| Work 包与恢复 | Inspect/Import、Export 准备、Download 准备/验证、原 transfer 查询与清理、Known operations、Operation/snapshot 查询、清除已完成记录 |

收到原 Operation/Run acceptance SHALL 立即展示其 ID、对象及 Accepted，不能等待后续 Work、列表、日志或配置读取才展示。执行状态 SHALL 依据真实 state/phase；不同动作不统一伪装成 Preparing，缺细阶段时显示该对象操作正在进行且保留原值。观察终态后 SHALL 提供所属对象的结果或返回/刷新入口，不把 succeeded 等同于另一能力已经 Ready、loaded 或浏览器已落盘。

同步修改已确认时 SHALL 立即保留并展示确认事实；需要关联读取时另行显示 Refreshing/Verifying，读取失败只说明当前数据未确认，保留原结果及只读恢复入口。没有可靠确认的修改 SHALL 区分明确拒绝与结果未知，保留输入和已有对象身份，禁止自动重发。手动检查成功且内容未变化时 SHALL 更新检查时间或显示此次已确认，失败不得使用成功图标/措辞。

普通导航和首屏读取 SHALL 立即建立目标页面的稳定外壳，使用稳定内容框架及固定的局部三点、Loading files / Loading conversation 等就地状态及 busy 语义满足等待反馈，不插入统一检查条。仅有本次授权身份下确认的旧数据才可先显示，并标明取得时间与正在更新；未确认数据不显示为空集合。并行模块读取 SHALL 独立收敛，不因某一模块失败而把整个 Work 退回检查页面。正常背景更新不抢焦点、不滚动或逐次播报。

覆盖 SHALL 同时包括本地/托管初始壳和会话检查、初次/手动Core连接检查、Session模型与Thinking读取/自动保存、Slash资源目录、图片草稿检查/历史图片、Chat Activity、默认Core偏好和About读取等独立状态。每次真实Core连接检查 SHALL 有可见的检查中及结束/错误状态并对同目标去重；文案为连接或检查Core，不表示Desktop会启动Core。检查失败转为准确恢复提示，不因此新增持续探测或自动进入行为。后台静默读取不逐次闪动，Files/Chat/Service的独立收敛、既有iframe及阅读锚点保持。

#### Scenario: 请求尚未返回的创建与启动
- **WHEN** 用户提交 Create Work 或 Start Work，请求被延迟
- **THEN** 原表单/Work 行在响应前显示提交动作和目标，重复入口不可再次提交，其他合法导航可用；接受后显示原 Operation，不预告 Ready

#### Scenario: 接受后关联读取缓慢
- **WHEN** Start/Stop/Delete/Apply/Package/Import/Export 已返回原 Operation ID，后续读取缓慢或失败
- **THEN** 原 ID 和 Accepted 已可见，读取独立呈现，不隐藏 acceptance、不宣称操作失败、不发第二次修改

#### Scenario: 读取不是空数据
- **WHEN** 用户打开 Work、Files、Settings、Session 或日志且请求尚未返回
- **THEN** 目标与读取状态可见，旧内容标记为最后已知，未确认列表不写成空集合/零计数；成功空集合、404 和读取失败各有不同的下一步

#### Scenario: Run 提交与请求取消
- **WHEN** 用户 Send 或 Cancel run，接受响应被延迟
- **THEN** 对应输入/Run 上显示 Submitting message 或 Requesting cancellation，保留草稿/原 Run；接受后显示真实 Run 状态，取消与成功竞争以真实终态为准

#### Scenario: 保存确认与读回分离
- **WHEN** 文件 PUT 或配置保存已被可靠确认，随后版本/配置读取失败
- **THEN** 已确认写入事实保留，界面明确版本/当前配置未确认，草稿和新编辑不丢失；不重复写入、不以旧时间授权下一次覆盖、不暗中 Apply

#### Scenario: 未变化的检查与快速完成
- **WHEN** 手动查询成功但返回相同状态，或请求立即完成
- **THEN** 查询确认时间/简短结果可辨，快速完成不增加人为等待；菜单与复制继续使用既有即时结果

#### Scenario: 自动Core检查有可辨结果
- **WHEN** 页面已完成浏览器会话检查，正在首次查询Core而请求尚未完成
- **THEN** Core连接区显示正在检查及三点，不能提前显示确定Connected；成功/错误后结束该等待，离线和Runtime未就绪分别说明，不声称正在启动Core

#### Scenario: 通用动作之外的等待不遗漏
- **WHEN** 响应设置自动保存、图片读取、Activity执行、默认Core偏好或About请求尚未确认
- **THEN** 各自原对象显示统一三点及真实阶段，完成/失败后停止；现有内容、iframe、草稿和阅读位置保持，不为此改写业务状态或重复发请求

#### Scenario: Works 首次读取使用稳定骨架
- **WHEN** 当前身份尚未确认 Works 列表，初次 Core 检查或 Works 读取正在进行
- **THEN** SHALL 立即显示对应列表结构的静态骨架及可访问加载状态，不呈现空白框或已确认零条；保留所属 Core 检查三点。成功空集合及实际错误后骨架结束，有旧列表刷新时不替换旧正文，减少动态效果下保持可辨

#### Scenario: Works 初次错误不重复提示
- **WHEN** 未确认列表的初次读取失败，随后用户重试
- **THEN** SHALL 仅在中间错误态显示纯文本原因和 Retry loading，不再重复顶部黄色刷新警告；重试在原刷新槽显示局部三点并防重，终态停止。已有确认列表（包括确认空集合）的刷新失败仍保留对应错误反馈，不抹掉正文或恢复方向

#### Scenario: 导出明细长身份仍可读
- **WHEN** Starting export 的 Details 展开且 Stop/Export Operation、Snapshot 身份较长，用户处于宽屏或360px窄屏
- **THEN** SHALL 保留完整身份、原链接和状态，值列宽度与行高随内容适配，长token安全换行且不互相重叠或遮盖后续行；默认按需披露及停止/导出/暂停/Hide/Pending语义不变

#### Scenario: Session选择器紧凑且选中状态独立
- **WHEN** 用户在当前Work打开Sessions，列表包含短名称、长token或正在运行的已选Session
- **THEN** SHALL 使用局部Popover呈现，顶部New session与列表有明确间隔且不抢占选择层级；行高可随完整名称增长，状态不挤压名称、选中勾不被Run徽标替代，宽/360px及短视口不发生横向溢出或焦点遮挡

#### Scenario: Session样式调整保留原交互与恢复
- **WHEN** 用户用鼠标或键盘切换Session、创建新Session、关闭选择器，或会话列表加载/失败/空集合
- **THEN** SHALL 保留当前Work作用域、原只读/创建请求及等待/unknown防重、Run不因切换停止；Arrow/Home/End只移焦点、Enter执行原选择、Escape恢复可用原触发点，读取锁暂不可用时沿用安全焦点回退；打开时优先聚焦并显示当前选中项；头部关闭保留而不重复footer Close，空/加载/失败保持区分与原恢复入口

### Requirement: Service 处理记录与证据在现有工作区闭环

**Identifier:** DWUI-FEEDBACK-001

Desktop SHALL 在 Chat 及对象详情中提供当前 Work 的处理记录列表与详情，可按 Service 范围分页查看真实请求、来源事件、关联 Runs、等待对象、终态、错误和证据；证据 SHALL 表达观测时间、状态/代码版本及验证结论。分页 SHALL 使用服务端有界查询和游标，不在浏览器加载全部历史。自动 Session SHALL 可以进入现有 Session/Run 观察，不新增顶层工作流导航或独立执行控制台。

Cancel request 和 Retry request SHALL 是明确且作用域可辨的操作。取消 SHALL 阻止后续自动 Run；重试 SHALL 使用稳定的新 submissionKey 生成关联原请求的新请求，而不是复用未知结果的 Action。响应丢失 SHALL 查询原请求/提交结果，不自动生成第二次重试。导入的 historical 请求 SHALL 展示历史标记并禁用直接 Retry；用户可另行明确提出新的目标。Stop/Apply/Delete 准入失败 SHALL 显示真实原因，不暗中 Start、Apply 或取消其他 Run。

该工作区 SHALL 延续 master 的本地反馈、对象级锁、关闭只停止观察、跨身份清除及已受理 ID 恢复规则；页面状态刷新 SHALL 不重载 Service iframe。处理记录是领域记录，SHALL 不混入通用 UI 读取成功流水；请求状态未知 SHALL 显示最近确认值与 Check status，不能猜测成功或失败。

Desktop SHALL 以当前 Work/Service 的有界请求查询确认是否存在记录。在现有 Service 工具栏右侧、Focus 与独立打开动作之前，仅当已确认有记录时显示所选界面语言的 Agent requests 按钮；确认空集合时隐藏，已完成、已取消和 historical 记录仍使入口保留。初次未确认时不新增空态占位，读取失败不能清除此前已确认存在的入口或被当作空集合。当前 Service 可见且 Work 可查询时 SHALL 自动进行有界、去重的只读刷新，使原本无记录时后来收到的请求能在下一次正常刷新后出现；页面隐藏、身份变化或离开该 Service时停止其周期查询。

新增 Service 入口 SHALL 复用现有请求列表与详情，初始范围为原 Work 与当前 Service；切换网页端口不改变请求范围。列表展示请求内容摘要、来源、时间、真实状态及查看/取消；详情展示原请求、可取得的关联 Run 回复、请求结果与错误，证据和技术身份按需读取。无回复、读取失败、业务请求未完成与某次 Run 已结束 SHALL 分开表达，不拿其他请求的回复或某个 Run succeeded 填充请求完成。关联回复仅从原请求确有关系的 Run 取得，不因自动 Session 共用而展示整个 Session 的无关内容。

Service 入口的新增操作 SHALL 限于查看和取消，不增加补充对话或输入框；原 Chat 全 Work 入口和既有显式 Retry 能力保持原位置与语义，不在新入口增加重试流程。pending 或等待中的 live 请求可直接取消，执行中显示 cancelling 直到真实 Run 收尾；取消后不得再自动续接。终态完成先提交时返回原结果，historical 只读。取消 Agent 处理不撤销已经提交的业务 Job 或数据。

列表/详情的查看、分页、状态刷新与关闭 SHALL 不修改用户 Session 选择，不重载同一 Service iframe，不启动 Run。关闭详情返回原请求列表及其过滤、阅读位置，关闭列表返回发起入口并恢复焦点；Work/Core/账号切换使旧响应失效。读取或取消未确认 SHALL 沿既有错误与原请求 Check status 恢复，不自动重发消息或新建请求。

同一身份、Work 和原请求范围内，关联 Run 读取失败 SHALL 保留该 Run 最后确认的回复、实际模型与 Thinking，并显示读取错误及最后成功读取时间；首次未取得回复、已取得后刷新失败及其他 Run 成功刷新 SHALL 分别表达。部分失败不得清空其他已确认回复，不得使用其他请求缓存填充内容；关联仅以该原请求当前确认的 runIds 为准。

原 Chat 显式 Retry 的接受响应未知时，Desktop SHALL 保留原 Work、原 requestId、原 submissionKey 和对应未知操作锁，并通过纯读取核对该次 Retry 的受理结果。确认受理时 SHALL 验证新请求属于该 Work 且 retryOf 指向原请求，展示该已受理新请求并仅解除匹配的未知锁；读取旧请求本身或另一个新请求不得视为该次 Retry 已确认。同一身份内未找到映射、读取失败或旧组件不支持时 SHALL 保留未知表达、原键和匹配锁，不自动重发 Retry、不新建键、不解除其他操作锁。身份改变 SHALL 使旧响应失效，不把旧意图或内容迁移到新身份，不以旧结果解除新身份的锁。只读核对不得唤醒处理、创建请求/Run 或隐式 Start/Apply；Service 新入口仍不增加 Retry 动作。

用户在列表取消后，Desktop SHALL 在列表或对应详情可见且 Work 可查询时，对该原记录立即及正常每五秒进行有界、去重的只读收尾核对，并将最新确认状态合并回原分页缓存。确认终态后结束该记录的收尾观察；读取失败保留最后确认状态和错误恢复入口，不将取消请求显示为已取消。隐藏页面、离开该 Work 或关闭列表/详情 SHALL 停止本地收尾观察，重新打开时核对原记录，不重发取消；完成先提交时保留真实完成结果。

证据分页响应 SHALL 仅合并对应请求的证据项和分页游标，使用响应返回时该原请求的当前缓存，不以发起分页时的旧详情替换缓存。分页附带的旧请求投影 SHALL 不回写最新确认的 state、updatedAt、runIds、result、error、状态确认时间或读取错误，不据此过滤已确认回复或修改取消收尾观察标记。已确认终态 SHALL 不因晚分页回退为非终态；详情和列表继续保持同一最新确认投影，不通过重新启动收尾观察补救旧状态回写。

#### Scenario: 查看一次异步处理的闭环
- **WHEN** Service 请求从受理、Action、等待 Job、验证到完成
- **THEN** 详情关联来源事件、真实 Run/Action/Job 与结果证据，等待期间可继续手动聊天，终态能追溯验证依据

#### Scenario: 重试响应丢失
- **WHEN** 用户显式 Retry request 后失去响应
- **THEN** 保留原请求、本次 submissionKey 与对应未知锁，只读核对该键；确认后定位已受理且 retryOf 匹配的新请求，只解除匹配锁，不重发 Retry 或自动生成第二个请求

#### Scenario: 导入历史不参与自动处理
- **WHEN** 用户打开导入 Work 的来源请求与证据
- **THEN** 能完整阅读历史，直接重试不可用，Work 启动不会因此产生自动 Run

#### Scenario: 空 Service 后收到首个请求
- **WHEN** Service 请求查询已确认空集合，随后该 Service 向 Agentd 成功投递首个请求
- **THEN** 初始工具栏无按钮和占位，下一次正常只读刷新后出现 Agent requests；没有统计条、状态卡、额外页面或自动弹窗

#### Scenario: 只有终态或导入历史
- **WHEN** 当前 Service 的记录全部已完成、已取消或 historical
- **THEN** 按钮保留，用户可查看原结果；终态及 historical 不提供取消，historical 不进入自动执行

#### Scenario: Service 范围和晚响应
- **WHEN** 用户从 Service A 打开请求记录，换端口或切换为 Service B，A 的旧读取随后返回
- **THEN** A 的端口变化不产生另一份请求范围；B 的入口和记录只使用 B 的读取，旧响应不覆盖 B 或新的用户身份

#### Scenario: 请求回复和 Main Chat 保持独立
- **WHEN** 用户打开多个自动请求之一的详情，自动 Session 同时保存其他请求的历史
- **THEN** 只显示该请求可确认关联的回复与结果，Main Chat 的 Session、草稿及阅读位置不变，同一 iframe 不增加文档加载，没有新模型提交

#### Scenario: 取消等待或正在处理的请求
- **WHEN** 用户从新 Service 入口取消一个 pending、waiting_result 或 running 的 live 请求
- **THEN** 无活跃执行时取消原请求；执行中先显示 cancelling，确认停止后显示 cancelled并阻止续接；原业务 Job 和已提交结果仍按自己的真实状态显示

#### Scenario: 取消回执或查询失败
- **WHEN** 已有记录的刷新失败，或取消返回结果未确认
- **THEN** 原入口、请求身份和最后确认内容保留，现有错误与 Check status 可用，不把失败显示为无记录或已取消

#### Scenario: 只读详情关闭与专注布局
- **WHEN** 用户在 Service + Chat、仅 Service 或 360px 布局中查看、取消并关闭详情
- **THEN** Agent requests 和退出动作可达，返回原列表或发起入口且焦点可恢复，Service iframe和用户 Chat节点不被重建

#### Scenario: 已确认回复的重新读取失败
- **WHEN** 原请求已有可见回复和实际执行信息，重新读取对应 Run 返回错误
- **THEN** 保留最后确认内容并标明读取失败和最后确认时间，不改成未取得回复，不加载其他 Session 全部历史

#### Scenario: 多个关联 Run 部分读取失败
- **WHEN** 同一请求的多个已确认关联 Run 中，一部分刷新成功而另一部分刷新失败
- **THEN** 成功部分更新，失败部分保留各自最后确认内容并说明错误，不相互覆盖且不串入其他请求回复

#### Scenario: Retry 核对尚未确认或旧组件不支持
- **WHEN** 原 Retry 回执未知，按原键查询未找到映射、失败或报告不支持
- **THEN** 保留原键、未知结果和匹配锁，可继续只读核对，不把未找到视为失败，不发送 Retry POST 或自动更新镜像

#### Scenario: Retry 核对范围失配或晚响应
- **WHEN** 核对结果的 Work、原请求或提交键不匹配，或用户已切换身份/Work
- **THEN** 不采用该结果、不解除当前或其他操作锁，不展示另一作用域内容、不触发新的执行

#### Scenario: 列表取消跟踪真实终态
- **WHEN** 用户在列表取消 running 请求，收到 cancelling 后原执行实际收尾
- **THEN** 可见列表在下一次正常只读核对后更新为原真实终态，取消动作随终态禁用，分页、过滤、阅读位置、Main Chat 和同一 iframe 保持

#### Scenario: 关闭列表停止收尾观察
- **WHEN** 列表取消中的原请求尚未收尾，用户关闭列表或隐藏页面后再打开
- **THEN** 离开时停止本地周期读取而不撤销远端取消，重新打开只读核对原记录，不重发 Cancel 或新建请求

#### Scenario: 证据分页与取消终态核对并发
- **WHEN** More evidence 已读取 cancelling 的旧请求快照但响应延迟，原 ID 状态读取先确认 cancelled 并结束收尾观察，然后旧分页响应返回
- **THEN** 只将该页证据和游标合并到当前缓存，详情及各列表缓存保持 cancelled、最新结果、错误和 runIds，取消观察标记不被旧页改变；返回列表并经过正常刷新周期仍保持终态，只有一次 Cancel 且没有新 Run

### Requirement: Service 专注视图与浏览器全屏有独立且可恢复的状态

**Identifier:** DWUI-FOCUS-001

Desktop SHALL 在可嵌入 Service 的工具栏提供 Focus，进入填满当前浏览器内容区域的 Service + Chat 布局，隐藏常规导航。Hide chat / Show chat 在同一专注布局切换仅 Service 或 Service + Chat，聊天仍为当前 Session。Exit focus SHALL 始终可达并恢复进入前的常规区域、对象选择、草稿、阅读位置和焦点来源。没有可嵌入 Service、尚未取得入口、明确禁止嵌入或入口失败时 SHALL 给出对应等待/原因与既有独立打开入口，不将 Focus 变成绕过嵌入限制的方法；可保留当前视口的未确认预览仍可进入 Focus，并继续显示真实未知状态。

Focus chat SHALL 从常规区域或 Service 专注布局放大同一 Chat；仅 Chat 头部持续保留 Restore layout 与 Exit focus。恢复回到放大前常规区域或专注布局，退出直接恢复首次进入专注前常规区域。Service + Chat、仅 Service、仅 Chat 共用返回所有者，内部切换不覆盖最初返回目标；普通 Chat 模块仍有正常导航，不等同于 Focus chat。

仅因 Focus chat 及恢复改变布局 SHALL 保持同一 Service iframe/祖先和 Chat 节点连接，隐藏而不卸载、不改 src、不重取入口；正常跨模块导航仍按原规则处理。用户明确切换 Service/端口或 Session 后返回保留该新选择，失效对象给原因且仍可退出。退出与恢复以现有图标按钮和所选界面语言的准确 tooltip/无障碍名表达，不藏在溢出菜单。

Full screen SHALL 是专注工具栏中的额外、明确用户动作，使用当前同一视图。浏览器不支持、拒绝或退出全屏时 SHALL 保留可用的专注布局并给出就地说明。浏览器 Esc 退出全屏只取消全屏状态，不自动退出专注或丢失数据；Exit focus 在本视图全屏时先请求退出，再恢复常规布局。普通专注视图中，外壳取得键盘事件且没有优先菜单/弹层时 Esc 可返回；跨源应用内部键盘事件不能保证传给外壳，始终保留返回按钮。

进入、隐藏 Chat、退出全屏和返回 SHALL 不重建同一 Service/端口视口、不重置 Chat、不中断 Run 观察、不改原访问 origin、不产生 Apply/Start/Stop。仅在明确选择另一 Service/端口或服务真实失去资格时沿原访问规则转换，状态变化不伪造应用成功。专注仅为当前页面临时状态，不写入 Work 配置，不复制为另一个 Session，不影响独立窗口。

窄屏无法同时容纳 Service 与 Chat 时 SHALL 用可关闭的 Chat 覆盖层；Show chat 打开同一会话，关闭恢复 Service，焦点按来源恢复。隐藏 Chat 时 SHALL 以紧凑提示表示当前 Run 进行中、失败或观察未知，不重复自动弹出 Chat。弹层、菜单及覆盖层 SHALL 遵守明确键盘优先级和可见焦点；360px 下返回和显隐动作仍可用。

#### Scenario: 同一应用和对话切换布局
- **WHEN** Service 页面已填写未保存内容，Chat 有草稿，用户进入 Focus、隐藏并显示 Chat、返回
- **THEN** 同一 iframe 没有再次文档加载，应用输入保留，Session、草稿、展开选择和阅读位置保持，没有新提交或停止请求

#### Scenario: 浏览器全屏失败与 Esc
- **WHEN** 用户请求全屏被拒绝，或成功后按浏览器 Esc
- **THEN** 前者解释无法全屏且专注仍可用，后者回到专注；Exit focus 始终能恢复常规布局

#### Scenario: 服务不可预览或执行仍进行
- **WHEN** Service 无入口/禁止嵌入/真实停止，或 Chat 隐藏期间 Run 仍在执行
- **THEN** 显示真实访问原因和回退，隐藏聊天不改变 Run；进行中、失败和未知可从紧凑提示辨认

#### Scenario: 窄屏及弹层键盘
- **WHEN** 用户在窄屏显示 Chat 并打开命令菜单，再按 Esc
- **THEN** Esc 先关闭菜单，再关闭 Chat 覆盖层，返回按钮仍可达；浏览器全屏退出与布局返回不混为同一动作

#### Scenario: 从专注进入其他模块
- **WHEN** 用户在专注中的 Chat 执行 /settings，或选择打开 Files
- **THEN** 先恢复常规布局再打开目标，按原返回位置回到 Work；恢复专注本身不重载视口，模块导航继续遵守原容器规则

#### Scenario: Focus 与 Focus chat 完整往返
- **WHEN** Service 有未保存表单且 Chat 有草稿，用户依次进入 Focus、Focus chat、Restore layout、Exit focus
- **THEN** 每一步有可见出口，恢复回原专注布局，退出恢复常规导航，同一 iframe/Session、表单、草稿、阅读位置及 Activity 展开保持，无重复文档加载或业务请求

#### Scenario: 仅 Chat 直接退出
- **WHEN** 用户从专注布局进入仅 Chat 并直接 Exit focus
- **THEN** 一次退出恢复最初常规区域，不需先恢复 Service 工具栏或固定跳往 Services

#### Scenario: 返回目标随来源确定
- **WHEN** 用户从常规 Files、常规 Chat 或仅 Service 专注进入 Focus chat 并恢复
- **THEN** 分别恢复原常规区域或仅 Service 专注布局，当前 Session 与未保存内容保持，重复放大不丢返回目标

#### Scenario: 仅 Chat 的全屏与异常出口
- **WHEN** 仅 Chat 中菜单打开、浏览器全屏，或 Work/Service 失去资格
- **THEN** 菜单、浏览器全屏与布局遵守逐层键盘返回，Exit focus 始终可见，异常原因按真实资格表达，退出不发业务修改

### Requirement: Chat 图片草稿支持三种添加方式与显式发送

**Identifier:** DWUI-IMAGE-001

Desktop SHALL 在常规 Chat、Agent 辅助栏及 Focus chat 共用图片草稿，允许在输入区域粘贴剪贴板图片、拖入图片文件及通过与所选语言对应的 `Add images` 文件选择入口添加图片。添加后 SHALL 显示缩略图、可访问名称及移除动作；纯图片和图文组合均可显式 Enter/Send 发送，添加、预览和移除本身不创建 Session/Run、不调用模型或上传到 Work。

第一版 SHALL 支持 PNG、JPEG、WebP，每条最多 4 张、每张原始字节最多 5 MiB、图片总量最多 10 MiB；单图宽高各最多 8192 像素、总像素最多 40,000,000。超限、不支持、容器结构非法/截断或无法生成预览的图片 SHALL 给出就地原因，保留此前合法草稿。添加混合批次时 SHALL 明确逐项结果，不能静默丢弃非法项。普通文字粘贴保留原行为，不从 HTML、文件路径或远端链接暗中抓取图片。

同一 Work/Session 的图片及文字 SHALL 随布局切换保持；切换 Session/Work 不串用草稿，切换账号/Core、注销或本地授权失效 SHALL 清理旧身份草稿和预览资源。文件读取/校验的晚结果不得加入新上下文。图片添加、移除和查看 SHALL 支持键盘、所选界面语言的明确名称与 360px 窄屏，不挤走 Send 或既有配置摘要。

#### Scenario: 三种方式进入同一草稿
- **WHEN** 用户依次粘贴截图、拖入图片和选择图片，并切换到 Focus chat
- **THEN** 同一草稿显示已添加图片，顺序保持，可逐张移除，没有上传、Session 创建或 Run 提交

#### Scenario: 纯图片与图文发送
- **WHEN** 用户有合法图片且无文字，或同时输入文字，明确点击 Send/Enter
- **THEN** 分别提交一条纯图片或图文消息，图片与文字属于同一 Run；Shift+Enter 和输入法组合仍遵守原规则

#### Scenario: 类型、容量与混合批次
- **WHEN** 用户添加 SVG、结构损坏或无法预览的图片、超限图片或含合法/非法项的文件批次
- **THEN** 逐项说明未接受项及原因，合法已有草稿不丢失，未通过检查的内容不发送

#### Scenario: 异步选择与身份变化
- **WHEN** 图片读取期间用户切换 Session、Work 或账号，旧读取随后完成
- **THEN** 不加入新对象草稿；同身份原草稿按归属保留，旧身份资源清理，其他 Service 和 Chat 内容不被覆盖
