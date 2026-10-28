# Spec Delta

## MODIFIED Requirements

### Requirement: 主流程的异步动作提供即时且归属明确的反馈

**Identifier:** DWUI-011

Desktop SHALL 采用 UIL-PENDING-001 的统一局部三点，并在有效动作开始后的首个可绘制机会、请求结果尚未返回时，在原控件、对象状态位或所属任务详情表达动作、目标对象及正在读取/提交/上传/验证的英文状态；固定图标槽中的等待 SHALL 提供可访问状态说明，适用时可通过提示或按需详情查看文字，仅禁用按钮或改变颜色不构成等待反馈。按钮、表单、列表行、模块或传输区 SHALL 在原上下文呈现状态，等待区域提供适当的 busy 语义。快速完成不得人为延迟；最终页面、对象状态或成功提示可直接成为完成反馈。普通菜单、搜索、选择、复制及无需读取的导航 SHALL 不被强制添加加载或 toast。

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

收到原 Operation acceptance SHALL 在所属原控件或状态位立即表达对象及 Accepted，并使原 ID 在所属任务详情中可按需查看和复制，不能等待后续 Work、列表、日志或配置读取才表达。收到原 Run acceptance SHALL 在对应消息或 Run 的原上下文立即表达对象与受理状态，原 Run ID 在该 Run 的详情可按需查看，不为显示技术 ID 插入挤压聊天输入区的普通反馈块。执行状态 SHALL 依据真实 state/phase；不同动作不统一伪装成 Preparing，缺细阶段时显示该对象操作正在进行且保留原值。观察终态后 SHALL 提供所属对象的结果或返回/刷新入口，不把 succeeded 等同于另一能力已经 Ready、loaded 或浏览器已落盘。

同步修改已确认时 SHALL 立即保留并展示确认事实；需要关联读取时另行显示 Refreshing/Verifying，读取失败只说明当前数据未确认，保留原结果及只读恢复入口。没有可靠确认的修改 SHALL 区分明确拒绝与结果未知，保留输入和已有对象身份，禁止自动重发。手动检查成功且内容未变化时 SHALL 更新检查时间或显示此次已确认，失败不得使用成功图标/措辞。

普通导航和首屏读取 SHALL 立即建立目标页面的稳定外壳，使用稳定内容框架及贴合结构的首读骨架或原控件固定槽三点，并以可访问名称和 busy 语义表达等待，不插入统一检查条或重复的普通 Loading 行。仅有本次授权身份下确认的旧数据才可先显示，并标明取得时间与正在更新；未确认数据不显示为空集合。并行模块读取 SHALL 独立收敛，不因某一模块失败而把整个 Work 退回检查页面。正常背景更新不抢焦点、不滚动或逐次播报。

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
- **WHEN** 目标已确认为 Works、当前身份下的列表尚未确认，初次 Core 检查或 Works 读取正在进行
- **THEN** SHALL 立即显示对应列表结构的骨架及可访问加载状态，可用低对比渐变且减少动态效果时为静态，不呈现空白框或已确认零条；保留所属 Core 检查三点。成功空集合及实际错误后骨架结束，有旧列表刷新时不替换旧正文，减少动态效果下保持可辨

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

#### Scenario: 原动作等待与旁边控件不位移
- **WHEN** 用户提交创建、保存、刷新或操作所属对象，请求被延迟并随后完成
- **THEN** 普通等待只在原按钮或原对象状态位呈现，触发器、邻近按钮、行和导航在前、中、后保持位置与大小；接受、真实结果和可恢复状态不被误报

#### Scenario: 提交与对象阶段各自原位
- **WHEN** 用户提交 Work 或 Service 控制且接受响应及后续状态分别延迟
- **THEN** 先在原触发控件表达提交，再在原对象状态表达已确认阶段；原 Operation ID 和详情可查，未确认状态不冒充成功，等待不新增挤压工作区的状态行

### Requirement: 传输的等待与进度在所属流程中可见

**Identifier:** DWUI-013

Files 上传 SHALL 从开始目标检查起通过可按需打开的所属详情提供当前文件/总文件数和真实已发送字节或不可量化的 Uploading，逐文件串行且最终结果按路径呈现。只有浏览器发送完成时不能宣称 Core 已保存；等待响应时表达 Waiting for confirmation，部分失败/未知保留未成功输入及既有条件覆盖规则，不自动重传。Files SHALL 在现有文件操作按钮的固定区域表达真实上传阶段和已知进度；用户通过点击或键盘可按需展开当前文件、数量、真实字节与状态，原文件操作菜单仍可使用。普通上传等待不得在工具栏上方插入推移列表的状态块；未知总量时不得虚构百分比。

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

#### Scenario: 上传进度原位且可查看
- **WHEN** Files 上传处于目标检查、已知字节传输或等待保存确认，用户用鼠标或键盘查看进度
- **THEN** 原文件操作区域以固定几何表达真实阶段，按需详情提供当前文件、数量与可确认字节；工具栏与已有文件行不因普通等待移动，不重复显示同一阶段

### Requirement: Desktop 反馈按任务呈现且不堆积读取成功流水

**Identifier:** DWUI-019

Desktop SHALL 按 DUL-003、007 将反馈放在所属按钮、表单、列表行或功能模块，并将提交协调与可见反馈的保留规则分开。Open Work、切换模块、目录导航及普通读取成功后 SHALL 使用实际内容作为完成反馈，不生成或保留 `Work · 路径 · Checked/Confirmed · 原始 ISO 时间` 通用状态条，不跨目录堆积成功记录。正常背景读取 SHALL 不生成 toast 或反复播报成功。

