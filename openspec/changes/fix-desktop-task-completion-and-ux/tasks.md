# Tasks

本任务表保留原分层实现状态；`[x]`不代表所有浏览器、真实Core或辅助技术门槛已经通过。2026-10-13基于main `28bfdfa`的实际重验见[整合验收记录](evidence/acceptance.md)；旧候选结果单列在[历史验收记录](evidence/previous-candidate-acceptance.md)，不沿用为本轮通过。

2026-10-13后续完整界面范围已获确认，见proposal新增范围与design第9—14节。第12—16节为新增实施及验收，文档更新不代表这些任务完成；第1—11节原有33项完成、17项未测的状态保持，新增门槛单列。沿用NoDocker，不修改Core/API、依赖、安全边界、其他change或主规格；不自动推送、发布或归档。

## 1. Apply 前置与证据基线

- [x] 1.1 收到本提案交付之后新的明确 Apply 请求，再核对 HEAD、工作树和相关在途 delta；记录本轮 Core 逻辑/API 不改、NoDocker 及按功能提交边界。验证：验收记录列实际基线、授权范围和冲突处理，不覆盖用户改动、不改其他 change、不先归档。
- [ ] 1.2 在获准开发环境准备 Go 1.25.5、现有依赖和 Desktop 静态资产，按现有构建入口生成原生 CLI；确认 Playwright 能合法启动浏览器及原生测试夹具可用。验证：记录 go/node/浏览器版本、构建与最小启动结果；不绕过 socket 拒绝、不用纯 TS 代替原生入口，失败明确阻塞后续相应层。
- [x] 1.3 固定32项已通过的状态/边界基线、Desktop typecheck与测试编译结果；对全仓agentd声明缺失等已有失败单独记录并按既有构建依赖复核。验证：逐项记录命令/退出码，未执行的213项浏览器不计通过，不把基线问题扩为未授权后端修复。
- [x] 1.4 建立编号01–26与新规格场景、请求断言、证据等级的验收索引；收纳已有合成截图编号及新失败复现位置，明确20为风险脚注、03含停止续接。验证：每项可定位至少一个测试/人工门槛，深层目标目录候选不混入本次范围。

## 2. A批：精确导出对象与一次明确意图（03/04）

- [ ] 2.1 为停止态导出多段接力、已有旧包遮蔽新导出、两份snapshot乱序后按ID选错增加确定性失败测试。验证：基线可重现；记录每次Export、snapshot查询、download准备及content的精确ID和计数，不能只检查ready标签。（DWUI-009、DUL-009）
- [x] 2.2 在页面内导出流程模块及adapter/app间建立有界意图与阶段模型，分开view有效性、身份代次和原Work/Operation/snapshot/transfer；接入明确导出当前内容与下载旧快照两种入口。验证：模块测试覆盖新意图、双击、同对象冲突和无原ID的未知结果，无隐藏队列或自动重POST。（DWUI-009/010/012）
- [x] 2.3 让已确认stopped的导出动作连续生成、查询、准备校验并在同一进度面板交付；保留新导出入口，按ID查询/Operation查看严格选原snapshot，展示真实过期/大小信息。验证：多快照乱序及重开用例通过，没有必经View package/第二次Download，没有从本地顺序推断最新内容。（DWUI-009/013）
- [x] 2.4 接入一次Stop and export影响确认及原停止目标续接，复用既有生命周期准入；取消、失败、未知、仍stopping或Core拒绝时不提前Export。验证：取消0写入，正常Stop/Export各1次，实际stopped前0Export，旧Start/Stop晚结果不推进错误目标，必要停止说明仍完整。（DWUI-009/016、DUL-009）
- [x] 2.5 更新本批使用说明和验收记录，解释新导出与旧快照、必要停止确认、真实阶段和Download started边界。验证：文案与上述请求/截图一致；本组定向状态/浏览器测试、Desktop typecheck通过后才进入下一批实现，不声称真实Core已验。

## 3. A批：收起、恢复与单次浏览器交付（21）

