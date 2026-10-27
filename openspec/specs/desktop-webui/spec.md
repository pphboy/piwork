# Desktop WebUI Specification

## Purpose

使 Work 所有者通过 CLI 启动的本地浏览器界面完成工具使用、Agent 对话、共享文件和 Work 维护，落实统一产品语言，并为认证、长任务、大文件传输及失败恢复建立可测试的运行契约。

## Requirements

### Requirement: 连接与用户会话在本地入口内完整闭环

**Identifier:** DWUI-001

本需求中的 CLI 实例/共享凭证、Switch Core 及默认 Core 偏好条款适用于独立 piwork-cli desktop 模式；其普通浏览器会话自动建立，不构成独立 Access 门禁。统一服务端工作台使用 DWUI-HOSTED-001 的服务器浏览器会话与固定所属 Core，不读取 CLI 凭据；两模式共同的业务反馈、恢复和身份隔离约束保持。

Desktop SHALL 展示当前 Core、用户身份、Core 可达性、运行环境及各能力状态，区分可达与可创建/可对话/可访问文件。用户 SHALL 可登录、查看身份、登出及切换 Core。复用凭证前 SHALL 验证所属 Core 和当前用户，错误不得展示其他身份的旧内容。无登录仍 SHALL 能检查本地 `.work`，但不取得任何 Core 内容。

确认的 Core 会话失效 SHALL 清除该平台身份派生的内容授权、关闭相关内容流并进入登录恢复页面；仍有效的浏览器本地控制会话 SHALL 保留用于重新登录，不要求重启 Desktop。普通网络失败保留最后已知状态与取得时间，不推断为登出。重新登录同一 Core/用户 SHALL 可查询已知 Operation，不能重发原提交。切换身份 SHALL 清空内容缓存和草稿，已知操作记录按 Core/用户隔离。登出在 Core 可达时 SHALL 撤销平台会话；不可达时仍立即撤销该平台身份的本地内容访问并说明未确认远端撤销，禁止显示远端撤销成功。

Desktop SHALL 只以真实 Core 用户会话和连接状态决定账号界面，不提供独立浏览器 Access 状态。普通地址打开后自动建立必要的浏览器会话：可复用的同 Core CLI 凭据经正常核验后进入工作区，否则显示可提交的账号登录、连接配置和 Inspect，不要求特殊链接或额外授权。正常 Sign out 清除该 Desktop 当前平台登录，保留普通登录页面的可用性；其影响包括该实例中使用同一平台身份的其他浏览器，不影响持有其他 Core 会话的客户端。

当前连接编辑及切换 SHALL 接受 CLI-CORE-PROTOCOL-001 定义的 HTTP(S) origin，不因目标非 loopback 拒绝 HTTP。默认 Core 配置的编辑、保存、读取及后续启动 SHALL 使用相同的协议准入。偏好仍为不含凭据的独立 v1 本地记录，保存/清除仅影响之后启动，不切换当前连接、不改凭证、不清理 Inspect，退出登录仍保留默认地址。

合法 HTTP 输入 SHALL 进入原动作的加载、等待、确认或失败状态，不显示“远程必须 HTTPS”的错误或增加确认流程。非法 origin SHALL 保留输入并就地说明格式错误，后端拒绝相应修改。保存响应丢失或提交后未确认 SHALL 沿原只读核对流程恢复，不自动重发。HTTP 与 HTTPS 的 origin 身份不同，切换时 SHALL 按原身份撤销/内容隔离规则处理。

#### Scenario: Core 可达但运行环境失败
- **WHEN** 健康接口正常而运行依赖不可用
- **THEN** 登录和可用控制信息仍可使用，创建/启动显示真实限制，不把连接状态写成全部 Ready

#### Scenario: 过期后重新登录
- **WHEN** 用户在观察已接受的 Import 时会话过期，随后重新登录同一账号
- **THEN** 内容访问中止后恢复原 Operation 查询，Import 不被再次提交

#### Scenario: 切换 Core 或用户
- **WHEN** 用户从 Core A/用户 A 切换到 Core B 或用户 B
- **THEN** A 的 token、文件内容、对话和活动不被发送给或展示为 B 的内容

#### Scenario: 本地授权有效而 Core 会话过期
- **WHEN** 普通浏览器会话仍有效而 Core 明确拒绝当前账号会话
- **THEN** 显示可提交的账号登录表单，旧内容和派生连接被撤销，重新登录不需要新启动链接或重启 CLI

#### Scenario: 本地未授权不能伪装成账号登录
- **WHEN** 新浏览器直接打开运行中 Desktop 的普通地址，或已有浏览器清除 Cookie 后刷新
- **THEN** 必要会话自动建立，必须核验真实同 Core 共享凭据后才能进入工作区，否则显示可提交的正常登录/连接页面；不以普通 Cookie 伪造 Core 登录，不出现 Access 页面或要求终端重新打开

#### Scenario: 登录页面连接远程 HTTP Core
- **WHEN** 用户在普通登录/连接页将当前 Core 切换为合法远程 HTTP origin
- **THEN** 输入不被协议限制拒绝，界面显示切换等待与实际连接结果，可在 Core 可达时登录；不可达时提供连接恢复而不伪造已登录

#### Scenario: HTTP 默认地址保存并用于重启
- **WHEN** 用户将 HTTP Core B 保存为默认地址，当前连接为 A，随后关闭 CLI 并在没有参数/环境覆盖时重启
- **THEN** 保存时当前仍为 A，读回显示 B；新实例使用 B，依原 origin 规则判断登录状态，普通业务 CLI 的地址优先级不变

#### Scenario: 读取已有 HTTP 偏好及清除
- **WHEN** 安全的 v1 偏好记录含合法 HTTP origin，或用户显式恢复自动选择
- **THEN** HTTP 记录可正常读取且无需迁移；清除后显示未设置，当前连接及 Inspect 保持，后续启动按原回退规则选择

#### Scenario: 从 HTTPS 切换到同地址的 HTTP
- **WHEN** 用户已有 HTTPS Core 登录，显式切换为同 host/port 的 HTTP Core
- **THEN** 旧身份的 token、内容流、缓存及草稿按原切换规则隔离，不借用旧 token；新 origin 只有真实认证成功后才成为已登录

#### Scenario: 协议扩展不放宽本地授权
- **WHEN** 错误 Host/Origin 或缺失/错误 CSRF 的请求尝试切换或保存 HTTP Core
- **THEN** 在修改连接或本地文件前拒绝；合法页面可自动恢复普通会话后由用户显式重试，不因 HTTP 地址放行，也不要求浏览器 Access 授权

#### Scenario: HTTP 输入的失败与未知结果
- **WHEN** 输入非法 origin，或合法 HTTP 默认地址遇到锁冲突、存储失败、响应丢失
- **THEN** 分别显示格式/明确失败/未确认结果，保留输入和最后确认值；只有原对象只读核对才能解除未知结果保护，不自动再保存

### Requirement: 以统一语言组织可操作的 Work 工作区

**Identifier:** DWUI-002

Desktop SHALL 落实 DUL-001—007、DUL-010、DUL-016 的对象、容器、英文文案和 Serve 浅色视觉规则。Work List SHALL 独立展示搜索、New Work、Import、账号、按需出现的无可见 Work 任务提示与对齐的状态/动作列；原操作按所属任务查找，不提供全局 Known operations 入口。打开 Work SHALL 直接进入专属面板，无跨 Work 侧栏或强制概览；Service/Files/Chat 为同级入口，Settings 明确可达。

首次进入且无当前身份的有效上次区域时，可用 Service SHALL 为默认主区域，同一 Session 的 Agent 输入保留在辅助栏；首次进入且无有效上次区域时，无可用 Service 且对话准入成功则聚焦 Chat。停止状态 SHALL 展示 Start、配置、Export 与历史保留提示，不新读历史。切换区域 SHALL 保留当前 Service/端口、Session 和本页面非敏感草稿；不承诺任意应用内部未保存表单的恢复。所有列表 SHALL 区分加载、真正空集合、错误和带时间的旧内容。

共同颜色/字阶/间距/控件 SHALL 可集中修改；360px 无整页横向溢出，长名称和技术标识可完整读取/复制，危险/编辑弹层按 DUL-007 管理焦点及未保存确认。交付 SHALL 提供原型 36 帧/CLI 能力矩阵到实际界面与验收记录的对应关系。

同一有效身份的当前页面生命周期内，重新进入 Work SHALL 优先恢复上次明确选择的 Services、Files 或 Chat，以及仍存在且有权访问的 Service/port、Session、文件目录和已打开文件；首次进入才使用默认区域规则。恢复目标的读取使用该区域稳定外壳，不先强制切往 Services。目标失效 SHALL 说明原因并提供该模块可用回退，不能因后台加载晚到覆盖用户的新选择。离开脏文件/配置仍需既有确认；不将草稿或选择持久化到另一身份。

最后确认可用的 Work/Service 仅遇到状态观察网络错误、超时或暂时服务错误时，Desktop SHALL 保留同一已挂载应用视口与工作区，标记状态未确认及安全重查入口；不能因该读取错误卸载再创建 iframe、清除草稿或抢焦点。保留画面不表示刷新授权或确认 Ready，不扩大新动作准入；已确认停止/删除、停止目标接受、真实资格撤销及身份失效仍按原规则限制能力和撤销访问。

Desktop SHALL 按主流程、对象管理、全局管理分层：Ready Work 优先直接 Open，Stopped 保留 Start；Stop 与 Work information 在所属 Work 更多菜单；About Piwork 在账号下拉，Known operations 不作为账号菜单入口。Files 空选择提示不占独立行，批量动作在已有工具栏；Service/Agent请求入口使用有可访问名称的就近图标，分别保留当前Service与全Work作用域。账号下拉外侧关闭不受背景草稿/任务阻碍，不扩大其他确认窗规则。

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
- **THEN** Name 字段附近显示可理解的英文换名提示，名称及高级草稿保持，没有假 Operation 或自动提交

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

### Requirement: Session 与 Run 的观察可恢复且不重复提交

**Identifier:** DWUI-004

Desktop SHALL 提供 Session 创建、列表、读取与切换，提交消息、文本/工具事件、Run 详情和显式取消，落实 DUL-012。标题使用真实首消息摘要或创建时间/ID。一个 Work 活跃 Run 的限制 SHALL 在其他 Session 提交前后都明确反馈，保留草稿且不建立隐藏队列。取消以当前 Run ID 为目标，取消中不预告终态。

断线恢复 SHALL 按原 Run ID 和事件游标查询/观察，重复事件去重；游标过期 SHALL 查询结果和 Session 历史，不重发 prompt。旧 context 不兼容 SHALL 提供 New session 并保留草稿，不自动迁移。停止 Work 不新取历史，页面已有内容标为旧内容。所有观察 SHALL 在切换身份、对象或页面卸载时释放本地连接，不取消远端执行。

手动 Run 与由显式 Service 请求受理的自动 Run SHALL 共用真实 Session/Run 历史和观察能力。自动处理记录与已经受理的 Run SHALL 分开表达：待处理或等待状态不等于正在执行模型；自动请求不是手动消息的隐藏队列。每个 Run SHALL 展示实际模型及执行来源，Service 来源 SHALL 能定位请求、已核验的事件/证据和当前阶段。关闭观察不取消请求；Cancel run 取消当前 Run，若关联未完成请求则同时结束其后续自动续接；Cancel request 可直接取消待处理、执行中或等待中的请求。

当前用户 Chat 的模型发送 SHALL 根据本 Work 的真实活跃 Run 与独立能力确认，在原 Send 位置显示 Stop and send；目标快照绑定原 Core/账号、Work、Session、旧 Run、输入内容和原 submissionKey。用户点击或在该动作明确可见时按 Enter 才执行 CONV-CANCEL-SEND-001；空输入、未确认模型设置、非法图片或失效资源命令不得取消旧 Run。Shift+Enter、输入法组合和五个网页 slash 动作保持原行为；仅导航或编辑不请求取消。

Stop and send SHALL 可以取消同 Work 的任意来源旧 Run，取消与新提交由服务端协调，确认旧执行结束后才接受新 Run；不能把按钮操作拆成可能被后台抢槽的独立隐式发送。旧 Run 已终态且没有另一个活跃 Run时正常提交；出现新的不同活跃 Run 时保留输入并重新确认目标，不扩展取消授权。取消等待最多 5 秒；超时、明确拒绝或新受理前失败保留文字、图片和设置，超时后不得因旧 Run 稍后结束而自动发送。提交接受响应未知时保留原键并按 CONV-SUBMISSION-001 只读核对。

当前 Work 活跃 Run 的读取 SHALL 不切换当前 Session 或加载其他 Session 全部历史；支持能力未确认、Work 不可达或读取失败不得当作已确认空闲。未支持组合动作的旧 Agent SHALL 保留已有 Cancel run、普通 Send 和 busy 提示。已受理 Run 的执行与观察断线规则不变。

Chat 正文 SHALL 移除 Run History ID 列表，原 Session/Run 数据及实际模型、Thinking、来源仍在按需 Run 详情可读。历史详情 SHALL 绑定明确的原 Run，不覆盖当前活跃 Run 的观察对象，不取消或提交执行；错误、进行中与未知提交恢复仍在所属上下文可见。

全 Work 活跃 Run 的投影 SHALL 只决定忙碌说明及明确的停止目标，不取代当前 Session 原 Run 的错误和观察恢复投影。当前 Chat 原错误、失败及未知反馈 SHALL 在其他来源占槽时继续可见；打开原 Run 详情或核对原状态 SHALL 不覆盖活动槽的观察对象、不改绑停止目标，也不提交执行。旧消息缺少可确认关联时保留原未知表达，不猜测另一个 Run 属于当前用户消息。

事件入口返回 410 后，Desktop SHALL 真正读取原 Run 和对应 Session；只有历史读取成功后才能提示历史已恢复。SHALL 停止向事件入口重发同一失效游标，不擅自用 0 重播。原 Run 仍活跃时 SHALL 展示历史恢复模式，以串行只读查询观察原 Run 和已保存历史；查询到终态后 SHALL 停止自动观察并呈现最终结果，已有输出不得重复追加。读取失败 SHALL 保留已知内容、Run ID 和可恢复提示；鉴权失效或对象不存在 SHALL 停止自动读取并进入对应恢复状态，不能发送新的 Run。

当前身份各 Work/Session 中未发送的非空文字或图片草稿 SHALL 纳入页面刷新、关闭和离开的未保存保护；浏览器支持且满足提示条件时请求原生离页确认，取消离开保留原草稿。不自动发送、上传或新建 Session，不承诺浏览器强制关闭、崩溃或不支持离页提示时能恢复。首版不新增跨关页草稿持久化；账号/Core 切换、注销和本地授权失效仍清理旧身份草稿及图片预览资源。可靠受理只消费本次提交快照，后续新编辑仍受保护。

Run详情入口 SHALL 绑定实际Work/runId及Session上下文，并跟随对应一轮消息/Activity或明确活动执行状态；没有runId的历史消息不推测绑定当前最近Run，同一Run不因多段消息重复展示详情。全Work业务请求与Session对话、单次Run SHALL 分层，Request与Run各自显示真实状态；等待请求可没有活跃Run，某次Run成功不能推导目标完成。请求列表/详情展示调整 SHALL 保持分页、原过滤、取消竞争、historical只读及Retry新请求语义。

Assistant消息正文 SHALL 支持GFM标题、强调、列表、链接、代码块及表格，历史与流式增量采用同一renderer；用户文字与工具输出保持原义。原始HTML不得执行，危险/相对链接不得导航本地授权页面，外链隔离opener，Markdown图片不自动读取外部资源。超出解析预算或解析失败时 SHALL 保留完整转义文字；表格和代码在消息内横向滚动，不撑开Chat或覆盖输入区。现有source入口、鉴权图片、Session/Run身份与阅读位置规则保持。

#### Scenario: 历史与新回复含表格或代码
- **WHEN** 打开已有assistant历史或接收增量Markdown表格、未闭合代码围栏
- **THEN** 正文安全解析或完整转义回退，表格/代码可局部滚动，危险HTML与URL不执行，用户/工具文字及原附件入口不改变

#### Scenario: 忙碌时保留输入
- **WHEN** 同一 Work 的另一 Session 正在执行而当前 Session 发送失败为 busy
- **THEN** 显示活动执行入口并保留草稿，不排队、不取消旧 Run

#### Scenario: 断线与游标过期
- **WHEN** 事件观察断开，恢复请求报告游标过期
- **THEN** 从原 Run 结果和 Session 历史恢复，只呈现一次已有输出，不发第二次消息

#### Scenario: 取消与成功竞争
- **WHEN** 用户取消时 Core 已经成功完成 Run
- **THEN** 最终显示 succeeded，不能以本地取消请求覆盖真实结果

#### Scenario: 等待请求不是活跃 Run
- **WHEN** Service 请求等待 Job 完成，而当前 Work 没有活跃 Run
- **THEN** 显示等待对象和最近确认时间，手动聊天可以正常受理，不将等待展示为模型持续执行

#### Scenario: 取消范围可辨
- **WHEN** 用户打开自动 Run 的详情
- **THEN** 能分别识别当前 Run 和来源请求的状态与取消影响，取消请求后不得再自动续接

#### Scenario: 当前 Work 的其他 Session 或 Service 占槽
- **WHEN** 当前用户 Session 有可发送草稿，真实活跃 Run 来自另一 Session 或 Service，且能力已确认
- **THEN** Send 位置提供 Stop and send 并明确旧执行来源，用户确认后在原用户 Session 接受一个新 Run，最多一个执行占槽，用户会话与草稿不被后台对话替换

#### Scenario: 无效新消息不影响旧执行
- **WHEN** 用户尝试用空输入、非法图片、未知命令或未确认模型执行 Stop and send
- **THEN** 保留内容并说明校验原因，旧 Run 不收到取消，没有新 Run

#### Scenario: 取消等待超时且旧 Run 随后结束
- **WHEN** 旧执行在取消请求后 5 秒仍未收尾，并在界面已收到超时后才结束
- **THEN** 显示取消等待超时与原状态核对，草稿保留，没有新消息自动提交，旧执行槽在实际停止前继续保留

#### Scenario: 目标变化和完成竞争
- **WHEN** 原目标 Run 先完成，或它完成后新的不同 Run 已占槽
- **THEN** 前者保留原结果并正常发送；后者保留草稿并更新忙碌目标，不取消新 Run、不自动发送

#### Scenario: 接受响应丢失与后续编辑
- **WHEN** Stop and send 的新 Run 已受理但响应丢失，或用户在等待期间继续编辑下一条内容
- **THEN** 按原 submissionKey 查询同一 Run且不重发，确认只消费已提交快照，后来的文字、图片和模型选择保持

#### Scenario: 原能力降级与历史详情
- **WHEN** Agent 未声明组合动作能力，或用户查看已完成 Run 的执行信息
- **THEN** 前者保留普通聊天与显式 Cancel run，不静默升级镜像；后者不显示正文 ID 列表，详情仍可读实际设置、来源和诊断，不替换当前执行观察对象

#### Scenario: 后台活动与当前 Chat 错误并存
- **WHEN** 当前 Session 有已确认失败或观察中断的原 Run，另一 Session 或 Service 随后占用活动槽
- **THEN** 原错误与按原 Run 核对的入口继续可见，忙碌来源及 Stop and send 指向另一个真实活跃 Run，草稿、Session 和原观察关联保持

#### Scenario: 410 后原 Run 已完成
- **WHEN** 事件入口返回 410，原 Run 查询确认 succeeded 且 Session 保存了最终回答
- **THEN** 实际读取 Session 并展示最终回答一次，停止自动读取，不重复 POST prompt 或请求失效事件游标

#### Scenario: 410 后原 Run 仍运行
- **WHEN** 事件入口返回 410，原 Run 先返回 running 后进入终态
- **THEN** 通过同一 Run 的只读状态和 Session 历史查询看到运行中及终态，事件入口不收到同一失效游标的无限重试，终态后查询停止

#### Scenario: 历史恢复失败或身份切换
- **WHEN** Session 读取失败、鉴权失效，或用户在历史恢复期间切换身份
- **THEN** 不显示虚假的恢复成功；读取失败保留已知内容和恢复入口，身份失效后停止旧观察且旧响应不写入新身份

#### Scenario: 文字或图片草稿触发离页保护
- **WHEN** 用户交互后在任一 Session 保留未发送文字或合法图片并尝试刷新页面
- **THEN** 支持的浏览器请求离页确认；取消后文本、图片和归属保持，没有 Run 或上传；只有全部草稿已消费/明确丢弃时不因聊天草稿阻止离开

#### Scenario: 旧身份草稿不会被离页保护保留到新身份
- **WHEN** 用户注销、切换账号/Core 或本地授权失效
- **THEN** 按原安全规则清理文字、图片和预览资源，不因离页保护留下可被新身份读取的内容

#### Scenario: 当前对话和其他来源的执行详情不混淆
- **WHEN** 用户查看当前Session历史Run，同时Work由其他Session/Service运行或存在等待请求
- **THEN** 各入口只打开精确原Run/Request，来源可辨，旧消息不绑定最新执行；关闭查看不停止Run或恢复等待目标

#### Scenario: 多次执行的请求仍以目标状态为准
- **WHEN** 请求关联多个Run，其中某次succeeded但目标waiting_result/waiting_apply/needs_attention
- **THEN** 原请求状态与必要下一步直接可见，执行、回复与证据按真实关联呈现，不虚构整体完成或重放mutation