实际请求尚在等待时 SHALL 在原上下文以骨架、就地等待或控件状态显示动作和目标、可访问的状态及 busy 语义，超过十秒仍未确认时如实说明仍在等待。Files/Chat普通读取（包括显式刷新且结果未变化）SHALL 在原控件结束等待并恢复普通状态，不增加成功条或toast；其他已有显式Check的简短确认 SHALL 保留在所属检查入口附近，不新增通用 Checked/Confirmed 条；普通成功提示至多显示三秒，不形成累计历史。同步写入可靠确认可显示 Saved 等简短结果；持久生命周期进展以 Work 状态及原 Operation 详情承接，技术 ID 和取得时间仍可按需查看。

失败、观察中断、未知修改及写入已确认但刷新失败 SHALL 有对象、可理解原因和安全下一步，不随成功提示到期被清除。提示消失不得释放未知锁、取消执行或丢失原 Operation。模块已有同一错误/进度时 SHALL 合并呈现，不再插入重复通用条；可恢复的错误在对应重查成功后清除。反馈更新不得移动或重载当前 Service iframe、覆盖编辑草稿，360px 及键盘操作仍可达。

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
- **THEN** 原历史、草稿和阅读位置保持，普通读取无时间戳/通用状态行；初次结构骨架，错误一次局部呈现与重试；activeRun真实loading在发送控制中性表示、发送仍按未确认锁定，失败/闲置未确认保留Check status，真实Run/断连/unknown提交不被隐藏

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

同一任务在所属上下文中已有等价进度或错误时 SHALL 合并为一处主要反馈，不额外叠加通用状态条。原 Operation 和 snapshot 技术 ID SHALL 可在该任务的次级详情中读取、复制，默认折叠；已知多个原任务 SHALL 能逐一查看各自结果，历史顺序或旧成功不得覆盖当前控制目标。关联恢复 SHALL 核实原 Core/账号、Work、任务类型和可确认的 Service 身份；缺少或无法确认归属时 SHALL 说明未确认，不将任务归到猜测的对象。

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
- **WHEN** 用户从 Work 的 Export 上下文按 snapshot ID 找回先前的快照
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

### Requirement: 无可见 Work 的任务仍有临时恢复入口

**Identifier:** DWUI-OPREC-002

Desktop SHALL 在 Works 列表现有操作区为当前身份已知但尚无可见 Work 的 Create、Import，以及 Work 已离开列表的 Delete 提供固定几何任务入口和按需展开的临时任务提示。入口及提示 SHALL 表达已确认的动作、目标或目标未确认、实际状态、Check status 和原结果详情，不在搜索框或列表前插入挤压内容的普通等待行；多个任务按各自身份呈现且可逐一展开，不变成全局操作历史。Work 行出现并确认关联后 SHALL 将适用反馈归回该行；删除清理仍在执行或失败时不得因行消失而丢弃原提示。

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

#### Scenario: 无对象任务出现不推移搜索与列表
- **WHEN** 创建或导入尚无可见 Work、删除后行已移除，且一个或多个原任务仍需观察或恢复
- **THEN** Works 标题既有操作区的固定几何入口可识别并按需展开各自原任务，搜索框、列表及其他动作不因等待区域出现或消失而移动；重载、搜索和空列表仍可找回原任务

### Requirement: 全部会话恢复入口使用有界历史读取

**Identifier:** DWUI-HISTORY-RECOVERY-001

新版历史能力可用时，Session 首次打开、切换、图片 profile 补读、Run 完成刷新、断线恢复、原提交键核对后的恢复及事件 410 恢复 SHALL 使用同一分页合并逻辑，不能通过其他入口退回整份 Session 或内联大最终结果的控制响应。

恢复原 Run SHALL 分别确认有界状态与所需保存历史，使用原 Run 的读取范围；历史读取完成前不能宣称结果已经完整恢复。活跃 Run 可串行只读观察新增保存内容并在终态停止自动观察，不反复加载无关 Session 全部历史。事件和历史按真实身份合并，最终答案不依靠跨消息文字相等来去重。

旧 Agent 未支持时 SHALL 不在正常 Chat 主区常驻分页历史能力文字；用户实际遇到历史读取不支持、超限或结果不完整时，在对应历史操作或恢复处显示事实及可执行方向。保留已知内容、草稿和原 Run 恢复入口，不自动更新镜像、循环请求超限旧接口或重发原 prompt，也不把未完整读取当作完整历史。所有既有模型、Thinking、图片归属、工具安全呈现及 DWUI-004 的执行与授权边界继续适用。

#### Scenario: 正常完成时刷新大结果
- **WHEN** 正常事件观察取得终态，最终结果或整份 Session 超过旧单次响应上限
- **THEN** 状态可确认且所需正文分片可读取，完成刷新不调用整份历史，已有回复与工具不重复

#### Scenario: 410 后原 Run 运行中或已完成
- **WHEN** 事件入口返回 410，原 Run 分别仍运行或已经终态
- **THEN** 读取原 Run 状态及对应历史页，停止重试原失效事件游标；运行中按原身份观察，终态且结果读取完成后停止自动读取，不再提交 prompt

#### Scenario: 恢复期间能力或身份变化
- **WHEN** 页恢复遇到旧 Agent 不支持、鉴权失效、对象缺失或身份切换
- **THEN** 明确保留或清理对应身份内容并停止不适用的自动读取，不显示虚假恢复成功，不换绑新 Run 或自动升级运行环境

#### Scenario: 旧能力下正常聊天不展示常驻文字
- **WHEN** 旧 Agent 不支持分页历史，但当前会话内容已正常取得且用户正在聊天
- **THEN** Session 下方和消息区不常驻 Paged history is unavailable 技术说明；实际历史读取失败或不完整时在所属操作表达，保留已读内容与只读恢复
