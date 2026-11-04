# Spec Delta

## MODIFIED Requirements

### Requirement: 导出与下载保持显式阶段及原快照恢复

**Identifier:** DWUI-009

Export SHALL 按 DUL-009 清楚呈现停止（需要时）、生成、传输校验与浏览器下载的真实阶段；一次明确的 Export current Work and download 可授权连续执行后续必要步骤，不要求每阶段额外点击。仅 desired/observed 均 stopped 且无已知冲突时可提交，最终准入以 Core 为准；只有用户在明确影响确认中选择 Stop and export 后才可提交 Stop 并继续；普通导出入口或旧快照查看不能隐式 Stop，Export 不暗中 Apply、另行取消 Run 或启动 Work。接受后保留 Operation/snapshot ID，成功且完整校验后可下载。完整 `.work` 使用既有快照格式，包含 workspace 及格式定义的其他持久内容，文件浏览下载不能替代它。

下载 SHALL 复用原 snapshot，流式传输、核验长度/hash，失败不能显示保存完成；过期明确提示用户重新发起 Export，不静默创建快照。SHALL 提供按 snapshot ID 找回下载。浏览器下载动作仅能确认发起时显示 Download started，不宣称实际落盘完成；敏感包提醒在下载前可见。临时空间不足必须可见且不删除 Core 已生成快照。

从 Work 进入导出 SHALL 始终保留显式“导出当前内容”的新尝试入口，不能被已有成功快照遮蔽；新尝试使用自己的提交身份。旧快照下载 SHALL 在所属 Work 的独立恢复上下文与新导出分开标识，显示可靠取得的 ID、状态、大小与过期信息，不将旧快照列表塞回导出进度 Details；无可靠生成时间时不伪造时间，不称为当前最新内容。按 snapshot ID 或某个导出 Operation 打开时 SHALL 精确使用原 snapshot，不能再按 Work 随意选另一份；新导出后续下载只能使用本次 acceptance 对应的 snapshot。

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
- **THEN** 同一进度上下文衔接生成和校验后发起一次浏览器下载，没有必经 View package/再次 Download；保留实际阶段、隐私提醒和手动保存入口；原 ID 在内部保留并可于所属独立恢复上下文核对，不显示在仅进度 Details

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

#### Scenario: 进度 Details 不承载技术诊断
- **WHEN** 用户从当前导出打开Details或再次打开已收起进度
- **THEN** 显示同一非模态进度、真实阶段与必要控制，不显示技术ID/旧快照/诊断卡；私有包提醒仍在交付前可见，原身份仍可在独立所属恢复上下文核对


### Requirement: Desktop 反馈按任务呈现且不堆积读取成功流水

**Identifier:** DWUI-019

Desktop SHALL 按 DUL-003、007 将反馈放在所属按钮、表单、列表行或功能模块，并将提交协调与可见反馈的保留规则分开。Open Work、切换模块、目录导航及普通读取成功后 SHALL 使用实际内容作为完成反馈，不生成或保留 `Work · 路径 · Checked/Confirmed · 原始 ISO 时间` 通用状态条，不跨目录堆积成功记录。正常背景读取 SHALL 不生成 toast 或反复播报成功。

实际请求尚在等待时 SHALL 在原上下文以骨架、就地等待或控件状态显示动作和目标、可访问的状态及 busy 语义，超过十秒仍未确认时按真实请求类别处理：长期任务如实说明等待，关键初读到达原有预算则转为未确认及安全恢复，不无限动画。Files/Chat普通读取（包括显式刷新且结果未变化）SHALL 在原控件结束等待并恢复普通状态，不增加成功条或toast；其他已有显式Check可在原固定状态位保留新的确认时间/短确认，不插入Alert或通用Checked/Confirmed条；需要显式通知的动作结果按UIL-NOTICE-001呈现，正常读取仍不额外toast；普通成功提示至多显示三秒，不形成累计历史。同步写入可靠确认可显示 Saved 等简短结果；持久生命周期进展以 Work 状态及原 Operation 详情承接，技术 ID 和取得时间仍可按需查看。

