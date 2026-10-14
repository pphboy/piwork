# Design

## Context

动机和三批范围见 `proposal.md`。提案基线为 `8b49c2cec1c6708a601d1809a97f81491525d81d`，整合基线为 `28bfdfa56b4c84b10ade9a63fedb7c2b75c04a90`，以下问题分析与证据账本保留提案时背景；A/B/C前端实现已按最新main整合，当前可执行验收与保留门槛单列，环境/工具门槛单列，真实Core仍未验。当前结果见[验收记录](evidence/acceptance.md)和 `tasks.md`。

当前主要问题模型是“领域任务、页面展示和观察请求共用同一种结束条件”：`app.ts` 的 `stay()` 绑定 hash/modalChoice，关闭导出面板会跳过 await 后的下载；`show(operation)` 把多个简单动作都落到技术详情；`projectWork().usable` 又把一次 statusError 当作整个工作区不可用。已有对象锁、幂等恢复和增量 iframe 保留机制仍有价值，修复应分离这些生命周期，而不是删掉保护。

最新增量设计以文末2026-10-14读取反馈与次级信息为准；前轮＋、端口标签和Updated方案已由该增量取代，历史验收不改写。

### 证据账本与范围判定

证据分为“源码确认”“合成状态执行”“合成浏览器复现”“真实后端/人工待验”。Bug 指行为错误或既有契约不满足；用户目标与设计改善不包装成 Bug。编号沿用交付的26项清单，其中20为风险脚注，03含A/B/C子场景。

| 编号 | 类别与已取得证据 | 本轮规划处理 |
|---|---|---|
| 01 | Bug；源码及合成状态执行确认 usable 因503失效；实际应用输入损失未实测 | 分离展示保留与动作准入，新增真实 iframe document/焦点断言 |
| 02 | Bug；合成状态执行确认 Starting→Ready 后入口POST为0 | 当前所选就绪服务的入口去重准备；浏览器待验证 |
| 03A/B | 用户明确目标与流程改善；合成浏览器复现多段接力、Stop后无继续导出 | 一次明确意图贯穿必要停止、生成、校验、下载 |
| 03C/04 | Bug；源码确认旧包遮蔽新导出及精确snapshot身份丢失 | 精确ID、独立新导出入口，多快照自动化先复现 |
| 05 | Bug；源码确认返回列表无读取 | 列表进入/可见性/手动刷新，保留旧数据 |
| 06 | 设计改善；源码确认只保存Service/Session，不保存区域 | 同身份页面内恢复area/path/file，首次才默认Services |
| 07 | 数据丢失风险；源码确认beforeunload未包含聊天草稿 | 最小离页保护；真实关页图片恢复未测且不承诺持久化 |
| 08 | 设计改善；源码确认创建草稿复用 | 可靠受理后下一次新草稿；失败/未知仍保留 |
| 09 | 待验证；源码存在observer实际暂停与按钮投影不一致风险 | 先确定性故障注入，证实后按现有观察契约修正 |
| 10 | Bug；合成浏览器截图10确认Starting标题与Disabled正文矛盾；Failed分支仅源码 | Starting/Failed/disabled/unknown逐状态复现与准确文案，Failed仍待运行验证 |
| 11 | 验证门槛；已有局部反馈和稳定创建按钮规则 | 测快慢请求、十秒等待、焦点/几何；不预先添加延迟或全局loading |
| 12 | Bug；源码确认局部CSS覆盖搜索/Composer焦点 | 实际Tab、computed style和截图验证至少2px焦点 |
| 13 | Bug与设计改善；合成浏览器测首次勾选y=253.5→307.5，位移54px；裸checkbox命中问题为源码 | 稳定工具栏空间，扩大独立命中区 |
| 14/15 | 设计改善；源码确认命名入口缺字段聚焦/Enter、Rename空值 | 局部表单提交、IME保护、basename预填 |
| 16 | Bug；源码确认danger被普通text-button级联覆盖 | 定向CSS与computed color回归，不重建令牌体系 |
| 17 | 设计改善；源码确认无显式遮罩关闭逻辑 | 非busy、无草稿、白名单弹窗安全关闭 |
| 18 | 设计改善；源码确认关闭Cancel与Cancel request邻近 | 关闭用Close，取消执行保留对象并断言请求 |
| 19/20 | 未证实问题；已有reduced-motion，根live区域只是风险 | 动效/真实NVDA或VoiceOver门槛，未有证据不宣称缺陷/通过 |
| 21 | 目标交付断点；合成浏览器复现延迟POST期间Close，ready后12秒无下载事件；旧规格实际允许该行为 | 明确修改旧规格而非声称旧实现违反其规则；恢复ready路径另加测试 |
| 22 | 设计改善；合成浏览器确认Create有Open、Start无Open；Service/Import分支源码确认 | Work/Service完成出口，导入仍先stopped且显式Start and open |
| 23 | 设计改善；合成浏览器和源码确认编辑器无Download | Download saved version，不自动Save |
| 24 | Bug；合成浏览器确认读文件后仍留在Settings/modal | 统一目标文件导航及dirty guard |
| 25 | Bug；合成浏览器日志GET503挡住详情，对照200可进入 | 先开详情、日志局部加载，不放宽控制权限 |
| 26 | Bug；合成浏览器仅验证单路径COPY403原因在弹窗后 | 就地逐路径结果；两路径混合成功/207属于新增验收门槛 |