- [ ] 3.1 扩展现有D19夹具，增加延迟POST期间Close/换Work、丢POST响应后Check、ready先于POST返回、重复GET/晚回包的失败复现。验证：实际监听browser download事件及content GET；旧测试只断言URL/ready不能替代该组证据。（DWUI-009/012/013）
- [x] 3.2 让原交付意图独立于modalChoice/hash持续推进，并在ready时原子消费单次自动交付标记；通知标明原Work，面板不重开。验证：所有上述交错仅1次自动content/下载事件、1次准备、1次Export，同身份导航不覆盖新对象。（DWUI-009/012/013）
- [x] 3.3 保留同transfer的Save file/Download again，分开自动尝试与显式再次下载；未知仅只读核对，过期/校验失败/空间不足给对应恢复。验证：浏览器拦截模拟有可达手动入口，手动再次下载使用原content且无新准备/快照，只有Download started而非已保存。（DWUI-009/013）
- [x] 3.4 覆盖Core/账号切换、注销、本地授权失效、pagehide/重载、暂停/恢复观察的交付边界；清理旧自动资格但不虚构远端取消。验证：旧身份晚ready零content且不泄漏内容；重登录/重载只查原ID并等待显式下载，Pause及其后的Check不推进POST/content；Resume先只读核对再按原授权继续未提交阶段，未知POST不重放。（DWUI-001/009/010/012/015）
- [ ] 3.5 在可运行Go环境执行现有CLI transfer/feedback/snapshot/storage/recovery契约测试，必要时补本次原ID及失效授权回归，不改Core业务逻辑/API。验证：ready前不发布未验证内容，长度/hash/格式错误被拒，原transfer绑定正确；更新本批关闭/手动回退文档和证据。接口不足则报告用户，不能擅自后端修复。

## 4. B批：保留可用工作区与就绪入口（01/02）

- [x] 4.1 在lifecycle与recovery测试中复现Ready后单次503/超时，以及Work一直Ready而所选Service Starting→Ready缺入口。验证：基线断言记录iframe文档/祖先连接和entry请求；使用合成权限/停止对照，不能只用usable布尔值替代浏览器后果。
- [x] 4.2 分离工作区展示保留与新动作准入，保持稳定iframe/Chat祖先，局部显示状态未确认及重查。验证：临时失败→恢复不重载文档、不丢测试应用输入/焦点/草稿；Stop accepted、stopped/deleted及可信401/403撤权仍正确限制，不以旧数据重授资格。（DWUI-002/016/019、BSA-005）
- [x] 4.3 对当前selected Work/Service/port的ready转换补去重入口准备，呈现真实pending/error/retry，丢弃其他对象/身份晚响应。验证：Starting→Ready一次entry准备且最终可用，重复状态不重POST；切端口/身份不误显示旧入口，没有无请求永久Opening。（DWUI-005、BSA-005）
- [x] 4.4 回归Focus/Focus chat/恢复、同Service origin、独立窗口和真实资格失效规则，更新工作区暂时错误说明。验证：本组定向浏览器与状态测试通过，已有iframe稳定/安全断言未删除，不承诺任意应用崩溃或真实网络故障的数据恢复。

## 5. B批：列表、草稿、新建与源码导航（05/07/08/24）

- [ ] 5.1 为返回Works/重新可见但无已知Operation时的外部增删状态增加失败测试，并接入一次去重列表刷新及Refresh Works。验证：真实GET更新、旧行与搜索保留、错误不变空集合，旧响应不能撤销新控制版本/接受目标，无额外业务POST。（DWUI-017）
- [ ] 5.2 把同身份所有Work/Session的未发送文本/图片纳入beforeunload保护，保留既有图片异步/受理快照规则及身份清理。验证：有实际用户激活时文本/图片触发原生离页确认，取消保留、干净草稿不提示；无Run/上传/持久存储；不支持或强制关页场景如实未保证。（DWUI-004、DWUI-IMAGE-001/002）
- [x] 5.3 区分New Work草稿revision与可靠受理后的下次新建，默认新草稿不继承名称/高级覆盖；拒绝/未知保留输入和锁。验证：A受理→New B默认值、未知关闭重开、旧A晚回包及新B编辑均有断言，创建按钮几何稳定，无重复创建。（DWUI-003、DWUI-CREATE-LAYOUT-001）
- [x] 5.4 统一Open brain source的精确文件导航，复用脏配置/文件guard，成功关闭详情并退出Settings。验证：原入口直达正确brain.md；取消guard留原页、失败局部可恢复、切Work/Core后晚文件不显示，零隐式Save/Apply。（DWUI-007、DUL-002）
- [ ] 5.5 更新列表刷新、聊天离页保护、新建默认及brain source使用说明，并记录本组测试。验证：文档明确页面内保护及浏览器限制、不承诺关页图片持久恢复；对应Desktop定向测试/typecheck通过，统一配置草稿和匿名Inspect旧测试保留。