临时结果反馈 SHALL 使用 UIL-NOTICE-001 单宿主而非额外插入 Alert。失败、观察中断、未知修改及写入已确认但刷新失败 SHALL 有对象、可理解原因和安全下一步，不随成功提示到期被清除。提示消失不得释放未知锁、取消执行或丢失原 Operation。模块已有同一错误/进度时 SHALL 合并呈现，不再插入重复通用条；可恢复的错误在对应重查成功后清除。反馈更新不得移动或重载当前 Service iframe、覆盖编辑草稿，360px 及键盘操作仍可达。

Work 列表、Work、Services、Files、Settings、Session、详情和深链接首屏 SHALL 按同一规则呈现；进入路径本身不要求用户先点击检查。已有内容更新 SHALL 保留可读内容和取得时间，首次读取无数据时显示真实骨架，成功空集合才进入空态。后台读取不得插入通用 pending 条；需要影响准入的真实降级或不可达 SHALL 仍在所属模块持续呈现。
轻量状态、工具栏和选择反馈 SHALL 不让用户正在连续操作的命中目标无故移动；Files 从零选中到有选中及清空选择时，列表起点和对应行的选择目标位置保持稳定。同一服务的临时状态观察失败按 DWUI-002 保留实际视口，不能用整体替换状态页达到提示错误的目的。

受影响界面的完成与警告 SHALL 使用既有语义色、图标和简短文字，不重复输出同一结果的标题、长说明、状态条和toast。必要风险、失败原因、未知结果与下一步仍可见且可被辅助技术识别，不仅凭颜色表达。Files刷新SHALL固定在原控件显示busy，成功后恢复普通图标，不增加主区域顶部行；错误反馈不能随正常成功提示定时消失。

Modal footer SHALL 按DUL-007统一同类按钮几何与角色，正文按钮、菜单行保持各自职责。开关 SHALL 即时完成且不使用Modal动画、退场快照或延迟清理，同时保持原模态/非模态、Escape/外部关闭白名单、dirty guard与提交保护；旧异步结果不得影响新对象、新身份或新弹层。焦点恢复一次，背景无遗留遮罩；普通与减少动态效果设置一致。


普通提交、读取及任务等待 SHALL 附着发起控件或所属对象的固定状态位，不在 Work 列表行、Work 标题与导航间、Service 列表、Settings、Files 工具栏、Pi Requests 或 Session 列表之前插入推动已有内容的普通状态块。完整确认后的普通成功不保留冗余的 Create Work succeeded、Operation details 与 Check progress 常驻组合；原任务仍按所属对象可查，未确认和失败不被隐藏。

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
- **THEN** 原 Operation 从所属 Work 或对应任务入口仍可查，正常反馈更新不重新加载 iframe；合法返回、独立动作及键盘焦点保持可用

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
- **THEN** 按当前Work和目录区分首读骨架/已确认内容/局部错误，保留工具栏、选中和滚动，不以其他目录缓存制造假空态；重试不重放未知写入

#### Scenario: Chat普通读取与执行状态分离
- **WHEN** 会话列表或历史背景读取、首次读取、失败重试，或activeRun首次检查
- **THEN** 原历史、草稿和阅读位置保持，普通读取无时间戳/通用状态行；初次结构骨架，错误只呈现一次主要说明并保留局部恢复入口（通知不替代首读/准入的持久无框原因）；activeRun真实loading在发送控制中性表示、发送仍按未确认锁定，失败/闲置未确认保留Check status，真实Run/断连/unknown提交不被隐藏

#### Scenario: 合法多入口与Desktop图标
- **WHEN** 用户切换服务、在详情选择多入口，或打开Desktop页面
- **THEN** Service主Header与选择器不展示端口，详情保留技术信息和合法入口选择；iframe及独立窗口路由与所选真实端口一致，favicon使用既有Piwork PNG并通过嵌入资源交付