### Requirement: Service 管理与数据上下文清楚分离

**Identifier:** DWUI-005

Desktop SHALL 实现 DUL-004、006、013：Service 列表/详情包含禁用、失败、非 Web 服务，提供公开域名/端口、Start/Stop/Restart/Retry/Remove 和有界日志刷新，访问行为遵循 `browser-service-access`。Stop 是持久禁用，Start 不启动停止的 Work，Remove 保留共享文件且无法以 Start 撤销。日志 SHALL 显示取得时间、截断及不可用原因，不伪装实时终端。无效动作说明原因，控制完成以原 Operation 为准。

所选 Service SHALL 只提供明确的身份上下文，不自动读取或上传页面 DOM、输入、截图和内存。用户请求分析时 SHALL 通过 Agent 的实际文件/API 能力取得数据，并要求回答说明来源；无来源时说明不可访问，不声称浏览器已同步数据。现有 Service 创建/定义更新仍由 Agent 工作流完成。

Pi 开发且实现交互契约的 Service SHALL 可以主动记录页面路径和业务动作，并向 Agent 提交显式请求；这些事实由 Service 的事件/API 提供，不是 Desktop 对任意网页的监听。Service 详情和 Work 请求检查面板 SHALL 能查询该 Service 的处理记录、事件来源和证据；仅有普通事件不启动自动 Run。未接入契约的外部 Service SHALL 只显示平台已经确认的状态、日志、可访问性以及 Agent 实际读取到的外部信息，不声称掌握其内部用户操作。

打开 Service 详情 SHALL 先呈现该对象已知身份、状态和按真实准入可用的控制，日志作为独立内容加载。日志慢响应或失败 SHALL 仅影响日志区域，提供日志重试及取得时间；不得阻止进入详情或把合法控制一并隐藏。旧 Service/身份的日志晚结果不能覆盖当前对象。

Starting、Failed、Disabled 和无 Web 入口 SHALL 分别说明真实原因；仅已确认未启用才使用 Disabled 解释。用户 Start/Restart/Retry Service 后 SHALL 保留原 Service 上下文和原 Operation 入口，结果确认后可返回该 Service，并在真实浏览器入口可用时提供 Open Service。详情/处理记录关闭使用 Close，真正取消请求仍使用 Cancel request，不混淆关闭观察与业务取消。

Service选择器 SHALL 使用已确认的名称、observed、enabled及声明Web端口，区分应用切换和Manage services。单端口轻显示，多端口独立选择；非Web/Removed对象不伪造应用入口。切换不可用Service仅选择并解释原因，不自动Start；其他Service/端口的晚准备结果不得覆盖当前选择，Chat上下文保持。

#### Scenario: 非 Web 和禁用 Service
- **WHEN** 服务没有可用 Web 端口或被禁用
- **THEN** 仍可查看详情/日志和有效控制动作，不能因为不可预览就隐藏服务

#### Scenario: 移除后文件仍保留
- **WHEN** 用户确认 Remove Service 并观察到成功
- **THEN** 服务消失但共享 workspace 不被 UI 描述为已删除，恢复定义仍需 Agent 操作

#### Scenario: 请求分析 Service 数据
- **WHEN** 用户操作应用后在聊天中请求分析
- **THEN** 明确传递 Service 身份而非页面内容，实际读取文件/API 后说明来源，数据不可达时不编造结果

#### Scenario: 两类 Service 的观测边界
- **WHEN** 同一 Work 包含接入契约的应用和未接入的外部 Service
- **THEN** 前者可显示其提供的页面路径、业务事件与请求回执，后者仅显示已经取得的外部信息，界面不自动采集两者 DOM 或输入内容

#### Scenario: 日志失败仍可管理服务
- **WHEN** 用户打开 Service 详情，日志 GET 挂起或返回 503
- **THEN** 身份与状态立即可读，符合当前准入的控制可用，日志区域有等待/错误及重试；日志重试仅读取日志

#### Scenario: 切换服务后旧日志返回
- **WHEN** Service A 日志未返回时用户查看 B
- **THEN** B 的身份、控制和日志不被 A 的晚结果覆盖，旧结果不弹回 A

#### Scenario: 服务开始运行后可继续使用
- **WHEN** Service 控制达到确认结果且入口可用
- **THEN** 当前详情保留对应对象并提供访问入口；Starting/Failed 无额外错误字段时仍不误称 Disabled

#### Scenario: 关闭请求详情不取消执行
- **WHEN** 用户在活跃 Pi request 详情点击 Close
- **THEN** 只关闭详情，未发送取消请求；只有明确 Cancel request 才改变原请求

#### Scenario: 紧凑选择器保留真实状态与端口
- **WHEN** 多个Service具有长名称、不同状态或多个声明端口，用户快速切换及用键盘关闭选择器
- **THEN** 名称/状态/端口与选中项对齐可读，焦点回触发器，只打开当前合法目标；无自动Start、未声明端口或Chat切换

### Requirement: 浏览器文件操作覆盖共享 workspace

**Identifier:** DWUI-006

Files SHALL 以当前 Work 的整个共享 workspace 为根（包含隐藏项），通过本地认证入口调用 Core WebDAV；仅运行且文件准入成功时可读写。SHALL 实现 PROPFIND 列目录、GET 下载/文本读取、PUT 上传/保存、MKCOL、同 Work MOVE/COPY/DELETE，准确处理 Destination、Location、DAV href、中文与百分号路径及逐项错误。工作根不可删除、移动或重命名，符号链接/特殊项按真实类型限制，不能穿越根或跨 Work。

文本编辑 SHALL 限于至多 1 MiB、合法 UTF-8 且不含 NUL 的普通文件；超限或二进制提供 Download。编辑不自动保存，不承诺锁/ETag/自动合并，离开前明确 Save/Discard/Keep editing；保存前展示并发覆盖风险，已知修改时间可用时携带条件请求，冲突先重读，不自动覆盖。上传逐文件显示结果，已存在目的地须明确覆盖；目录操作可递归时先说明影响。

SHALL 遵守 Core 文件限额及单 Work mutation 并发限制；浏览器默认逐文件上传，无隐式写入重试。`207` 展示成功/失败路径，未知写入要求重读实际目录。普通下载不表示一致性备份，不提供目录 ZIP 或跨 Work 操作。文件能力缺失 SHALL 只局部降级。Connect with WebDAV SHALL 展示现有 proxy 命令、完整 Work URL 和终端临时密码获取方法，浏览器 Files 不依赖该流程。

编辑保存 SHALL 将 `If-Unmodified-Since` 绑定到读取正文时已知的修改时间；后台目录刷新不得将脏编辑的读取版本偷偷升级。新文件上传 SHALL 使用 `If-None-Match: *`，防止 HEAD 确认不存在后出现的文件被覆盖。既有文件覆盖 SHALL 绑定用户确认的路径及已知修改时间，发送已有条件请求；读取失败不视为不存在。条件冲突 SHALL 保留本地编辑或待上传 File，展示先重读/比较的恢复入口，不能自动改成无条件 PUT。重读 SHALL 分别保留用户草稿和新保存版本；再次覆盖重读版本须用户明确同意。有可用条件时使用条件，无可用修改时间时 SHALL 明示不能进行版本保护并要求显式覆盖同意，不宣称具有文件锁或强一致保护。

文本编辑器 SHALL 直接提供 Download saved version，下载真实已保存文件；未保存编辑保持且不自动 PUT，不以草稿内容冒充服务端版本。Copy/Move/Delete/Rename 的逐路径结果 SHALL 在仍打开的操作弹层内可读，分别显示成功、明确失败和未知及下一步；不要求关闭弹层才能查看错误原因。失败项输入保留；未知先核对原路径，成功项不因再次确认被盲目重做。

New folder/Rename SHALL 在打开后将焦点置于命名字段；Rename 预填原 basename，文件名选择优先主名并保留扩展名，目录可全选。普通 Enter 仅对该字段合法且未 busy 的现有提交动作生效，输入法组合期间 Enter 不提交，危险/覆盖确认不继承通用 Enter 快捷提交。

Files常规工具栏 SHALL 仅有一个Refresh，并以More file actions更多命令菜单承接Upload/New folder及分隔后的WebDAV次级入口，不在Workspace options重复相同刷新或WebDAV入口。等待/成功按DWUI-019在原刷新控件呈现，不增加额外Status checked行或重复成功toast；列表选择、编辑草稿、未知写入及逐路径错误规则保持。

#### Scenario: 文件读写全流程
- **WHEN** 用户建目录、上传、编辑、重命名、复制、移动并下载文件
- **THEN** 相应 WebDAV 操作作用于同一 workspace，内容一致且浏览器不持有 Core token 或外部 WebDAV 密码

#### Scenario: 大文件、特殊项及越界
- **WHEN** 用户尝试编辑超限/非 UTF-8 文件、符号链接，或修改根及跨 Work 目标
- **THEN** 合法普通文件可下载，非法编辑/目标给出原因并在写入前拒绝

#### Scenario: 覆盖冲突和响应丢失
- **WHEN** 文件保存发生条件冲突，或 PUT 已发出但结果丢失
- **THEN** 保留本地编辑，提示重读/比较，不能自动再次 PUT 或声称回滚

#### Scenario: 目录部分失败和后端缺失
- **WHEN** 目录请求返回 207，或 Core 文件后端不可用
- **THEN** 前者显示逐路径结果并刷新；后者只禁用 Files，仍允许可用 Service 与 Work 控制

#### Scenario: 用户编辑期间 Agent 更新同一文件
- **WHEN** 用户读取带修改时间的文件后编辑，Agent 在下一秒或更晚更新该文件，随后用户保存
- **THEN** PUT 携带原修改时间，Core 的 412 被显示为冲突；Agent 的内容保留，本地草稿保留，没有无条件重试

#### Scenario: 新建上传的 HEAD 与 PUT 之间出现同名文件
- **WHEN** HEAD 返回 404 后另一写入者创建了同名目标，随后上传发送 PUT
- **THEN** PUT 包含 `If-None-Match: *`，返回条件冲突，不覆盖新出现的文件；待上传文件保留，须重读并显式确认覆盖

#### Scenario: 确认覆盖后目标再次变化
- **WHEN** 用户确认覆盖的既有目标在 PUT 前以可辨别的新修改时间变化
- **THEN** 原确认版本的条件请求失败；页面保留上传输入并要求重新核对，不自动以最新版本刷新覆盖同意

#### Scenario: 重读不自动覆盖草稿或重复写入
- **WHEN** 条件冲突或未知保存结果后用户重读文件
- **THEN** 新保存版本与本地草稿分别可查看，重读本身仅 GET；用户明确接受新的覆盖基线并再次保存才允许下一次 PUT

#### Scenario: 在编辑器下载已保存文件
- **WHEN** 用户打开文本并保留未保存修改后点击 Download saved version
- **THEN** 直接发起保存版本下载，草稿保持且没有 PUT；发起下载不宣称已落盘

#### Scenario: 失败结果在当前弹层可见
- **WHEN** 一项 COPY/MOVE/DELETE 明确失败或响应未知而操作弹层仍打开
- **THEN** 该路径、结果和原因在弹层内可读，提供安全核对方向，不被背景详情遮挡或自动重发

#### Scenario: 混合结果不整体重试
- **WHEN** 合成两路径操作返回一项成功和一项失败/未知
- **THEN** 弹层分别显示实际结果，不声称整体回滚；已成功项不会被盲目重做，未知项先只读核对

#### Scenario: 命名可直接输入并安全提交
- **WHEN** 用户打开 New folder 或对中文、带点、无扩展名文件及目录 Rename
- **THEN** 字段正确聚焦并预填适用名称，普通 Enter 最多提交一次，IME Enter 不提交，失败保留输入，取消不修改

#### Scenario: 刷新菜单整理不影响文件保护
- **WHEN** 用户通过唯一Refresh重读列表、通过More file actions上传/建目录，或在未知写入后核对
- **THEN** 工具栏与文件行位置稳定，菜单键盘可达，仍使用原目录和条件保护；正常成功不插新行，未知只核对原目标

### Requirement: 配置、能力目录与应用形成独立步骤

**Identifier:** DWUI-007

Settings SHALL 按 DUL-014 完整提供 Skills 目录与 Work 选择/清空、AGENTS 当前/待应用内容及导入编辑、Advanced 完整 JSON show/set、Pi Package 目录及 Work 已安装项。In use、Saved changes、Not applied、runtime loaded/modelVisible SHALL 各自对应真实状态。目录不可编造说明；重选 Core 副本与保留 Work 副本的语义须明确。

Package SHALL 支持 Core/npm/Git/本地目录/ZIP 的安装与显式来源更新、enable/disable/remove；本地目录和 ZIP 使用浏览器选择器与受限上传。选择现有包不暗中安装或刷新。保存和包修改仅更新 desired；Apply 为独立 Operation，不暗中启动 Work 或取消 Run，后续新编辑仍待应用。Apply 失败保留 prior active，回退失败如实展示 Work 故障。离开脏表单 SHALL 处理保存、放弃或继续编辑。

piwork-brain SHALL 使用现有 Pi Packages 与 Files 产品流程。Files 中 `.pi/packages/piwork-brain/` 是可编辑源；Settings 中 loaded/modelVisible 对应 active 捕获包，不能因文件已修改就宣称采用。候选详情 SHALL 展示来源摘要、受理基线、验证目标、准备/发布结果及真实 Apply 状态，区分包已加载与实际 SDK 行为已核验。用户显式 Apply 期间仍允许后续配置编辑；晚返回候选不得覆盖无关的新 desired。自动验证只能在有效加载之后运行，不能在 Apply 初始化中调用模型。

候选详情 SHALL 在现有 Package Details 分项展示受理时 active/desired 选择与当前匹配摘要、固定目标及能力、安全输入摘要和必要 checks、准备发布结果、对应 Apply 原 ID/状态，并能按原 ID 打开既有请求/Operation 详情。内部 context identity、制品 digest、凭据和宿主路径 SHALL 不成为展示字段。没有匹配 Apply、观测不可用、加载失败与行为失败 SHALL 分开，不能用 Saved/Loaded 标签或缺字段 JSON 代替这些信息；打开或刷新详情不提交修改，也不重载 Service iframe。

Skills、Packages、AGENTS.md 与 Advanced SHALL 展示同一份未保存配置；保存结果 SHALL 不取决于当前页签。有效 JSON 中的显式空集合和空 AGENTS 内容 SHALL 保留，未在普通表单编辑的其他公开字段 SHALL 保留；重复编辑同一字段采用最后一次有效显式编辑。非法 JSON SHALL 保留输入并定位错误，阻止配置提交与向其他配置页签转换，用户仍可修正或明确放弃草稿。保存失败或结果未知 SHALL 保留完整非敏感草稿，不触发 Apply。

Core 目录读取状态 SHALL 与 Core 可达性/readiness 和 Work 草稿独立。刷新时 SHALL 保留已有数据并显示正在检查；部分失败保留成功目录及旧 Work 副本并定位失败目录，不能将失败当成空目录或全局离线。成功取得有效目录响应后 SHALL 清除该目录的不可用状态并按实际数据及动作准入恢复操作；有效空数组表示空目录。刷新 SHALL 不修改已选 Skills、Packages 或其他未保存配置。

Open brain source SHALL 经既有脏配置/文件离开保护后导航到当前 Work 的 Files 并打开明确源文件，成功后关闭原详情且退出 Settings 路由。读取失败 SHALL 在目标上下文显示真实原因与重试，不虚构已经打开；取消离开确认保持原设置与草稿，不丢目标文件身份或擅自保存/Apply。

Settings的Back to Work SHALL 作为左侧内容返回导航，恢复原有效区域/对象，并区别顶栏Back to Works；未保存保护保持。saved与active一致时 SHALL 使用轻量状态及按需配置详情，不占用大型正常状态卡或无意义的禁用Apply主动作；Unsaved、Not applied、Applying、失败/未知及安全下一步仍直接可辨。省略正常说明不得合并Save/Apply或把Loaded当成验证完成。

#### Scenario: 安装与 Apply 分开
- **WHEN** 用户从任一支持来源安装包成功但尚未 Apply
- **THEN** 显示 Saved/Not applied，不声称 loaded；用户显式 Apply 后才观察激活结果

#### Scenario: 忙碌与失败回退
- **WHEN** Apply 被 Run busy 拒绝，或已接受 Apply 验证失败
- **THEN** 前者保留配置不取消 Run；后者显示真实回退结果，不能将安装成功当成运行成功

#### Scenario: Apply 期间继续编辑
- **WHEN** Apply 已接受后用户保存新的 AGENTS/Advanced 内容
- **THEN** 原 Operation 只激活其已接受候选，新编辑仍 Not applied

#### Scenario: 已加载但未完成脑包验证
- **WHEN** 候选 Apply 成功且运行时已加载包，但实际 SDK 目标工具输出尚未通过检查
- **THEN** Package 显示真实加载状态，请求继续显示验证阶段，不显示整个更新已完成

#### Scenario: 候选晚返回与用户新编辑
- **WHEN** 候选准备期间用户保存了无关的 Skills 或 AGENTS 修改
- **THEN** 候选发布保留这些新编辑，冲突的脑包基线单独报告，原 Apply 与后来编辑分别呈现

#### Scenario: 候选详情包含原验收项与 Apply
- **WHEN** 用户打开已准备候选详情，包括无关保存后 Apply 加载失败的候选
- **THEN** 可读到原受理基线、固定能力/输入摘要/必要 checks、准备结果和实际对应的 Apply ID/状态；可按原 ID 查请求与回退依据，Service 页面及当前 Session 不被刷新或替换

#### Scenario: Advanced 修改后从其他页签保存
- **WHEN** 用户在 Advanced 修改 Skills、Packages、AGENTS.md 和其他公开字段，切到 Skills 或 AGENTS.md 后保存
- **THEN** 相应页签展示新值，提交包含全部修改，不用原表单值覆盖 JSON；保存仅更新 desired

#### Scenario: 普通表单修改后从 Advanced 保存
- **WHEN** 用户先修改 Skills、Packages 或 AGENTS.md，再打开 Advanced 保存
- **THEN** JSON 展示并提交普通表单的新值，显式空值保留，同一字段最后一次有效编辑生效

#### Scenario: JSON 非法时尝试转换或保存
- **WHEN** Advanced 存在无法解析的 JSON，用户切换配置页签或点击任一保存入口
- **THEN** 保留原文及脏状态，显示定位错误，不转换到另一配置页签、不发配置 PUT；明确 Discard 可放弃该草稿

#### Scenario: 目录失败后恢复
- **WHEN** Skills 或 Packages 曾读取失败，随后用户刷新获得有效目录
- **THEN** 清除对应不可用反馈并恢复合法动作，用户现有选择和草稿保持不变，不覆盖 Core 离线或运行环境未就绪的真实状态

#### Scenario: 目录部分失败及空集合
- **WHEN** Skills 成功而 Packages 失败，随后 Packages 成功返回空数组
- **THEN** 首次只提示 Packages 错误且保留 Skills；后续显示真实空 Packages 目录并清除其错误，保留 Work 已保存副本和未保存选择

#### Scenario: 从脑包详情直接打开源码
- **WHEN** 用户在 Pi Package 详情点击 Open brain source 且文件可读
- **THEN** 进入该 Work Files 的目标 brain.md 编辑器，原详情关闭且路由不再停在 Settings，无需额外找文件

#### Scenario: 脑包导航尊重未保存编辑
- **WHEN** Settings 存在草稿时用户 Open brain source 并取消离开
- **THEN** 仍在原 Settings/详情并保留草稿，没有隐式 Save、Apply 或文件写入；同意离开后才进入目标文件

#### Scenario: 设置正常态简洁而异常仍明确
- **WHEN** 配置分别为一致、未保存、已保存待Apply、Apply中、失败或未知，用户刷新并返回Work
- **THEN** 仅一致状态降为轻提示，其余状态及合法动作明确；返回原区域并执行未保存保护，不自动Save/Apply或丢失后续草稿

### Requirement: 完整 Work 包可以本地检查和原子导入

**Identifier:** DWUI-008

用户 SHALL 能选择 `.work` 在本地完整 Inspect，无需 Core 登录、不执行包内代码，显示既有安全摘要和私有内容提醒，允许检查后直接关闭。上传与检查 SHALL 流式处理并遵守现有 `.work` 格式、完整校验及容量限制，不将整个包放进浏览器/CLI 内存。

Import SHALL 复用检查后的同一包，提交前校验仍一致；名称留空真正省略，显式冲突定位名称字段；目标权限与模型兼容由 Core 校验。上传不虚构 Operation；接受后保留原 ID，发布前/失败时无半成品 Work。成功展示最终名称、新 ID 与 Imported · Not started，并提供显式 Start and open 和仅查看/暂不启动入口。不自动运行 Service 或包代码。取消未提交传输可清理本地暂存；取消观察不撤销已接受 Import。

同一本地浏览器会话在同一 Core 下从匿名检查进入首次登录时，SHALL 保留已完整验证且未提交的包和其本地传输身份；登录成功后可继续检查摘要并显式导入，无需重新选择文件或上传到本地 CLI。登录失败不丢弃合法匿名检查。此例外 SHALL 不保留已认证用户的 Core 内容，亦不适用于切换 Core、已认证用户切换账号、登出或本地会话失效。