## 6. B批：Service日志与文件结果就地恢复（25/26）

- [x] 6.1 为Service详情日志挂起/503及切服务晚返回添加失败测试，改为先显示身份/状态/合法控制、日志独立加载。验证：无日志仍可进入并使用符合准入的控制，日志Retry只GET日志，旧日志不覆盖新服务，Stop/Remove确认及对象锁保留。（DWUI-005）
- [x] 6.2 先复现单路径COPY403原因被弹窗遮挡，再在Files操作弹层渲染逐路径状态、原因和恢复；保留失败输入。验证：modal内可见准确路径/错误，无须Close才能读；关闭不撤销已成功修改，未知不盲目重发。（DWUI-006、DUL-015）
- [x] 6.3 新增真实格式的合成207混合成功/失败/未知场景，验证再确认只处理已明确选择的可重试项，未知先核对原目录/路径。验证：成功项请求计数不增加，未知项只读、不错误整体成功或回滚；该项首次执行前仍标未测，不能以单路径403截图代替。
- [x] 6.4 更新本组说明与测试证据，回归原条件覆盖、HEAD/PUT竞争、根/越界与文件能力局部降级。验证：相关browser/Go file契约在可用环境通过；日志失败不放宽Service权限，文件失败不自动转为无条件写入。

## 7. C批：区域恢复与操作完成出口（06/22/23）

- [ ] 7.1 为重进Work恢复Chat/Files及路径、失效目录、不同Work/身份隔离添加测试，并扩展页面内选择记忆与openWork/loadRoute。验证：首次默认Services、再次恢复有效区域，加载无先切Services闪跳，晚读取不覆盖新选择，dirty guard保持。（DWUI-002、DUL-002）
- [x] 7.2 将Start/Retry与Service控制进度保留在所属对象，原Operation为可查次级详情；真实能力确认后提供Open Work/Open Service。验证：从列表启动成功直接可打开，未确认/failed/superseded无假入口，普通Start不强制导航，POST一次。（DWUI-003/005/016、DUL-002）
- [ ] 7.3 调整Import成功出口为Imported · Not started，提供显式Start and open和仅查看/暂不启动。验证：完成Import、查看或关闭0Start；明确选择后一次Start、真实可用才打开，失败/未知保留原导入与启动ID、不二次Import。（DWUI-008、DUL-009）
- [x] 7.4 在文本编辑器增加Download saved version并复用现有文件下载路径。验证：有未保存草稿时实际下载服务端保存字节，0PUT，原草稿/光标保留，界面只确认下载发起。（DWUI-006、DUL-015）
- [ ] 7.5 更新本组导航/出口/保存版本说明及截图证据。验证：宽屏和360px入口可达、相关定向测试通过，导入图片/历史和现有Save/Apply边界回归无退化。

## 8. C批：键盘、命中区、布局和明确文案（10/12–18）

- [x] 8.1 先用真实Tab、computed style和截图复现Works搜索/Composer焦点，再定向修复至少2px可见焦点；修Pi Package Remove危险色级联。验证：常态/hover/focus/disabled与普通按钮区分，合并Response settings及菜单键盘行为不退回旧双选择器。（DUL-007）
- [ ] 8.2 固定Files选择工具栏空间，给复选框独立至少32px命中区，文件名仍只打开。验证：首次/末次选择前后同一行坐标差不超过1px，留白点击/Space正确切换，文件名不误选，宽屏/360px无溢出。（DWUI-019、DUL-007）
- [ ] 8.3 给New folder/Rename初始字段焦点与局部合法Enter提交，Rename预填原basename并正确选择主名/目录。验证：中文、点文件、多点、无扩展名和目录均正确；IME候选Enter/229/disabled零提交，普通Enter、双击及Enter后click总计最多一次，失败保留，危险确认不继承快捷提交。（DWUI-006、DUL-015）
- [x] 8.4 为明确白名单的非busy、无草稿轻量菜单/信息窗实现安全外部关闭。验证：pointerdown/up均外侧才关闭并回焦点；拖选/内容点击不关闭，Stop/Delete/Remove/Overwrite/dirty/Inspect/Import及未知恢复流程不被白名单关闭，原Esc/Tab保持。（DUL-007）
- [x] 8.5 Pi request查看退出改Close，真实Cancel request/run保持对象；Service Starting/Failed/Disabled/unknown按真实状态给说明。验证：Close零取消POST，Cancel仅原live对象一次，历史/无权限不开放修改；Starting截图10场景不再矛盾，Failed新测试独立记录。（DWUI-005、DUL-007）
- [ ] 8.6 在本变更验收记录补本组宽屏/360px、键盘、几何与颜色证据，并更新涉及用户动作的使用说明。验证：每项有实际截图或请求断言，原reduced-motion、焦点返回、图片草稿和必要风险确认未被删改。