#### Scenario: 首次骨架不显示普通加载文字
- **WHEN** Works、Work、Services、Files 或 Chat 首次内容尚未确认且没有真实错误
- **THEN** 骨架只呈现贴合内容区域的形状，可用低对比渐变且减少动态效果时静态，区域名称与busy由辅助属性表达；未取得的Session/模型名称可使用对应字段占位，已有名称、真实错误和unknown设置恢复不被隐藏；仅延迟占位显现，不延迟可用内容，缓存刷新不换回骨架

#### Scenario: Service 入口归一与未完成导航不遮挡应用
- **WHEN** 已取得合法 Service entry，独立 CLI 票据 bootstrap URL 经预览检查归一为应用路径，或托管入口在保持完整 Service 前缀的情况下确认，或 iframe 的子资源尚未结束而应用已开始显示
- **THEN** Desktop SHALL 直接显示并保留同一 Service iframe，不以原始 src 等于最新 entryUrl 或 window.load 作为内容展示条件，不覆盖等待骨架；入口取得前可保留首次占位，真实 entry/预览失败与显式恢复入口仍可见，load 不表示业务就绪

#### Scenario: 已有内容刷新保持原位
- **WHEN** 用户刷新已有目录、Pi Requests、Session、配置目录或其他已确认列表
- **THEN** 原内容、选择和阅读位置保持，发起控件原位表达等待，无新增普通等待行推移既有项；成功恢复原控件，失败保留对应恢复

#### Scenario: 两个 Work 成功后不堆叠状态
- **WHEN** 两个 Work 的创建原任务与各自对象和列表读回均已确认完成，Work 均真实 Ready
- **THEN** 每一行只显示 Ready 与适用的快捷动作，名称、状态、操作与菜单按列对齐；不会继续显示 Create Work succeeded、Operation details 和 Check progress 的多行组合

#### Scenario: 常用控件等待不改变几何
- **WHEN** 用户在中英文及宽窄视口操作创建、保存、刷新或对象控制，分别观察等待前、等待中与完成后
- **THEN** 原触发控件及邻近交互目标保持位置和大小，既有正文、焦点及输入保持；需要用户处理的错误和未知结果仍显示所属恢复入口

### Requirement: 原操作在所属任务中呈现并恢复

**Identifier:** DWUI-OPREC-001

Desktop SHALL 在 Work 列表行和 Work 面板、Service 详情及管理区域、Settings 的 Apply 和 Package 区域、Import 与 Export 流程中，为对应任务呈现动作、目标、实际进度、失败或观察中断原因、只读 Check status 及原 Operation 详情。已可靠接受与执行终态 SHALL 分开；Work、Service 实际可用性、配置生效和浏览器落盘 SHALL 各依据其自身确认结果，不能由 Operation acceptance 或 succeeded 代替。

同一任务在所属上下文中已有等价进度或错误时 SHALL 合并为一处主要反馈，不额外叠加通用状态条。原 Operation 和 snapshot 技术 ID SHALL 可在该任务所属对象的次级诊断中读取、复制，默认折叠；Export Details 及所有既定仅进度 drawer 不承载技术ID/旧快照/诊断卡，这些内容转到同Work独立恢复上下文；已知多个原任务 SHALL 能逐一查看各自结果，历史顺序或旧成功不得覆盖当前控制目标。关联恢复 SHALL 核实原 Core/账号、Work、任务类型和可确认的 Service 身份；缺少或无法确认归属时 SHALL 说明未确认，不将任务归到猜测的对象。

原 ID 查询 SHALL 在相关任务上下文中可达；Export SHALL 仍能按 snapshot ID 找回该 Work 的原快照并核验归属，不另建全局 Operation 列表、搜索页面或操作中心。操作详情、手动查询、重新登录及页面重载恢复 SHALL 只观察已知原对象，不因查看、关闭或重查自动提交业务操作。相关 Work 或 Service 读取失败 SHALL 与已确认的 Operation 终态分别呈现，并继续按既有同步和有界重试规则收敛。