取证来源：2026-10-12 的主流程/小交互审查及补充、合成浏览器记录、提案时源码和初始检查结果。初始独立基线报告不在仓库中；当前已重跑的基线命令/退出结果记录于本变更验收记录，截图及请求证据另附。历史在途 change 的勾选状态不作为本次新场景通过证据。未编号“深层目标目录只能选已浏览缓存”保留为后续候选，本案不扩展目录选择器范围。

### 规格与在途变更合并

- 明确修改 DWUI-009、012、013 与 DUL-009：原先分开点击、关闭后禁止其他页自动下载，改为同一有效页面身份中已明确授权的一次交付。DWUI-010仅澄清展示观察与交付的关系，不增加持久记录字段。
- DWUI-016—019已有主规格，直接MODIFIED并保留较新的首屏/骨架/就地反馈规则。
- DWUI-004/006/007/008以完整主规格为底，合并 `fix-webui-data-integrity-and-recovery` 中尚未全量同步的410恢复、条件保存、统一配置草稿、匿名检查和释放规则，避免较旧delta删除现行Service自动请求或脑包候选细节。该合并只保留既有行为，不重复列实现任务。
- 不修改 `compact-chat-composer-settings` 和 `improve-desktop-chat-and-release-info` 文件；回归依据实际合并设置摘要、DWUI-IMAGE-001—003、DWUI-CREATE-LAYOUT-001，不还原主规格里较旧的双选择器布局。
- BSA-005补充入口Ready转换和临时失败视口保留；BSA-002及Work lifecycle/snapshots/file-access后端契约不变。所有后续同步/归档前须再做交叠检查，本轮不归档。

## Goals / Non-Goals

**Goals:**

- 一个用户目标只创建一次对应业务意图，界面收起、读取重试和用户查看别的对象不会混淆其身份。
- 展示保留、读取观察、提交锁、领域前置条件、交付资格各自可测，未知结果继续只读核对。
- 在现有结构里进行有边界的修复；每个实现提交能对应编号、规格场景与可执行断言。

**Non-Goals:**

- 不建立永久下载队列、跨关页/CLI重启自动续传、全局Operation发现或跨窗口一次性下载分布式锁。
- 不持久保存聊天正文/图片，不声称能恢复浏览器崩溃或强制关页的草稿。
- 不重构整个app、不新增设计系统或装饰动效、不修改About内容/模型执行；本轮不修改Core业务逻辑或API。若验证发现接口不足，先向用户报告证据与必要变更并等待新授权，不能借验收自动扩大为后端修复。Go/CLI既有契约测试及正常构建资源同步仍在验证范围。
- 不改文件权限、条件写入、包hash/格式校验、Core cold snapshot门禁、导入默认stopped或Save/Apply分离。

## Decisions

### 1. 页面内有界的导出交付协调器

增加一个小型可单测的导出流程模块（建议 `src/export-flow.ts`），由app拥有浏览器发起下载副作用，adapter保持Core/CLI请求、身份代次、原对象事实。流程数据仅在当前页面内保存：意图ID、Core/账号与local identity epoch、Work ID、mode（new export / existing snapshot）、stop/export Operation ID、snapshotId、transferId、阶段和autoDeliveryConsumed。技术ID之外不复制包内容或凭据。

流程按以下顺序推进：

1. 用户明确选择导出当前内容。
2. 已停止的 Work 直接继续；运行中的 Work 先完成停止影响确认，提交一次 Stop，并查询确认 stopped。
3. 提交一次 Export，保留返回的原 Operation 和 snapshot。
4. 查询确认快照成功后，针对该 snapshot 提交一次下载准备。
5. CLI 完成完整校验，确认原 transfer ready。
6. 单次发起浏览器下载，并保留同一 transfer 的手动保存回退。


- 初次动作明确表达最终目标。已stopped且没有待选参数时，动作直接进入进度面板，不加无风险重复确认；隐私提醒在面板及交付前可见。已有快照下载是独立动作，不代替“导出当前内容”。
- 运行中用一次Stop and export确认，内容复用现有停止影响。取消确认零Stop/Export。stopping状态不再次Stop，用户明确继续目标后观察原停止。只有真实desired/observed stopped、无已知冲突且Core接受才能打包。
- 每个后续阶段依赖可靠确认，不因UI文字、旧数组顺序或Operation succeeded单独推断下一能力。停止失败/未知暂停推进；没有原Operation ID的未知Export不能重POST。
- 同意一次组合目标允许其必要顺序调用；重复点击被同对象锁拒绝，不排队。新导出有新提交意图，重读原任务不生成新key。
- 只在ready且身份/原资源仍匹配时原子消费autoDeliveryConsumed，然后发起content链接；ready观察先于POST回包、重复GET及晚回包不能二次自动交付。浏览器无法保证保存，用Download started。始终保留手动Save file/Download again，手动再次下载不等于允许重复自动调用。
- 收起面板只改变展示，不解除领域锁或停止完成原意图所需的有界观察。同身份换Work允许继续原下载，但通知必须标原Work且不重开旧面板；切Core/账号、注销、失效local auth或pagehide终止未完成自动交付资格。身份恢复/页面重载仅查询原ID并允许显式下载。
- 保留现有Pause/Resume观察含义：用户明确Pause该导出观察时暂停依赖该观察的下一阶段推进，Resume仅核对原ID后继续，不能把暂停说成取消。关闭面板不是Pause，读取失败耗尽后留原身份和显式Check。