## 9. 待验证观察与可访问性门槛（09/11/19/20）

- [x] 9.1 用确定性时钟/故障注入区分手动Pause、隐藏、退避与耗尽自动暂停、401/404/410，检查真实观察状态与按钮。验证：仅在复现不一致后按原DWUI-017修投影并加回归；恢复只查原ID，404/410不无限轮询，无mutation重放，未复现如实记录无新增修复。
- [ ] 9.2 验证快/慢/十秒等待下局部反馈、焦点、按钮几何和prefers-reduced-motion；若当前满足规则仅记录通过。验证：请求首帧反馈/动作锁不延迟、无虚假进度、减少动态效果生效；不为了打磨默认引入动效或全局loading。（DWUI-011/019、DUL-007）
- [ ] 9.3 在可用真实NVDA/VoiceOver环境检查持续聊天、状态更新、弹窗切换播报，依据实际重复/冗余现象决定是否缩小live区域。验证：记录浏览器/辅助技术版本、实际步骤及结果；DOM检查不代替读屏，没有环境则保留未测、不修改后假称验收；超出本案的设计变更另提。

## 10. 分层集成与交付核对

- [ ] 10.1 完成A/B/C各自定向测试后，运行Desktop typecheck、完整test:browser及必要Go CLI/assets/file/snapshot安全契约，包含原生browser.test/native-auth。验证：逐命令结果和跳过理由完整，不能以31项纯状态测试替代完整浏览器/原生桥接，现存失败与新增回归分开。
- [x] 10.2 通过现有Desktop build和Go宿主构建同步嵌入资源，执行源码/生成资源一致性、native boundary及git diff --check。验证：原生程序实际提供本次UI，生成副本不手改，无Core逻辑/API或项目依赖的无关改动；如发现接口不足暂停对应工作并向用户提交证据。
- [ ] 10.3 在后续明确授权且具备隔离Engine/匹配helper的环境执行真实Core停止→导出→完整校验→浏览器下载→Inspect→Import→用户显式Start链路，含文件内容/hash及权限撤销。验证：真实数据结果、原ID、请求次数和安全清理可核验。当前NoDocker阶段此项保持未完成，不自动安装/启动Docker，不以mock/native合成协议替代。
- [x] 10.4 汇总编号/规格场景覆盖及通过/失败/阻塞/未测证据，复查三个delta与在途变更兼容，并运行openspec validate fix-desktop-task-completion-and-ux --strict。验证：用户可区分前端修复完成和真实Core待验，所有已勾选项都有实际证据；未获授权不推送/发布/归档，必要的后续提交按功能、使用文档、规格归档分别组织。

## 11. 用户反馈：主流程与管理入口分层

- [x] 11.1 更新本变更proposal/design/spec，明确原45项28完成、17未测不变；按模块限定本轮层级调整与NoDocker边界。
- [x] 11.2 精简Export展示为非遮罩进度/结果，原入口直接执行，详情按需；验证一次提交/交付、背景动作与键盘可用、running停止确认及精确旧快照恢复。
- [x] 11.3 全局动作归Admin，Stop/Work information归Work更多菜单，Ready行优先Open；修头像外侧关闭/Escape/焦点，去重复Create CTA，保留空列表引导。
- [x] 11.4 删除Files空选择条、在现有工具栏承接批量动作；Service/Agent请求图标化且保持原过滤范围与可访问标签。
- [x] 11.5 执行定向生产函数与状态回归、typecheck/build/embed及官方云浏览器截图，记录实际通过/限制；不将合成GUI记为真实Core或完整浏览器通过。