Work 和 Service 的普通操作 SHALL 在原对象单一状态位表达提交、真实进行阶段或未确认状态；原 ID、详细阶段及只读检查归所属对象的现有菜单／详情，不默认堆叠多行 Operation 信息。原 Operation、对应最新目标、本地记录和 Work/列表读回均确认收敛后，普通成功 SHALL 自动结束进度呈现，只显示真实对象状态；一项尚未确认不能被另一项成功覆盖。

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
- **WHEN** 用户从 Work 的独立导出恢复上下文按 snapshot ID 找回先前的快照
- **THEN** 仅在原 Work 和权限匹配时显示该快照的状态、期限和原下载动作，不按列表顺序改选其他快照，不产生新的 Export

#### Scenario: 操作完成但对象读取失败
- **WHEN** 原 Stop 已确认为 succeeded，随后 Work 或列表确认失败
- **THEN** 保留 Stop 的成功事实，另外显示状态未确认及只读恢复；确认恢复后收敛 Work 和按钮，不重提 Stop 或要求用户刷新整页

#### Scenario: 截图所示成功状态收敛
- **WHEN** Work 行已显示 Ready，原创建 Operation 已成功，且相同身份下该 Work 的最新目标、记录与 Work/列表读回均已确认收敛
- **THEN** 行内只保留 Ready 和适用快捷动作，不再常驻创建成功、Operation details 与 Check progress 多行；原操作可按需查询，不重发创建

#### Scenario: Ready 但读回尚未确认
- **WHEN** Work 曾确认 Ready 且原 Operation 显示成功，但关联读回、记录保存或当前目标仍未确认
- **THEN** 原位置准确表达确认中的真实事实或需要检查，最后确认状态与原操作可查，不仅因 Ready 或 succeeded 任一信号释放保护或声称全部完成

## ADDED Requirements

### Requirement: Desktop 全部状态来源按实际业务契约验收

**Identifier:** DWUI-V13-STATE-001

Desktop SHALL 对来源矩阵 D01–D23 的全部实际可观察状态交付一致反馈与安全恢复，不以原型代表状态替代业务覆盖。范围包括连接/会话、Works、生命周期及创建、Service目录/入口/控制/日志、文件浏览/预览/写入/上传、Save与Apply、Skills/Packages、会话/历史/Run/工具、模型/Thinking、图像、Requests、Import/Export/log export、原ID恢复及About/偏好。已确认事实、正在提交、已接受任务、真实对象可用性和观察错误分别表达；不扩展当前API能力或虚构Operation/百分比。

文件写入与批量结果 SHALL 保留每路径账本和未知目标锁，只重试明确失败且合法的目标；源/目标及覆盖同意变化使旧结果失效。Import 完成 SHALL 显示 Stopped/Not started 并等待用户显式Start。Run取消请求不等于已取消，未知提交不得自动重发prompt。模型与Thinking沿既有单一汇总与成对自动保存语义，不照搬原型里不符合当前能力的常驻选择器。Requests的等待结果/等待Apply不等于模型一直执行；历史、取消、Run和Operation身份分别核对。

#### Scenario: 文件部分成功与未知
- **WHEN** 批量复制/移动/删除一部分成功、一部分失败或未知
- **THEN** 各路径真实结果可查，未知目标仍锁定；用户仅可显式重试已确认失败且仍合法的子集，不重复成功项

#### Scenario: 导入完成不启动
- **WHEN** 包检查/上传/接受后原Import确认发布成功
- **THEN** 显示真实最终Work与Stopped状态，检查完成或上传100%不提前显示成功；只有用户Start才运行

#### Scenario: 会话取消与未知提交
- **WHEN** Cancel run尚未确认或发送响应丢失，用户切换后返回
- **THEN** 保留原Session、草稿、Run/提交身份与安全核对，状态不伪称取消/完成，不自动重发

#### Scenario: 模型与请求状态独立
- **WHEN** Thinking能力变化或Request等待结果/Apply
- **THEN** 当前有效能力、模型设置确认和请求状态分别呈现，既有焦点/草稿保持，不把Request等待显示为Run一直运行