用户关闭未提交检查、替换所选包或取消仍在进行的本地检查时，SHALL 中止相应本地传输/观察并请求释放原暂存；晚到的进度和结果不得重新打开旧检查或覆盖新包。删除确认成功或已不存在后才显示清理完成，失败时保留可定位的清理信息与显式重试入口，不能以隐藏弹窗代替清理。为同一 Core 登录而暂离检查不属于放弃该包。Import 提交中、接受响应未知及已接受后 SHALL 保留该次身份及恢复信息，不按未提交检查重新提交、替换或取消远端操作；关闭仅停止本地观察。

Start and open SHALL 只在用户于导入成功后明确选择时提交 Start，并在真实 Work 及能力确认后打开；导入成功、详情关闭、状态查询或查看控制信息都不能自动启动外来包。启动失败/未知保留导入成功事实、原 Start 身份及安全恢复，不重复 Import。

本地 Inspect 摘要 SHALL 提供来自已验证包的 `sourceName` 显示字段，用于本页自动改名前后的名称说明；该字段不改变包格式、校验或导入执行。

Import 名称字段 SHALL 在提交前说明：留空使用包内源名称，名称不可用时由 Core 自动添加唯一后缀；显式名称须可用。客户端不得依据列表预测或提前承诺具体后缀。受理后 SHALL 使用现有接受响应的最终 `name` 显示本次导入目标名称；只有未显式指定名称且 Core 最终名称与已确认源名称不同，才能说明自动改名并显示原名称和实际名称。用户显式选择不同名称不应被描述为 Core 因重名自动改名。

显式名称冲突 SHALL 在名称字段旁给出换名或主动留空的英文提示，保留名称、已检查包及其他输入；不得自动清空、修改名称或重新发送 Import。修改和后续提交仍遵守既有 transfer 准入、未知结果保护与用户显式提交规则。

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

### Requirement: 导出与下载保持显式阶段及原快照恢复

**Identifier:** DWUI-009

Export SHALL 按 DUL-009 清楚呈现停止（需要时）、生成、传输校验与浏览器下载的真实阶段；一次明确的 Export current Work and download 可授权连续执行后续必要步骤，不要求每阶段额外点击。仅 desired/observed 均 stopped 且无已知冲突时可提交，最终准入以 Core 为准；只有用户在明确影响确认中选择 Stop and export 后才可提交 Stop 并继续；普通导出入口或旧快照查看不能隐式 Stop，Export 不暗中 Apply、另行取消 Run 或启动 Work。接受后保留 Operation/snapshot ID，成功且完整校验后可下载。完整 `.work` 使用既有快照格式，包含 workspace 及格式定义的其他持久内容，文件浏览下载不能替代它。

下载 SHALL 复用原 snapshot，流式传输、核验长度/hash，失败不能显示保存完成；过期明确提示用户重新发起 Export，不静默创建快照。SHALL 提供按 snapshot ID 找回下载。浏览器下载动作仅能确认发起时显示 Download started，不宣称实际落盘完成；敏感包提醒在下载前可见。临时空间不足必须可见且不删除 Core 已生成快照。

从 Work 进入导出 SHALL 始终保留显式“导出当前内容”的新尝试入口，不能被已有成功快照遮蔽；新尝试使用自己的提交身份。旧快照下载 SHALL 与新导出分开标识，显示可靠取得的 ID、状态、大小与过期信息；无可靠生成时间时不伪造时间，不称为当前最新内容。按 snapshot ID 或某个导出 Operation 打开时 SHALL 精确使用原 snapshot，不能再按 Work 随意选另一份；新导出后续下载只能使用本次 acceptance 对应的 snapshot。

一次交付意图 SHALL 绑定发起时有效 Core、用户、本地授权、Work 及原操作/快照/传输，页面内导航或收起面板不取消该意图。同一意图在未被用户手动暂停、snapshot 成功并经 CLI 完整验证且原 transfer ready 后最多自动发起一次浏览器内容下载；重复状态、晚 POST 与只读恢复不得重复触发。浏览器可能拦截或由用户取消保存，界面 SHALL 保留同一已验证 transfer 的显式 Save file / Download again，不重新打包。

未知 Export/下载准备结果 SHALL 先查询原对象，不重放 POST 或生成新意图；无可查原身份时说明恢复限制。停止失败/未知、实际尚未停止、快照失败/过期、完整性校验失败或身份失效均阻止继续交付。切换 Core/账号、注销或本地授权失效撤销旧自动交付；重新登录或重载页面只能查询已知原结果并由用户显式继续下载，不恢复未保存的自动交付意图。此行为不构成持久后台队列或跨页面卸载/进程续传。

用户对导出流程明确 Pause 时 SHALL 暂停尚未开始的下一阶段和自动内容交付；已经接受的远端操作不被取消，晚结果可按原身份记录但不推进。Check status/Check transfer SHALL 仅核对原结果，不解除手动 Pause；只有明确 Resume 并核对原结果后，仍有效的意图才可继续尚未提交的下一阶段或单次交付，不重放原未知修改。关闭进度不是 Pause。

本变更交付验证 SHALL 使用真实Docker Engine、Core、Agent及匹配helper完成停止、快照生成、完整校验、真实浏览器下载、本地Inspect、Import为stopped及用户显式Start；以实际字节/hash、原Operation/snapshot/transfer、请求次数、权限撤销和限定安装清理作为证据，不以合成Core响应替代真实链路。

#### Scenario: 真实Docker导出导入闭环
- **WHEN** 在独立真实Core安装中创建合成Work数据并由Desktop完成停止、导出、下载、检查、导入和显式启动
- **THEN** 实际Docker Agent/helper参与执行，下载包与原snapshot的长度/hash一致，Import后未自动启动且显式Start后数据逐字节一致，原ID及单次提交/交付可核验；撤销测试权限后旧访问被真实服务端拒绝，清理仅作用于本次installation ID

#### Scenario: 运行中请求导出
- **WHEN** Work ready 或 stopping 时用户进入 Export
- **THEN** running 状态提供目标和 Run/Service/文件影响明确的 Stop and export 确认；确认前无 Stop/Export，确认后只 Stop 一次并待真实停止再导出。已在 stopping 时说明等待原停止，未确认前无 Export，不重复 Stop

#### Scenario: 状态显示停止但 Core 拒绝
- **WHEN** Core 发现实际写入者或快照锁而拒绝 Export
- **THEN** 显示安全原因和恢复入口，不提供半成品下载

#### Scenario: 下载断开或过期
- **WHEN** 下载失败后用户重试，或快照已过期
- **THEN** 有效快照使用原 ID；过期显示明确原因，需要用户重新 Export，不自动重做

#### Scenario: 停止态一次导出并发起下载
- **WHEN** 用户在已确认 stopped Work 显式导出当前内容，原 Operation/snapshot 成功且 CLI transfer 完整验证 ready
- **THEN** 同一进度上下文衔接生成和校验后发起一次浏览器下载，没有必经 View package/再次 Download；保留实际阶段、原 ID、隐私提醒和手动保存入口

#### Scenario: 停止并导出的失败不越过前置条件
- **WHEN** 用户确认 Stop and export 后停止失败、未知或 Work 尚未确认停止
- **THEN** 保留原停止操作与导出目标，显示对应安全恢复，没有 Export 或半成品下载；只读确认恢复后才允许沿已授权目标继续

#### Scenario: 导出最新内容与下载旧快照分开
- **WHEN** Work 曾导出后又被用户修改并再次停止，且已知两份快照
- **THEN** 显式新导出仍可用且绑定新 snapshot；按旧 ID 打开只下载该旧快照，数组顺序变化不替换目标

#### Scenario: 关闭进度仍完成原交付
- **WHEN** 用户发起导出/下载后关闭面板并在同一有效身份内浏览另一 Work，原 transfer ready
- **THEN** 保留原目标归属且最多一次发起原文件下载，不弹回旧详情、不替换新 Work 内容；可见通知指明原 Work 与下载发起事实

#### Scenario: 准备响应丢失后恢复交付
- **WHEN** 原下载准备 POST 响应丢失，随后 Check transfer 确认原 transfer ready
- **THEN** 只查询原 transfer；仍有效、未手动暂停且未消费的当前页面交付意图发起一次下载，已发起则不重复，没有新 Export/准备 POST

#### Scenario: 切换身份或重载不自动交付
- **WHEN** 下载准备期间注销/切换 Core或账号/失去本地授权，或页面重载
- **THEN** 旧自动交付失效，晚结果不下载也不进入新身份；同身份重新授权后可显式查询/下载原结果，不假称续传或落盘

#### Scenario: 自动下载被浏览器拦截
- **WHEN** 已验证包的自动浏览器下载未被浏览器接纳或用户未保存
- **THEN** 保留明确手动 Save file / Download again 入口及原 transfer，不重新生成或重新准备，不把 Download started 写成保存完成

#### Scenario: 手动暂停门控后续导出交付
- **WHEN** 用户 Pause 原导出观察后原 snapshot/transfer 的晚结果变为 ready，随后先 Check 再 Resume
- **THEN** Pause 和 Check 期间只记录/核对原事实，不发新的阶段 POST/content；明确 Resume 核对后才沿仍有效的原授权意图继续，已提交或已消费阶段不重复

### Requirement: 已知操作恢复不形成隐式任务队列

**Identifier:** DWUI-010

Desktop SHALL 在 Work、Service、Apply、Packages、Import、Export 所属任务上下文提供原 Operation 详情、按 ID 查询和只读恢复；没有可见 Work 的创建、导入及已移除 Work 任务在 Works 列表提供必要的临时提示。账号菜单不提供 Known operations，全局操作列表和操作中心不作为替代入口。已接受操作持久记录仅含 Core/用户归属、类型、相关身份 ID 和时间；页面重载后重新查询原对象，不能称为全局历史。记录不得包含凭证、提示词、文件正文、包字节或来源秘密。未知结果 SHALL 保留最后确认时间、原 ID 和 Check status；无 Operation ID 的未知提交不能自动再发，提示核对对象状态。

多窗口与观察重连 SHALL 不导致重复 mutation。请求进行时防重复点击，关闭普通详情仅结束该详情展示/读取观察，不取消远端执行；已经明确授权且仍有效的导出交付按 DWUI-009/013 继续；有幂等键的提交保持该次键且不用于新意图。读失败采用有界退避，鉴权失败进入恢复，404/410 不无限重试。用户可隐藏已完成提示或清除本地显示记录，不改变 Core 对象、未完成任务的恢复、待同步依据或未知修改保护。

#### Scenario: 删除后重载
- **WHEN** Delete 已接受且列表已无该 Work，用户刷新页面
- **THEN** 从当前身份已知记录恢复原 Operation，仍可查看清理结果

#### Scenario: 提交响应丢失
- **WHEN** 控制请求已发送但未取得 Operation ID
- **THEN** 显示结果未知并引导核对状态，不自动再次提交，不虚构 ID 或失败终态

#### Scenario: 多窗口观察同一任务
- **WHEN** 两个窗口恢复同一个已知 Operation
- **THEN** 二者只查询该任务，无新增 mutation，切换身份后不读取旧身份记录

### Requirement: 主流程的异步动作提供即时且归属明确的反馈

**Identifier:** DWUI-011

Desktop SHALL 采用 UIL-PENDING-001 的统一局部三点，并在有效动作开始后的首个可绘制机会、请求结果尚未返回时，显示动作、目标对象及正在读取/提交/上传/验证的英文状态；仅禁用按钮或改变颜色不构成等待反馈。按钮、表单、列表行、模块或传输区 SHALL 在原上下文呈现状态，等待区域提供可访问状态说明及 busy 语义。快速完成不得人为延迟；最终页面、对象状态或成功提示可直接成为完成反馈。普通菜单、搜索、选择、复制及无需读取的导航 SHALL 不被强制添加加载或 toast。

覆盖入口 SHALL 至少包括下表，鼠标、键盘提交、文件选择和深链接遵守同样规则；后台定时读取不能冒充用户刚发起的检查。

| 入口组 | 必须覆盖的动作 |
| --- | --- |
| 连接与身份 | Sign in、Sign out、Switch Core、Check connection/readiness、重试 Works 读取 |
| Work | Create、Start、Stop、Retry、Delete、Open、Check status、进入 Settings/深链接 |
| Work 模块 | Services/Files 读取与刷新、路径导航、Session 列表读取/创建/切换、Run 提交/取消/恢复 |
| Service | Start/Stop/Restart/Retry/Remove、详情及日志读取/刷新；浏览器入口按 BSA-005 |
| Files | 文本读取/保存/重读、上传/覆盖、建目录、Rename/Move/Copy/Delete、下载发起 |
| Settings | Save/Refresh/Apply、Skills 副本刷新、catalog 检查、AGENTS/JSON 文件读取、Pi Package 五种来源安装/更新/移除 |
| Work 包与恢复 | Inspect/Import、Export 准备、Download 准备/验证、原 transfer 查询与清理、所属任务的 Operation/snapshot 查询、已完成任务提示关闭或本地记录移除 |

收到原 Operation acceptance SHALL 立即展示对象及 Accepted，并使原 ID 在所属任务详情中可按需查看和复制，不能等待后续 Work、列表、日志或配置读取才展示。收到原 Run acceptance SHALL 立即展示其 ID、对象及 Accepted。执行状态 SHALL 依据真实 state/phase；不同动作不统一伪装成 Preparing，缺细阶段时显示该对象操作正在进行且保留原值。观察终态后 SHALL 提供所属对象的结果或返回/刷新入口，不把 succeeded 等同于另一能力已经 Ready、loaded 或浏览器已落盘。

同步修改已确认时 SHALL 立即保留并展示确认事实；需要关联读取时另行显示 Refreshing/Verifying，读取失败只说明当前数据未确认，保留原结果及只读恢复入口。没有可靠确认的修改 SHALL 区分明确拒绝与结果未知，保留输入和已有对象身份，禁止自动重发。手动检查成功且内容未变化时 SHALL 更新检查时间或显示此次已确认，失败不得使用成功图标/措辞。

普通导航和首屏读取 SHALL 立即建立目标页面的稳定外壳，使用稳定内容框架及固定的局部三点、Loading files / Loading conversation 等就地状态及 busy 语义满足等待反馈，不插入统一检查条。仅有本次授权身份下确认的旧数据才可先显示，并标明取得时间与正在更新；未确认数据不显示为空集合。并行模块读取 SHALL 独立收敛，不因某一模块失败而把整个 Work 退回检查页面。正常背景更新不抢焦点、不滚动或逐次播报。

覆盖 SHALL 同时包括本地/托管初始壳和会话检查、初次/手动Core连接检查、Session模型与Thinking读取/自动保存、Slash资源目录、图片草稿检查/历史图片、Chat Activity、默认Core偏好和About读取等独立状态。每次真实Core连接检查 SHALL 有可见的检查中及结束/错误状态并对同目标去重；文案为连接或检查Core，不表示Desktop会启动Core。检查失败转为准确恢复提示，不因此新增持续探测或自动进入行为。后台静默读取不逐次闪动，Files/Chat/Service的独立收敛、既有iframe及阅读锚点保持。

#### Scenario: 请求尚未返回的创建与启动
- **WHEN** 用户提交 Create Work 或 Start Work，请求被延迟
- **THEN** 原表单/Work 行在响应前显示提交动作和目标，重复入口不可再次提交，其他合法导航可用；接受后显示原 Operation，不预告 Ready

#### Scenario: 接受后关联读取缓慢
- **WHEN** Start/Stop/Delete/Apply/Package/Import/Export 已返回原 Operation ID，后续读取缓慢或失败
- **THEN** Accepted 已可见且原 ID 可按需查看，读取独立呈现，不隐藏 acceptance、不宣称操作失败、不发第二次修改

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

### Requirement: 等待状态按对象防重复并允许离开和独立操作

**Identifier:** DWUI-012

Desktop SHALL 只限制该提交的重复入口和同对象的冲突修改，禁止用一个异步动作禁用整页按钮。同一 Work 文件修改串行，同一 Service 控制提交串行，同一配置提交串行；同 Work 生命周期提交期间限制冲突写入。取得 acceptance 后提交锁 SHALL 释放，后续准入仍按真实对象状态及既有控制语义，允许合法 Stop 取代未完成 Start；不能将 Operation 观察当作全局锁。身份变更提交期间阻止新的平台修改，既有匿名 Inspect 规则保持。

Service 控制提交的对象 SHALL 按发起时的 Work 与 Service 身份绑定，不包含浏览器入口端口。切换端口、关闭再打开详情或换用另一控制入口不能绕过同一 Service 的在途冲突锁；其他 Service 的合法动作保持可用。Service 预览、入口准备及其缓存仍按 Work/Service/port 区分。

等待期间 SHALL 保留普通 Close/Back、复制及无关对象的合法动作，导航仍检查脏草稿。关闭普通详情或离开模块只结束当前展示/读取观察，不暗中取消远端 Operation、Run 或已提交修改；DWUI-009 的明确导出交付意图与面板展示独立，继续其必要只读观察和已授权后续步骤。未提交 Inspect 的 Cancel/Escape 仍释放本地暂存；提交中/未知/已接受 Import 保留原身份并只停止展示。界面 SHALL 明确这些不同的关闭含义。

反馈 SHALL 绑定发起时的 Core/账号、Work/对象及该次动作。切换对象后晚结果不能打开旧弹层、覆盖新内容/草稿或显示为新对象的成功；同身份已接受操作仍能按原 ID 找回。新身份不得取得旧内容或传输。失败/终止后 SHALL 释放相应等待状态，保留已有安全约束；未知修改不能通过重新启用按钮暗示可直接再次提交。保存期间允许继续编辑时，成功只确认已提交草稿，新编辑仍为 Unsaved。

未知修改的只读核对 SHALL 匹配原 Core/账号、Work、动作及涉及资源，并依据实际返回对象判断核对范围。查询其他 Work 的 Operation、同 Work 的无关 Operation 或未确认关联关系的记录不得解除原动作的未知结果锁；不得因为一次查询成功而批量解除当前 Work 的生命周期、传输和 Agent 锁。已有接口能够确认原目标的当前事实或原业务身份时，才可恢复对应动作的既有准入，并保留原提交结果未知与当前事实已核对的区别；无法确认时继续提供原对象核对入口，不自动重发、不暗示可直接重试。

#### Scenario: 等待下载时关闭或执行独立动作
- **WHEN** 当前 Work 的下载准备尚未完成，用户关闭 Export 并查看另一 Work
- **THEN** Close/Back 可操作，另一个 Work 的合法动作不被禁用；原准备不会自动再次提交，原结果可在原上下文找回，未手动暂停的有效原交付意图完成后最多一次发起原文件下载并明确原 Work；不会打开旧弹层或覆盖新对象，身份失效则不得自动交付

#### Scenario: 文件选择入口防重复
- **WHEN** 同一 Work 正在上传，用户再次通过文件选择或键盘触发上传/删除
- **THEN** 第二个冲突修改未发出，当前上传和原因可见，不建立隐藏队列；其他 Work 的合法操作不受此锁限制

#### Scenario: 晚返回与继续编辑
- **WHEN** 用户切换 Work/Core/账号，或在 Save 期间继续编辑，旧动作随后返回
- **THEN** 旧反馈不进入新对象或新身份；同对象保存只确认提交版本，新草稿保留；旧请求的结束不会释放另一动作的锁

#### Scenario: Operation 观察与目标取代
- **WHEN** Start 已接受并正在观察，用户在既有准入下显式 Stop
- **THEN** 可以提交新的停止目标；两个 Operation 身份分别保留，旧 superseded 不被描述为当前启动成功

#### Scenario: 切换端口不绕过 Service 控制锁
- **WHEN** 同一 Service 的 Restart 响应尚未返回，用户关闭详情、切换浏览器端口并重新打开该 Service 的控制入口
- **THEN** 第二个冲突控制请求不会发出，原目标与等待原因仍可查看；其他 Service 的合法控制不受此锁限制，预览入口仍按所选端口区分

#### Scenario: 未知结果核对仅恢复对应原对象
- **WHEN** Work A 的 Start 返回结果未知，用户查询 Work B 的 Operation 或 Work A 的无关 Operation，随后核对原目标
- **THEN** 无关查询不会解除 A 的未知结果锁或产生第二次 Start；只有匹配原身份、动作对象且能够确认相关事实的核对才恢复对应准入，原提交未知不被改写为确定成功，其他未知动作不被批量解除

### Requirement: 传输的等待与进度在所属流程中可见

**Identifier:** DWUI-013

Files 上传 SHALL 在开始目标检查时显示当前文件/总文件数，并展示真实已发送字节或不可量化的 Uploading，逐文件串行且最终结果按路径呈现。只有浏览器发送完成时不能宣称 Core 已保存；等待响应时显示 Waiting for confirmation，部分失败/未知保留未成功输入及既有条件覆盖规则，不自动重传。

Pi Package 本地目录/ZIP SHALL 在安装弹层展示浏览器到 CLI 的真实上传、等待本地校验及传送、随后提交 Core 接受的不同事实；没有 CLI 到 Core 的字节数据时只显示阶段。Core/npm/Git 来源的提交也 SHALL 有等待反馈，acceptance 后才进入原 Operation 观察，安装成功不等于 Apply/loaded。

