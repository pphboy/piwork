# Design

## Context

动机和三批范围见 `proposal.md`。提案基线为 `8b49c2cec1c6708a601d1809a97f81491525d81d`，整合基线为 `28bfdfa56b4c84b10ade9a63fedb7c2b75c04a90`，以下问题分析与证据账本保留提案时背景；A/B/C前端实现已按最新main整合，当前可执行验收与保留门槛单列，环境/工具门槛单列，真实Core仍未验。当前结果见[验收记录](evidence/acceptance.md)和 `tasks.md`。

当前主要问题模型是“领域任务、页面展示和观察请求共用同一种结束条件”：`app.ts` 的 `stay()` 绑定 hash/modalChoice，关闭导出面板会跳过 await 后的下载；`show(operation)` 把多个简单动作都落到技术详情；`projectWork().usable` 又把一次 statusError 当作整个工作区不可用。已有对象锁、幂等恢复和增量 iframe 保留机制仍有价值，修复应分离这些生命周期，而不是删掉保护。

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
- Files 取消空态选择条；选中数量与 Copy/Move/Delete/Clear 在原工具栏替换普通辅助动作，保留至少32px复选框命中和行高度。Service 与 Agent 请求使用已有 note 图标、aria-label/title；Service 仍仅可靠 hasRecords 时显示且过滤当前 Service，Agent 仍全 Work。

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