备选：只在现有await后加downloadURL仍被modalChoice截断；移除所有stay校验会泄漏跨身份/旧视图副作用；持久后台队列扩大隐私和恢复范围。选择只把交付意图从视图有效性中独立出来，保留identity与对象校验。

### 2. 快照是精确不可混淆的交付对象

Export view保存明确snapshotId，不再用find(workId)覆盖用户指定对象。模型保留实际expiresAt、size及可取得的可信生成时间；没有生成时间则只显示ID/状态，不推断“最新”。打开已有快照先只读确认可用性；新生成成功严格消费本次返回的snapshotId。已有原transfer ready直接使用其content，未知先Check，过期要求新明确导出而非静默重做。

备选：按数组排序只能改善默认展示，不能证明包包含当前内容，更不能满足按ID恢复，故不以排序作为修复。

### 3. 保留展示不等于授予动作

`lifecycle.ts`/models区分“最后确认可保留工作区画面”与“当前允许的新动作”。`app.ts`保留稳定的work-layout/iframe祖先；状态条在固定位置标记未确认，不以workState整体替换。原停止目标、真实stopped/deleted、可信权限失效和网关撤销仍立即生效；服务端每次访问仍授权。新的危险控制和文件/Run提交保持保守准入，不能只删usable中的statusError条件导致全部按钮解锁。

Service入口观察绑定identity+Work+Service+port；只对当前所选且ready、缺entry、无同目标在途请求的对象ensure。入口错误给显式Retry；不后台递归扫描/创建所有Service入口。旧端口/身份晚结果只归原对象，不切换当前选择。

备选：网络错误时销毁页面破坏连续性；无条件保留全部能力违反撤销边界。采用展示和准入分离。

### 4. 列表与工作区导航只读恢复

进入/返回/重新可见Works调用现有listWorks协调路径，按身份去重，保持已有列表、搜索和更新标记；提供Refresh Works，不增加永久高频轮询。沿用controlVersion、新接受目标及旧列表防回滚逻辑。

`workSelections`扩展area、path、file，只在当前身份页面内存。openWork/loadRoute统一恢复目标；读取开始前固定目标区域外壳，guard通过后才离开脏配置/文件。无效目录/文件在Files内局部回退，后台结果不能覆盖用户更晚areaChoice/serviceChoice/sessionChoice。Open brain source复用同一“导航并打开精确文件”入口，成功退出Settings/modal；取消guard保持原页。

备选：写localStorage会引入跨身份内容和隐私生命周期；本轮只做已有页面循环的上下文记忆。

### 5. 草稿与创建各有清楚边界

现有beforeunload dirty predicate加入当前身份所有Work/Session非空文本和图片（含读取中已选合法草稿）检查，取消离开保持原对象。不得把图片写浏览器永久存储；支持程度和用户激活要求如实记录。身份清理优先，保护不成为阻止安全清理的理由。

New Work采用draft revision/accepted snapshot：原提交可靠受理后标记该草稿已消费，下次明确New使用空名称/当前默认；未知或拒绝保留原draft与锁。旧结果不能清空另一新draft。暂不增加“沿用上次配置”入口，避免把可选便利扩大为新产品功能。创建按钮现有稳定几何与反馈不变。

### 6. 附属读取与结果反馈留在动作所在处

Service详情先渲染身份/状态/合法控制，再独立readLogs，日志loading/error/refresh按原Service隔离，控制不依赖日志成功。控制进度不强制show(operation)替换原对象；原ID保留次级详情，真实可用后显示Open Service/Work。Import成功用Imported · Not started，用户明确Start and open后才接续启动和打开。

文件弹层调用统一逐路径结果呈现组件，显示成功/失败/未知、目标和安全下一步。已成功项从再次提交集合排除；未知只能核对，不因再次按主按钮整体重放。一次COPY403和真实混合207分别测。文本编辑器下载现有已保存版本，不调用Save，保留草稿/光标。

备选：仅toast“有路径失败”仍不能让用户在当前决策处恢复；强制关闭弹窗会丢输入和上下文。

### 7. 控件改动限定到实测断点

- Files选中工具栏占用稳定空间；独立label命中区至少32px，文件名仍打开。连续选择前后同一行坐标在相同布局下误差不超过1px。
- New folder/Rename用局部form submit或等价单入口；初焦字段，basename预填，最后扩展名保留（点文件不把整个名字当后缀，目录全选）。isComposing/组合态/229兼容保护；Enter+click、双击仍只一次mutation。Stop/Delete/覆盖不挂通用submit捷径。
- 搜索/Composer沿现有token修focus；danger修局部特异性，检查hover/focus/disabled。保留合并Response settings，不修改其自动保存/焦点规则。
- 外部关闭白名单仅Work options、Service options、Work information等无草稿只读入口，且非busy/unknown恢复。pointerdown/up均在外侧才关闭，保留Esc/Tab/触发焦点；不扩至Stop/Delete/Remove/Overwrite/dirty/Import。
- Close用于关闭查看；Cancel request/run保留真实取消。Starting/Failed/Disabled按confirmed事实分支，缺错误文字时不伪造Disabled。
- 09/11/19/20先测：自动暂停状态有确定性反例才修其投影；loading/motion无问题则只记录符合；live区域须真实辅助技术证明后再在原范围内修，不把DOM结构分析当读屏验收。