`.work` 下载 SHALL 在点击后立即显示本机下载准备，随后按已有原 snapshot/transfer 显示 downloading/validating/ready、已知字节及查询时间。准备响应尚未返回也 SHALL 可以观察进度；total 未知时不得伪造百分比或用零代表真实大小。下载读取/校验失败与观察失败分别反馈；观察失败保留原 transfer/snapshot，显式重新查询不创建新快照、不重复准备。已准备的同一 transfer SHALL 可继续发起浏览器内容下载，发起后只显示 Download started，不声称落盘完成。

关闭 Download 弹层仅收起进度，不取消原准备或 DWUI-009 中有效的一次交付意图；未被用户手动暂停且完成/恢复 ready 时可在同一有效身份内自动发起原文件下载一次，原 Export/活动上下文持续提供同一 transfer 的手动保存回退。新的界面不被旧结果覆盖。页面卸载、本地身份失效或 CLI 退出的传输边界沿用现有行为，不能承诺后台跨进程续传。Inspect/Import 的已有本地检查与明确提交、释放及未知恢复保持 DWUI-008 与既有修复规则。

#### Scenario: 文件上传发送完成但等待确认
- **WHEN** 文件上传字节已发送，而 WebDAV 响应尚未返回
- **THEN** 当前路径显示等待保存确认，成功计数不提前增加，重复/冲突修改受限，返回成功后才更新结果

#### Scenario: 本地 Pi Package 阶段
- **WHEN** 用户从目录或 ZIP 安装/更新包
- **THEN** 响应前可见真实上传和后续等待阶段，取得 Operation 后立即显示 Accepted；不把上传完成写成安装/加载完成

#### Scenario: 下载 POST 尚未结束
- **WHEN** CLI 正在从原 snapshot 拉取和验证 `.work`，初始准备请求尚未返回
- **THEN** Export 显示对应 transfer 的实际进度/阶段，Close 可用，尚未提供未校验内容下载，未新增 Export

#### Scenario: 下载观察丢失与继续
- **WHEN** 下载状态查询失败后用户显式 Check transfer，随后原 transfer ready
- **THEN** 保留原 snapshot/transfer 和最后确认时间，仅重新查询原传输，按仍有效、未手动暂停且尚未消费的原交付意图单次发起同一内容下载，并保留手动回退；不重新提交准备、重复发起或声称文件已落盘

#### Scenario: 有界本地等待与未知总量
- **WHEN** 进度没有 total，或已等待十秒但未取得新确认
- **THEN** 分别显示不可量化阶段或仍在等待确认及已等待时间，不假造百分比、超时失败或新的修改请求

### Requirement: 普通入口初始化与登录恢复形成闭环

**Identifier:** DWUI-014

本需求中的 CLI 实例/共享凭证、Switch Core 及默认 Core 偏好条款适用于独立 piwork-cli desktop 模式；其普通浏览器会话自动建立，不构成独立 Access 门禁。统一服务端工作台使用 DWUI-HOSTED-001 的服务器浏览器会话与固定所属 Core，不读取 CLI 凭据；两模式共同的业务反馈、恢复和身份隔离约束保持。

Desktop SHALL 在初始化期间立即显示中性的工作区外壳、Opening workspace… 与可访问的等待状态，自动建立或恢复普通浏览器会话并读取真实 Core 登录状态。确认前不得展示未核验的私有内容或假造已登录；确认后直接显示可用的账号登录/连接页面或 Works。不得签发、兑换或校验 Desktop 入口 ticket，不得保留独立浏览器 Access 状态或仅把其标为恒定 authorized。

新浏览器、普通地址、刷新、清 Cookie、CLI 重启和浏览器会话到期 SHALL 使用同一初始化路径，不要求 `desktop open`、最新启动链接或终端授权。旧 `#ticket=` 链接 SHALL 移除或忽略该片段后按普通地址处理，不触发兑换、重放错误或额外页面。CLI/Core 共享登录继续按当前 Core 和保存凭据的真实状态判断；没有有效账号时显示正常 Sign in。

页面和账号菜单 MUST NOT 提供 Browser access required、Check browser access、Reset browser access、授权到期弹窗或复制重新授权命令。CLI 确认不可达时 SHALL 显示 Desktop connection unavailable、连接重试及必要的启动方向，区别于 Core 不可达；重试不是授权动作。浏览器不能保留普通会话 Cookie 时 SHALL 说明会话无法保存及可执行的浏览器设置/重试方向，不转成 Access 授权、不虚构登录成功或无限循环。

初始化/手动读取 SHALL 去重，检查结果有身份和视图归属；初始化失败仍允许显式读取重试，不能依赖未启动的后台定时器恢复。CSRF 拒绝后 SHALL 先只读更新普通会话与 CSRF，再允许用户明确重新提交，不能自动重发原 mutation。读取响应丢失时只读核对，账号登录是否成功以真实会话为准。身份/页面切换后的旧响应不得覆盖新身份、草稿或释放新锁。

初始化成功 SHALL 以真实登录页面或 Works 自然承接，不保留浏览器授权检查成功条。初始化超过十秒仍未确认时 SHALL 在原等待区说明仍在读取连接/会话，不制造进度百分比或无限遮挡恢复；普通网络失败保持为连接/读取错误，只有已确认 Core 登录失效才进入正常账号登录。

#### Scenario: 旧链接与有效 Cookie 同时存在
- **WHEN** 已有正常会话的浏览器打开含已使用、过期或上次进程 ticket 的旧链接
- **THEN** 忽略或移除片段，按真实登录状态进入账号登录或 Works，没有 ticket 兑换或授权恢复页

#### Scenario: 新浏览器与普通地址
- **WHEN** 没有 Cookie 的新浏览器直接打开 Desktop 普通地址，或另一浏览器打开旧启动链接
- **THEN** 自动建立普通会话，并使用正常共享凭据或账号登录流程；不要求任何一次性链接或终端动作

#### Scenario: CLI 重启或浏览器 Cookie 被清除
- **WHEN** CLI 已重新运行，或用户清 Cookie 后重新打开普通地址
- **THEN** 自动建立当前实例的普通会话，按原规则核验保存的同 Core 登录，进入工作区或正常登录，不需要新启动链接或重启 Core/Work

#### Scenario: 读取不确定或 Cookie 无法保存
- **WHEN** 会话读取暂时失败、响应丢失，或浏览器不能保留普通会话 Cookie
- **THEN** 分别提供只读重试、实际会话核对或 Cookie 设置说明；不自动重放登录/修改、不出现 Access 页面、不虚构成功

#### Scenario: CSRF 拒绝与晚到的读取结果
- **WHEN** 平台修改被 CSRF 校验拒绝，或旧读取在身份/页面变化后返回
- **THEN** 普通会话/CSRF 可自动恢复提交上下文但不重发修改，旧结果不覆盖新身份、草稿或释放新锁

#### Scenario: 注销和账号过期
- **WHEN** 用户 Sign out，或 Core 确认当前账号会话过期
- **THEN** 回到正常账号登录，继续可以登录或配置连接，旧内容访问被撤销，任何后续检查都不切回浏览器 Access

### Requirement: 正常注销平台身份并保留直接登录入口

**Identifier:** DWUI-015

本需求中的 CLI 实例/共享凭证、Switch Core 及默认 Core 偏好条款适用于独立 piwork-cli desktop 模式；其普通浏览器会话自动建立，不构成独立 Access 门禁。统一服务端工作台使用 DWUI-HOSTED-001 的服务器浏览器会话与固定所属 Core，不读取 CLI 凭据；两模式共同的业务反馈、恢复和身份隔离约束保持。

Desktop SHALL 提供 Sign out，清理该实例当前 Core 登录及其内容授权，显示平台注销是否已确认，并保留普通地址直接登录的能力。界面、API 和状态模型 MUST NOT 保留独立 Reset browser access 功能或其确认弹窗；没有账号登录时不要求先完成浏览器授权才能登录、Inspect 或配置连接。

正常注销 SHALL 撤销同一实例中使用该平台身份的 Service/文件/观察访问，清理所属敏感缓存、草稿和临时资源；其他浏览器在受保护请求或会话检查时获知身份失效，活动内容流至多两秒断开。已经发送的文件修改可能已提交，不得声称回滚；已经接受的 Import/Export/Run 保持服务端执行。注销或 CLI 退出均不得停止 Work、Service 或取消已接受的 Run/Operation，也不得删除其他 CLI 新写入的 Core 凭证或 Work 数据。

浏览器普通会话缺失时 SHALL 自动恢复提交上下文；Sign out 仍由用户明确触发，不自动重放。用户也可通过同一系统用户的实例 logout 命令清理平台登录，随后普通地址即可登录，无需重新授权。清理中显示实际等待状态并阻止重复提交，失败/未知分别提供原注销状态检查或明确恢复方向。

实例报告保存凭证清理未完成时 SHALL 区分内存身份已清理与磁盘未清理，显示可执行的实例 logout 命令；新登录或切换被拒绝时保留非敏感输入，不宣称已退出后下次启动会保持退出。

#### Scenario: 正常注销后再次登录
- **WHEN** 用户 Sign out，随后输入另一账号
- **THEN** 原平台身份和内容访问被撤销，可直接重新登录；旧浏览器内容不能显示为新账号，Work 运行目标不变

#### Scenario: 账号菜单不再包含浏览器重置
- **WHEN** 用户从普通登录页或工作区打开账号相关菜单
- **THEN** 没有 Reset browser access、其确认弹窗或重新授权提示，正常 Sign out 保留原有可用性和反馈

#### Scenario: 从终端清理登录
- **WHEN** 同一系统用户执行该实例 logout，随后从原普通地址重新打开页面
- **THEN** 可进入可提交的账号登录表单，显示本地清理与远端撤销的分别结果，不要求新链接或手工删除配置文件

#### Scenario: 清理并发与敏感内容保留边界
- **WHEN** 清理过程中其他 CLI 保存新凭证，或旧响应在新登录后返回
- **THEN** 新凭证不被条件清理删除，旧内容/反馈不进入新账号；本地暂存清理不删除已接受业务结果或 Work 数据

### Requirement: Work 生命周期以接受目标和确认状态共同呈现

**Identifier:** DWUI-016

Desktop SHALL 在 Work 列表行、Work 身份栏、生命周期状态页和原 Operation 详情中一致区分本次请求提交状态、已接受目标、Core 已确认 observed 状态与观察是否成功。`provisioning` SHALL 显示 Preparing，`starting`、`ready`、`degraded`、`stopping`、`stopped`、`failed` SHALL 分别显示 Starting、Ready、Degraded、Stopping、Stopped、Failed；确认 deleted 的 Work 不再作为可运行条目显示，真实未知值或未确认状态 SHALL 有检查入口而不默认 Ready。

Create/Start/Stop/Retry/Delete 接受后 SHALL 立即提供原 Work/Operation ID 和相应目标，例如 Start accepted 或 Stop accepted；后续 Work 查询缓慢时仍可查看原操作。界面 SHALL 保留最后确认状态并说明目标尚在执行，不把 acceptance 写成 Ready/Stopped/Deleted；进度仅显示已取得的状态和阶段，不生成固定百分比或未取得的执行步骤。细阶段缺失时 SHALL 显示 Starting Work / Stopping Work 等对象动作及执行状态，原始状态、ID、确认时间在详情可查。

列表与面板快捷动作 SHALL 使用同一准入规则：准备/启动中的运行目标允许显式 Stop；停止目标执行中只提供检查而不重复 Stop 或提前 Start；确认停止后可 Start，Export 还需 desired/observed 均 stopped 且无已知冲突。desired=running 的启动/恢复失败可 Retry，desired=stopped 的失败检查原 Stop，不改回运行。提交期间只锁该对象的重复及冲突入口，接受后释放提交锁，继续遵守未知结果保护与 Core 实际准入。

状态观察未确认 SHALL 与已确认失去运行资格分开：同身份最后确认可用的工作区按 DWUI-002 保留画面并显式标记过期/未确认，而新动作仍受当前控制目标、未知锁、能力和服务端准入约束。仅一次读取失败不能等同 Stop、Delete 或身份撤销；已接受停止目标仍立即限制新的运行/文件写入，不能用保留画面回退该规则。

#### Scenario: 默认创建到就绪无需重载
- **WHEN** 用户提交有效名称，Core 接受创建并依次返回 provisioning、starting、ready
- **THEN** 创建表单立即显示提交中，接受后原操作可查；列表和面板分别显示 Preparing、Starting、Ready，无 Unknown 假错误，无需刷新整个页面或重复创建

#### Scenario: 停止接受而实际状态尚为运行
- **WHEN** Stop 返回原 Operation ID，但 Work 查询仍确认 ready 且 desired=stopped
- **THEN** 列表和面板显示 Stop accepted 或 Stopping Work，并说明最后确认状态仍为 Ready；不宣布 Stopped，不提供重复 Stop、Start、Export 或新的运行/文件写入入口，原 Stop 可查

#### Scenario: 准备期间停止
- **WHEN** 创建或 Start 已接受，Work 仍 provisioning/starting，用户确认 Stop
- **THEN** 可按既有 Core 准入提交一次 Stop，显示新的停止目标，保留原创建/启动操作，不能用全程观察锁阻止该合法控制

#### Scenario: 停止完成后再启动
- **WHEN** Stop succeeded 且 Work 查询确认 desired/observed 均 stopped，用户随后显式 Start
- **THEN** 两处状态同步为 Stopped，Start 可用，数据保留提示可读；新 Start 按原 ID 观察，确认 Ready/Degraded 及相关能力后恢复对应交互，不自动 Start Service 或改变其 enabled

#### Scenario: 创建校验拒绝和运行失败
- **WHEN** 创建在接受前被校验拒绝，或已接受创建随后 failed
- **THEN** 前者保留名称和高级输入并显示字段/请求原因，不虚构 Operation；后者保留 Core 已发布的原 Work 和 Operation，可检查或修正后显式 Retry，不要求再次创建

#### Scenario: 停止失败或真实状态未知
- **WHEN** Stop failed、查询未确认停止，或 Work 返回无法识别的状态
- **THEN** 显示安全原因、最后确认事实和只读检查入口，不显示停止成功，不开放 Export，不以 Retry Work 将停止目标改回运行

#### Scenario: 降级与删除
- **WHEN** Work 确认 degraded，或 Delete 接受后 Work 从列表消失但清理未终结
- **THEN** 前者仅按各能力实际准入开放交互；后者保留原 Delete Operation 入口，不因行消失宣称清理成功或提供假撤销

#### Scenario: 观察错误和停止目标不同
- **WHEN** 同一 Ready Work 先遇到暂时状态 GET 失败，后取得新的 Stop accepted
- **THEN** 前者保持视口并提示未确认，后者按停止目标限制能力；旧状态读取晚到不能重新开放运行

### Requirement: 生命周期观察与对象刷新独立收敛

**Identifier:** DWUI-017

Desktop SHALL 将原 Operation 状态查询、Work 元数据确认及必要的列表同步作为可分别成功或失败的只读步骤。自动观察、Check status、Operation 详情检查和恢复查询 SHALL 使用相同的结果处理规则；进行中的当前身份已知生命周期操作 SHALL 在列表与面板持续取得 Work 状态，而不是只在 Operation 终态后刷新。

Operation 达到 succeeded/failed/superseded 后，Desktop SHALL 继续完成所属 Work 的确认及必要列表同步；后续读取失败 SHALL 保留操作终态，显示 Work status not confirmed 或列表未确认及 Check status，不把读取失败改成操作失败，不丢失同步义务。读恢复成功后 SHALL 同时收敛状态和按钮；不得依赖用户整页刷新。手动查询先发现终态也 SHALL 触发同样同步。确认 deleted 的 Work 可经当前列表和既有对象读取缺失收敛，不把合法移除写成创建失败。

用户清空本地已完成操作历史时，Desktop SHALL 独立保留尚用于 Work/列表同步的原 Operation ID、已确认终态及其接受代次。移除历史展示 SHALL 不使已确认的原操作重新成为未决，不使 Work 永久停在 accepted 或保持错误的能力禁用。同步确认后 SHALL 依据匹配的终态解除对应接受意图并释放协调记录；旧代次的历史清理 SHALL 不解除新的控制目标或未知修改保护。

读取暂时失败 SHALL 有有界只读重试，耗尽后有显式恢复入口；鉴权失败进入既有登录恢复，明确 404/410 停止该 ID 的无限观察并保留可读原因。一个对象查询缓慢 SHALL 不阻止其他对象更新。隐藏页面停止周期读取，返回可见页面时确认当前事实；关闭详情或离开 Work 不取消远端操作，Works 列表仍观察所属已知操作。暂停原 Operation 观察不得取消远端执行或暗中重提请求。

进入 Works 列表、从 Work 返回列表以及列表重新可见时 SHALL 主动执行一次去重的后台列表确认，不依赖本页是否已知生命周期 Operation。SHALL 提供轻量 Refresh Works 与最后可靠确认信息；刷新保留已有行和当前搜索，成功空集合与读取失败分开。后台刷新不产生成功流水、不触发业务控制，保持既有并发、排序、身份隔离和失败恢复边界，不承诺跨窗口实时推送或高频全量轮询。

#### Scenario: 列表看到执行中的状态变化
- **WHEN** 用户关闭 Create/Stop 的详情并留在 Works，原 Operation 仍在执行
- **THEN** 对应行持续取得 Work 状态，Preparing/Starting/停止目标及快捷动作可更新，没有只有详情才生效的补偿路径

#### Scenario: 终态确认后 Work 查询暂时失败
- **WHEN** 原 Stop 已查询为 succeeded，而 Work 或列表读回暂时返回网络错误/503
- **THEN** 保留 Stop 的成功事实，Work 显示最后确认状态与未确认提示，继续有界 GET 恢复；恢复成功后更新为确认停止，Stop POST 总数仍为一

#### Scenario: 手动检查先于自动轮询取得终态
- **WHEN** 用户 Check status/检查 Operation 先读到 succeeded，随后自动观察运行
- **THEN** Work 和必要列表同步仍执行，不能因操作已经终态跳过确认，按钮无需整页重载即可更新

#### Scenario: 清空历史后待同步的 Work 自动恢复
- **WHEN** 原 Start 已确认 succeeded，Work 或列表读回暂时失败，用户 Clear local records，随后读取确认 Work 为 Ready 且 desired=running
- **THEN** 历史展示可移除，但原 ID 和终态协调依据保留；Work 和必要列表确认后自动解除该次接受意图，状态及使用入口恢复，不继续显示 Start accepted，不要求重载或重提 Start，原 Start POST 总数仍为一；新的 Stop 意图及未知修改锁不受旧记录清理影响

#### Scenario: 独立失败、慢查询和重试耗尽
- **WHEN** Work A 的 Operation 查询成功但 Work 读取失败，或查询持续超时，Work B 可正常查询
- **THEN** A 的操作与对象确认分别表示；A 的查询仍在途时，资源允许的 B 按两秒活跃观察频率跨多个周期查询并发布最新状态，不等待 A 返回、超时或整轮完成，不能只证明首轮并发读取成功；同 ID 在途不重复派发、元数据最多四并发，A 的自动读取有界停止且 Check status 可继续查询原 ID，没有生命周期 POST 重试

#### Scenario: 隐藏、返回列表和暂停观察
- **WHEN** 用户隐藏页面、重新显示、关闭详情返回列表，或暂停后恢复原 Operation 观察
- **THEN** 可见后从原身份及 ID 确认事实，列表中仍可找回活动操作；暂停/关闭/恢复本身不重放业务修改或发送远端取消；已明确授权的导出意图可在用户 Resume、核对原结果并满足前置条件后，按 DWUI-009 继续尚未提交的下一阶段，不把它当成原未知 POST 的重试

#### Scenario: 缺失对象、读取失败与空列表
- **WHEN** 列表读取成功为空、列表读取失败，或原 Delete 操作仍可查而 Work 不再存在
- **THEN** 分别显示真实空态、保留旧列表及读取恢复、或原 Delete 进度；不得以读取失败制造零 Work 或丢失 Delete 身份

#### Scenario: 外部变更后返回列表
- **WHEN** 另一授权客户端新增/删除/停止 Work，而本页没有对应已知 Operation，用户返回 Works 或重新使列表可见
- **THEN** 发起一次合并列表查询并更新真实结果，保留搜索和可读旧内容；没有整页重载或生命周期 POST

#### Scenario: 列表刷新失败后重试
- **WHEN** 返回 Works 的列表读取失败后用户点击 Refresh Works
- **THEN** 旧列表与最后确认信息保留，局部错误可恢复；成功才更新行/空态，没有后台成功提示堆积

### Requirement: 原生命周期操作恢复遵守身份及新旧目标顺序

**Identifier:** DWUI-018

Desktop SHALL 在创建接受、已有 Work 控制接受，以及同 Core/账号页面重载恢复后，将已知生命周期 Operation 与所属 Work 关联，供列表行、Work 面板和详情查询。恢复 SHALL 重新确认原 ID 的类型、对象和状态；多个历史或未决操作存在时提供相应原 ID 入口，不仅凭浏览器记录时间或 UI 文案将某历史结果认定为 Core 当前目标。不提供全局操作发现保证，未取得的当前操作不得虚构。

Work 当前事实 SHALL 以既有 Core 查询为依据；新的已接受目标和更高控制版本取得后，旧 Work/Operation 回应不得回退当前目标、重新开放停止中的交互或覆盖其他 Work/身份/草稿。Start 与 Stop 竞争时各自保留原 ID，旧操作的 succeeded/superseded 不能被投影成新 Stop 的结果。重复 GET 可合并，业务 POST 仍只由显式提交产生。