本轮实现已覆盖第12—15节全部模块；385项纯状态/adapter/生产函数测试及定向官方GUI事实见[本轮验收](evidence/acceptance.md#2026-10-13-后续完整界面范围工作区层级与一致控件)。复选框采用完整任务门槛的保守口径：包含未执行的360px、完整状态/分页/键盘/缩放或全Modal矩阵的任务仍保留未完成，不表示其实现被省略。原第1—11节50项的33完成/17未测逐项不变。

## 12. 工作区对象层级、布局与真实高度

- [ ] 12.1 将全Work Pi Requests归Work辅助入口，Service快捷入口保持真实过滤与有记录条件；同一检查面板重组目标/结果、执行与证据，保留返回上下文。验证：全Work/Service范围、空/初次失败/保留旧回复、多Run及waiting/historical、分页返回/取消竞争/晚证据；不新增计数或Session过滤、不重载iframe；更新本变更使用与验收证据。（DUL-002、DWUI-004/005、BSA-005）
- [x] 12.2 将Run Details移至真实runId对应消息轮次/Activity或明确active执行状态，移除无上下文常驻入口。验证：同Run多段只一个入口、不同Run不串、缺runId不猜测、另一Session/Service占槽与当前失败并存；Run succeeded不当Request completed，Cancel/Stop and send原行为回归；记录实际证据。（DWUI-004）
- [ ] 12.3 分离普通Chat显隐与workspace/focus状态，页面内按身份/Work记忆比例与显隐，维持Restore layout/Exit focus语义。验证：普通折叠保留导航、展开/重进/Files聚焦返回及身份清理，文字图片草稿/阅读位置/选区/焦点保持，同iframe document/load计数与Session/Run提交计数不变；独立Service不增Chat。（DUL-002、DWUI-002、BSA-005）
- [ ] 12.4 增加可拖separator、最小宽度、重置与键盘操作，窄屏改单面板/覆盖层且保留原宽屏比例。验证：指针跨iframe、取消拖动/层清理、左右/Shift/Home/End/Escape、可访问比例、长内容、500px/360px往返、reduced-motion；比例按容器夹取，无全页横滚；补对应测试与证据。（DUL-002/007）
- [ ] 12.5 重组Service选择器的名称/状态/选中标记及管理出口；按最新反馈端口归详情、多入口仍可选择。验证：长名称、Ready/Starting/Stopped/Failed/Disabled、非Web/Removed、多端口、快速切换晚响应、键盘关闭/焦点恢复，不自动Start或变更Chat；记录证据。（DWUI-005）
- [ ] 12.6 以真实剩余高度替代工作区固定减数，移除底部约35px外壳余白，最多一条StatusLine。验证：常规/专注/独立窗口、Chat显隐、Degraded/错误提示出现消失、窗口宽高变化和浏览器缩放，底边贴合、输入/必要错误可达、内层滚动正确；不改iframe业务DOM，不用固定35px补偿；记录几何与截图。（DWUI-002、DUL-007、BSA-005）

## 13. Files与Settings减重

- [ ] 13.1 Files只保留一个Refresh，将等待/成功反馈放回原控件，去重复Status checked行和成功toast。验证：快/慢/十秒等待、成功未变、失败/未知、连续刷新、文件多选几何/焦点，错误与安全下一步仍可见、未知写入不重放；定向修改读反馈而不删除全局必要状态，更新证据。（DWUI-006/019）
- [ ] 13.2 Upload/New folder收进更多命令菜单，去重复刷新及无独立作用的Workspace options，保留WebDAV与空目录引导。验证：键盘/窄屏菜单、路径目标、上传覆盖、命名Enter/IME、菜单关闭焦点和批量动作稳定；能力不丢失，补测试与使用说明。（DUL-015、DWUI-006）
- [ ] 13.3 Settings左侧返回导航及正常配置轻状态，异常/待应用仍明确。验证：原Services/Files/Chat返回、dirty guard、一致/dirty/Not applied/Applying/failed/unknown、晚结果与后续编辑、配置刷新不改草稿，Save/Apply仍分离；补定向回归与截图。（DWUI-007）

## 14. Works主页与Admin身份

- [ ] 14.1 Refresh/Import/New改一致图标组并保持主次，tooltip/aria完整。验证：鼠标/键盘、focus/hover/disabled、500px/360px、刷新/导入/创建原动作及空列表文字引导，无新增重复入口；更新使用/验收记录。（DUL-007、DWUI-002）
- [ ] 14.2 Admin只显示一次账号身份，角色必要时有明确标签，Core信息保留。验证：同名/异名账号与角色、长内容、外侧/Escape/触发焦点、内部管理动作与确认不变，不因背景草稿阻止收起；补回归和截图。（DUL-007）

## 15. Modal控件、轻动效与短反馈

- [ ] 15.1 统一所有Modal footer直接动作的几何、图标间距和角色顺序，限定覆盖范围。验证：请求/包/创建/文件/导入/会话/Run/Service/Operation/Export/危险确认的computed尺寸、长标签、窄屏换行和键盘次序；primary/danger/disabled保留，menu rows/正文小按钮/头部关闭不被误改；保存覆盖矩阵与证据。（DUL-007、DWUI-019）
- [x] 15.2 去掉Stop影响范围中像Checkbox的装饰，保持清楚非交互说明。验证：Stop/Stop and export不新增勾选门槛、取消零提交/确认单次提交，Delete等真实确认checkbox仍可操作；记录事实与截图。（DWUI-003）
- [ ] 15.3 按2026-10-14最新要求移除所有Modal开关动画、退场快照和timer。验证：快速开关/开A关A开B、轮询刷新、导航/身份切换、reduced-motion与普通设置均即时关闭、焦点只回合法来源一次，无backdrop/inert残留或旧回调删新窗；Export仍非模态且交付不中断，原提交锁立即生效，补状态/浏览器回归。（DUL-007、DWUI-019）
- [x] 15.4 将本轮完成/警告反馈收敛为既有语义色、图标和短标签，合并重复说明。验证：必要停止/导出隐私影响、具体错误/未知/恢复动作未被隐藏，非颜色线索与aria可辨，短提示到期不释放锁/重放操作；真实读屏无法执行仍标未测，不以DOM断言代替。（DUL-007、DWUI-019）

## 16. 后续界面范围集成与交付

- [x] 16.1 各模块带本地回归后运行Desktop typecheck、适用完整测试与build/embed、原生边界和git diff --check。验证：对照最终源码记录逐命令通过/失败/未跑，保留原17项未测；全仓或真实Core门槛不被本轮定向合成通过替代，NoDocker不变。（DWUI-002/004/006/007/019）
- [x] 16.2 汇总11模块实际实现、场景证据与剩余限制，更新本change使用/验收并运行OpenSpec strict。验证：截图仅证明实际所见、任务仅按实际证据勾选，主规格/其他change不改、不归档；功能/测试/生成资源与文档按边界本地提交，未经明确授权不推送或发布。

## 17. 截图反馈的组件语义修正

- [x] 17.1 固定同一Chat显隐按钮和面板图标，正常Settings移除空Details，Input options与Move纠正语义；生产renderer测试及宽/500px实际操作。
- [ ] 17.2 Files更多命令菜单改锚定非模态菜单，验证外侧/Escape/Tab/方向键/快速切换、路径身份变化、Upload和New folder出口与原安全保护。
- [ ] 17.3 按最新要求完全移除Modal动画与退场层，验证快开关/重开/轮询/导航/身份/减少动态效果；无遗留遮罩、点击拦截或旧焦点覆盖。
- [x] 17.4 运行完整纯回归、typecheck/build/embed及官方云浏览器定向检查，按事实更新证据；原17项及其他完整矩阵未测保持，不同步主Spec或归档。

本轮17.1/17.4完成（388纯回归与官方Chrome1440/500px定向GUI）；17.2/17.3实现完成，因完整路径/身份/修改与关闭竞争矩阵未逐项运行保持未勾选。最新任务40/71；前述38/67为上一轮记录，原33/50与17未测不变。详见验收记录2026-10-14节。

## 18. 明确浮层职责与Service Header显隐

- [x] 18.1 校正命令Dropdown、Service/模型/简单设置Popover及Service管理Drawer；保留真正Modal与无动画，补生产分类/几何/键盘及上下文回归。
- [x] 18.2 Show/Hide Chat移到Service Header同一位置，窄屏保留可达出口，验证同iframe与草稿、无Work导航重复入口。
- [x] 18.3 执行最终纯回归/typecheck/build/宿主构建/embed与官方Chrome1440/500px定向验证，记录实际通过及未测，不替代历史完整矩阵。

- [x] 18.4 将Operations/Operation、Run、Package持续详情改非模态Inspector，回归原恢复身份/写锁/完成出口及配置dirty guard；保留真正独立Dialog例外。
- [x] 18.5 原文保存用户组件Spec并建立稳定采用入口，记录完整入口分类与实际验收；清单不当作全量合规承诺。

- [x] 18.6 完成有限实证修正：split握柄、Service/Chat失败与重试、Session缓存、Work导航Link、删除恢复说明、Upload review真假覆盖；运行生产handler/renderer与adapter回归，不引入业务能力。

本轮第18节6项完成，当前46/77；第1—17节40/71与全部历史未测项保持不变。403项纯回归、22资源一致性与官方Chrome1440/500px定向证据见最新验收；不等于全自动浏览器、真实Core或全量无障碍通过。

## 19. 读取状态与截图反馈（2026-10-14）

- [x] 19.1 将Files/Chat普通读取收敛至原位控件与首次静态占位，保留缓存内容、错误恢复、身份/路径/Session归属及unknown锁；验证空缓存、首次失败、背景读取、真正未确认Run与安全边界。
- [x] 19.2 修正Reset split图标、Files更多命令入口、Service技术端口层级与合法多入口，复用Piwork标志为Desktop favicon；验证真实renderer/handler和资源路由。
- [x] 19.3 执行回归、typecheck、build/embed/宿主及定向浏览器截图，记录冻结资产、实际通过与限制；代码/测试/嵌入和OpenSpec分别提交，历史未测矩阵不冒充完成。

本轮19.1—19.3按实际定向验证完成，当前49/80；前46/77及所有历史未测项不变。414纯回归、最终v4b定向Chrome与明确未通过/未测边界见验收记录。

## 20. 连续截图反馈与Chat Markdown（2026-10-14）

- [x] 20.1 补齐Agent/文件对象菜单图标，覆盖五类菜单及layout/fullscreen条件分支，保留命令和文字。
- [x] 20.2 Files全成功使用3秒Toast并去除重复成功结果区，保留失败/混合/unknown/回读失败与锁，阻断旧身份晚保存通知。
- [x] 20.3 移除Files常驻宿主路径行，将WebDAV移到原更多菜单的分隔次级命令，保留当前路径与原访问流程。
- [x] 20.4 对齐Packages身份/状态/动作和Catalog分组，限定整理Work/Service属性行，覆盖长内容与窄屏。
- [x] 20.5 Works确认缓存/空集合原位刷新，首次才骨架，失败保留列表/搜索和恢复入口。
- [x] 20.6 Open Work/Services/Chat首次局部骨架、Service entry首帧与iframe首次导航占位，已显示内容不重载，load不冒充业务就绪。
- [x] 20.7 复用固定marked依赖实现安全assistant Markdown历史/流式渲染，覆盖表格、代码、安全输入与预算回退，原user/tool/source/images保持。
- [x] 20.8 执行最终纯回归/typecheck/build/嵌入/宿主与定向浏览器检查，记录实际范围，按功能及OpenSpec分别交付，不将历史未测矩阵改为完成。

本轮20.1—20.8按定向实证完成，当前57/88；前49/80及所有历史未测项不变。475纯回归、25嵌入资源、目标宿主测试和最终Chrome代表图见验收记录，不代表完整test:browser、全CLI、真实Core或读屏通过。

## 21. 首次骨架细节（2026-10-14）

- [x] 21.1 首次区域骨架及未取得的Session/模型字段去可见加载文字，保留aria、真实失败/unknown/禁用边界；用CSS单次延迟显现避免快速读取闪烁，不延迟真实内容或新增定时状态。
- [x] 21.2 运行纯回归、typecheck/build/embed、宿主及宽/窄屏定向检查，按实际结果记录验证和未测边界，不恢复Modal动画或扩展Core/API。

本轮21.1—21.2完成，当前59/90；此前57/88与历史31项未完成保持。479纯回归、54独立定向、宿主与最终冷开GUI实证见验收记录，减少动态效果GUI、完整test:browser、真实Core和读屏未冒称验证。