### 8. 主流程与管理入口分层（2026-10-13反馈）

- 直接进入 Work、使用 Service/Agent、修改 Files 是常驻主路径；Ready 行显示 Open Work，Stopped 保留 Start。Stop 与 Work information 归当前 Work 更多菜单；全局 About 与 Known operations 归 Admin，不互换作用域。只删除已有列表底部重复 CTA，保留空列表创建入口。
- 原 Export 处理器已经直接建立新意图，本轮不重做协调器。把展示降为右下非遮罩紧凑面板，默认只显示 Work、真实阶段、错误和必要恢复；原 Operation/snapshot/transfer、Pause/Check、旧快照放到 Details。成功不常驻另一个 Export 主按钮；需要新导出时从同一原入口明确触发。运行中仍使用原 Stop and export 影响确认。
- 非遮罩导出不拦截背景输入、Tab 或动作目标；从背景选择新动作先收起展示，原交付继续。模态与非模态切换重新设置 dialog 展示模式，不能继承旧 Stop 窗的遮罩/焦点锁。
- Admin 使用同一 dialog renderer 的紧凑右上样式；外侧 pointerdown/up 的同对象/身份校验和 Escape/焦点规则复用。它自身无草稿，背景文件/设置脏状态或后台任务不应阻止仅收起菜单。内部选择原动作仍受原确认/身份规则保护；不扩展其他危险/编辑弹窗白名单。
- Files 取消空态选择条；选中数量与 Copy/Move/Delete/Clear 在原工具栏替换普通辅助动作，保留至少32px复选框命中和行高度。早期请求入口图标化保持了 Service 过滤与全 Work 范围；后续确认的入口归属及布局以以下第9—14节为准。

### 9. Request 与 Run 按真实对象分层

依据 `adapter.ts` 的 requests/requestDetails/runDetails、`models.ts` 的 Message.runId 和 WAF-005/007：请求属于 Work，来源可为 Service 或 Chat；一个请求关联多个 Run，等待时释放执行槽。普通 Chat 消息不保证存在业务 Request，Run succeeded 不证明请求完成。当前 Pi requests 已在 Agent 头部，继续在头部挪图标不能解决作用域问题。

- 全 Work Pi Requests 放在 Work 模块导航右侧的轻量辅助动作，Services/Files/Chat仍是三个主区域。常态不使用抢主流程的实心主按钮。专注模式从可见的对象/Work 更多菜单保持该入口；Service工具栏继续仅在确认有记录时显示当前Service的过滤入口。
- 复用读取与恢复数据，列表/详情在同一右侧检查面板切换，宽屏建议约480–560px，窄屏使用单一可关闭面板；不做第四个必经页面。保留同一Service与Chat，不新增输入上下文。可在背景操作的宽屏检查面板不冒充模态焦点锁；窄屏覆盖层按实际模态规则管理焦点。
- 列表按 goal、source、state、updatedAt 排列，historical明确只读；只提供现有全Work/Service过滤，不在已分页数据上虚构“当前Session”或Chat-only全量过滤，也不新增未读计数。
- 详情先显示目标、来源、请求状态和最后确认时间，再显示result、waitRef的类型/期限/等待说明或error；各次Executions按runIds紧凑折叠，展开实际模型、Thinking、时间、source.phase（存在时）、finalText。Evidence及ID后置；不生成无事实支持的阶段进度。返回恢复过滤、已读分页、滚动与焦点；取消/重试未知结果继续核对原身份。
- Run Details入口放在真实runId对应的一轮消息/Activity末尾，同Run多段消息只显示一次；默认状态与Details短行，展开才呈现执行事实。无runId的旧消息不推测绑定；需要时从Session已知Run记录查看。Work级其他Session/Service占槽仍就地说明真实来源，并查看精确active Run。移除composer上方无上下文的常驻详情和不明确指向对象的泛化入口。

备选：把所有请求当Session历史会丢失自动Service目标；永久执行大卡和每个Run完整dl会遮蔽用户结果，均不采用。

### 10. 布局状态、分隔线与真实剩余高度

改动集中在 `app.ts` 的 workPage/focus返回与阅读状态、`public/style.css` 的工作区尺寸；保留 `reconcileHTML` 的稳定iframe节点与祖先。当前service-only同时表示专注模式，直接用它处理普通Collapse会错误隐藏Work导航，因此Chat可见性与workspace/focus状态分开表达。