已知操作 ID 缺失或提交结果未知时 SHALL 继续遵守 DWUI-010、012 的原对象核对及禁止盲目重提规则；历史查询、无关操作查询与单纯隐藏提示不能解除未知修改保护。切换 Core/账号清理旧内容、观察及提示，晚返回不能污染新身份；同身份导航后可从已知操作找回已接受任务，不自动弹回旧详情。

接受响应明确报告本地原 ID 记录未保存时，Desktop SHALL 保留本页已接受事实和可复制原 ID，说明重载后的自动找回无法保证；不能将记录失败写成 Core 未接受或自动重新提交。

#### Scenario: 创建接受后关联原操作
- **WHEN** 创建返回新 Work ID/Operation ID，首次 Work 读取成功或暂时失败
- **THEN** 原 Operation 在当前身份可查询；对象取得后其行内检查和面板详情指向该原 ID，不另建操作或再次创建

#### Scenario: 重载恢复正在停止的 Work
- **WHEN** Stop 已接受且仍执行，用户重载 Desktop
- **THEN** 通过当前 Core/账号已知记录查询原 Stop 并关联所属 Work，显示最后确认事实与停止目标，Stop POST 不增加，其他账号记录不进入页面

#### Scenario: 多个历史操作和类型差异
- **WHEN** 同一 Work 有 Create、Start、Stop 的历史记录，包含接受时的英文名称和 Core 的规范操作类型
- **THEN** 正确识别生命周期动作并可查询各原 ID，当前目标来自确认事实，记录顺序或旧成功不能直接授予 Start/Export 或覆盖当前停止

#### Scenario: Stop 取代 Start 且旧读回晚到
- **WHEN** Start 已接受，随后 Stop 已接受，旧启动查询或旧 Work 快照在新停止目标/版本之后返回
- **THEN** 页面保持停止目标和对应按钮，保留两个 Operation，旧结果仅更新旧操作详情，不能重新显示当前已就绪或恢复运行交互

#### Scenario: 切换对象或身份后返回旧结果
- **WHEN** 用户切换 Work/Core/账号，旧观察或提交随后返回
- **THEN** 旧结果不打开旧弹层或覆盖新内容/草稿/锁；同身份已接受 ID 仍可在其原对象找回，新身份不能读取旧记录

#### Scenario: 未知提交与无关查询
- **WHEN** 生命周期请求结果丢失且无原 Operation ID，用户查询另一个 Work 或同 Work 的无关历史操作
- **THEN** 原未知结果保护仍存在，界面只提供匹配原对象的核对方向，不因成功读取或提示消失允许盲目重复提交

#### Scenario: 接受后本地记录保存失败
- **WHEN** Core 已接受创建或控制并返回原 ID，但 CLI 明确报告 localRecordSaved=false
- **THEN** 当前页面仍可观察并复制原 ID，说明重载自动恢复的限制；不声称操作失败，不发第二次创建或控制请求

### Requirement: Desktop 反馈按任务呈现且不堆积读取成功流水

**Identifier:** DWUI-019

Desktop SHALL 按 DUL-003、007 将反馈放在所属按钮、表单、列表行或功能模块，并将提交协调与可见反馈的保留规则分开。Open Work、切换模块、目录导航及普通读取成功后 SHALL 使用实际内容作为完成反馈，不生成或保留 `Work · 路径 · Checked/Confirmed · 原始 ISO 时间` 通用状态条，不跨目录堆积成功记录。正常背景读取 SHALL 不生成 toast 或反复播报成功。

实际请求尚在等待时 SHALL 在原上下文以骨架、就地等待或控件状态显示动作和目标、可访问的状态及 busy 语义，超过十秒仍未确认时如实说明仍在等待。Files/Chat普通读取（包括显式刷新且结果未变化）SHALL 在原控件结束等待并恢复普通状态，不增加成功条或toast；其他已有显式Check的简短确认 SHALL 保留在所属检查入口附近，不新增通用 Checked/Confirmed 条；普通成功提示至多显示三秒，不形成累计历史。同步写入可靠确认可显示 Saved 等简短结果；持久生命周期进展以 Work 状态及原 Operation 详情承接，技术 ID 和取得时间仍可按需查看。

失败、观察中断、未知修改及写入已确认但刷新失败 SHALL 有对象、可理解原因和安全下一步，不随成功提示到期被清除。提示消失不得释放未知锁、取消执行或丢失原 Operation。模块已有同一错误/进度时 SHALL 合并呈现，不再插入重复通用条；可恢复的错误在对应重查成功后清除。反馈更新不得移动或重载当前 Service iframe、覆盖编辑草稿，360px 及键盘操作仍可达。

Work 列表、Work、Services、Files、Settings、Session、详情和深链接首屏 SHALL 按同一规则呈现；进入路径本身不要求用户先点击检查。已有内容更新 SHALL 保留可读内容和取得时间，首次读取无数据时显示真实骨架，成功空集合才进入空态。后台读取不得插入通用 pending 条；需要影响准入的真实降级或不可达 SHALL 仍在所属模块持续呈现。
轻量状态、工具栏和选择反馈 SHALL 不让用户正在连续操作的命中目标无故移动；Files 从零选中到有选中及清空选择时，列表起点和对应行的选择目标位置保持稳定。同一服务的临时状态观察失败按 DWUI-002 保留实际视口，不能用整体替换状态页达到提示错误的目的。

受影响界面的完成与警告 SHALL 使用既有语义色、图标和简短文字，不重复输出同一结果的标题、长说明、状态条和toast。必要风险、失败原因、未知结果与下一步仍可见且可被辅助技术识别，不仅凭颜色表达。Files刷新SHALL固定在原控件显示busy，成功后恢复普通图标，不增加主区域顶部行；错误反馈不能随正常成功提示定时消失。

Modal footer SHALL 按DUL-007统一同类按钮几何与角色，正文按钮、菜单行保持各自职责。开关 SHALL 即时完成且不使用Modal动画、退场快照或延迟清理，同时保持原模态/非模态、Escape/外部关闭白名单、dirty guard与提交保护；旧异步结果不得影响新对象、新身份或新弹层。焦点恢复一次，背景无遗留遮罩；普通与减少动态效果设置一致。

#### Scenario: 多目录正常读取后不堆积
- **WHEN** 用户在同一 Work 依次打开根目录、apps、子目录，再返回根目录并切换 Services/Chat
- **THEN** 等待有局部读取反馈，完成后内容正常展示，没有 Checked/Confirmed 加 ISO 时间的状态条，没有跨目录成功记录堆积或背景读取 toast

#### Scenario: 手动检查未变化
- **WHEN** 用户显式刷新目录或检查 Work，成功结果与已有内容相同
- **THEN** Files/Chat普通读取在原控件结束等待并恢复普通状态，不新增成功条或toast；其他显式检查保持已有简短确认；失败时有可操作错误而非成功措辞

#### Scenario: 写入成功、未知结果及读回失败
- **WHEN** Save 已确认、修改响应丢失，或原操作已确认而对象刷新失败
- **THEN** 分别提供简短保存确认、持续的未知核对入口、或确认结果与刷新未确认说明；短提示到期不改变提交保护或重放任何修改

#### Scenario: 详情关闭与应用稳定
- **WHEN** 进行中的生命周期详情关闭、反馈到期，或状态刷新时当前 Service 有未保存输入
- **THEN** 原 Operation 从所属 Work/已知操作仍可查，正常反馈更新不重新加载 iframe；合法返回、独立动作及键盘焦点保持可用

#### Scenario: 文件多选反馈不推移目标
- **WHEN** 用户连续勾选 Files 中多个文件并取消最后一个选择
- **THEN** 操作反馈可辨且同一视口的列表起点/行选择目标不因工具栏出现消失而跳动，文件名打开与选择互不混用

#### Scenario: 文件刷新不产生额外成功行
- **WHEN** 文件刷新快速成功、慢响应、结果未变化或失败
- **THEN** busy在原图标按钮呈现、成功恢复普通图标且目标几何稳定，无重复成功toast；失败/未知仍有对象及安全下一步，不伪造成功

#### Scenario: 即时关闭与异步结果竞争
- **WHEN** 关闭时旧请求返回、立即重开另一弹层、切换身份/导航，或使用减少动态效果
- **THEN** 旧展示只清理原对象且不接受重复提交，新弹层和焦点不被旧回调清除；关闭最终无backdrop/inert残留，Export继续非模态交付

#### Scenario: Files缓存与首次读取的作用域
- **WHEN** 当前目录首次读取、缓存空目录背景读取、已有文件刷新或读取失败，而其他目录已有缓存
- **THEN** 按当前Work和目录区分静态占位/已确认内容/局部错误，保留工具栏、选中和滚动，不以其他目录缓存制造假空态；重试不重放未知写入

#### Scenario: Chat普通读取与执行状态分离
- **WHEN** 会话列表或历史背景读取、首次读取、失败重试，或activeRun首次检查
- **THEN** 原历史、草稿和阅读位置保持，普通读取无时间戳/通用状态行；初次静态占位，错误一次局部呈现与重试；activeRun真实loading在发送控制中性表示、发送仍按未确认锁定，失败/闲置未确认保留Check status，真实Run/断连/unknown提交不被隐藏

#### Scenario: 合法多入口与Desktop图标
- **WHEN** 用户切换服务、在详情选择多入口，或打开Desktop页面
- **THEN** Service主Header与选择器不展示端口，详情保留技术信息和合法入口选择；iframe及独立窗口路由与所选真实端口一致，favicon使用既有Piwork PNG并通过嵌入资源交付

#### Scenario: 首次骨架不显示普通加载文字
- **WHEN** Works、Work、Services、Files 或 Chat 首次内容尚未确认且没有真实错误
- **THEN** 骨架只呈现贴合内容区域的静态形状，区域名称与busy由辅助属性表达；未取得的Session/模型名称可使用对应字段占位，已有名称、真实错误和unknown设置恢复不被隐藏；仅延迟占位显现，不延迟可用内容，缓存刷新不换回骨架

#### Scenario: Service 入口归一与未完成导航不遮挡应用
- **WHEN** 已取得合法 Service entry，独立 CLI 票据 bootstrap URL 经预览检查归一为应用路径，或托管入口在保持完整 Service 前缀的情况下确认，或 iframe 的子资源尚未结束而应用已开始显示
- **THEN** Desktop SHALL 直接显示并保留同一 Service iframe，不以原始 src 等于最新 entryUrl 或 window.load 作为内容展示条件，不覆盖等待骨架；入口取得前可保留首次占位，真实 entry/预览失败与显式恢复入口仍可见，load 不表示业务就绪

### Requirement: Chat 模型选择遵守下一次受理语义

**Identifier:** DWUI-MODEL-001

Desktop SHALL 在现有 Chat Box 输入框底部用一个轻量摘要呈现当前 Session 的下一次手动 Run Model 与 Thinking，点击摘要在同一 Response settings 面板中编辑两项，来源为 Go Core 与实际 SDK 共同确认的可用模型，包含 Use Work default。模型与 Thinking SHALL 作为完整设置对自动保存，不要求另按 Save model；保存 Session 偏好 SHALL 不触发 Apply、重建 Session、取消 Run 或立即发送消息。已受理 Run 的实际模型与 Thinking SHALL 保持不变；自动请求 SHALL 使用该 Run 受理时 Work active 默认模型及其兼容旧行为的 Thinking，不继承手动 Session 偏好。选择器及详情 SHALL 不公开密钥、私有路径或绑定凭证。

加载、保存、发送、错误和恢复 SHALL 沿用 DWUI-011、012、014、017、018、019 的对象归属、即时反馈、身份隔离及原 ID 规则。偏好保存尚未确认时 SHALL 不受理依赖该新选择的发送；失败保留草稿与已确认偏好，不将 UI 临时选项当作服务端事实。失效模型 SHALL 明确阻止新受理并提示选择可用项，不静默换模型。模型或偏好读取晚返回 SHALL 不覆盖切换后的 Work/Session；已受理的提交即使刷新失败也 SHALL 保留 Run ID 和 submissionKey，不重发 prompt。

偏好保存响应丢失或无法确认是否已写入时 SHALL 显示结果未知并保留原 Session 和所选值；Check chat settings SHALL 读取原 Session 的实际完整偏好，不重新发送 PATCH 或 prompt。确认当前偏好之前 SHALL 禁止依赖该保存结果发送；查询失败保持未知和草稿，明确拒绝且可证明未写入时才恢复原已确认偏好。

Thinking 可选档位 SHALL 仅来自当前真实模型的能力，不显示硬编码的通用档位。不能选择 Thinking 的模型 SHALL 显示 Off 和不可用原因；模型切换需要调整不兼容档位时，SHALL 在保存前显示目标模型提供的默认档位及调整说明，保存返回值才成为确认事实。模型覆盖列表为空但 Work 默认已确认可用时 SHALL 仍允许选择默认及发送。当前已保存值不可用时 SHALL 明确要求用户选择，不能静默回退。

快速连续选择 SHALL 在原 Session 内按完整设置对协调；上一请求未确认时保留最新选择，不并行提交可能互相覆盖的保存。发送 SHALL 等待最新选择可靠确认；未知结果阻止后续自动保存和发送，重查得到实际完整设置后由用户明确处理尚未保存的选择。切换 Work/Session 不丢草稿，不用晚响应覆盖新对象，也不为界面切换自动提交未开始的保存。

尚无 Session 时 SHALL 允许在 Work 的输入草稿上选择设置，说明用于新 Session；用户显式 Send 或 New session 才创建一次 Session并确认设置对。创建或保存结果未知时保留原身份、提交键和草稿，按原结果只读核对，不再次创建或发送。当前 Run 占用期间下一条设置可变更，但发送仍遵守单 Work 单活跃 Run。

打开选择器 SHALL 不立即改变设置；只有明确选择才触发保存。控件、菜单和错误恢复 SHALL 支持键盘且保持输入草稿。新聊天能力缺失时 SHALL 保留既有基础聊天与模型能力，Thinking 入口说明此 Work 不支持，不将缺失能力等同于 Off 已保存。
合并摘要、Input options 与 Send SHALL 组成输入框内同一底栏；Model 与 Thinking 不再作为两个独立字段常驻 Composer。摘要 SHALL 按内容占宽，宽度足够时所有底栏动作同行、等高并垂直居中；长名称在摘要中截断且不能挤走发送，完整名称在设置面板内可读取。360px 下所有必要动作和错误恢复 SHALL 可达且无整页横向滚动，局部空间不足时可让摘要整组换行，不能恢复两个平铺字段。打开面板不修改，Esc 或 Close 只关闭面板并返回来源；/model 与 /thinking SHALL 打开同一面板并直接展开对应的真实选项，不能只停在一个未展开按钮。

模型和档位 SHALL 以固定 Pi SDK 的已确认能力结合 Core 准入为准，不为让 Thinking 可点击而补通用档位。能力未确认、真正不支持、新契约缺失分别说明；已确认支持多个档位时必须可直接选择、保存并用于下一次真实请求，SDK/配置修订不成为默认模型标签。

Response settings SHALL 持续显示相邻的 Model 与 Thinking 当前值行，一次只展开其中一项的选项列表；点击当前展开行可收起列表，切换另一行只改变展开目标，不保存。摘要直接打开时 SHALL 先显示两行当前值，不默认展开长选项列表。模型选项 SHALL 包含 Use Work default 及其真实模型名称；Thinking 档位仅来自当前所选模型的已确认能力。

明确选择不同值后 SHALL 自动保存完整设置对、收起该选项列表并保留面板，焦点返回对应当前值行；选中值与保存中状态立即可辨。选择与当前完整设置相同的值 SHALL 不产生重复保存；由 /model 或 /thinking 发起且原设置已经确认时，这种明确确认可完成对应网页命令。Close 或 Esc 在选择之后 SHALL 不撤销、取消或重新提交已经发出的保存，面板不提供暗示撤销自动保存的 Cancel 动作。保存期间仍允许按原协调规则继续选择不同值。

摘要在模型目录加载、读取失败、偏好保存中或结果未知时 SHALL 仍可打开，以查看当前值、限制及恢复入口；能力和确认状态只限制实际修改与发送。首次未确认目录不得展示虚构选项或将错误当成空模型列表，已有旧值 SHALL 标为未确认或最后已知；已确认只有 Work default 的目录仍可正常选择和发送。结果未知时面板中两项修改 SHALL 禁用，原 Session 的 Check chat settings 仍可用。目录失败提供 Retry models，明确保存失败提供 Retry settings，所有恢复只作用于原上下文，不自动发送消息。

摘要与面板 SHALL 显示同一设置状态。正常状态使用已确认值；保存中、明确未保存和结果未知时可展示保留的最新选择，但 SHALL 同时明确其未确认状态，不能据此声称下一条消息已经可以使用该值。保存中、失败、未知、模型不可用、Thinking 真正不支持或能力未确认的必要状态与原因 SHALL 在面板关闭后仍留于 Composer 附近；尚无 Session 时显示 For new session。正常已确认状态不保留永久 Saved 条。

面板 SHALL 将当前展开列表的已选项作为初始焦点，未选中时使用首个可用项；从摘要直接打开时焦点进入 Model 当前值行，若该行不可编辑则进入可用的恢复入口或 Close。上下键及 Home/End 只移动当前列表的焦点，不改变设置；Enter/Space 明确选择，Tab/Shift+Tab 按面板焦点顺序导航。不可编辑项 SHALL 紧邻说明原因，不构造通用 Thinking 档位。直接摘要打开的面板关闭后焦点返回摘要，网页命令打开的面板关闭后返回 Composer；输入法组合期间 Enter 不选择或发送，Esc 只关闭面板而不同时退出专注布局。

面板状态 SHALL 归属打开时的 Core/账号、Work 和 Session。切换身份、Work、Session 或离开相应 Chat 时 SHALL 关闭原面板；晚结果只更新原对象，不重开旧面板或覆盖新对象草稿。/model 与 /thinking 保留 DWUI-COMMAND-001 的成功消费、取消/失败保留与原草稿比对规则；不接收额外参数，不提交 Run。Input options、Service identity 与资源命令参数边界继续遵循原规则。

#### Scenario: 当前执行中修改下一次模型
- **WHEN** 当前 Run 使用模型 A，用户保存当前 Session 的模型 B 偏好
- **THEN** 当前 Run 仍显示 A，下一次新手动 Run 在偏好保存确认后使用 B，Session 不变

#### Scenario: 偏好保存失败
- **WHEN** 用户选择 B，但保存返回鉴权或服务错误
- **THEN** 显示归属该 Session 的错误，草稿保留，后续发送不假定 B 已保存

#### Scenario: 默认与自动处理
- **WHEN** 用户将 Session 设为 Use Work default，随后有 Service 自动请求被受理
- **THEN** 手动和自动 Run 各自显示其受理时的真实模型，旧历史不随默认值变化

#### Scenario: 偏好保存响应丢失
- **WHEN** 保存可能已写入但响应丢失，随后查询也暂时失败
- **THEN** 显示未知结果并保留草稿，发送暂不可用；按原 Session 查询成功后显示其真实偏好，不重复 PATCH 或自动提交消息

#### Scenario: Thinking 与模型原子确认
- **WHEN** 用户切换模型并选择该模型支持的 Thinking，保存响应被延迟
- **THEN** 控件显示最新完整设置与保存中，输入仍可编辑，发送暂不可用；可靠确认后下一次 Run 显示真实模型和 Thinking

#### Scenario: 快速选择与跨 Session 晚响应
- **WHEN** 用户连续选择多个设置后切到另一 Session，原请求晚返回
- **THEN** 原设置只归属原 Session，当前控件和草稿不受覆盖；没有并行保存或自动向新 Session 发送

#### Scenario: 没有模型覆盖或没有 Session
- **WHEN** 已确认可用的 Work 默认模型之外没有模型，且用户还未创建 Session
- **THEN** 默认模型仍可用于草稿设置，显式发送才建立并确认一个 Session，未知响应不引发第二次创建

#### Scenario: 模型变化导致 Thinking 不兼容
- **WHEN** 用户从支持 High 的模型切换到仅支持 Off 的模型
- **THEN** 控件明确显示调整为 Off 的原因并保存完整设置对；当前 Run 的 High 保持不变，未确认前不发送

#### Scenario: 输入底栏对齐
- **WHEN** 用户在宽屏输入，或在 360px 选择长名称模型
- **THEN** 宽屏合并摘要、Input options 与 Send 同行等高并垂直居中，摘要按内容占宽；窄屏长名称仅在摘要内截断，完整名称在面板可读，所有必要控件与状态可达且无整页横向滚动

#### Scenario: Thinking 直接调整与网页命令一致
- **WHEN** 当前模型支持多个 SDK 档位，用户在设置面板展开 Thinking 或执行 /thinking
- **THEN** 同一面板中的实际档位列表打开，能选择并保存受支持值，关闭而未选择保留草稿，选择不立即发送 Run

#### Scenario: 设置菜单优先关闭
- **WHEN** 用户在 Focus chat 打开 Response settings 的 Model 或 Thinking 选项并按 Esc
- **THEN** 仅关闭设置面板并按打开来源恢复焦点，不同时退出 Focus，未知与保存中的提交保护仍成立