- 保持Service左、Chat右，默认约70/30；建议Service最小400px、Chat最小320px，separator约8px命中区配细分隔线。比例按实际容器宽度夹取，拖动期间不反复重建DOM；跨iframe拖动用指针捕获或临时透明拖动层，结束/取消必清理，不修改iframe内部。
- separator提供role、vertical方向、控制面板和当前比例；左右键16px，Shift左右64px，Home/End到边界，Escape撤销当前拖动；双击与可键盘到达的Reset split恢复默认。几何值是实现起点，最终按实际字体、边界和可读性验收。
- Collapse Chat在常规模式只隐藏右栏，Work工具栏同一固定面板按钮切换Show/Hide chat，窄屏仍可见；Focus chat、Restore layout、Exit focus原返回语义保持。按当前身份/Work在页面内保存比例与显隐，切换/返回及窄屏往返保留，刷新回默认；不引入跨重启存储。隐藏内容不进入Tab序列，但不卸载同一iframe、创建Session、清空文字/图片草稿或重启Run。
- 小于900px或容器不满足最小宽度时使用单面板/覆盖层，隐藏separator，不用窄屏几何覆盖最后宽屏比例；500px与360px都回归。独立Service窗口不新增Chat，Files不顺手改成新的可拖分栏系统。
- 底部空白的源码根因：常规Work header69px加tabs53px为122px，work-layout却减157px；窄屏64px加51px为115px，却减150px，均多减约35px。用可见头部/提示行加剩余空间的flex或grid布局替代固定减数；不是给iframe补35px。最多保留一条紧凑StatusLine，iframe与Chat内部滚动，正常、Degraded、错误提示、Focus及折叠均占满真实可用高度。不改Service业务页面自身留白。

### 11. Service 切换与 Files 工具栏

- `services()`将两个裸select组织成统一Service触发器和独立端口控制。触发器展示name、observed，列表按名称/状态/declared ports/选中标记对齐，底部Manage services；单port轻标签，多port选择。只用已有Service字段；Removed/无Web端口不混入应用切换，管理仍可查看适用对象。不可用项说明原因，选择不自动Start。长名称与键盘选择、Escape/焦点返回、旧入口晚响应一并验收。
- `files()`只保留一个Refresh；Upload/New folder收进＋菜单。移除file-options内重复Refresh；若仅剩重复WebDAV则撤下该空余菜单，页底原WebDAV与空目录文字引导保留。多选动作仍替换原工具栏，不新增空选择行。
- `action-state.ts`现在对refresh-files成功保留3秒Status checked，并由renderActionStates向main-panel prepend一行，另有Workspace reread toast。为Files增加原按钮内的busy/成功呈现而非全局禁掉读反馈；固定命中区与几何，成功短标签/图标及aria反馈，取消重复成功条/toast。失败或未知仍在所属对象明确显示原因/安全下一步，未知写入只重读不重放。

### 12. Settings、Works 与身份菜单

截图中的Back to Work和Configuration in use属于 `settingsPage()`。返回入口放在设置内容左侧导航、与标题对齐；顶栏Back to Works仍返回列表。沿既有区域记忆和dirty guard返回原对象，不强制去Services。

saved/active一致时，仅保留标题旁轻状态及就近Refresh status图标，不提供重复解释的Details；dirty、Not applied、Applying、失败/未知则保留明确状态和动作。无变更时不保留占位的禁用Apply主按钮；Save、Apply、候选加载与验证仍是不同事实，不自动执行。

Works的Refresh/Import改quiet图标，＋New保持主动作角色；英文tooltip/aria-label和空列表文字CTA保留。账号菜单当前标题account=admin、正文裸role=admin形成重复；账号显示一次，角色必要时使用带标签的可读信息，Core地址保留。不得因省文字删除账号管理动作、影响确认或身份边界。

### 13. Modal统一几何与即时安全开关

`modalMarkup()`共用renderer，但footer混用默认40px与small34px；Pi Requests、Request detail、Package detail可出现混高。Stop的Cancel/Stop Work已同高，仅自然宽度不同；其“checkbox”实际是impact-box内stop SVG，无input/state/handler。移除误导空心框或换明确非交互符号，范围说明保留，不增加确认勾选，真正Delete checkbox不变。

- 给footer直接动作统一尺寸角色，建议40px高、13px字、横向16px、8px图标/按钮间距、约96px最小宽；成对动作等宽，长文案可扩展、窄屏统一换行/堆叠，不能裁文字。Close/Cancel为次级，合法提交为主动作，危险提交保留danger，恢复动作在同组次级；DOM顺序与可见顺序一致。menu型弹层、正文小动作、头部关闭icon保留各自角色，不使用覆盖所有.button的粗放规则。
- 2026-10-14用户取消全部Modal动画：开关立即完成，不保留keyframes、视觉快照、退场状态、动画事件或fallback timer。
- closeModal先失效modalChoice和逻辑状态，再关闭原生dialog并渲染、恢复合法焦点一次。新入口使用当前launcher，不继承旧窗来源；旧异步结果仍受原身份/对象/视图校验。
- Modal与Export继续分别使用showModal()/show()，即时关闭释放原生backdrop/inert，不以去动画改变危险确认、dirty guard或非模态背景操作。

### 14. 短反馈沿用已有颜色角色

完成与警告默认采用已有语义色、图标和短标签，如Saved、Updated、Needs attention；同一结果不再重复标题、解释段和toast。颜色不能独立传义，图标需配可见短文字/可访问名称；停止影响、私有包风险、具体失败原因和安全下一步不能被省略或只放tooltip。正常细节按需展开，异常/未知持续可辨，自动消失不释放锁、不重放操作。限本轮受影响界面，不重写全应用文案或颜色令牌。

## Risks / Trade-offs

- [自动下载可能失去浏览器用户手势或被拦截] → 最多一次尝试，持续同transfer手动按钮；只称发起，不称落盘。自动与显式再次下载分别计数。
- [保留旧视口被误解为权限仍有效] → 未确认状态和动作准入分离，真实401/403/停止撤销回归，网关2秒撤销契约不变。
- [连续导出被通用视图校验打断，或为修复而放宽身份] → 对view、identity epoch、对象ID、draft revision分别注入晚响应，交付仅脱离view而不脱离身份。
- [在途delta归档覆盖较新需求] → 本案保留合并文本，后续Apply/归档重新核对；本轮不修改其他change、不同步主规格。
- [beforeunload不能保证所有关页场景] → 明确提示能力范围，不承诺图片重开恢复；不引入不必要持久存储。
- [NoDocker误被记为端到端通过] → 分层验收记通过/失败/阻塞/未测；真实Core门槛保持未完成，不用skip或fixture替代。
- [任务范围膨胀] → 未编号目录选择候选、全局视觉重设和后端重写不纳入；09/11/19/20只有当前范围内证据才落修复，重大新问题另提案。

## Migration Plan

1. 新Apply请求后先核对仓库HEAD/在途改动与验收环境；准备Go1.25.5、原生CLI、静态资产及能合法启动的浏览器。不修改项目依赖来掩盖环境阻塞，不绕过socket限制。
2. A按“导出意图/精确快照与单次交付”功能提交；先有自动化失败证据，再实现与同transfer恢复回归。
3. B按工作区连续性、列表/导航/草稿、Service/文件局部恢复等功能边界提交；C按控件、文案与完成出口提交。数量由实际改动决定，相关测试与生成资源随所属实现，不把所有改动塞一个commit。
4. 每批先跑相关状态/浏览器/Go契约，再跑完整Desktop测试、构建/embed与原生边界；文档单独整理。纯TS测试不替代browser.test/native-auth，合成原生HTTP不替代真实Core。
5. NoDocker环境完成可运行层后，真实Core/Docker停止→导出→校验→下载→检查→导入→显式启动作为明确待验收项保留；取得用户授权的合适隔离环境后才执行。不安装/启动Docker作为本轮默认动作。
6. 回滚按功能恢复对应源码、测试和生成资源，不删除用户Work/快照/数据。仅前端页面内意图，无存储schema迁移。发布/推送、规格同步与归档均另按明确授权和全部验收结果处理。

### 15. 组件语义纠正与即时关闭

Files＋使用带可访问名称的锚定动作菜单；Escape恢复＋焦点、外侧与Tab离开关闭而不锁背景。选择Upload直接启动文件选择，New folder进入原输入窗，路径/身份改变清理旧菜单。真正编辑与危险确认保留原Modal。

2026-10-14用户明确取消所有Modal动画：删除入场/退场keyframes、快照、展示层、动画事件和fallback timer。关闭立即失效modalChoice、退出原生top layer、渲染并恢复合法焦点一次；不存在旧退场callback。模态/非模态、安全确认与原身份/异步结果保护不变。

Input options是打开设置的入口，以haspopup/expanded表达，不将内部includeIdentity状态放到入口pressed；Files Move用专用移动图标，不与Back混同。

## 2026-10-14 浮层职责修正

共享展示分类只改变前端容器，不改变原动作准入。Dropdown使用menu/menuitem、方向键/Home/End及键盘字符查找；Popover保留dialog及选择组语义，可Tab离开，锚定触发控件并在窄屏/视口底部夹取翻转。外侧指针关闭不得preventDefault或抢焦点，不吞下一个导航点击；Escape返回精确触发器。非阻断层没有backdrop/inert/focus trap。打开子任务时保留原来源，普通命令执行后收起。Service管理/详情为持续侧栏，必要控制仍打开原危险确认。身份/路径变更不得复活旧浮层。

Chat显隐控件移至Service工具栏；窄屏Chat显示时仍保留Service Header，主体Service内容暂隐藏且不可聚焦，同一按钮可恢复Service。所有布局只改容器，不能销毁Service iframe。Files/Chat自己的局部布局出口保留。

## 全量入口分类复核与本次继续范围

用户随后明确要求本次继续完成已确认不合规范项。Operations列表/Operation恢复详情、Run详情、Package详情含持续观察、诊断或长配置内容，改为非模态Inspector Drawer；保留原ID、Cancel/Retry准入、导入完成出口和源码dirty guard，不新增业务能力。独立导入/创建/文件目标表单与高风险确认仍是Modal；About、图片预览、WebDAV是可独立退出的短时阅读任务，保留Dialog为合理例外。

稳定规范采用入口：`openspec/specs/desktop-ui-language/ui-component-adoption.md`；原文只存一份，不复制到本change。

### 收尾实证与最小修正