#### Scenario: 摘要打开与关闭不改变设置
- **WHEN** 用户有未发送草稿，点击配置摘要查看两行当前值后直接 Close 或 Esc
- **THEN** 不创建 Session、不 PATCH 偏好、不提交或取消 Run；草稿、光标、布局和阅读位置保持，焦点返回摘要

#### Scenario: 同一面板内调整两项
- **WHEN** 用户打开面板、展开 Model 选择另一模型，再展开 Thinking 选择该模型支持的档位
- **THEN** 两行当前值始终同组可见，一次只有一个列表展开；每次明确选择自动协调完整设置对，列表收起后面板保留，发送等待最新设置可靠确认

#### Scenario: 已确认值重复选择
- **WHEN** 当前完整设置已确认，用户再次明确选择相同的 Model 或 Thinking
- **THEN** 不发送新的偏好保存；从对应网页命令进入时可消费仍与原输入相同的命令草稿，没有 Run，用户新编辑的草稿不被清除

#### Scenario: 保存期间关闭并重新打开
- **WHEN** 选择模型后的保存响应被延迟，用户关闭面板、继续编辑消息并再次打开摘要
- **THEN** 保存仍属于原 Session，仅提交一次；摘要和面板都说明最新选择仍在 Saving，输入草稿不丢失，面板不重新提交选择或提前允许发送

#### Scenario: 目录首次读取与失败恢复
- **WHEN** 首次模型目录尚在读取或读取失败，用户打开摘要
- **THEN** 面板分别显示 Loading models 或读取原因与 Retry models，不显示虚构空列表；用户能关闭面板继续编辑，读恢复成功后显示真实选择，不自动发送或保存

#### Scenario: 无 Thinking 能力的命令入口
- **WHEN** 当前 Work 不支持新聊天能力、模型仅支持 Off 或 Thinking 能力未确认，用户执行 /thinking
- **THEN** 统一面板打开并显示对应禁用原因，真正不支持时显示 Off，缺失或未确认能力不伪装成已保存 Off；命令和草稿保持，没有偏好修改或 Run，关闭后仍能看到必要原因

#### Scenario: 未知结果的统一入口
- **WHEN** 保存结果未知，用户关闭并重开面板，然后执行 Check chat settings
- **THEN** 摘要仍可打开，两项修改与发送仍受限；Composer 与面板提供原 Session 的只读核对，成功后显示实际完整设置，不重复 PATCH、不自动应用保留选择、不发消息

#### Scenario: 命令直接展开与焦点返回
- **WHEN** 用户从 Composer 明确执行 /model 或 /thinking，使用上下键、Home/End 导航后关闭面板
- **THEN** 对应真实列表已展开且选项可操作，键盘移动不保存；未选择时保留原命令，关闭返回 Composer，输入法 Enter 不触发选择或发送

#### Scenario: 切换上下文与晚到保存
- **WHEN** 旧面板的设置正在保存，用户关闭面板后切换 Session、Work 或账号，旧结果随后返回
- **THEN** 旧面板不重开，当前摘要、草稿和界面状态属于新上下文；同身份的旧结果只归属原 Session，不产生另一个保存或 Run

#### Scenario: 新 Session 的草稿配置
- **WHEN** 尚无 Session，用户从摘要选择模型或 Thinking 后关闭面板
- **THEN** 摘要与附近状态说明 For new session，只有本地草稿选择改变；明确 Send 或 New session 才按原规则创建并确认一次 Session，没有后台创建或立即发送

### Requirement: Service 处理记录与证据在现有工作区闭环

**Identifier:** DWUI-FEEDBACK-001

Desktop SHALL 在 Chat 及对象详情中提供当前 Work 的处理记录列表与详情，可按 Service 范围分页查看真实请求、来源事件、关联 Runs、等待对象、终态、错误和证据；证据 SHALL 表达观测时间、状态/代码版本及验证结论。分页 SHALL 使用服务端有界查询和游标，不在浏览器加载全部历史。自动 Session SHALL 可以进入现有 Session/Run 观察，不新增顶层工作流导航或独立执行控制台。

Cancel request 和 Retry request SHALL 是明确且作用域可辨的操作。取消 SHALL 阻止后续自动 Run；重试 SHALL 使用稳定的新 submissionKey 生成关联原请求的新请求，而不是复用未知结果的 Action。响应丢失 SHALL 查询原请求/提交结果，不自动生成第二次重试。导入的 historical 请求 SHALL 展示历史标记并禁用直接 Retry；用户可另行明确提出新的目标。Stop/Apply/Delete 准入失败 SHALL 显示真实原因，不暗中 Start、Apply 或取消其他 Run。

该工作区 SHALL 延续 master 的本地反馈、对象级锁、关闭只停止观察、跨身份清除及已受理 ID 恢复规则；页面状态刷新 SHALL 不重载 Service iframe。处理记录是领域记录，SHALL 不混入通用 UI 读取成功流水；请求状态未知 SHALL 显示最近确认值与 Check status，不能猜测成功或失败。

Desktop SHALL 以当前 Work/Service 的有界请求查询确认是否存在记录。在现有 Service 工具栏右侧、Focus 与独立打开动作之前，仅当已确认有记录时显示英文 Agent requests 按钮；确认空集合时隐藏，已完成、已取消和 historical 记录仍使入口保留。初次未确认时不新增空态占位，读取失败不能清除此前已确认存在的入口或被当作空集合。当前 Service 可见且 Work 可查询时 SHALL 自动进行有界、去重的只读刷新，使原本无记录时后来收到的请求能在下一次正常刷新后出现；页面隐藏、身份变化或离开该 Service时停止其周期查询。

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

### Requirement: 工具过程按调用合并并默认折叠

**Identifier:** DWUI-ACTIVITY-001

Desktop SHALL 将同一 Run 内同一工具调用的开始、结束、保存历史及重连事件合并为一个调用项，不用工具名作为身份。相邻工具项 SHALL 组成默认折叠的 Activity；不同 Run 和被正文隔开的工具段不合并。工具开始显示进行中，可靠结束显示成功或失败；未保存结束事实或观察中断时显示未确认，不用 Run succeeded 猜测每个工具成功。失败数量与可理解错误摘要 SHALL 在折叠状态可见，必要的执行诊断不被隐藏。

展开 SHALL 展示工具名、状态和可取得的结果，文本结果超过 64 KiB 时提供截断标记；非文本结果说明结果类型，结果缺失说明不可取得，不虚构输出、不新增完整参数展示。工具文字是用户数据 SHALL 安全按文本呈现。空工具集合 SHALL 不显示 Activity；流式正文、工具段、后续正文和最终回答 SHALL 保持原发生顺序，不重复最终答案。

用户展开/折叠选择 SHALL 在同一 Work/Session 的重绘、事件更新和重连中保持；切换布局不得改变选择。手动上滚阅读时事件不抢滚动，只有用户处于底部或明确跳到最新时跟随。正文没有历史工具关联时 SHALL 保留真实旧历史，不能按时间或工具名猜测合并。关闭详情、折叠 Activity 或断开观察不会取消 Run。

#### Scenario: 开始与结束事件
- **WHEN** 同一工具开始后收到结束事件，随后收到重复事件
- **THEN** Activity 调用数量保持一，状态从进行中变为真实终态，没有第二条重复工具消息

#### Scenario: 工具与正文交错
- **WHEN** Run 先产生正文，再产生连续工具，然后继续正文
- **THEN** 正文保持原位置，连续工具占一个折叠段，后续正文独立可读，工具数量与顺序正确

#### Scenario: 折叠失败与观察中断
- **WHEN** 折叠段包含失败，或工具开始后观察断开且未取得结束事实
- **THEN** 摘要分别显示失败或未确认，原 Run 仍可查询，不能把中断描述为已取消或工具成功

#### Scenario: 重新打开与阅读位置
- **WHEN** 用户展开历史 Activity、向上阅读，随后重连或隐藏并显示 Chat
- **THEN** 调用和正文不重复，展开选择与阅读位置保持，长结果有截断说明且内容不作为 HTML 执行

### Requirement: 基础 slash command 在输入位置发现和确认

**Identifier:** DWUI-COMMAND-001

Desktop SHALL 在 Chat Box 的首个非空白字符为 /、且光标处于命令名时打开可搜索命令菜单，包含网页动作 /new、/resume、/model、/thinking、/settings，以及当前 Work active 已加载 Skill 与 Prompt Template。资源命令 SHALL 使用 Pi 形式 /skill:<name> 和 /<template-name>，显示名称、简短说明及类别，不暴露路径、正文、密钥或内部版本。菜单空结果、加载、读取失败与功能不支持 SHALL 分开；命令目录未确认时不允许执行资源命令，已有普通文本输入仍可使用。

上下键 SHALL 移动选项，Enter/Tab 选择并填入命令，不在选择时执行；参数按原输入保留。光标离开命令名后输入按普通参数编辑，Esc 关闭菜单并保留草稿且不向父布局传播，中文输入法组合期间 Enter 不选择或提交。用户后续显式 Enter/Send 才执行已确认命令；Shift+Enter 保持换行。菜单关闭或没有匹配项的未知命令 SHALL 提示不可用并保留输入，提供明确 Send as text；该动作按字面文字发送，不能静默执行扩展命令或模板。

/new SHALL 创建并选择一个新 Session，其余 Session 的未发送草稿保留；/resume 打开当前 Work 的 Session 选择器，选择后加载真实历史；/model 与 /thinking 打开对应设置选择器；/settings 按原设置与返回规则打开当前 Work Settings。这五个网页动作 SHALL 不提交模型 Run，不把命令文字保存为用户对话消息；不接收参数，额外参数显示字段错误且保留草稿。执行成功只消费当前命令草稿，其余 Session 草稿不变；失败、未知、取消或仅关闭选择器时保留待处理输入，不自动执行后续动作。

当前 Session 正在运行时 /new、/resume 仍可导航/创建；任何后续发送仍遵守单 Work 单活跃 Run。网页动作受既有对象等待和授权规则约束。资源命令与当前 Session context 不兼容、在目录更新后消失或被不支持的扩展命令占用时 SHALL 明确拒绝，不能自动换 Session、运行扩展或降级成普通文字。选择目录项不构成执行授权。

Service identity 选项 SHALL 在资源命令输入期间明确说明不附加到命令，恢复普通输入时保留原选项；资源命令及参数发送为原命令文本，不把 Service 身份后缀误作模板参数。不读取 Service 网页数据。

#### Scenario: 搜索并选择资源命令
- **WHEN** 用户输入 / 并用键盘选择一个 Skill 或模板
- **THEN** 菜单显示类别和说明，输入框只填入可编辑命令，没有 Run；再次明确提交才执行一次

#### Scenario: 网页命令导航
- **WHEN** 用户确认 /model、/thinking 或 /settings
- **THEN** 打开当前 Work 的实际网页入口，没有模型提交；取消保留输入，完成后回到正确位置

#### Scenario: 新会话与恢复
- **WHEN** 用户执行 /new 或从 /resume 选择原 Session
- **THEN** 分别创建一个可核对的新 Session 或恢复同一历史；各自草稿保持，当前执行不被隐式取消

#### Scenario: 无资源、目录失败或不支持
- **WHEN** 当前 Work 没有 Skill/模板，资源查询失败或 Agent 不支持基础命令契约
- **THEN** 网页动作仍按自身能力可用，资源区分别显示真实空态、重试或不可用原因，普通文字仍可编辑

#### Scenario: 未知或失效命令
- **WHEN** 用户提交未知命令，或菜单中的命令在提交前失效
- **THEN** 保留命令和参数并说明原因，没有隐藏模型提交或扩展调用；只有明确 Send as text 才按字面发送

#### Scenario: 输入法、关闭菜单与参数
- **WHEN** 用户组合中文输入、Esc 关闭菜单或编辑模板参数
- **THEN** 输入法 Enter 不提交，Esc 只关闭菜单，参数完整保留且不附加 Service 身份，草稿不被自动清空

### Requirement: Service 专注视图与浏览器全屏有独立且可恢复的状态

**Identifier:** DWUI-FOCUS-001

Desktop SHALL 在可嵌入 Service 的工具栏提供 Focus，进入填满当前浏览器内容区域的 Service + Chat 布局，隐藏常规导航。Hide chat / Show chat 在同一专注布局切换仅 Service 或 Service + Chat，聊天仍为当前 Session。Exit focus SHALL 始终可达并恢复进入前的常规区域、对象选择、草稿、阅读位置和焦点来源。没有可嵌入 Service、尚未取得入口、明确禁止嵌入或入口失败时 SHALL 给出对应等待/原因与既有独立打开入口，不将 Focus 变成绕过嵌入限制的方法；可保留当前视口的未确认预览仍可进入 Focus，并继续显示真实未知状态。

Focus chat SHALL 从常规区域或 Service 专注布局放大同一 Chat；仅 Chat 头部持续保留 Restore layout 与 Exit focus。恢复回到放大前常规区域或专注布局，退出直接恢复首次进入专注前常规区域。Service + Chat、仅 Service、仅 Chat 共用返回所有者，内部切换不覆盖最初返回目标；普通 Chat 模块仍有正常导航，不等同于 Focus chat。

仅因 Focus chat 及恢复改变布局 SHALL 保持同一 Service iframe/祖先和 Chat 节点连接，隐藏而不卸载、不改 src、不重取入口；正常跨模块导航仍按原规则处理。用户明确切换 Service/端口或 Session 后返回保留该新选择，失效对象给原因且仍可退出。退出与恢复以现有图标按钮和准确英文 tooltip/无障碍名表达，不藏在溢出菜单。

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

### Requirement: 本机 Desktop 的普通地址启动和使用边界

**Identifier:** DWEB-USAGE-001

本需求中的 CLI 实例/共享凭证、Switch Core 及默认 Core 偏好条款适用于独立 piwork-cli desktop 模式；其普通浏览器会话自动建立，不构成独立 Access 门禁。统一服务端工作台使用 DWUI-HOSTED-001 的服务器浏览器会话与固定所属 Core，不读取 CLI 凭据；两模式共同的业务反馈、恢复和身份隔离约束保持。

Desktop SHALL 由前台 CLI 提供 127.0.0.1:17891 的本机浏览器入口，可显式 port/no-open；端口占用不自动更换，help 不读取状态或连 Core。启动与重新打开输出不含授权片段的普通地址；浏览器自动建立必要的 HttpOnly 会话，按共享凭据或正常账号登录继续，平台 token 不交给网页。Copy local link 仅当前电脑且需 CLI/会话持续有效；.work domain 不是同一 URL，外部 DAV 使用 proxy 的随机 Basic 密码。

Service 预览/独立页 SHALL 仅路由声明 HTTP/ws 端口，隔离各应用本机 origin，保留 CSP/X-Frame-Options、应用认证、SSE/WebSocket，不改响应正文或自动批准跨 Service 跳转。嵌入拒绝提供独立页回退；平台身份不交应用。Focus/Full screen、Chat、草稿、阅读位置及 iframe 沿有效 browser-service-access/desktop-ui-language 保持，不以换布局重建业务视图。

关闭浏览器或退出本机入口 SHALL 不停止 Work 或重发写入；平台过期确认后登录并按原 ID 恢复。导入仅浏览器选取/Inspect 不登录执行，真正 Import 需授权且保持 stopped；下载开始不等于落盘。图像粘贴/拖拽/选择、限额及模型能力遵循本规范的 DWUI-IMAGE-001 至 DWUI-IMAGE-003 与 agent-conversation，About 版本日志遵循 product-release-info；技术身份按需展开，错误和恢复保持可见。

#### Scenario: 按现行契约操作与核对
- **WHEN** 用户或维护者使用上述现行入口，并满足对应身份、平台与运行条件
- **THEN** 操作、边界、拒绝及恢复遵循上述契约，不依赖已移除的开发手册；历史版本描述不覆盖当前有效 Spec

以下为已有操作/验证入口的示例，使用实际返回 ID 和隔离测试资源；命令存在不表示本次已执行或验收通过。源码构建使用 Go 1.25.5、Node 24，容器/浏览器专项须预备相应依赖。

```sh
piwork-cli desktop
piwork-cli desktop --no-open
piwork-cli desktop --port 18001 --no-open
piwork-cli --core https://core.example.com desktop
```

### Requirement: 在连接配置中管理下次启动使用的默认 Core

**Identifier:** DWUI-DEFAULT-CORE-001

本需求中的 CLI 实例/共享凭证、Switch Core 及默认 Core 偏好条款适用于独立 piwork-cli desktop 模式；其普通浏览器会话自动建立，不构成独立 Access 门禁。统一服务端工作台使用 DWUI-HOSTED-001 的服务器浏览器会话与固定所属 Core，不读取 CLI 凭据；两模式共同的业务反馈、恢复和身份隔离约束保持。

Desktop SHALL 在登录/连接页面和切换 Core 的配置入口提供默认 Core 的读取、保存及恢复自动选择操作；普通地址初始化后即可使用，不要求本地浏览器授权、Core 可达或账号已登录。界面 SHALL 区分当前连接的 Core、编辑中的地址和已保存的默认 Core，并说明参数/环境覆盖及保存仅影响之后的启动。

用户显式保存 SHALL 校验 HTTP(S) origin，拒绝 userinfo、非根路径、query、fragment；合法 HTTP 与 HTTPS origin 均可保存，协议准入遵守 `allow-http-core-connections` 的 CLI-CORE-PROTOCOL-001，按现有 Core origin 规范保存。偏好 SHALL 不包含密码、token、账号身份或一次性票据。恢复自动选择 SHALL 清除该偏好，使下次启动按参数、环境、凭证和默认地址选择。正常退出、CLI/Desktop logout、账号会话失效和切换账号 SHALL 不删除此偏好。

保存或清除偏好 SHALL 不切换当前 Core、不清理当前身份/内容/Inspect、不重载应用、不提交 Core 请求，也不修改共享登录凭证。连接、切换 Core 和登录仍由原有显式操作完成，不自动保存；同 Core 的匿名 Inspect 在首次登录时 SHALL 继续遵守既有保留规则。既有 `desktop open` SHALL 不重读偏好或切换运行中的实例。

#### Scenario: 首次离线配置
- **WHEN** 用户首次直接打开 Desktop 普通地址，Core 不可达且默认配置不存在
- **THEN** 展示当前地址、未设置默认值及可用的保存入口；保存合法地址后不要求先登录，下一次无覆盖启动使用该地址

#### Scenario: 保存不同于当前连接的地址
- **WHEN** 当前连接 Core A，用户输入 B 并保存为默认值
- **THEN** 默认值更新为 B，当前仍连接 A，账号、页面草稿、Service 和已完成 Inspect 保持；需显式切换才连接 B

#### Scenario: 临时覆盖和退出登录
- **WHEN** 通过 `--core A` 覆盖默认 B 启动，随后登录或退出登录
- **THEN** 默认 B 不被自动覆盖或删除，页面如实区分本次连接与下次启动配置

#### Scenario: 清除默认值
- **WHEN** 用户选择恢复自动选择并成功清除偏好
- **THEN** 显示未设置默认值，当前连接不变；下一次启动使用既有参数、环境、凭证和默认地址规则

#### Scenario: 登录和 Inspect 不受保存动作干扰
- **WHEN** 匿名用户完成本地 Inspect，保存默认地址后在同一当前 Core 首次登录
- **THEN** 保存不清理 Inspect，登录仍保留可继续使用的既有结果；偏好文件没有凭据，登录本身不隐式保存偏好

### Requirement: 默认 Core 配置读写有明确反馈和本地安全边界

**Identifier:** DWUI-DEFAULT-CORE-002

本需求中的 CLI 实例/共享凭证、Switch Core 及默认 Core 偏好条款适用于独立 piwork-cli desktop 模式；其普通浏览器会话自动建立，不构成独立 Access 门禁。统一服务端工作台使用 DWUI-HOSTED-001 的服务器浏览器会话与固定所属 Core，不读取 CLI 凭据；两模式共同的业务反馈、恢复和身份隔离约束保持。

默认配置 SHALL 作为当前系统用户的独立、受保护、版本化本地状态保存；相同配置位置的多个 Desktop 实例共享该偏好，不同系统用户相互隔离。完整提交 SHALL 原子发布，并发修改 SHALL 序列化，最终值为最后成功提交的值；读取不得观察到半个文件。配置大小上限 SHALL 为 64 KiB，未知版本、额外或重复字段、错误类型、非法地址及不安全目标 SHALL 被拒绝，原文件保持可供恢复。

配置入口 SHALL 首次加载时显示读取中，成功缺失才显示未设置，失败保留最后确认值和读取恢复入口，不把失败解释为空配置。保存/清除等待 SHALL 在所属配置控件内显示，阻止重复修改，不阻塞独立的登录、Inspect 或业务读取；慢响应持续显示尚未确认。成功只在确认完整提交后显示；普通成功反馈遵守既有短提示规则，晚返回不得覆盖更新的输入或其他页面。

非法输入 SHALL 就地提示并保留输入；锁冲突、权限、存储损坏或写入失败 SHALL 提供安全原因及可执行下一步，不覆盖旧配置或声称成功。写入响应丢失、或完整提交后的持久化确认失败 SHALL 显示结果未确认，暂时阻止再次修改并提供只读重新读取；读取确认实际值后解除保护，不自动重发修改。多个实例的后续读取 SHALL 获取已提交的新值，不承诺其他窗口即时推送更新。