- 分隔线保持原键盘/双击重置逻辑，加入常驻短握柄、hover/focus高亮及12px独立gutter；抓取区不覆盖相邻内容/滚动条，不加动画。
- Service已确认空列表后的失败读取保留错误与精确Retry Services；加载/错误/无Web分支都保留真实Services Header和Show/Hide出口。
- 首次Session/历史读取失败不展示新会话欢迎；正常模型候选失败不误抹掉已确认空态。重建同Work/Session时保留checkedAt/imageProfile，挂起重读仍展示缓存历史；显式Retry只读原资源，选择和身份保护不变。
- Work名称/Open Work是可复制真实hash目的地的Link；普通点击仍走原dirty guard，Ctrl/Meta/中键保留浏览器行为。
- File Delete补充UI不可恢复说明。Upload review只将needsConsent已确认目标列作Overwrite；普通失败重试不带overwrite授权；unknown只读核对且成功项不重传，原版本与路径锁保留。
- Dropdown失败保留可见错误；模型summary重复点击关闭；Drawer列表换详情只在显式打开时聚焦Close，背景异步更新不抢焦点。旧菜单负margin引起1px横滚，限定Dropdown重置margin和长命令换行，不裁掉内容。

## 2026-10-14 读取反馈收敛与次级信息

- Files 的刷新为40px icon button，等待在原位并保持真实操作锁；完成恢复普通图标，无Updated字样、成功toast或额外行。目录以 `(Work,path)` 的checkedAt/error判断初次/缓存/失败，不能以其他目录文件判断当前目录已读。首次占位保留工具栏；缓存空目录也是真正已确认空态。
- Chat保留原消息、草稿及阅读锚点。后台Session读取不再插入时间戳；首次未确认内容使用静态占位，不提前显示欢迎。会话错误汇成一次局部说明、可展开详情与重试；原模型专属错误仍由原模型区域管理。
- activeRun初次真实loading只在发送图标表示中性检查，发送准入不放宽。未确认但未实际读取仍有Check status，真实读取失败保持持续警告；chatSubmissions unknown、stream断连及Run状态不是普通刷新，完全保留。
- ActionState仍协调锁/生命周期；仅Files/Chat白名单纯read的普通等待/成功由模块承接。read错误绑定Work/path/Session，导航失败保留原位置到目标的上下文；unknown mutation不得被展示过滤或到期解除。
- Files的Upload files/New folder为混合命令集合，用ellipsis及More file actions而非创建＋；保持role=menu、键盘和路径身份校验。Reset split用回转箭头图标。Service主Header及选择器只保留名称/状态；详情保留声明端口，当前多入口服务可选择已声明端口。独立窗口同步已验证路由，不改变实际入口或越过就绪保护。
- favicon直接引用现有 `/desktop/piwork-logo.png`，复用现有PNG/MIME/Host边界及嵌入流程，不另造图标资产。

## 2026-10-14 追加截图修正与Markdown

- Agent及文件对象Dropdown每条命令保留文字和一个装饰SVG；Restore layout沿用原返回箭头，Files Rename补铅笔，属性值列表与信息正文不强加图标。
- 仅非空且全部路径succeeded的Files批次标记为Toast展示，复用3秒自动消退通知；不清除结果账本或未知路径锁。混合/失败/unknown及回读失败保留原恢复入口。全部成功不再重复常驻Transfer results。旧身份文件保存回调不得改新身份编辑器或通知。
- 删除Files底部Shared workspace宿主路径说明；WebDAV移至More file actions的分隔次级命令，当前Workspace面包屑不变。
- Packages使用独立图标/文字/动作列，状态文字与名称起点一致；Catalog动作成组，768px以下换行。Skills复选框缩进不变。Work/Service属性列表仅局部对齐，不改配置/Apply/unknown准入。
- Works已有确认列表（包括空集合）时刷新只在固定按钮busy；首次未确认才骨架，失败保留缓存与重试。Service/Chat首次未确认使用静态局部结构占位；Ready Service entry尚未发出请求的首帧也不显示错误空态。应用入口取得后直接在稳定viewport显示iframe，不叠加等待window.load的骨架；票据入口经检查归一到origin后也不得遮挡已显示内容；load仅触发既有嵌入检查，不代表业务就绪；已显示iframe及祖先继续保留。
- 仅assistant正文经安全GFM解析，用户文字、工具输出、source chip、鉴权图片管道保持原行为。原生HTML转义、链接只允许明确http/https/mailto导航且noopener/noreferrer、Markdown图片仅显示alt不自动联网。代码/表格局部滚动；历史与流式增量均走同一纯renderer。超64KiB、4096行或4096分隔符回退完整转义文字，不截断、不缓存跨身份内容。

最终截图进一步确认：open-work/retry-work-read普通pending不再与区域骨架重复显示状态条；首次未确认Session/模型使用中性Loading标签，不显示假空会话或Retry models，真实错误与未知设置恢复保持。

## 2026-10-14 首次骨架去文字

- 按最新反馈移除局部骨架可见加载文字；保留所属区域的 aria-label、status 和 busy。Works 以图标/名称/状态三列行占位，Services 以标题/正文块占位，Chat 以交错消息块占位；不替换真实工具栏或输入区。
- 初次 Session 未取得名称时，同一选择控件内用小型静态字段占位；模型初次读取且配置为 clean 时，同一设置控件内占位、移除主输入区重复正常 Loading 文案。已确认值、模型失败和 unknown 设置恢复原样保留。
- 仅通过 CSS 零时长、150ms 延迟的单次显现抑制快速读取的骨架闪现。没有 shimmer/pulse、JS timer、最短等待或内容延迟；正常/减少动态效果下均为静态形状，不恢复 Modal 动画。
- 缓存刷新、实际业务状态、发送禁用及iframe保留逻辑不变。不新增统一超时状态；既有ActionState/Files等十秒等待提示保持，Service iframe本身仍没有新增独立十秒提示，此边界不冒充已完成的全域慢请求处理。