读取和写入 SHALL 遵守原有精确 Host/Origin、自动建立的普通浏览器会话和写入 CSRF 校验，不要求 Core 账号登录或独立 Access 授权。来源不匹配、未持有效普通会话的配置请求或 CSRF 不匹配的修改 SHALL 在读写本地配置前被拒绝；普通页面会话缺失/过期时自动更新提交上下文，错误只显示连接、会话或 CSRF 恢复，不要求特殊链接或 Reset browser access。仅配置格式损坏时，显式恢复自动选择可安全清除该配置；权限或目标安全校验失败不得强行删除。

#### Scenario: 加载、空态和读取失败
- **WHEN** 初次读取尚未结束、成功发现配置缺失，或已确认默认值后读取失败
- **THEN** 分别呈现读取中、未设置默认值、或最后确认值和重查入口，不以读取失败制造空态

#### Scenario: 校验和提交前失败
- **WHEN** 输入非法地址，或写入遇到锁冲突、权限失败、磁盘不足
- **THEN** 保留编辑值，显示所属配置错误，原值和凭证保持；未产生成功提示，明确拒绝后可由用户重试

#### Scenario: 修改结果未确认
- **WHEN** 保存或清除响应丢失，或提交后持久化确认失败
- **THEN** 显示未确认与重新读取入口，禁止自动重复写入；读取确认实际默认值或确实缺失后恢复编辑，输入未被晚响应覆盖

#### Scenario: 并发实例和半写入
- **WHEN** 同一系统用户的两个实例并发保存 A、B，或写入过程被打断
- **THEN** 成功提交按序形成完整值，读回为最后提交值；中断只留下原完整值或新完整值，不留下被当成合法配置的部分 JSON

#### Scenario: 无授权或跨源读写
- **WHEN** Service origin、其他本机主机名、缺失普通会话的配置请求或缺失 CSRF 的修改访问配置
- **THEN** 拒绝对应请求，不泄漏默认地址、不触碰磁盘、不改变当前身份；合法普通页面可自动建立会话后使用配置，不出现 Access 门禁

#### Scenario: 损坏配置的显式恢复
- **WHEN** 用户用参数覆盖格式损坏的偏好启动，读取显示损坏后选择恢复自动选择
- **THEN** 在目标安全校验通过后只清除偏好，再读确认为未设置；凭证、当前 Core 和 Inspect 保持，不能删除不安全目标

### Requirement: Chat 图片草稿支持三种添加方式与显式发送

**Identifier:** DWUI-IMAGE-001

Desktop SHALL 在常规 Chat、Agent 辅助栏及 Focus chat 共用图片草稿，允许在输入区域粘贴剪贴板图片、拖入图片文件及通过英文 `Add images` 文件选择入口添加图片。添加后 SHALL 显示缩略图、可访问名称及移除动作；纯图片和图文组合均可显式 Enter/Send 发送，添加、预览和移除本身不创建 Session/Run、不调用模型或上传到 Work。

第一版 SHALL 支持 PNG、JPEG、WebP，每条最多 4 张、每张原始字节最多 5 MiB、图片总量最多 10 MiB；单图宽高各最多 8192 像素、总像素最多 40,000,000。超限、不支持、容器结构非法/截断或无法生成预览的图片 SHALL 给出就地原因，保留此前合法草稿。添加混合批次时 SHALL 明确逐项结果，不能静默丢弃非法项。普通文字粘贴保留原行为，不从 HTML、文件路径或远端链接暗中抓取图片。

同一 Work/Session 的图片及文字 SHALL 随布局切换保持；切换 Session/Work 不串用草稿，切换账号/Core、注销或本地授权失效 SHALL 清理旧身份草稿和预览资源。文件读取/校验的晚结果不得加入新上下文。图片添加、移除和查看 SHALL 支持键盘、明确英文名称与 360px 窄屏，不挤走 Send 或既有配置摘要。

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

### Requirement: 图片发送按能力与原受理身份恢复

**Identifier:** DWUI-IMAGE-002

Desktop SHALL 区分 Work 不支持图片、模型已支持、已不支持及图片能力未确认；不可用原因 SHALL 留在输入附近，保留图片/文字草稿，并提供既有选择模型或升级方向。不得静默删图、自动切换模型、扩大权限或自动 Apply。纯文本基础聊天 SHALL 保留既有能力。

有图片时 SHALL 按字面图文消息发送；网页动作及资源命令不消费图片草稿，需明确提示选择普通文本发送方式或先移除图片，不能执行命令后悄悄丢图。图片仍在读取/校验或最新模型设置尚未确认时 SHALL 不提交未完成草稿。

发送 SHALL 固定本次文字、图片顺序及内容和原 submissionKey，显示提交中并阻止重复提交；用户后续编辑属于新草稿。可靠受理后只消费与本次快照一致的内容，新添加/修改的内容保留。明确拒绝、busy、受理前模型准入错误及结果未知 SHALL 保留输入；未知结果仅按原键只读核对，不自动重发。成功核对后合并原 Run 与用户消息，不重复显示图片或再次执行。已经受理后模型执行失败 SHALL 保留原消息、图片与 Run 的失败事实，不自动恢复为未发送草稿或重新提交。

#### Scenario: 旧 Agent 与模型不可用
- **WHEN** Work 缺少图片能力，或当前模型不支持/未确认图片
- **THEN** 输入区域显示对应原因，图片草稿保留，没有隐式升级、删图或换模型，原支持的文本聊天继续按既有规则使用

#### Scenario: 图片与 slash 命令
- **WHEN** 用户附图后以命令模式发送 /new、/model 或资源命令
- **THEN** 保留完整草稿并说明图片需普通消息发送，不执行命令或清除图片；明确选择字面方式后才可提交图文 Run

#### Scenario: 接受响应丢失
- **WHEN** 图文 Run 已接受但响应丢失，用户执行原提交键核对
- **THEN** 返回同一 Run 后继续原观察，完整草稿在核对前保留，没有第二次提交或重复历史消息

#### Scenario: 在途发送后继续编辑
- **WHEN** 图片消息提交中用户新增图片或改写文字，原接受响应随后返回
- **THEN** 只确认原内容，新增草稿保留，原图片/文字只显示一次，不能由旧清理回调清空新输入

#### Scenario: 受理后执行失败
- **WHEN** 图文 Run 已确认接受，随后模型请求失败
- **THEN** 原图文消息和失败 Run 可查，新草稿不变，不自动把已接受内容还原为未发送消息或重发

### Requirement: 历史图片可以再次查看且保持私有归属

**Identifier:** DWUI-IMAGE-003

Chat SHALL 按真实消息顺序展示已发送图片及正文，纯图片消息不得消失或被误归入工具 Activity。历史图片 SHALL 可在应用内查看较大预览；读取中、失败和图片缺失分别表达，失败只影响该图片并提供只读恢复，不重发原 prompt。

重新打开会话、重连、Agent 替换以及终态 Work 完整导出导入后 SHALL 能查看保留的原图。历史列表不一次加载全部图片正文，图片访问 SHALL 经过当前本地与 Core/Work 所有者授权；不生成公开分享 URL、不从其他 Work/Session 取图。停止 Work 时沿用已有历史准入，仅将已加载内容标为最后已知，不暗中 Start 获取图片。

#### Scenario: 重开纯图片会话
- **WHEN** 用户发送纯图片消息后离开，再重新打开同一可读 Session
- **THEN** 该用户消息与图片仍存在，按需取得原图，不出现空工具段或重复用户消息

#### Scenario: 历史图片局部失败
- **WHEN** 一张历史图片读取失败而文字及其他图片可用
- **THEN** 其他内容继续可读，失败图片显示原因和只读重试，没有新的 Run、模型调用或整个历史清空

#### Scenario: 导出导入与停止边界
- **WHEN** 含图片的终态 Work 停止后导出导入，并由用户显式 Start 后打开原会话
- **THEN** 图片和消息对应关系保持，导入本身不执行原图文请求；停止状态不为查看图片自动启动 Work

### Requirement: 创建弹窗状态变化不拉伸操作按钮

**Identifier:** DWUI-CREATE-LAYOUT-001

Create Work SHALL 在提交中、超过十秒等待、明确拒绝与未知结果时保持 Create Work 及 Cancel/Close 按钮的宽高和排列稳定；动态提示 SHALL 在独立状态区域换行/滚动，不能把按钮拉高、挤出可见区域或覆盖输入。长 Work 名称及错误文本在 360px 下仍完整可访问，无整页横向溢出。

等待状态、可访问 busy/状态播报、同对象防重复及未知修改保护 SHALL 继续遵守 DWUI-011、012、016、019；不能仅删除等待提示以达到尺寸稳定。Close/Back 的既有语义及键盘焦点保持，受理后仍展示原 Operation，不提前宣称 Ready。

#### Scenario: 延迟创建与长等待
- **WHEN** 用户提交长名称 Work，响应延迟至出现 Still waiting
- **THEN** 首个可绘制机会已有创建状态，按钮宽高与状态变化前一致、位置稳定，重复入口只产生一次创建请求

#### Scenario: 窄屏拒绝和未知结果
- **WHEN** 用户在 360px 下创建，收到长拒绝消息或未知结果
- **THEN** 提示完整可阅读，输入保留，按钮不被拉伸或挤出，明确拒绝恢复合法重试、未知结果继续只读核对而不盲目重提

#### Scenario: 关闭等待弹窗
- **WHEN** 用户在创建等待期间按既有规则关闭弹窗
- **THEN** 焦点与可用导航正常，关闭只结束展示，不取消远端已受理操作，不重新提交创建

### Requirement: 统一服务端提供完整远程工作台

**Identifier:** DWUI-HOSTED-001

统一应用 SHALL 提供仅凭服务器 IP 即可在另一台电脑浏览器使用的完整工作台，不要求该电脑安装 CLI/Docker、设置代理/DNS/hosts 或使用本机启动票据。托管模式 SHALL 复用既有 Work、Service、Files、Chat、模型/Thinking/图片、设置、包、导入导出和原 ID 恢复能力；页面绑定所属 Core，不提供修改服务器实例所属 Core 或读取宿主 CLI 凭证的入口。

托管 Service SHALL 使用当前 ControlPlane origin 的 `/services/<workId>/<serviceId>/<port>/` 路径入口，遵守 browser-service-access 的同源可信应用、动态前缀及服务端响应 Cookie 分区约束。Service 说明 SHALL 明确：应用与工作台同源，脚本可能以当前用户身份访问平台页面/API；任意根路径硬编码、document.cookie/Cookie Store 与服务端 Cookie 同步不在透明兼容保证内。CLI 本机 Service 模式保持自己的独立来源契约，不成为托管回退。

身份 SHALL 按独立浏览器会话解析，传输/暂存、缓存、已知操作及 Service 授权均绑定用户/会话。管理员只能以自己的用户身份访问 Work 内容；注销当前浏览器不清理其他独立登录，禁用/密码重置按 Core 撤销语义生效。托管 Inspect 使用已认证会话私有暂存，保持完整格式校验与不执行内容；独立 CLI 的匿名离线 Inspect 保留。

其他 DWUI 业务条款中的“本地/CLI 传输资源”在托管模式 SHALL 对应会话私有服务器资源，并保持原容量、流式进度、条件写入、取消、未知结果与清理语义；不得把上传换成服务器任意路径或绕过 Core。浏览器关闭、导航和断线不改变远端 Work/Run/Operation 生命周期。

托管浏览器的 API、事件流、文件上传/下载、图片、包和 Service SHALL 全部使用 ControlPlane 17891；只有后端连接 Core 17871。Service 的 entryUrl/basePath SHALL 携带完整目标路径，不从 origin 根重建。预览、复制、独立打开、深链接刷新、登录返回和错误恢复 SHALL 使用同一已授权目标；切换 Work/Service/端口后的晚响应不得覆盖当前入口，单纯布局改变不得重建 iframe。

#### Scenario: 远程完成完整工作流
- **WHEN** 用户从另一台电脑只用浏览器登录服务器 IP
- **THEN** 可以创建 Work、收到模型回复、访问受支持的路径入口 Service、使用 Files、修改配置并完成 Stop/Export/Inspect/Import/Start，Service 兼容限制明确可见，不出现客户端 localhost 或 desktop open 前置步骤

#### Scenario: 两账号并发使用
- **WHEN** 两个独立浏览器账号同时使用 Service、Chat、Files 和传输
- **THEN** 各自只获得自己的内容、临时资源和原 ID，另一账号的晚响应、退出和上传不能覆盖或清理当前身份

#### Scenario: 会话失效和未知修改恢复
- **WHEN** 原 Run/Operation 观察中断或托管会话被撤销，随后同账号重新登录
- **THEN** 旧内容连接失效，按原身份及 ID 核对，不自动重发 prompt、导入、包安装或文件修改

#### Scenario: 托管与本机客户端并存
- **WHEN** 同一 Core 同时被托管浏览器和原生 piwork-cli desktop 使用
- **THEN** 两种入口独立认证，CLI 凭证、偏好、本机 open/logout 和匿名 Inspect 不被服务器浏览器登录修改

#### Scenario: 多 Service 同端口独立寻址
- **WHEN** 同一用户同时打开两个 Work 的 Service，再刷新其中一个深层页面或独立打开
- **THEN** 均只请求 17891，各自路径携带正确目标，平台只读核验当前身份，不依赖最后打开的应用、其他标签页 Cookie 或 Referer 猜测路由

#### Scenario: 只有浏览器端口可达
- **WHEN** 独立客户端网络只能连接服务器 17891，无法连接 17871 和旧 Service 端口池
- **THEN** 托管完整工作流仍可完成，网络记录无浏览器直连 Core、旧池端口或容器 IP

### Requirement: 管理员通过单一全局入口导出日志

**Identifier:** DWUI-LOG-001

DesktopUI SHALL 仅在当前有效管理员的账户菜单显示一个 `Export logs` 入口，作用域为当前 Core 的全局日志及该管理员自己的全部保留 Work 日志，不依赖当前选中 Work。普通用户不显示入口，直接调用后端仍由 Core 拒绝；管理员无 Work 或 Docker 未就绪时仍可尝试收集可用 Core 日志。

一次明确点击 SHALL 创建一个交付意图，依次展示 `Collecting logs`、`Creating archive`、`Download started`，中文含义为“收集日志 → 生成压缩包 → 下载”。接受后立即保留 exportId、cutoffTime 和服务端 scope，按真实状态展示来源数/已取得计数；缺少可靠百分比时不得伪造。Core 日志不可用、归档缺口、部分结果、整体失败和过期 SHALL 有可读原因与对应恢复操作。

ready 后同一有效页面交付意图 SHALL 最多自动发起一次原包下载，保留 `Download again`；只读恢复、重复观察、晚响应或重新登录不能重复自动下载。浏览器下载开始不表示本地保存完成。关闭进度面板或页面内导航不取消 Core 任务；刷新/重新登录后可按已知原 ID 查询并由用户显式下载，不自动创建新任务或恢复旧自动交付许可。创建响应未知时 SHALL 保留原提交键，只提供原结果核对或显式同键恢复，不能新键盲目重试。

GUI SHALL 独立完成排障日志的创建、观察、缺口反馈与 ZIP 下载，不要求用户运行命令；取得文件后由用户手工发送给可信维护者。本功能不包含远程上传接收端，不能把下载描述为自动上传或接收成功。

POST 接受响应已为 ready（包括原键恢复）时，DesktopUI SHALL 先按原 ID 查询完整详情，取得文件名、长度/hash、到期时间及缺口后再交付。该详情查询失败 SHALL 保留已知 ID 和原键进行只读恢复，不清空身份、不退回未知创建或自动另建任务；同一当前有效意图仍最多自动交付一次。

#### Scenario: 管理员与普通用户界面
- **WHEN** 两个浏览器分别以管理员和普通用户登录
- **THEN** 仅管理员账户菜单显示 Export logs，普通用户伪造请求也不能得到导出任务或内容

#### Scenario: 运行中一键导出
- **WHEN** 管理员在自己的 Work 运行期间点击 Export logs
- **THEN** 展示范围及真实收集/打包阶段，无停止确认、Stop 或 Apply 请求，ready 后最多发起一次下载

#### Scenario: 部分结果与下载重试
- **WHEN** 某些来源缺失但 Core 生成有效 ZIP，随后浏览器拦截或取消下载
- **THEN** 保留缺口摘要、原 exportId、大小及到期时间，Download again 下载原包而非重新打包

#### Scenario: 关闭、刷新和晚结果
- **WHEN** 关闭进度、切换 Work、刷新页面或旧身份的结果晚返回
- **THEN** 已接受 Core 任务不被取消；同身份当前意图最多交付一次，刷新后需显式下载，旧身份内容不进入新页面

#### Scenario: 创建响应丢失后恢复已完成任务
- **WHEN** 创建响应丢失，用户显式原键恢复时原任务已经 ready
- **THEN** UI 查询原 ID 详情后可下载，最多自动交付一次，Download again 取得同一 hash 的包；详情暂时失败只重查原 ID，不新建任务

#### Scenario: 故障 Work 的纯 GUI 排障交付
- **WHEN** 管理员自己的 Work 故障或 Docker 不可用，但 Core 和部分保留日志仍可读取
- **THEN** 管理员仅通过唯一 GUI 入口取得含可用日志和真实缺口的 ZIP，可手工发给维护者，无需运行命令，也不显示虚构上传状态

### Requirement: Desktop 通过同源后端转发日志任务与下载

**Identifier:** DWUI-LOG-002

托管 DesktopUI SHALL 经当前 UI origin 的 `/_desktop/api/log-exports`、`/_desktop/api/log-exports/<id>` 和 `/_desktop/api/log-exports/<id>/content` 调用 Core 对应 API；浏览器仅连接 UI 17891，后端固定连接 Core 17871。创建使用现有浏览器会话、来源与 CSRF 保护；后端使用当前会话的用户凭据转发，不读取宿主 CLI credential，不把 bearer 放入浏览器、URL 或内容链接。

独立 piwork-cli desktop SHALL 使用相同 DesktopUI 契约，由本机受保护 Desktop 后端连接选定 Core，保持独立 Desktop 地址选择和凭证规则。两种后端 SHALL 使用显式日志路由适配，校验 ID/请求结构并流式转发 ready ZIP，保留大小/hash/attachment/no-store 等必要元数据，不再收集或打包、不建立另一份完整 ZIP 暂存、不用现有 .work Inspect 代替日志包交付。

界面及适配 SHALL 绑定 Core、用户、会话和原 exportId；切换账号/Core、注销、降权或确认认证失效后撤销旧自动交付和活动流。只读查询/下载的网络错误不能伪装为重新收集或保存完成；Core 最终授权遵守 WACC-LOG-EXPORT-001。

#### Scenario: 远程浏览器只开放 UI 端口
- **WHEN** 管理员浏览器能访问服务器 17891，但不能直连 17871
- **THEN** 创建、进度查询和真实 ZIP 下载均完成，所有浏览器平台请求指向 UI origin，没有 Core token 或直连 Core 的重定向

#### Scenario: 独立 Desktop 连接远程 Core
- **WHEN** 管理员通过 piwork-cli desktop 选择远程 Core 后导出
- **THEN** 浏览器经本机 Desktop 后端取得同一 Core 任务和 ZIP，收集/打包/服务端清理由远端 Core 负责

#### Scenario: 缺少防伪证明或伪造上游
- **WHEN** 请求缺少有效 CSRF、来源不符，或尝试传入任意 Core URL/宿主路径/owner
- **THEN** 适配在转发 mutation 前拒绝，不用进程或 operator 身份弥补

#### Scenario: 下载期间身份撤销
- **WHEN** 管理员下载时被降权或注销，随后重新打开旧下载链接
- **THEN** 原流被有界终止，后续请求按当前身份拒绝，已缓存链接不能恢复旧内容许可

### Requirement: 长会话按需读取且保持阅读状态

**Identifier:** DWUI-HISTORY-001

本机 Desktop 与托管工作台 SHALL 在新版历史能力可用时共用分页读取行为：首次打开只取得最近的有界历史页，存在更早内容时提供明确的“加载更早消息”入口，不能为渲染首屏而自动遍历整份 Session。更早页与超大消息剩余分片 SHALL 按需读取并按稳定身份合并；部分正文必须明确尚未加载完整，可继续加载，不能被当成完整回复或与工具预览的既有截断标志混淆。

加载更早内容 SHALL 保持当前可见消息锚点、Activity 展开状态、草稿与 Session 选择；用户向上阅读时新事件不得抢滚动。多次触发同一页 SHALL 去重在途请求和结果，跨页工具开始/结果不得重复或降级已确认事实。尚未完整取得的 Markdown SHALL 安全呈现，不能执行 HTML、隐藏正文或编造完成状态。

加载中、已无更早消息、页读取失败、游标失效与旧内容 SHALL 分别表达。失败仅影响对应读取，保留已经读取内容和显式只读恢复入口；失效后重新建立快照时不自动拉完整历史或跳过用户正在阅读的范围。身份、Core、Work、Session 或实例切换后取消旧读取并拒绝晚响应；停止 Work 不为加载历史自动 Start。

#### Scenario: 打开工具结果占多数的长会话
- **WHEN** 用户从本机或托管入口打开整份历史超过 6 MiB 的 Session
- **THEN** 首屏只请求最近页，正文可读且提供更早消息入口，无通用格式错误，也没有后台自动拉完整历史