- 冷开Work深链接：bootstrap在loadRoute前先读全局列表，原无对象分支曾误报Unavailable。复用routeLoad=0和既有错误/连接状态判断初次占位，不改变初始化请求顺序、身份或真实404；路由已读或真正失败仍提供恢复入口。

- initialize失败时，以启动捕获的epoch和hash核验归属；仅当前精确Work且routeLoad=0、无对象时写既有workReadErrors（missing=false）。借原toast同步render错误与Retry，toast结束不清持久恢复；拒绝旧身份/路由晚失败，不创建额外加载框架。
- ticket reopen与首启均使用相同异常出口；调用initialize后立即捕获epoch和已同步规范化的hash，允许正常去ticket但拒绝之后导航/身份变化的晚失败。

## 2026-10-14 Service 遮挡回归修复

- 确认根因：真实入口可由票据 bootstrap URL 转为 origin `/`，adapter 的预览检查会归一 entryUrl，而 DOM reconciliation 按 Work/Service/端口保留 iframe 原始 src。旧展示条件同时要求 navigationLoaded 与 src 等于最新 entryUrl，导致真实入口正常加载后骨架仍覆盖应用；此前夹具将两个 URL 设为相同，遗漏此路径。
- 移除 iframe 上方的骨架和 navigationLoaded 展示状态；保留 Services 列表及取得入口之前的首次轻量占位、真实失败及显式恢复入口。页面子资源未结束也不得挡住已可交互应用，不以超时隐藏或伪造业务成功处理。
- 契约回归覆盖票据 URL 归一、load 尚未触发、身份变化及断开 iframe 的迟到 load；不改 Core/API、安全边界、票据协议或稳定 iframe reconciliation。

验证：480 项纯回归全部通过；Desktop 构建/typecheck、25 个嵌入文件逐字节同步、正常 linux/amd64 CLI 构建及 `TestNativeDesktopEmbeddedBrowserAndLocalIdentity` 通过。OpenSpec strict、文档边界与 native boundary 通过。完整 test:browser 在环境浏览器启动矩阵失败后停止，未把其余矩阵或真实 Core、读屏宣称通过。宿主构建身份为 666329b + dirty，不回写成后续提交。

定向 Chrome 对照：旧冻结版本在票据 `/bootstrap-ticket` 已触发 load、navigationLoaded=true 时仍保留一层覆盖；另以悬挂图片复现正文已渲染而 window.load 未触发、骨架持续挡住应用。新冻结版本两条路径均无覆盖，悬挂资源时可输入草稿并操作计数；Chat 显隐保持 iframe instance、草稿及计数。前后截图与冻结 manifest 位于被忽略的 `dist/services-stall-qa/`，属于合成 HTTP fixture 与真实产品构建资源实证，不等同真实 Core 集成。


## 2026-10-14 冻结需求后的 Verify 与 Review 修复

- 独立应用路由缺少Work对象时保留路由中的Work、Service和端口，区分首次读取、真实404及不可读原因，提供原目标Retry、Back to Work及列表出口。启动元数据失败同样按原身份和精确路由写恢复状态；不创建业务成功、授权或iframe。
- 首次无有效区域记录时，仅在Work可用、Services/会话读取已确认且对话模型准入成功后，已确认无Ready且enabled的Web入口才选Chat；原Services/Files/Chat选择、较新的区域操作和独立窗口不受此默认规则覆盖。Chat说明Service为空、状态不可用或无声明Web入口，并保留管理出口。
- Sessions的New session位于当前Work列表之前。独立应用选择Service及控制完成后的Open Service在渲染前同步精确路由和捕获的声明端口；原端口选择、就绪准入与稳定iframe规则不变。
- 文件写请求非207的408/5xx与逐路径结果采用一致的unknown分类，不把可能已提交的DELETE/MOVE/COPY/PUT变成可直接重放的failed。403/409/412等明确拒绝仍保留失败及原恢复；unknown账本/路径锁只沿原只读核对释放。
- 完整browser/feedback/recovery测试按真实Service按钮、Popover和详情Web entry控件进入，保留原iframe、授权、锁及计数断言。真实Core脚本使用实际Work链接与原runId对应的message-execution；语法/编译成功不代表实际浏览器或真实Core验收通过。
- 本轮仅纠正当前delta的旧＋菜单、Files读取成功反馈与iframe导航占位措辞，按已确认More file actions、成功恢复原图标及不遮挡iframe的契约统一。没有删Scenario或降低任务完成门槛。

产品冻结输入为 `912fa289ce2f28016d451e2a448ef2c6ab80286c`；Desktop资源已按Node24构建同步，独立应用恢复32项、默认区域及导航77项、Sessions35项、独立Service路由31项、文件结果31项定向纯回归分别通过（集合重叠，不累加为总数）。最终完整矩阵、Go宿主构建、官方Chrome合成界面、真实Core与读屏验证以各自实际结果单独记账，未验条件不标完成。