#### Scenario: 加载旧页及超大单条内容
- **WHEN** 用户向上阅读、展开 Activity 并加载更早消息，页边界落在超大正文或同一工具调用之间
- **THEN** 可见锚点、展开选择和草稿保持，分片按序合并、缺口有提示，工具只出现一次且最终可取得全部公开正文

#### Scenario: 页失败后重试与旧响应晚到
- **WHEN** 某页读取失败或游标失效后重试，或用户切换身份/Session 后旧请求才返回
- **THEN** 已读内容不清空，不重复追加或宣称完整加载；晚响应不覆盖当前对象，读取与重试不提交模型或工具

### Requirement: 全部会话恢复入口使用有界历史读取

**Identifier:** DWUI-HISTORY-RECOVERY-001

新版历史能力可用时，Session 首次打开、切换、图片 profile 补读、Run 完成刷新、断线恢复、原提交键核对后的恢复及事件 410 恢复 SHALL 使用同一分页合并逻辑，不能通过其他入口退回整份 Session 或内联大最终结果的控制响应。

恢复原 Run SHALL 分别确认有界状态与所需保存历史，使用原 Run 的读取范围；历史读取完成前不能宣称结果已经完整恢复。活跃 Run 可串行只读观察新增保存内容并在终态停止自动观察，不反复加载无关 Session 全部历史。事件和历史按真实身份合并，最终答案不依靠跨消息文字相等来去重。

旧 Agent 未支持时 SHALL 显示能力及运行环境更新方向，保留已知内容、草稿和原 Run 恢复入口，不自动更新镜像、循环请求超限旧接口或重发原 prompt。所有既有模型、Thinking、图片归属、工具安全呈现及 DWUI-004 的执行与授权边界继续适用。

#### Scenario: 正常完成时刷新大结果
- **WHEN** 正常事件观察取得终态，最终结果或整份 Session 超过旧单次响应上限
- **THEN** 状态可确认且所需正文分片可读取，完成刷新不调用整份历史，已有回复与工具不重复

#### Scenario: 410 后原 Run 运行中或已完成
- **WHEN** 事件入口返回 410，原 Run 分别仍运行或已经终态
- **THEN** 读取原 Run 状态及对应历史页，停止重试原失效事件游标；运行中按原身份观察，终态且结果读取完成后停止自动读取，不再提交 prompt

#### Scenario: 恢复期间能力或身份变化
- **WHEN** 页恢复遇到旧 Agent 不支持、鉴权失效、对象缺失或身份切换
- **THEN** 明确保留或清理对应身份内容并停止不适用的自动读取，不显示虚假恢复成功，不换绑新 Run 或自动升级运行环境

### Requirement: Assistant 文件引用经当前 Work 导航到 Files

**Identifier:** DWUI-FILE-REFERENCE-001

Desktop SHALL 在实时回复、会话历史及已确认所属 Work 的请求详情 Run 回复中，以同一规则识别 CONV-FILE-REFERENCE-001 的文件链接。合法引用 SHALL 呈现为以文件名/说明为内容、可键盘激活且可复制目标的 Files 导航入口；目标 Work 由所属回复上下文确定，不能由模型链接选择另一 Work。复制入口或在新标签打开 SHALL 仍指向同一 Work 和路径，并执行当前页面身份与 Work 授权。

只有明确点击或导航才读取文件；渲染消息、流式增量和重连不得自动下载或逐链接读取 workspace。未闭合/非法链接、原始 HTML、用户文字和工具输出 SHALL 不产生文件动作；Markdown 图片语法仍不得自动抓取资源，现有外链及有界解析回退保持。

打开入口 SHALL 复用 Files，处理既有未保存文件/配置保护，并在进入前退出 Focus/Full screen；取消离开保持原位置和草稿。成功后 SHALL 定位文件所属目录和目标，保持同一 Session、聊天草稿、阅读位置及 Run 观察，返回 Chat 不提交模型。失败 SHALL 保留明确目标和原因，提供只读 Retry、Back to files 或返回来源的可用路径，不以打开其他文件冒充成功。

#### Scenario: 实时与历史链接一致
- **WHEN** 用户先点击新回复中的 TXT 文件引用，再重开会话点击同一历史引用
- **THEN** 均进入同一 Work Files 的目标文件，没有新的 Run、自动上传或自动下载

#### Scenario: Focus chat 与未保存编辑
- **WHEN** 用户在 Focus chat 点击文件入口，或已有未保存编辑时点击另一个文件入口
- **THEN** 前者退出专注后使 Files 真正可见；后者先执行原离开保护，取消保持原草稿，确认后才完成目标导航

#### Scenario: 请求回复与新标签
- **WHEN** 用户在原请求的已确认 Run 回复中打开文件，或复制入口到同一 Core 的新浏览器标签
- **THEN** 使用该回复所属 Work 和明确路径，经当前会话授权打开；不切换或提交其他 Session，也不把文件解释成宿主路径

#### Scenario: 逐段流式内容和恶意引用
- **WHEN** 接收未完成链接、跨 Work authority、编码穿越、HTML 或含图片语法的消息
- **THEN** 只保留可读内容或合法导航，不访问外部资源、不执行任意页面动作，补齐合法文字也不自动打开文件

### Requirement: Files 显示当前图片与文本并保留普通下载

**Identifier:** DWUI-FILE-PREVIEW-001

通过聊天入口或 Files 列表打开同一个文件 SHALL 使用同一查看能力，并在每次重开或显式刷新时重新核对目标元数据与读取需要的内容；不能仅凭旧目录缓存决定目标存在、文件类型或内容。该行为不提供文件版本快照；保留未保存文本编辑时仍遵循 DWUI-006 的重读与冲突规则。

合法 UTF-8 且无 NUL、至多 1 MiB 的普通文本（包括 TXT）SHALL 沿用现有编辑/已保存版本下载行为。PNG、JPEG、WebP SHALL 按实际内容识别并在 Files 显示图片预览和 Download file；每张图片预览原始字节至多 10 MiB，宽高各至多 8192、总像素至多 40,000,000。图片显示 SHALL 适配可用区域，不将它呈现为可保存文本。类型与有效性不能仅由扩展名决定，解码失败不显示伪造图片。

超出预览预算、其他普通二进制、SVG/GIF、HTML 执行或文档转换 SHALL 不进入新增图片预览，仍提供文件基本信息及原始文件下载；文本内容不得作为 HTML 执行。PDF SHALL 不依赖专用查看器、转换服务、插件安装或新增软件依赖；只有浏览器已有原生行为可直接采用，缺少该行为时按普通文件下载，PDF 预览不作为本版必需能力。

下载 SHALL 复用原鉴权文件入口，按用户明确动作发起，不自动 PUT、生成附件副本或宣称本地保存完成；下载内容是执行该次读取时的真实文件字节，不能以编辑草稿、预览转码或旧 Blob 冒充当前保存版本。

#### Scenario: 图片与 TXT 从两处打开
- **WHEN** 用户分别从聊天链接和 Files 列表打开合法 PNG/JPEG/WebP、TXT
- **THEN** 两处使用同一图片预览或文本编辑能力，显示实际文件，图片和保存文本都可由用户主动下载

#### Scenario: 修改、删除与旧类型缓存
- **WHEN** 已查看路径的内容、类型或大小发生变化，或者该路径被删除，用户再次打开或刷新
- **THEN** 以当前读取判断内容和可预览性；删除显示缺失，不能继续把旧缓存表示为当前文件或静默指向另一个路径

#### Scenario: 超限、损坏和伪造后缀
- **WHEN** 图片超过字节/像素预算、解码失败，或文件后缀与真实类型不同
- **THEN** 文件区域说明限制或错误，合法普通文件仍有 Download；不无界读取或依后缀执行 HTML/SVG，也不自动下载

#### Scenario: PDF 与其他普通文件
- **WHEN** 用户打开 PDF、ZIP 或无法在 Files 预览的普通文件
- **THEN** 可查看基本信息并主动下载；PDF 没有可直接复用的浏览器原生行为时只下载，不加载专用查看器或发起转换

#### Scenario: 文本草稿与下载
- **WHEN** 用户保留未保存 TXT 修改后点击 Download saved version
- **THEN** 下载真实保存版本，草稿保持，没有 PUT；界面只确认下载发起，不承诺用户已保存

### Requirement: 文件预览遵守现有准入及视图资源生命周期

**Identifier:** DWUI-FILE-PREVIEW-LIFECYCLE-001

预览与重试 SHALL 经现有受保护 Desktop 文件入口和 Core WebDAV，遵守 WF-001、WF-005、WF-006 及所有者授权；浏览器只连接所属 UI/本机 Desktop，不取得 Core token，不创建公开文件 URL。托管与独立 Desktop SHALL 保持一致功能与各自会话隔离，符号链接/特殊项不绕过既有拒绝规则。

文件显示 SHALL 区分读取中、已确认内容、读取失败、缺失、超限、Work 不可用与身份失效。失败只影响对应目标，并保留合法的只读 Retry；停止 Work 不暗中 Start。暂时观察失败按原保留规则标明最后已知内容，确认身份撤销或 Work 停止则停止旧内容访问。

预览读取 SHALL 有界、可取消；离开文件、切换 Work/账号/Core、注销、权限撤销或页面卸载时 SHALL 取消原读取并释放预览对象资源。旧请求晚结果不得写入新目标、新身份或自动重开旧界面；连续打开与刷新不得累积旧图片资源。

#### Scenario: Work 停止与 helper 不可用
- **WHEN** 用户点击已停止 Work 的文件入口，或文件 helper 不可用
- **THEN** 显示真实不可用原因，其他合法工作区能力保持，不隐式 Start、调用模型或创建替代 Service

#### Scenario: 图片读取期间切换目标或账号
- **WHEN** A 图片尚未返回时用户打开 B、切换 Work 或注销，A 随后返回
- **THEN** A 的读取被取消或结果丢弃，旧预览对象被释放，不污染 B 或新身份，不自动下载

#### Scenario: 连续刷新和授权拒绝
- **WHEN** 用户反复打开/关闭图片后原访问被服务端拒绝
- **THEN** 旧资源没有持续累积，拒绝按当前身份反馈，旧文件入口不能恢复已撤销权限

### Requirement: 模型认证失败提供可执行方向

**Identifier:** DWUI-MODEL-ERROR-001

Desktop SHALL 在 Run 实时结果、详情和重开历史中一致显示经安全分类的认证或权限失败，说明应检查密钥或模型访问权限；提供与当前用户权限相符的模型管理入口或联系管理员的方向。界面 SHALL 不因供应商认证失败退出平台登录，不建议直接重试未修复的请求；旧 Agent 的通用错误仍可读且不伪造分类。

#### Scenario: 无效模型 Key
- **WHEN** 当前 Run 返回已确认的模型认证失败
- **THEN** 聊天和详情显示安全原因及适合当前权限的处理方向，重连后保持一致，旧 Run 不自动重新发送

#### Scenario: 旧 Agent 通用错误
- **WHEN** 旧 Agent 只返回原有通用执行失败
- **THEN** Desktop 保留原错误及可观察状态，不根据文本猜测认证原因

### Requirement: Work 降级和临时清理原因可查

**Identifier:** DWUI-SERVICE-CAUSE-001

Desktop SHALL 根据已确认 Service 状态显示造成 Work Degraded 的服务身份、可确认原因、影响范围和现有详情/处理入口；多个故障分别可查。恢复、停用或移除后 SHALL 依据当前已确认状态刷新提示；仍有其他故障时继续显示真实影响。读取失败或状态未知 SHALL 说明未确认，不把旧故障、空结果或猜测显示为当前事实。

临时服务的清理进行中、失败/待重试及确认完成 SHALL 在获准的 Work/Run 相关入口可查，用户能够定位真实清理记录与安全日志；日志不可用不阻止查看当前状态和合法控制。非所有者不获得私有内容。

#### Scenario: 服务退出导致降级
- **WHEN** 可选常驻 Service 运行后退出且 Work 确认 Degraded
- **THEN** 用户能识别该服务、退出原因、其他可用能力及进入服务详情/日志的入口

#### Scenario: 服务全部恢复
- **WHEN** 所有导致降级的服务已确认 ready、disabled 或 removed，Agent 仍 ready
- **THEN** Work 显示 Ready，旧降级提示消失，但历史诊断仍可查询

#### Scenario: 临时清理尚未确认
- **WHEN** 已结束 Run 的临时清理因 Docker 故障待重试
- **THEN** 界面显示关联对象、未确认状态、安全原因和可查询的清理记录，不宣称已删除或重发 Run

### Requirement: 原操作在所属任务中呈现并恢复

**Identifier:** DWUI-OPREC-001

Desktop SHALL 在 Work 列表行和 Work 面板、Service 详情及管理区域、Settings 的 Apply 和 Package 区域、Import 与 Export 流程中，为对应任务呈现动作、目标、实际进度、失败或观察中断原因、只读 Check status 及原 Operation 详情。已可靠接受与执行终态 SHALL 分开；Work、Service 实际可用性、配置生效和浏览器落盘 SHALL 各依据其自身确认结果，不能由 Operation acceptance 或 succeeded 代替。

同一任务在所属上下文中已有等价进度或错误时 SHALL 合并为一处主要反馈，不额外叠加通用状态条。原 Operation 和 snapshot 技术 ID SHALL 可在该任务的次级详情中读取、复制，默认折叠；已知多个原任务 SHALL 能逐一查看各自结果，历史顺序或旧成功不得覆盖当前控制目标。关联恢复 SHALL 核实原 Core/账号、Work、任务类型和可确认的 Service 身份；缺少或无法确认归属时 SHALL 说明未确认，不将任务归到猜测的对象。

原 ID 查询 SHALL 在相关任务上下文中可达；Export SHALL 仍能按 snapshot ID 找回该 Work 的原快照并核验归属，不另建全局 Operation 列表、搜索页面或操作中心。操作详情、手动查询、重新登录及页面重载恢复 SHALL 只观察已知原对象，不因查看、关闭或重查自动提交业务操作。相关 Work 或 Service 读取失败 SHALL 与已确认的 Operation 终态分别呈现，并继续按既有同步和有界重试规则收敛。

#### Scenario: Work 启动接受后对象尚未就绪
- **WHEN** 用户在 Works 列表启动某 Work，Core 已接受原 Operation，但 Work 状态仍在准备或读取失败
- **THEN** 原 Work 行显示启动已接受或正在准备及只读检查，原 ID 可在详情中查看；不宣称已就绪、不发第二次 Start，读取失败不改写已接受事实

#### Scenario: Service 控制重载恢复
- **WHEN** 用户控制 Service 后重载，同账号已知记录包含原 Work、Service 和 Operation 身份
- **THEN** 查询并验证原任务后，在对应 Service 的管理区域显示真实状态及详情；不把另一个 Service 的结果当作该任务，也不再次发送控制请求

#### Scenario: Service 归属缺失
- **WHEN** 已知 Service 控制记录缺少可确认的 Service 身份，或读取结果与记录不匹配
- **THEN** 在已确认的所属 Work 范围说明原任务目标尚未确认并保留原 ID 查询，不按名称、时间或当前选择猜测归属，不解除无关对象的未知结果保护

#### Scenario: 新旧目标及多个操作并存
- **WHEN** 同一 Work 的 Start 被后来的 Stop 取代，两次原 Operation 依不同顺序返回
- **THEN** 两个原结果各自可查，当前目标与按钮由确认的较新事实决定；旧 Start 结果不能使 Work 再显示可运行，也不能清除 Stop 的同步义务

#### Scenario: 原快照按 ID 找回
- **WHEN** 用户从 Work 的 Export 上下文按 snapshot ID 找回先前的快照
- **THEN** 仅在原 Work 和权限匹配时显示该快照的状态、期限和原下载动作，不按列表顺序改选其他快照，不产生新的 Export

#### Scenario: 操作完成但对象读取失败
- **WHEN** 原 Stop 已确认为 succeeded，随后 Work 或列表确认失败
- **THEN** 保留 Stop 的成功事实，另外显示状态未确认及只读恢复；确认恢复后收敛 Work 和按钮，不重提 Stop 或要求用户刷新整页

### Requirement: 无可见 Work 的任务仍有临时恢复入口

**Identifier:** DWUI-OPREC-002

Desktop SHALL 在 Works 列表为当前身份已知但尚无可见 Work 的 Create、Import，以及 Work 已离开列表的 Delete 显示临时任务提示。提示 SHALL 表达已确认的动作、目标或目标未确认、实际状态、Check status 和原结果详情；多个任务按各自身份呈现且可逐一展开，不变成全局操作历史。Work 行出现并确认关联后 SHALL 将适用反馈归回该行；删除清理仍在执行或失败时不得因行消失而丢弃原提示。

临时提示与 Work 搜索条件及列表空态独立；列表读取失败 SHALL 保留最后可确认内容并说明未确认，不将读取失败当作没有 Work。无法确认对象归属或实际名称时 SHALL 使用可确认的通用任务名称，不从源包、旧列表或记录时间推测。Import 只有成功发布后才可显示已导入的 stopped Work；用户明确选择时才执行 Start and open。

进行中、失败和未知结果提示 SHALL 不自动消失；用户可关闭详情或收起提示，并可再次查看需处理的原任务。关闭或隐藏展示 SHALL 不取消执行、不删除未决恢复依据、不重新提交、也不解除未知结果保护。完成提示可由用户关闭，不形成累积的永久成功流水；无对象的完成结果在用户关闭前仍可查看。关闭动作不得影响导出流程中仍有效的既有单次交付意图。

#### Scenario: 导入未发布时重载
- **WHEN** Import 已接受且原 ID 已记录，但尚未发布 Work，用户关闭详情并重载同账号页面
- **THEN** Works 列表恢复该次导入的进度和原结果入口，不显示半成品 Work、不自动重新 Import；未确认名称时不猜测名称

#### Scenario: 删除后 Work 行消失
- **WHEN** Delete 已接受，Work 不再显示，而清理仍进行或失败，随后用户重新进入 Works
- **THEN** 列表保留对应原删除任务的提示、检查和详情；只依据 Operation 终态说明清理结果，不创建假的 Work 行或假撤销

#### Scenario: 创建结果尚未确认
- **WHEN** 创建已接受并保存原 ID，但 Work 首次读取尚未完成或暂时失败
- **THEN** 列表提供对应创建任务与原 ID 的只读恢复，不因对象读取失败宣称创建失败或再次创建；对象确认后反馈归回原 Work 行

#### Scenario: 搜索和列表失败不丢失任务
- **WHEN** 用户搜索使 Work 行不匹配，或 Works 列表读取暂时失败，同时存在尚无可见 Work 的已知任务
- **THEN** 未决任务提示仍可访问并标明确认状态；列表错误与真实空集合分开，不因搜索或一次读取失败推测 Work 已删除

#### Scenario: 收起和重新查看未决提示
- **WHEN** 用户收起进行中、失败或未知结果的临时提示，随后返回 Works 或展开提示
- **THEN** 仍能查看匹配原任务及其检查入口；远端执行、原 ID、对象同步义务和未知修改保护不受收起或关闭详情影响

#### Scenario: 导入完成后的用户动作
- **WHEN** 原 Import 确认成功，用户先查看结果，随后选择 Start and open
- **THEN** 显示 Core 确认的名称与 stopped 状态，查看不启动 Work；明确选择后只提交一次 Start，并在实际可用后打开，不再次 Import

### Requirement: 原任务详情显示真实安全诊断

**Identifier:** DWUI-OPREC-003

Desktop SHALL 保留并在所属任务详情中展示后端实际提供的安全错误码、失败阶段、消息、修复建议、可确认的关联标识和相关阶段结果；已授权且可实际关联的日志入口 SHALL 在对应 Work 或 Service 上下文提供。任务主要说明 SHALL 包含可理解的失败事实和安全下一步，技术标识作为次级诊断，未确认的服务端自然语言只作为安全诊断辅助信息。

诊断为空、旧字符串、字段缺失、不合法或不可取得时 SHALL 保留已确认的失败事实，明确说明更具体的原因或相关日志未提供，不推断根因、失败阶段、修复结果或另一对象的归属。日志继续遵守原权限、脱敏和有界读取规则；查看诊断和日志 SHALL 不触发控制、修复或重新执行。既有后端未记录的原因不因本变更的呈现而被补出。

#### Scenario: 已提供完整诊断
- **WHEN** 原 Operation 返回失败及安全错误码、阶段、修复建议与可关联日志
- **THEN** 所属任务显示可理解原因和下一步，详情保留各实际字段及有权限的日志入口；查看只触发读取，不提交控制请求

#### Scenario: 后端未记录根因
- **WHEN** 原 Operation 失败但错误为空、仅有通用消息，或没有某次凭证冲突的具体根因
- **THEN** 显示已确认失败及更具体原因未记录，不虚构凭证冲突、阶段或修复建议；已有合法安全字段仍可查看

#### Scenario: 日志不可用或无权访问
- **WHEN** 任务没有可确认关联日志，或当前用户无权读取对应日志
- **THEN** 界面说明日志不可用或提供合适的联系管理员方向，不显示未经授权的内容或将关联标识当作其他对象的链接

#### Scenario: 提交未知且未取得原 ID
- **WHEN** 请求响应丢失或已接受但本地记录明确保存失败
- **THEN** 分别显示未知及可用的原对象核对方向、或保留已接受事实和可复制 ID 并说明重载自动恢复限制；不伪造 ID、解锁未知修改或自动重发
