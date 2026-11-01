# 实施证据（持续更新，不等同全量验收）

## 授权与基线（任务 1.1）

2026-11-01 用户新指令“先执行吧，完成这个Change，然后提供PR给我”授权实施及 PR。实施分支 `feat/standardize-webui-feedback-modules`；实施前 HEAD 为 `7c2325552a6db6e6777120c24135c16e458adcd5`，远端 main 由父任务 `git ls-remote` 核对相同。未归档 change 的已完成任务不等于已同步主 Spec。本批不修改其任务、主规格、归档或发布身份。

| 逐项冲突 / 事实来源 | 本批处理 / 核对 |
|---|---|
| `support-bilingual-webui` UIL-I18N-001–004 与旧英文限定 | 保留 `locale.ts` / shared i18n 单一所选语言；通知使用当前语言回调；业务用户文本不翻译。新 change 不恢复英文限定。双语实际浏览器仍待执行。 |
| 双语 UIL-010、Linux UIL-010 与 Work 内 Logo 旧限制 | 新 delta 只在原 Work 身份栏保留原 PNG，不增加第二层；Linux Core/CLI 原嵌入链不变。原 PNG SHA256 `bed999510609e8e24b96a4f4f0aaa7c3572384248fd2bc37cce943190abd95ab`。 |
| 双语 UIL-SETUP-001 / Linux 同 requirement 与管理入口 | Desktop Administration 仅全局账号；Quick setup 归 Admin 内部；Admin 直接 Workbench；保留权限和真实链接，不恢复独立 Console 产品入口。 |
| 双语 SUI-004/005 与普通 Alert | 保留原路由、表单未知、身份代次、草稿/Key 与有界首读；只改变反馈呈现，不能由关闭通知解锁。 |
| DUL-007 旧 64–72px 与 V12/V13 | 新 delta 明确 Desktop/Admin/Work 56px、Service39px；共享 token 为源，窄屏可按内容分行。视觉实测未执行。 |
| DUL-009 / DWUI-009 / DWUI-OPREC-001 的原 ID 可达与 progress-only | 进度模型仅同任务阶段/必要控制；同 Work 独立 export-recovery 保存技术 ID、旧包与显式按 ID 找回；ExportFlows 保持原协调。 |
| DWUI-OPREC-002/003 / SUI-006 与新通知 | 不新增全局任务中心；原无对象任务固定入口、修改确认与回读失败、package 稳定 key 恢复继续由原 owner 决定。 |
| `simplify-linux-delivery` 当前启动/统一 HTTP 与历史平台说明 | 本批不改 `internal/app/run.go` 默认值/三个参数或运行平台；只补负例。Go/TS 边界检查沿现有入口，不新增宿主 Node/Docker CLI 运行依赖。 |

实测：OpenSpec 1.13.2 `validate standardize-webui-feedback-modules --strict` 通过；`context/list/status/instructions apply` 返回 repo-local、spec-driven、ready（开始时0/31）。所有返回 contextFiles 已读取。未借此声称生产完成。

## 当前验证分层

- 共享通知直接 import：6/6；图标/三点直接 import：3/3。
- `work-chrome.ts` Node24直接源导入：6项 smoke断言通过，非类型检查。
- Desktop `app.ts`、`feedback-notices.ts`、`work-chrome.ts`、`action-state.ts` Node24内置类型剥离语法转换通过，非 TypeScript typecheck。
- 其余分工测试见本 change 的所属证据。锁文件依赖/Go/浏览器运行环境未齐时，不把内置转换称为正式构建。
- 真实 Docker Engine/Core/Agent/helper/浏览器下载链尚无执行条件；4.3、8.1、8.2 不得因此勾选。

## 责任模块批次（任务 2.1、3.1、4.1）

- 通知：shared `notices.js/.d.ts` 只接身份、对象、任务代次、事件 key、当前语言函数和具名恢复；`createNoticeHost` 单宿主使用 textContent，不持有业务 adapter/state。直接策略7/7，覆盖去重、错误/unknown不超时、同任务优先级、显式关闭无业务副作用、身份清理、精确读恢复。Desktop `feedback-notices.ts` 只投影 ActionRecord；读确认只收敛同逻辑读，不解除 mutation unknown。完整两端几何/键盘仍归2.2。
- Chrome：`work-chrome.ts` 的 workHeaderModel/serviceToolbarModel/menuCommands 是只读接口，无应用/adapter导入；明确 global-account/work-row/work-header/service、身份代次、目标与权限。source直接smoke及正式测试文件的Node预检5/5覆盖非活动行、过期身份/目标、权限、Service身份与输入不可变。App只装配事实；Service port修正从renderer移至数据到达owner。完整导航/iframe/焦点浏览器仍归3.2。
- 导出：`export-panel.ts` 纯展示/readmodel和 `export-panel-controls.ts` 具名manualsave port，不输入整个view/adapter；ExportFlows原协调保持。已删除app旧exportPanel/downloadProgressMarkup活动实现。原正则/VM面板单测由直接import取代；其余legacy单元未冒充已整体迁移。panel5/5、save9/9，以及既有flow/admission87/87、exportadapter/log46/46通过Node转换预检；不是tsc或浏览器。布局维护只需该接口、locale/pending/admission与直接tests，不读Files/Chat/Serve。几何与真实链继续由4.2/4.3验收，尚未完成。

## 实际交互预检：Requests（父任务 cloud CUA 回传）

2026-11-01 managed sites-preview 运行独立 `dist/ui-preflight`：真实Desktop源由Node24类型转换，合成HTTP API，无production构建或Core。父任务实际点击：Open Work→Requests，首读等待骨架→503无框原因/Retry且不误显Empty；Retry到rows后出现真实渲染行；已有行显式刷新期间保留，503后仍保留。Service iframe内输入 `keep this draft` 后开关Requests仍保留。

此预检发现并修复读取通知累积/恢复残留：reload最新fixture后503仅1条，Retry503仍1条，改fixture为rows再Retry后行可见且原错误通知消失。该收敛只适用于匹配的只读资源，未将unknown写锁变为已确认。之后进一步修改紧凑Chrome，需要再次复核，不能把这些请求流预检当V13视觉、完整浏览器套件、资源嵌入或真实Core通过。

## 实际交互预检：紧凑 Chrome 与 Administration（父任务 cloud CUA 回传）

2026-11-01 同一真实源转换/合成 HTTP 分层：1180px 下 Work Header 外框 56px（Y=0），Service Toolbar 与 Agent Header 均39px（Y=56），Work tabs 为纯文字；Work Header 菜单保留 Requests/Settings、无 Administration。Administration 独立 `/admin` 页面实际启动且顶栏 Workbench 直达入口存在；首次测得外框57px/内部56px的边框差异，已交所属 owner 修复，修复后需重测。尚未据此声称360px或完整视觉验收。

- Model Test：实际 `/admin/models` 填合成 id、example.invalid 地址及假 key→Test→结果 dialog→关闭，输入保持、Add model 可用；fixture 请求日志仅出现 model-tests POST（api/baseUrl/model/credential 字段），没有 models-save POST。不代表真实 provider 成功。
- Runtime unknown：配置未就绪，选择合成模型→Save 收到503一次后 Save 禁用；关闭 notice 仍禁用。Read current runtime 只发GET，无第二次PUT；读回与草稿不同后显示核对提示并允许手动 Save，输入保持。没有借通知关闭解除未知写锁。
- Runtime retained refresh：旧配置/readiness 在等待和读失败后保留，原区域出现无框 stale/Retry；同时发现同一读取失败产生3条通知，已交所属 owner 修复合并和读成功清理。发现不隐藏为“通过”。

## 触达模块依赖与行为基线（任务1.3）

最小接口、runtime/type依赖及消费者见已安装Skill的 `references/module-map.md`；这里记录行为而非把代码拆小当证据。

| 责任边界 | 必须保持的事实 / 协议例外 | 已执行与未执行 |
|---|---|---|
| Shared NoticeEvent/Store/host → Desktop/Administration 装配 | 展示不拥有请求/锁；身份、对象、任务代次隔离；dismiss不确认；成功读resolve只关闭精确读episode，后续同错误可再次提示；当前语言回调 | shared通知8、图标3、既有read-deadline4，共15/15直接测试；长文本/模态/键盘全矩阵未执行 |
| Desktop ActionState + Requests adapter + chrome只读模型 | 首读未确认不显示空；刷新保留；同Work+Service读合并Promise；身份清理旧finally不删除新请求；菜单scope与target/epoch；renderer不发请求 | 状态契约23文件342/342转换预检；chrome5/5、反馈6/6；Requests真实UI/合成HTTP首败/恢复/保留已交互验证；正式构建未执行 |
| ExportFlows/Port → ExportPanelInput/ExportFilePort | 原snapshot/transfer/work/epoch校验；暂停≠关闭、Check≠Resume；可靠原hash/长度与一次交付，不因重开面板新建任务；DTO无伪造百分比 | flow/admission87/87、adapter/log46/46、panel5/5、manualsave9/9转换预检；Docker/Core/helpers/真实下载导入链未执行 |
| ModelManagement → ModelPort | Test可选、不保存；确认修改与目录回读分离；旧回调不清新Key；unknown跨页面仍锁；默认facade仍依赖所属adapter.modelRequest/ConsoleError，不声称完全零adapter模块依赖 | 直接ModelManagement4/4及adapter合并15/15预检；真实UI/合成HTTP Test仅POST test无save已验证；真实provider未执行 |
| QuickSetup → QuickSetupPort + preparationIsReady | 五个具名操作；只有原有效首设意图可跳转；status/preparation/六组件和当前无读错同时满足；未知模型只按原公共身份0/1/2匹配恢复，不自动重写 | 旧源码切片用例首轮24通过14失败已记录，不能抹成通过；替换实际mountQuickSetup直接导入后29/29预检（后续新增见所属证据）；正式浏览器全矩阵未执行 |
| Go启动配置与生成链 | 三参数默认值不改，旧环境键不复活；protocol/history/UI生成源独立，输出非手工修补，失败生成不reset工作区 | 治理/负例直接测试及history生成已执行；Go工具链、wire/golden、正式UI资源生成/嵌入未执行，待授权环境 |

上述表建立准确基线与当前差距，不免除1.5/1.6/4.3/5.x/6.x/8.x各自完成条件。

Administration修复后父任务CUA复测：外框Header56px、内部55px加边框，与Desktop外框等高。Runtime Refresh503仅一条Retry/Close通知及原对象无框stale说明；再次Retry失败仍一条；清除fixture失败后Retry成功，原错误通知和stale说明均消失，配置内容全程保留。这是上述缺陷的真实UI/合成HTTP回归，不扩称Core或完整浏览器通过。

## 来源映射审查（任务1.2）

逐项核对 `desktop-state-coverage.md` 的D01–D23与 `administration-coverage.json`/`administration-evidence.md` 的S01–S12：保留真实来源名称及所有可观察状态，分别给出现行owner、入口、原对象恢复和具体测试入口；独立登录/退出/初始化壳、文件/配置等独立表单及standalone onboarding均单列，不继承原型遗漏。协议N/A明确注明Operation unknown为观察标签、无Package取消枚举、Runtime返回配置而非Operation、六组件就绪不等于完整ready等源码责任。映射完整性完成不意味着5.x/6.x/8.x所有行为已执行。

导出CUA补充（合成HTTP）：Stopped Work行→Export显示非模态aria-modal=false，无backdrop，隐私提醒和进度/Check/Pause，无技术IDs。Pause→Hide→fixture ready→从原Work重开仍Paused，日志始终仅一次原exports POST；Check只观察原任务，保留Paused/Resume，不自动下载。发现重开时accepted intent被当普通成功toast，已通过原owner成功投影标记修复，待重建复测；真实.work/Core链未执行。

08:53预检更新：ActionState/feedback-notices/work-chrome 25/25实际源转换测试通过（新增当前语言失败/确认、失效读丢弃不伪造checkedAt、不释放unknown、accepted进度由原owner呈现）；显式message直接测试2/2通过；shared15/15通过。首次本地化测试因旧断言直接把LocalizedMessage对象传assert.match及大小写断言失败2项，改为实际渲染String/current-language断言后通过，不掩盖首轮失败。Clipboard成功/拒绝均核对原identity+view，copy-local不在拒绝后另报成功。当前显式反馈只在通知边界保留本地化消息身份，业务/服务器raw值不被翻译。`make check-maintenance`、本批7个Desktop文件增量style、`git diff --check`均通过；仍不等于tsc/productionbuild。

额外导出CUA：Paused时切合成fixture为unknown，Check保持Paused；Resume继续原snapshot/download阶段。合成服务端503已受理且原transfer可读，既有读回恢复到400/2120已知字节进度；请求日志仅一次exports POST和一次snapshot-download POST，无重复写入。此项不是“始终不可确认unknown”分支，也不是有效包或真实Core链。

09:00响应式CUA：首次普通浏览器缩放到388 CSS px发现旧mobile `.list-controls` column/wrap叠加，96px Header把PW裁到负Y、连接溢出Header；已修为显式两行grid和nowrap工具行。父任务使用受支持原生浏览器缩放及窗口调整，实际测得 `innerWidth=360`（不是CSS假设宽度）：Header96px Y0，品牌/账号Y6高度40；Search Y58.75高21.5、连接Y57.5高24、Refresh/Import/New Y52.5高34，均在Header内；viewport/client/scroll宽均360，无横向溢出。未借此声称Admin/Work 360px通过。隐藏的无Work原任务入口也保留语义aria-label/count，仅窄屏文字收为图标，不删除入口。

09:00通知/状态预检：共享16/16（同精确owner真实状态转移可返回以前已见success，不重播静态/已关闭通知）；新文件ledger反馈5/5直接测试：原owner呈现累计unknown，retry自身持锁且不重复通知，readback失败不降低unknown优先级，关闭不改FileMutationResults/UnknownFileLocks。此前综合转换快照27测试文件373/373通过（日志 `dist/state-contract-smoke/integration-before-preferences.log`）；该快照不包含之后偏好/最终ledger全部更新，不能与最新源码全量通过画等号。

09:01实际360px Work CUA：Header96px所有控件在内，Service39px从Y96开始，document宽=innerWidth=360。合成长Work名省略，Services/Files/Chat纯文字可用；Service iframe可见；Show chat打开Agent pane并可Hide chat，无横向溢出。Work options打开后实际Escape关闭菜单并返回触发按钮焦点（aria-label=Work options）。工具某次body.press回报自身错误，但以原生Escape及最终DOM/焦点核实，未误记为产品失败。

偏好/会话原型外路径已补：`admission-feedback.ts`只读投影实际revision/state/feedback，prefs未知只由实际确认revision收敛，pending读不清unknown；prefs GET复用既有readWithDeadline覆盖响应体，新写/身份中止旧GET，mutation不添加超时重放。direct admission4/4 + preferences adapter4/4通过；原生UI偏好浏览器回归已写未运行。普通成功移到单宿主，原独立表单错误/unknown和原输入不丢；通知恢复不替换已打开的另一独立表单。

## Header视觉契约收口（任务2.4，真实浏览器/合成业务）

父任务最终360px复测Admin：outer精确96px（DPR1.5），client/scroll350因竖滚动条而小于innerWidth360，无横向溢出；展开Menu不丢直接Workbench。结合此前Desktop/Work360px均96、宽屏Desktop/Admin/Work外框56、Service与Agent Toolbar39及真实Y对齐，等高/两行窄屏契约已验证。首页Refresh/Import/New为带可访问名称的icon-only，Work行Open保持进入工作区图标+文字；未隐藏主要操作以伪造布局。共享56/96/39 tokens及原PW PNG未改。本项不替代2.2通知全矩阵、2.3所有busy槽测量或8.x正式构建/嵌入。

同轮修复并复测Administration动态菜单：选择简体中文后打开账号，角色/About/退出等标签及“语言 简体中文”均正确，真实账号/Core值未变；中英文切换现有读取通知也随语言变化。原stable-shell跳过dropdown子树导致缓存英文，已针对菜单打开/locale-change刷新，不重建业务表单。

360px Model Test unknown结果dialog：x16宽318、y20高466，内容scrollHeight551/client465内部滚动，document无横向溢出；Escape关闭后Add model仍可用，未发生配置写入。重复stage前缀已精确移除且保留恢复指导，新增中英文direct test后Administration56/56；完整浏览器套件仍未运行。

09:11最新综合转换快照：31个直接契约文件397/397通过，含Operation反馈11项与显式/ledger反馈5项；日志 `dist/state-contract-smoke/results-integrated.log`。首轮394通过/1模块失败为忽略目录层级与正式dist不同导致image fixture相对路径ENOENT；只修临时转换测试中的fixture路径后重跑全套397通过，未改生产源或把预检称正式构建。之后Chat接受/取消的owner-only展示标记另有直接反馈测试，不计入此快照。

Operation反馈只保留当前UI真正受理的原ID/work/kind/service/身份/代次，绝非全局任务中心或新业务Operation；模块无轮询/请求/锁修改。受理/运行不吐完成toast，终态须checked身份与kind匹配，terminalHint不作为证据；superseded不是绿色成功。记录原请求仍unknown时优先保留unknown，真实Operation observation unknown优先于关联回读失败，成功receipt不掩盖Work读回失败；同原owner可靠恢复替换错误，终态registry清理后仍由当前原request弱引用恢复关联回读通知。原有Work/Service/Settings/Import/Operation局部事实与恢复入口未新增卡片或被删除。

## 显式导航收口（任务3.2，最终同源真实UI/合成HTTP）

合并预检服务器分别装载实际Desktop/Administration/onboarding源及各自真实API形状，非“所有URL都回同一个index”。父任务360px中文：Work行菜单有原Operation history/info/settings/export/旧export/stop/delete/语言，无Admin和Requests；全局Account有管理及原About/logs/语言/signout。点击管理真正进入 `/admin` Console概览；顶栏直接工作台返回 `/` 真Desktop Works，中文持续有效。

最终重建09:12的Desktop：Open Work→Service iframe填写 `final preserve 草稿`→Work options→Requests→Escape→Work options→English，最终iframe输入保持原值、Service URL不变、路由保持 `#/work/work-1`，焦点回Work options。此为实际草稿/路由/可见Service连续性证据，不额外声称未直接测量的private DOM节点身份。

稀有模型认证错误的直接 `/admin` 链接已改为中英文“从Account菜单打开Administration”的原上下文指导，确保Work错误恢复没有偷偷另增全局Admin入口；本地CLI提示保持原连接Core边界。原Admin Overview进入Quick setup属于Admin内部恢复，不误删。相关旧浏览器菜单断言按真实新入口更新，整套Playwright未执行仍明示。

## 共享图标/等待槽与导出展示收口（任务2.3、4.2）

最终combined360真实DOM测量：Desktop首页Refresh按钮34×34，内SVG18×18；Export等待指示24×16、恰好3个i、aria-hidden=true。Requests Refresh在读取前/5秒pending/完成后均40×40且x299.333/y147.927不变；pending aria-busy=true/disabled=true，确认后移除busy并恢复可用。共享图标/三点直接3/3，原PNG SHA256仍`bed999510609e8e24b96a4f4f0aaa7c3572384248fd2bc37cce943190abd95ab`；两端pending无逻辑转发同源，旧Refresh路径已删除。此为共享语义及代表性槽实测，不冒充每个独立业务动作都已浏览器跑完。

导出360：英文非模态面板x16宽328高455.51/y34.49，中文宽328高440.21/y49.79；长说明内部适配，document宽=viewport360；aria-modal=false、Details仅进度/必要控制，无IDs/诊断，隐私提醒保留。Escape隐藏后焦点返回原Work2更多；语言切换重开仍同原任务，日志始终仅一次原exports POST。Details打开时点击背景Account成功切到真实账号菜单，不取消或重放导出。修复背景点击错误恢复旧drawer焦点导致aria-expanded=false后，最终复测Account expanded=true/菜单可见；Escape关闭、回Account且expanded=false。

结合之前宽屏Pause/Hide/重开仍Paused、Check不等于Resume、已知字节恢复等具体交互，展示4.2完成；旧snapshot/transfer/hash/长度、有效包下载和Docker/Core导入导出等业务真实链仍归未完成4.3。其他既有模态/非模态容器角色未为视觉统一而全局改写。

## 09:30–09:35 来源遗漏收敛与仍未通过项

新增功能内只读投影：Work列表/状态/Services、Settings配置/Packages/两份catalog、Service入口/临时清理，以及Files目录/预览；不由通知层发请求或改变未知写锁。读取失败episode只有实际成功读取的新timestamp/revision/不可变结果引用才能恢复，单纯loading结束或旧checked值不作确认。Settings首次配置503不再把占位默认config渲染成可保存空表单；清理/日志首次读取骨架和已有内容刷新保留已集成。

父任务真实360px/合成HTTP复测：首次configuration失败仅原上下文恢复入口、无默认空表单，恢复GET后真实配置内容出现；但发现原`settings`入口ActionRecord与资源投影重复通知，且恢复后旧入口错误仍内联/通知残留。此为未通过项，正在按同一逻辑配置读取归属修复，不计5.2完成。Files同类跨入口读恢复也正在核对，不能以新增helper测试代替此真实UI缺陷。

Chat反馈只登记本UI实际受理的原Work/Session/Run，保留受理时Work名称；异步executionError/failed/interrupted与观察失败区分，恢复只读原Run、不能重发prompt；现有其他对话框打开时提示先关闭，不覆盖独立表单。直接Chat6及实际adapter7项含旧身份/旧流最终GET回调隔离。09:35实际源转换综合快照33文件414/414通过（`dist/state-contract-smoke/results-latest.log`），未包含之后新加全部Files/read helper测试，不能视作全仓或正式typecheck。

Files PROPFIND采用已有readWithDeadline覆盖响应头与文本体（不改变文件内容下载流/写入）；epoch+目录代次+Work校验防旧响应污染及旧finally清除新loading。当前实际adapter直接4/4通过：头超时、体超时/晚解码、同路径新代次等待、跨身份晚响应。Files投影11项及资源投影独立套件另记所属证据，不与上述414重复相加。`make check-maintenance`、`check-ui-language`、`git diff --check`和合成预检源转换构建通过；npm/Go仍未获安装授权，Docker/Core、正式tsc/build/embed与完整Playwright仍未执行。

父任务补充通知模态共存：实际360px Requests503时仅一个notice-host并位于当前#modal顶层，长英文+中文通知x8/y64/宽344/高128.33，无横向溢出；关闭notice后dialog与原请求失败/Retry保留，未改变业务状态。Standalone onboarding读状态失败同样以原无框错误+单一持久通知呈现，恢复GET后表单返回且通知清除；未创建管理员/提交凭据。

09:39 配置缺陷修复后父任务同入口复测通过：first503只有原无框配置失败/刷新配置与1条通知，无可编辑空配置；连续刷新503仍1条；清除fixture故障再GET刷新后真实Skills/Packages/AGENTS/Advanced配置显示，通知0且旧入口503内联文本消失。原`settings`与`refresh-config`只读记录按同Work/来源精确移交，确认恢复后只退休该读取记录；未知修改锁未使用该清理。未做配置写入。此项关闭上文具体回归，不扩称5.2所有来源或正式浏览器套件已完成。

09:47 D02首次启动回归：父任务fresh root + Works503仅原Works无法加载/重试与1条通知；重复失败仍1条；GET成功后2行Works与0通知，无旧错误内联。修复使用来源catch登记的原错误对象/读取路径/identity provenance，由bootstrap让已有Works owner接管；不同文字相同的Error、旧identity、登录POST均不据此归属。实际adapter直接4/4验证这些正反例，不按文案去重或全局清未知。

直接预检扩为44个去重模块套件，624/624通过，排除源码切片/VM/静态regex与浏览器/Core测试；Chat Markdown明确复用原已嵌入marked，不称新依赖构建。随后About/D02快照632中630通过、2项失败为旧测试固定20/30微任务深度未到实际请求边界；改为等待下一真实事件循环且保留原predicate/身份隔离断言。审查同时撤掉不必要的全GET额外Promise链，把provenance限定在实际来源catch，避免无关transport时序变更；最终重跑另记，不能抹掉此中间失败。

D06精确条款复查补Service tail日志及Service/Run cleanup诊断GET的已有10秒响应头+JSON体读取预算，不作用于导出/下载流或写入。实际adapter6/6验证三类GET的头/体超时、保留旧内容/checkedAt和显式只读重试。此前未据仅代码/未跑浏览器用例提前勾5.1。

## D01–D06来源与有界初读检查（任务5.1，10:09重新打开）

最终09:50实际源去重47套件639/639、0skip（`dist/state-contract-smoke/results-final.log`），含Core/session admission、pending adapter、Works/Service continuity、lifecycle/control rules、原UI受理Operation与资源反馈；D06三个诊断GET头/体预算6项及Works实际来源4项、About5项在内。D01–D06具体所有者与直接测试入口在`desktop-state-coverage.md`对应行；首读未确认/确认空/失败、保留刷新、未知不重放和原任务恢复分别沿所属实际状态，不创造通用Operation。父任务真实UI/合成HTTP的Works首次失败/重复失败/恢复、Service iframe连续性及Requests过滤上下文补充装配验证。

上述来源接入与有界/恢复契约已有直接证据，但10:09复查发现非Works bootstrap错误仍走ad-hoc通知，尚无匹配的来源恢复证明，故撤回5.1完成标记；不吞并6.2独立登录全入口、5.3模型/消息浏览器分支或8.1完整Playwright/typecheck/build。D19/20最后异步导出反馈仍在收口，真实Docker/Core导入导出仍明确未执行。既有业务状态为Failed/Unknown的历史Work/Service保留原局部事实与恢复，不因成功读到旧状态而伪造新的任务通知或全局历史。

09:48–09:52追加实际CUA：About先有双方版本，再Core503刷新保留Desktop新结果与Core最后确认版本/时间，仅1条Core通知；切Local503刷新则Core恢复、仅Local通知；清故障后双方恢复且通知0，不制造空/零版本。Service首读503无假Empty/NoService，原Retry和1通知；重复失败仍1，实际GET恢复后Service picker/iframe/readiness显示且通知清除。均为真实当前UI/合成HTTP，不声称真实Core/CLI版本或Docker结果。


## 10:26 有限最终检查点（16/31，不代表 Change 已完成）

最终直接源转换预检51个去重套件 **676/676通过、0失败、0跳过**，日志 `dist/state-contract-smoke/results-checkpoint.log`，耗时32.17秒。该运行直接装载实际模块的Node类型擦除结果，不是tsc、正式打包、生产嵌入或真实Core；不与Administration112/112、共享16/16、治理65/65以及Export选集170/170机械累加。此前中间失败保留在上文，不被最终通过抹去。

5.1重新完成：父任务最终真实UI/合成HTTP三来源复核全部通过。status503首次启动有原Core未确认准入+一条通知，清故障原重新检查后Works返回且旧503/通知消失。深链Work的Works503只有原Work不可用+一条规范通知，Details进入既有Works失败/重试入口，确认GET后2行Works/通知0。零Works+known-operations503只有一条通知；关闭后既有header任务入口仍保留且无假count，打开显示原失败/Retry/查找原任务；原任务查找进入既有operations输入而不要求选中Work，清故障GET重试后确认空且错误清除，ledger全为GET。来源错误只按原错误对象、identity和路径归属；成功receipt仅来自匹配真实GET，畸形records不作空成功，无新增业务Operation/重放。

5.3完成：原unknown prompt POST一次，第一次原submission lookup pending保留草稿/锁且不重发，匹配原key accepted后原Run/assistant reply显示、草稿消费、旧502通知及内联错误消失；不是同Work所有unknown一起清除。Model+Thinking单组摘要、high自动成对PATCH、默认与第二模型各显式一次PATCH并保留high已由真实360px键盘及鼠标验证。模态内部scrollTop68可保持，第二项不再被footer遮挡，未放松context guards。Requests实际adapter6项包含同Work读取成功与503均不改变已确认Session/messages/terminal Run；其余history/draft/image/原Run隔离直接测试见覆盖表。完整Playwright与真实模型服务仍未执行，归8.x，不冒充完成。

最终Export/log具体回归：原导出read503→原Check确认pending后旧错误清除但仍显示准备中，exports POST仅1次；log503→原Check确认collecting1/2后旧错误清除且log POST仅1次。transfer503在operation退回running而未读原transfer时正确保留；只有实际原transfer GET确认400/2120后清除，始终1次exports POST与1次snapshot-download POST。均为真实UI/合成HTTP，不证明有效.work包或物理落盘。

### 剩余15项的阻塞与未完成边界

- **不是仅安装工具就自动完成**：2.2全两端通知/键盘/长文/模态矩阵仍保守未勾（已通过选中360px恢复与共存）；5.2 Files新选择/旧草稿、Save/Apply已确认后读回失败、Packages关联读取的完整装配验证；5.4 Import完成Stopped且仅显式Start等实际入口；6.1逐Administration页面装配、6.2完整登录/退出/unknown与独立表单、6.3未来Work作用域服务端证据、6.4同actor/source/key真实服务器幂等协议仍需完成。已有实现和直接测试不等于这些任务全验收。
- **工具链批准后可执行的明确检查**：1.5 Go配置负例；1.6 generate/wire/golden及UI输出；7.2正式类型检查结合边界审查；7.3 gofmt；7.4配置默认维护样例的实际Go检查；8.1正式typecheck/build/copy/embed与相关完整浏览器。Go和锁定npm依赖安装授权仍待用户答复；禁止将Node预检产物当生产嵌入。浏览器运行还须受支持环境，先前shell Chromium socket拒绝不会绕过。
- **需要真实Core/Docker环境**：4.3导入导出/helper真实链及8.2全高风险交付核验；仅安装Go/npm不能替代Docker Engine/socket、真实Core及所需测试镜像。上述6.3/6.4服务端证据也不能由前端fixture代替。

检查点停止扩展审计，无已知未修复的本轮具体P0/P1；这不声称未执行范围无缺陷。未提交、未push、未创建PR；AGENTS要求源码与生成资源同步，当前旧嵌入不能作为完成制品提交。原型、主规格和归档未改动，既定提交分组待正确构建产物与授权条件满足后执行。

10:27检查点复跑：`make check-maintenance`通过（依赖/文档/Quick Start/双语检查）；触达TS/JS/CSS增量source-style共107文件通过；OpenSpec strict通过；`git diff --check`通过。CLI apply进度16/31、剩余15，与tasks一致。最终新增bootstrap/Chat submission窄接口及直接测试已同步维护module-map。

## 10:30 继续执行既定验收，不扩大审计范围

父任务新增实际UI/合成HTTP：Settings未保存AGENTS.md草稿 `Synthetic unsaved draft1029草稿` 经Packages GET503及原GET恢复后内容/dirty状态不变，一条通知变0，无configuration PUT；空catalog夹具不证明非空已选package列表。native偏好首GET失败不伪造默认空值，原GET恢复自动选择；一次PUT合成Core URL返回unknown后Save/Reset禁用，关闭notice不解锁；原GET确认该URL后清unknown/error并恢复控件，当前连接仍为原synthetic-core.invalid，ledger仅一次PUT。不因此勾5.2/5.4/6.2全部完成。

同批6.2首次观察：native登录unknown一次POST，后续会话GET进入Works但原登录unknown仍保留。10:32核对发现提交账号synthetic-test-account与fixture已认证用户Browser QA不同，故该GET不是原意图确认，不能据此认定未知保留是缺陷；保留身份/账号校验，父任务将按匹配账号重跑。源所有权重复展示另须具体证据，不作宽泛清除。676/676仍为已确认快照。

10:32匹配账号复测确认有限缺陷：使用Browser QA与相同Core后，原会话GET正确解析登录意图，Works返回且canonical notice=0；只有委托给sign-in-owner的旧ActionRecord内联文案残留。修复范围仅该已解析所有者的显示，不改变pendingSignIn、身份核验、未知锁或重放协议；不把之前不同账号case改为成功。

10:33 Administration补充通知验收：实际360px，新建用户合成请求被400拒绝（fixture通用MODEL_INVALID，不冒充真实用户字段校验）；中英文均仅一个notice-host且位于打开的dialog内，dialog宽318、document350≤inner360，英文长通知x8/y64/宽324/高149。Enter关闭通知后form、原错误和草稿保留；Escape关闭dialog且焦点回Create user。没有创建实际账号，列表仍原一行。此补齐选定模态/键盘/长文证据，不自动完成完整2.2矩阵。

10:34登录最小补丁后Desktop51去重直接套件677/677、0fail/skip（`dist/state-contract-smoke/results-signin-inline.log`，31.97秒）；新增只读visibility直接断言仅在原sign-in-owner且adapter unknown=false时隐藏陈旧内联，unknown=true/不同账号、其他action/projection保持，冻结record未修改。没有修改adapter、凭据重放、锁或通用错误映射；浏览器匹配账号复测仍待回报。

Administration五页GET装配补证（实际360px英文、合成HTTP）：Users保留Browser QA一行，Default Work保留Synthetic starting instructions，Skills保留synthetic-skill，Packages保留已确认空（不证明非空选择），About保留synthetic-preflight版本。分别正常首读→对应path503→Refresh两次始终一条notice+原stale提示；清故障Retry后通知/提示清除且数据保留。五项没有写请求，之前两个拒绝的用户POST为独立fixture场景。未据只读装配声明相关写入/晚回调全覆盖或6.1完成。

10:34–10:35匹配登录修复CUA通过：重载最新源，以Browser QA+原Core提交一次unknown登录，原Retry GET确认匹配会话后2行Works、notice0且旧inline unknown消失。ledger三次login POST分别对应三个明确测试意图（不同账号负例、修复前匹配、修复后匹配），最新意图时间1793529289793仅一次POST，没有重复发送。不同账号负例继续保持未知，不能合并为成功证据；全程合成凭据/服务，不操作真实账户。

10:36 Administration已知失败文案精确修复：原ActionState.fail对所有失败沿用Not confirmed；现已知写入拒绝显示Failed/失败，读取失败显示Read failed/读取失败，实际RESULT_UNKNOWN/INVALID_RESPONSE/ACCEPTANCE_UNKNOWN写入保持Not confirmed/尚未确认。错误code/message映射及原blocked逻辑不变（Package外部intent锁和identity独立所有者不另造锁）。七组中英文直接测试覆盖这些类别及无关unknown锁不变，总119/119、0skip；运行 `PIWORK_CONSOLE_MODULE_DIR=/tmp/piwork-console-phase-check npm run test:unit -w @piwork/console-webui`，模块目录为真实源Node转换，不是正式build。Fixture通用modelRef字段错误的模型文案未改成伪造用户校验。

最终新增改动后maintenance、增量六文件source-style、OpenSpec strict、diff检查通过。Desktop677/677与Administration119/119为最新分列结果；任务仍16/31，15项剩余边界不因选定浏览器补证自动抹去。等待本次Admin文案真实UI复测后收口；安装Go/锁定npm依赖仍待授权，真实Docker/Core及正式嵌入未执行，无提交/push。

10:36 Administration最后文案CUA通过：合成400拒绝后关闭dialog并刷新，原记录显示`Create user · synthetic-failed-label · Failed`；切中文同记录显示`失败`而非`尚未确认`，model-invalid fixture细节保持不变，没有创建账户。当前可运行的有限补证已收口；677/119直接测试检查点有效，31任务仍明确未全部完成。后续等工具链安装授权/真实运行环境决定，不把等待误记为完成。

10:37父任务最终截图补充具体2.2残留：已知失败phase修复已通过，但关闭Create user dialog后普通ActionRecord黄字仍插在Users标题前，与floating notice重复；切中文时target中的Create user标题缓存英文。该两项属既定展示/双语要求且不依赖工具安装，故继续最小owner展示修复与直接回归，不以“有限检查点”掩盖已知问题。保留唯一unknown/关联回读恢复事实，不用全局隐藏错误或清锁解决。

10:43原Create user展示修复已集成：保留ActionRecord，只有具备真实原上下文恢复的detached已知失败省略页面标题前重复行；unknown、关联读回失败及其他未实现恢复的owner不被全局隐藏。Details调用既有Create user表单，只复制原account/role与原错误，密码始终空，不保存FormData、不自动POST；fresh Create user不继承原失败，另一个已开新dialog不会被覆盖。恢复按原record/current identity/view验证，旧notice不能指向新对象。targetText保留原用户账号原文并懒翻译原动作标题，不翻译用户输入。

新增功能内29行`user-recovery.ts`及直接测试覆盖安全字段、不同身份/页面/record、其他dialog与普通失败/unknown/readback策略；Admin总124/124、0fail/skip，日志`/tmp/piwork-console-recovery-check.log`。Desktop677/677未受修改。module-map已补窄接口/消费者/测试；maintenance、六文件source-style、strict与diff复跑通过。combined于10:42:53重建，等待父任务四项真实UI复测；不将此实现声明代替复测结果。

10:43四项最终CUA通过（真实当前源/合成HTTP）：known400合成用户后Escape+Refresh，main无重复inline、仅一条notice；Details打开原真实表单，account=synthetic-original-owner、role=User、原owned error，两密码长度0。Escape后正常Create打开空account/无旧error；填synthetic-new-draft后点旧notice Details不替换新form/草稿，仅聚焦Close。关闭后ZH→EN，notice动作标题与错误翻译而原account保持；mainHasError=false。始终原一次失败POST，恢复没有提交。此为Create user有限覆盖，不推称其他未实现owner、全2.2或整个Change完成。

## 12:39 安装获批后的正式构建与检查（取代此前工具未授权阻点）

用户12:28:54“安装请求不要我确认啊，快点执行”、12:29:03“你做任何事情我都同意”后执行已请求的隔离安装：锁文件`npm ci`339 packages，package-lock/go.mod/go.sum未改；官方Go1.25.5 linux/amd64归档SHA256 `9e9b755d63b36acf30c12a9a3fc379243714c1c6d3dd72861da637f336ebb35b`核对官方发布清单。固定protoc36.2 npm下载器5秒proxy timeout后，同官方asset用较长curl超时成功，核对官方GitHub asset digest `121f6c7afe1d4d0e3ea6aab9432038599250134cbf4474cb1167d2c7decd4278`；未替换版本/绕过权限。

- 全workspace正式`npm run typecheck`通过；harness-fixtures全build通过；两端官方tsc/copy-static/sync-assets完成。`check-generated ui`再次从源清理重建，嵌入输出字节一致。固定history/protobuf/HTTP完整生成链也字节一致；没有手改生成物。
- Desktop首次正式typecheck暴露Requests self-referencing pending的definite assignment错误；采用相邻已有`let pending!: Promise<void>`声明，不改调度/请求语义。测试tsc另发现导出fixture窄推断、目录可能undefined与test跨root导入；三测试文件改为实际built声明类型、正确可选字段/nullable contract及断言收窄。编译错误临时发射的12个src JS/map/declaration已精确清理，手写共享声明保留。
- 正式编译的51个Desktop直接套件677/677（0skip/fail）；Console默认dist unit124/124（不再设置临时模块目录）。完整scripts/shared165/165。旧Node转换预检仍为历史，不以此次正式结果抹去中间失败。
- 全workspace unit初次结果：contracts49/49、pi-package78/78、work-store8/8、pi-adapter19/22、agentd184/199。16个确定性SDK失败真实原因是默认credential dir `/home/agent/.pi/agent`不可建立；使用SDK支持的`PI_CODING_AGENT_DIR`指向忽略dist内0700隔离空目录后，仅这些失败的无socket测试重跑16/16通过，不读取用户凭据/不改依赖源码或断言。另2个agentd Unix-socket测试仍因listen EPERM阻塞，未重试绕过。分次恢复证据不是一次全套unit绿灯。
- 全Go标准unit的失败/通过详情见`evidence/governance.md`：Unix socket/netlink权限拒绝与CLI控制通道症状是实际环境阻点，不仅是Docker缺失。已发现并修复真正的setup嵌入入口404：Go handler仅加入三个实际纯模块的精确公开路径，保留私有模块404；webapp最终20顶层/26含子例全部通过（GET/HEAD/CSP/依赖遍历）。修复后Go宿主二进制重新build成功。
- 官方产物有限CUA12:35–36通过：实际Desktop→Account Administration→实际/admin→Workbench /；setup/login各自真实表单成功装载，未提交凭据。Admin原失败Details恢复account/error且密码空，无页面重复行。仅fixture hosting路径/mode适配，业务HTTP仍合成；不声称真实Core或全部Playwright。

1.5、1.6、7.2、7.3、7.4据实际Go配置/生成/typecheck/gofmt/负例和四维护样例正式检查完成，当前21/31；其他实际入口与真实Core未执行范围不因此完成。当前主要硬阻点为缺少Docker Engine/socket以及系统禁止Unix socket/netlink/本地Chromium；禁止把安装批准当作放宽这些权限。PR可以是明确未全验收的Draft，不是完成/可合并声明。

## 12:41 Draft PR交付检查点（23/31）

6.1按其逐owner直接契约要求完成，而不是把8.1的全部DOM矩阵误作前置：S01新增实际adapter.health聚合、true/false/unknown、两来源失败保留及跨身份晚结果四项，Console正式默认dist **128/128、0skip**；S02–S12对应直接所有者/窄port/实际ActionState/view-scope协议见Administration覆盖表，未以源码切片/VM代替。

6.3新增 `TestRuntimeHTTPSaveChangesFutureDefaultsNotPersistedWork`，真实HTTP建立模型和保存Runtime A/B，中间通过既有Store持久化Work/config/context；保存B后原完整Work/config、context文件字节/image及行数不变，未来默认modelRef/revision更新。新测试与相关Model/Runtime共6顶层/15含子例通过，gofmt通过。结合实际服务端Test无写入/失败不门控Save、客户端not-run/failed/success×Enable/Choose、Runtime未ready读回等证据完成该配置语义；明确不声称Docker运行中的容器实际行为。

已完成正式Go二进制build、所有workspace typecheck、两端官方资源重建及生成一致性、Desktop677、Console128、scripts/shared165；完整Go/全部workspace unit的环境失败及支持配置重跑保持如上分列，不能在PR写作“所有测试通过”。最终maintenance、114文件增量style、OpenSpec strict和diff检查通过。

剩余八项保持未勾：
- **2.2**：两端选定360px/键盘/长中英文/模态/恢复已验证，但未把所有未支持的普通ActionRecord owner都宣称展示策略全覆盖；Create user恢复是明确有限修复。
- **5.2**：Files部分/未知批次、dirty/new selection及Save/Apply已确认后关联回读失败的完整实际入口装配仍需支持的浏览器/HTTP场景；已有直接契约与Packages dirty draft CUA不能替代全部。
- **5.4**：Import真实完成Stopped且仅显式Start的实际包/入口链未执行；Export/log/About/偏好及零Work恢复的选中场景已分列。
- **6.2**：native Desktop匹配/不匹配登录、偏好、sessionloss与onboarding只读场景已有实际UI证据；独立非hosted Console登录/退出/unknown完整入口仍未执行。
- **6.4**：客户端原upload/key/source Resume和六项ready/有效首设意图已有直接证据；真实服务端同actor幂等及Package生效链仍缺可用运行环境。
- **4.3、8.2**：真实Docker/Core/helper导入导出、高风险全来源核验缺Engine/socket/匹配镜像，不以fixture、descriptor/字节单测假代。
- **8.1**：正式type/build/embed/CSP公有资源Go测试及选中官方产物CUA通过；完整现有浏览器集成与reduced-motion全矩阵未执行，本地Chromium权限拒绝不绕过。

PR为可审阅Draft，源码、直接测试和正式嵌入同步，不等于整个Change完成或可合并。无主spec同步、归档、release或deploy。当前正式产物之外的预检服务器/工具链/日志均留忽略workspace，不提交凭据、缓存或测试临时目录。

### 最终入库差异检查的冻结输入例外（12:42）

四组提交后对完整baseline→HEAD（包含此前未跟踪的授权规划）检查，`git diff --check`指出冻结V13 HTML原有两处尾随空白：374、783行。此前“diff检查通过”针对当时已跟踪实现差异，不包含未暂存的新冻结附件；不可扩写为完整PR无空白警告。该文件SHA256仍为`679968a781adba928cbc867e5466d590ebfb7db685d674d56fd43468cc653b76`，与冻结scope-manifest完全一致，故不为消除lint改写已批准输入。精确排除此一个冻结HTML后的完整baseline→HEAD检查通过，生产源码、测试和其他新增文档没有同类警告。PR保留此例外及完整任务未完成声明。

## PR #4后的6.2有限独立入口验收（14:30）

继续完成既定未完成项，不把Draft PR发布当作Change完成。单独的忽略目录`dist/console-native-acceptance`服务真实非hosted Console /login，88个资源与正式dist逐字节一致；不改变原combined fixture。九项实际loopback HTTP自检通过：明确区分accepted-unknown（先存合成会话再503）与unaccepted-unknown（不受理），GET恢复、不同账号、旧响应快照、注销、known401与rate-limit。ledger只保存method/bodyKeys/合成account及effect，不保存密码；这不是实际Core认证证据。

父任务官方产物/合成HTTP CUA已通过：session首次503原Retry恢复登录表单；availability503原Retry清原错误和notice；known401清密码。accepted-unknown关闭notice仍Sign in禁用，原GET确认匹配账号进入Overview且仅一次POST；不同账号GET保持原unknown锁，再匹配账号GET恢复。新发现明确缺陷：unaccepted-unknown一次POST后，GET确认signed-out已恢复人工Sign in/空密码并说明无已登录会话，但旧ActionRecord内联Not confirmed与旧unknown notice没有退休。正在仅修原登录展示回执；不同账号/读取失败不能当作恢复，也不清其他未知所有者。6.2仍未勾选，尚不宣称本批所有路径完成。

14:30第五项注销/草稿CUA通过：合成账号正常登录→Default Work编辑instructions为未保存草稿→Sign out出现明确Discard确认→Discard后/login；旧草稿文本/编辑器消失、密码长度0。ledger仅一次logout POST200（accepted-session-revoked）及session GET signed-out，无配置PATCH/PUT。该项为真实前端、合成HTTP的显式丢弃与身份清理，不证明实际账号/远程注销。

### 6.2 原登录回执与真实 session DTO（14:46，后续修复验收中）

实际定位范围为 Console `adapter.initialize` 的 session receipt 接纳、`checkConsoleLogin`/原 login submit/退出 catch，以及原 ActionState、NoticeStore。新增 feature-local `login-feedback` 只接收只读原 record、account、notice owner 与具名退休回调，不取得完整 adapter/view；身份、未知锁及 HTTP 仍归原 owner。原未知登录在显式 signed-out 或同账号已登录的真实 GET 后只退休原展示，不同账号及读失败不退休。Logout 的 RESULT_UNKNOWN/INVALID_RESPONSE 保留原本地化不确定错误，已知拒绝才沿用 SIGNOUT_FAILED，未改变注销协议或重放。

正式 Console typecheck/build/embed 后第一批135/135通过；父任务14:39–42官方资源/合成HTTP复核：未受理登录原GET确认signed-out后旧unknown行和notice均消失，密码空、人工Sign in恢复；未受理logout仍保留原会话，用户显式第二次已受理未知logout后GET确认撤销进入/login，旧logout notice清除，无自动第二POST。两次logout是两次独立用户动作，不是自动恢复写入。

随后真实adapter六个非法session响应（空对象、数组、非boolean authenticated、true但无user、无account、空id）在修复前均产生缺少预期INVALID_RESPONSE的RED；校验置于任何CSRF/session/identity/store修改前后全部GREEN，合法明确signed-out与无可选coreUrl的authenticated receipt仍接受。当前143/143直接测试包含原session各字段不变及原signed-out info的精确owner退休；不以schema负例声称真实Core集成。父任务又发现429后人工同账号登录成功仍留原429 notice，正在沿同一原登录owner补退休与直接回归，尚未将143结果扩写为最终通过。

14:43官方资源/合成HTTP的429时序已通过：两秒倒数禁用Sign in、密码清空，到期仅开放人工提交，无自动POST；手动再次提交进入Overview。其旧429 notice残留为本批待复核缺陷。另原“No signed-in session”说明在新成功会话存续108秒仍可见，也按精确原info owner修复，不允许通用notice reset。仍保持6.2未勾，等待最终两条有限UI复核与完整来源对照。

14:48最终有限复核通过：正式Console144/144（0fail/skip），typecheck/build/embed通过；`check-generated ui`再次正式重建两端并核对字节一致，Go `internal/webapp`/`consoleassets`通过，maintenance、五个修改源/测试的style、OpenSpec strict及当前diff检查通过。父任务CUA使用最终正式资源：unacceptedunknown→原GET signed-out清旧unknown；随后同账号人工成功进入Overview，notice为0、无旧signed-out info。429显示两秒禁用/清密码，到期仅人工再次提交成功后notice为0、无旧RATE_LIMITED。HTTP ledger精确四次login POST对应两组各两次明确用户提交（503→200、429→200），其余恢复均GET，没有自动重发。

本批只关闭真实发现的原登录/注销反馈缺陷，6.2仍未勾：独立onboarding创建管理员已知拒绝/未知受理与原GET恢复、onboarding人工登录未知及初始壳重试耗尽等实际入口证据仍未建立；已有控制平面/boot浏览器测试的编写不等于执行。Docker/Core/Unix socket/完整浏览器环境阻点保持原声明；未把合成身份视为真实账号或真实Core认证。下一批限于现有onboarding协议的正式资源夹具与实际UI验证，不开始5.2或新功能。


## 15:03 6.2独立首设有限验收完成（24/31）

父任务经管理预览运行原正式setup.html、onboarding.js及其真实依赖/CSP；只使用既有HTTP接口的合成fixture，不注入页面状态、计时器或storage。HTTP夹具自检10/10，资源沿正式dist复制。已知创建400未受理且两密码清空；创建accepted-unknown一次POST后读失败，关闭notice不解锁，原GET确认后导航`/admin/setup`（该目标明确仅合成占位，不宣称真实Admin集成）。未受理创建原GET确认未初始化，恢复人工Create且密码均空，不自动POST。

人工登录unknown后，不同account GET保持原锁与说明；恢复原account GET才导航`/destination`（仅导航事实）。waiting普通用户的真实/setup Sign out一次POST200后进入真实/login。初始state连续503恰好三次自动GET（ledger35/36/37），耗尽后保留所属失败及人工Read；清故障后原Read为GET38+session39，恢复创建表单。真实官方`/setup/browser/onboarding.js`持续503恰好三次asset GET（40/41/42），实际watchdog停止自动重载并提供Retry/return home；清asset故障后点击真实Reload表单，经原恢复303返回`/setup?case=boot`，URL完整保留并出现真实创建表单。全批精确五次明确用户write：已知拒绝创建3、已受理未知创建7、未知登录15、未受理创建23、注销32；所有恢复是GET。

6.2按其确切条款完成：以上独立首设/初始壳证据，结合前批native Console匹配/不匹配/未受理/429/注销真实UI、Admin会话失效清旧草稿与秘密、Desktop admission实际UI及直接契约，以及真实adapter身份epoch/response-body晚结果拒绝、view-scope晚草稿和共享read-deadline契约，覆盖登录/退出/未知、独立表单、准入、有界恢复、身份清理。完整storage拒绝、selective sessionStorage/BFCache和全Playwright矩阵仍属8.1未完成回归，不从未运行测试推断其通过，也不把整个旧浏览器套件追加为6.2隐含门槛。

明确保留2.2已观察残余：onboarding credential unknown与随后read failure同时产生两条相同通用浮动说明、同一Read current state动作，虽来源不同且原unknown表单/锁正确，来源辨识/重复展示仍待有限修复。不能因6.2功能通过声称全部通知策略完成。无真实账号/Core、无主spec同步或归档；剩余2.2、4.3、5.2、5.4、6.4、8.1、8.2未勾。

### 2.2首设来源辨识有限修复（15:11，浏览器复核待定）

对15:03明确观察到的两条相同说明，只修独立onboarding的来源投影：读取失败、原账号创建结果未知、原账号登录结果未知使用不同的惰性双语消息；原kind/account在发布时捕获标量，不从后来的credentialUnknown取值。read与credential的原owner/task/generation和恢复动作、未知锁、dismiss/resolve不变，不能因read成功但账号不同就合并消除原未知。新增窄`onboarding-feedback`只有locale依赖，四项直接测试覆盖同callback EN/ZH、原账号快照、实际NoticeStore独立生命周期及普通消息不误标；Console正式148/148、typecheck/build/embed通过。原controlplane浏览器用例新增来源不同断言，仅记录已编写/语法检查，未冒充执行。

集成检查先运行真实Go setup依赖遍历，RED明确为新`/setup/browser/onboarding-feedback.js`返回404。随后仅在既有精确公开allowlist增加此纯模块，同步GET/HEAD/CSP断言；不公开adapter/app或整个目录，不用合成fixture掩盖真实handler缺失。此处资源修复随实现和正式输出同批交付。全2.2其他owner、长文本/模态矩阵仍未因此完成。

### 5.2有限真实入口A–E验收进行中（15:18）

忽略combined fixture已改为两端正式dist逐文件复制，而非旧Node转换；Desktop196、Console87 browser文件当时逐字节一致，HTTP handler自检16个断言通过。后续源码修复另按正式build同步，不把旧fixture当新版本。fixture仅真实DAV/现有配置DTO合成响应，写入ledger记录bytes/目标/原版本头而非任意用户内容，不虚构进度或Core状态。

父任务实际UI A通过：预览GET503期间原dirty draft保留，原Retry成功恢复精确草稿及只读已保存比较、notice0；Keep editing保留，显式Discard后切换正确文件。迟到其他文件Refresh后选择note，新内容/路径正确，但旧目录读取的CONNECTION_CHANGED仍误投影浮动错误。修复仅在原refresh-files目录/预览读的成功及失败边界核对捕获identity/view/fileChoice/path，obsolete只丢弃仍当前的原read ActionRecord并按ViewChanged退出；当前真实连接错误仍保留，较新记录和其他unknown写锁不动。直接窄上下文+真实ActionState回归通过，正式51个原套件679/679、0skip/fail；不是模拟DOM的伪full-app RED，真实前测为父任务CUA。

B实际UI通过：三个目标DELETE分别204成功、403失败、502未知；关闭notice不解锁批量Delete；原Refresh只PROPFIND不重放DELETE，显式勾选已知失败项Retry只再次DELETE该项，原未知保留历史unknown、不假绿。D确认note.txt PUT204显示Saved，但实际客户端没有自动关联GET/PROPFIND，故早期夹具指南“自动回读”假设已纠正：本例只验证确认Save后显式Refresh失败，真实自动关联回读由配置E验证。D又发现单文件Save等待说明沿用了隐藏批量选择的三个路径，而实际PUT正确指向note.txt；正在只修Save动作metadata，不全局清batchselection。此批仍未结束、5.2未勾。

15:33后续有界修复：Save/dirty-save的原动作resource只取editorPath，其余动作沿旧fallback，未改PUT或清批量选择。另确认当前表格toolbar仍把已不存在的原三路径当3 selected，而原批次ledger/UnknownFileLocks已有独立恢复所有权；仅在当前Work/path目录已有成功checkedAt、非loading且无error时，表格selection与当前可见行相交，失败/未确认/预览不清选择，原结果与未知锁不变。增加三项直接回归后，原51个正式编译套件682/682、0skip/fail（相对677基线共五项）；相关正式build/embed完成，实际UI复核待父任务当前E结束。

C原生上传的当前证据明确未通过mixed HTTP分支：浏览器实际选取三个44-byte合成下载文件，三次HEAD到达fixture，但零upload PUT，UI三个无httpStatus unknown。实际adapter在XHR error/abort或send同步异常时保留unknown；真实fixture403/502必有PUT ledger与httpStatus，因此失败发生在fixture HTTP收到写入之前，不能归咎旧批量锁或假造403/502结果。浏览器产生上传批准回调，完成状态不能证明实际发出；在支持的浏览器审批/传输证据确认前，不重放、不假XHR、不以此宣称产品upload成功或缺陷。

E真实旧构建证明：选中的fixture Skill与@fixture/tools保持，Save一次配置PUT200后自动GET503，原保存已确认但readback失败；原显式GET恢复确认Not applied后，旧Save.refreshError仍以inline及notice残留。随后Apply一次POST202/原Operation GET成功但关联配置GET503，旧快照又显示Not applied并开放Apply；清故障原GET后实际Configuration in use/选择及Loaded事实正确，始终一PUT一Apply POST。修复沿真实所有者：`SettingsSaveReadback`只绑定实际成功Save的只读record、identity/Work/config确认版本；同Work新成功GET且无reading/error才允许ActionState自身退休原refresh字段，原result/unknown/其他记录不变，延迟回调再次核对当前receipt。只在原匹配资源读取notice已存在时不再重复发布Save关联读失败。Header优先表达当前配置读取未确认，保留旧事实而不推断applied；Apply按钮及实际入口均拒绝当前配置GET错误，显式Refresh仍可用，不改服务端协议/原Operation。

正式51直接套件最终685/685、0skip/fail（新增原Save恢复及错Work/身份/同receipt/loading/error/新记录/unknown反例、配置Apply读错准入），Console148/148；相关正式build/embed与fixture16断言通过，两端正式资源再次逐文件一致。真实修复后A/D/selection/E及首设来源文案CUA仍由父任务复核，当前不提前勾5.2或2.2。

15:40–41首设来源文案实际CUA通过：未知创建+读失败分别显示原synthetic-label-owner创建结果未知与当前状态读取失败；编辑可见account不改变原notice账号，切ZH两条来源/正文翻译而原账号不变。另用真实人工登录unknown及不同账号GET验证：read失败notice清除，原synthetic-label-login未知notice和锁保持、不自动POST。创建已初始化管理员的导航只作为原创建readback事实，未冒充人工登录账号不匹配证据。上述是正式资源/合成HTTP，不证明真实Core创建或认证。

15:47父任务实际中文发现Save旧代码以本地化result.message与英文`Confirmed`比较，成功中文“已确认”被错误标为refresh未确认；这是本批真实缺陷而非fixture文案。最小修复给frontend-only TransferResult增加结构化versionReadback（confirmed/unconfirmed），只在已确认Save后由有效PUT version或匹配已保存内容的GET/version产生；未确认version保持已确认写入与独立版本回读失败，未知write无此字段。app仅消费此事实，不再以语言字符串判断语义；不改变HTTP DTO、PUT路径、版本保护或未知锁。正式实际adapter EN/ZH各验204有效version与204后GET503，另验502未知不重放，新增五项后原51套件690/690、0skip/fail；正式build/embed通过。父任务此前已复核Save等待目标正确为/note.txt、过时其他文件读取不再发连接变化notice；最终中文成功路径待新资源复核。

## 15:54 5.2有限功能验收完成（25/31）

最终正式资源实际CUA：A过时其他文件读不再发布连接变化错误，新路径/内容正确；D隐含旧other.txt选择时，Save等待目标仍精确/note.txt。原部分删除三路径读取后，当前表格只保留实际存在的blocked.txt为1 selected，原三路径结果ledger及unknown行仍在。E保存PUT200后GET503显示“尚未确认”、一条canonical读取错误及原保存事实；匹配GET恢复清旧refresh错误，Not applied及普通合法Saved成功notice（没有错误notice）。Apply一次POST202/原Operation成功但GET503时，仍“尚未确认”且Apply实际禁用；新GET才显示Configuration in use、旧错误消失且无再次Apply。配置全过程精确一PUT、一Apply POST，所选Skill/Package保持。

15:53–54最终中文Save：真实24-byte“中文保存确认回归”一次PUT204，保留原ifUnmodifiedSince，已保存/合法成功notice、error notice为0，不再有“刷新未确认：已确认”；草稿正确，Save/Discard按已保存正常禁用。直接实际uploadReview投影另以冻结输入验证overwrite仅明确需同意失败、retry仅已知失败、unknown不进入重试、成功排除且原行不变；不执行旧regex/VM renderer冒充直接模块测试。最终原51正式套件691/691（0skip/fail），Console148/148。

5.2依其任务原文的D07–D12功能、局部/部分/未知写、旧草稿/新选择、确认结果后读回失败测试矩阵完成：以上实际入口加既有actual adapter原生File204/unknown准入、共享writeFile已知403/409/412与408/5xx未知分类、原路径/覆写同意/晚回调/未知锁直接契约共同支撑。**C真实浏览器native XHR成功/403/502与上传进度未通过，受待确认的浏览器文件上传批准阻挡，零PUT不能算其通过；不重试或假造XHR。**该明确浏览器集成缺口继续列入8.1，不把整个浏览器矩阵隐含追加为5.2门槛，也不宣称真实Core或所有上传浏览器场景已测。2.2尚有普通info重复与未恢复的已知失败独立dialog owner待有限验收；4.3/5.4/6.4/8.1/8.2原环境/集成缺口保留。

15:56提交前最终集成检查：全workspace typecheck通过；两端官方生成重建与内嵌字节一致；Go webapp/consoleassets通过（12.17秒）并重新build正式宿主入口；maintenance、17个修改源/测试的增量style/gofmt、文档归属、OpenSpec strict及当前diff均通过。Console当前官方dist148/148再次通过；Desktop精确51套件691/691日志保留。未执行或环境失败的完整Go/Unix socket/Chromium/Core/C native上传证据不被这些选择性绿灯覆盖。

## 16:23 夜间独立复核与合法CI准备（仍25/31）

用户要求本次修改完成后反复检查，不能把“无问题”承诺代替执行证据。独立只读复核固定11f9777快照发现三个已复现P2防腐检查假绿：clean committed PR的source-style默认只比较HEAD工作树、显式路径又以HEAD自身为基线；覆盖式protocol generator保留旧输出导致before/after相同；依赖scanner跳过template `${...}`执行代码中的literal import。旧选择性绿色结果不能证明这些漏检已覆盖。

先修第一项：source-style增加显式`--base <commit-ref>`，一次验证并解析为commit SHA，用同一base选择改动与逐文件旧内容；保留默认dirty工作流。真实临时Git两次提交负例证明cleanHEAD旧模式0文件、新模式捕获已提交新增/修改违规，旧未改违规不误报，显式路径、非法base及修复后通过均验证；6/6通过。对当前整个PR与7c2325基线实际运行，发现新FS52候选测试三处多语句行并仅修该处后，122个改动源码文件通过。后两项仍有已验证候选补丁，尚未应用/完整复核，继续记为已知待修。

五个新增FS52实际浏览器回归使用既有正式app/CSS、真实UI动作及受控HTTP route/ledger，覆盖过时文件读、中文Save、确认Save的GET恢复、Apply读错准入、部分结果与当前选择。没有regex/VM提取或隐藏app状态写入；中文用例等待真实PUT204完成和已保存/not-busy，不能把pending禁用当成功。官方测试tsc通过，尚未运行浏览器，不计入691直接套件或虚称新用例通过。

新增仅PR4/同仓公开分支运行的GitHub Actions验证配置，contents只读、checkout不持久化凭据、无秘密/上传制品/部署/镜像发布/合并；固定官方action提交，三个独立Linux runner分离unit/static、完整两端browser及真实Docker/Core链。使用显式PR base style检查，不再把clean checkout零文件当PR style证明。历史schema4测试镜像拟从20fb8334精确源码重建，SQL hash与冻结v4一致，再用既有bridge；仅称重建夹具，不冒认原历史digest。该合法隔离运行环境不是重试绕过本地socket/Chromium限制。workflow尚未触发；网络、磁盘、时长、可选旧Core/其他history/SELinux/真实模型等实际执行与skip须以runner日志逐项记录，不能预先宣布环境已解决或所有CI通过。

### 16:35 余下两项已复现检查漏检修复

Protocol检查按当前固定两proto、七个实际输出声明精确inventory，在原before/after之外拒绝遗漏及未变化的额外文件；不会删除额外文件。旧负例中假生成器主动rm旧文件的失真已改为真正覆盖式行为，并验证重复拒绝和原文件保留。全套实际pinned history/protocol/HTTP生成通过，238 Go DTO schemas、8128 TS oracle fixtures及其他输出字节一致。额外真实负例以独占创建的合成obsolete `.pb.go`运行实际protocol generator：检查确实exit1并指出多余文件，原合成bytes原样保留；只删除本次明确创建的合成文件后重新生成通过。没有删除或重置用户文件、没有将修正后的生成物静默归零。

依赖scanner现在只递归扫描template插值的执行表达式，忽略模板data，并保留原offset/行号。测试覆盖literal import/require、反向entry边、循环、嵌套template、字符串/注释/regexp以及静态无插值template target；真正非literal specifier仍是明确未解析限制。额外独立审查构造`if(ok) /}}/`发现第一候选仍会错把regexp括号当插值闭合，真实RED后用有界控制括号上下文区分regexp语句和除法，补正反例再GREEN；不是声称写了完整JavaScript parser。

最终scripts/shared174/174、0skip/fail；实际全PR显式base检查123个源码文件通过，maintenance/文档/strict/diff通过。新scanner直接消费者另比较118个TS/JS/MJS/CSS相对真实base，无新增误报；该只读检查不替代完整CLI/Go检查。此前三项P2假绿都有具体负例与修复，旧“全绿”不被回写为当时已覆盖。GitHub实际验证run41326705682已在先前CI提交头运行，不能把本地新guard结果冒称那个旧head已执行新逻辑；每个远程run继续按自身commit、日志与skip记录。

### 16:52 第二轮独立检查与真实CI首个绿色job

独立复核确认先前三项治理负例18/18已关闭，但追加合法表达式`const n = /foo/ / 2; import("./app.js");`仍能使scanner漏掉后续import：实际RED返回空数组。最小修复将已完成regexp标作值，而不是与除法符号混同；新增普通/插值表达式、regexp作除数与假import数据四个断言。相关language/boundary/style直接测试36/36、0skip/fail，实际依赖CLI与全PR显式base style127源码文件通过；仍不将有限lexer称作完整JS parser。

GitHub实际run41327583037（head feecb469）的unit/static job已通过：Go目标、678项Node测试（158 scripts +16 shared +148 Console +49/8/78/22/199保留workspace测试）、typecheck、正式build、generated检查及123文件PR-base style均由该job执行。此678不是Desktop全部浏览器或本地691直接套件的替代计数；同run浏览器/真实Core job当时尚未完成，旧run另有失败待日志诊断，不宣称整体CI绿色。

旧run暴露`TestLogExportDownloadConcurrencyLimit`时序假设：2MiB响应可已全部进入socket缓冲，客户端只读1KiB不能证明服务端仍持下载slot。本机原测试20次实际6次错误200；新测试只改测试文件，用真实HTTP与实际route在首个body Write设置确定性barrier，并保留ResponseController Unwrap。第一handler明确活跃时第二请求必须409；释放并等handler返回（不是sleep）后第三请求200且全长度，第一请求也完整200。修复20/20、race10/10、整个四项download family通过；不增加生产hook、不削弱并发准入、不将失败归咎于产品而无证据。

### 17:11 CI隔离长套件以取得实际失败日志

已发布后续run在a4f8960头unit/static通过45个Go package与683个Node测试（该头Console152），不把本地更新的155测试回填为那个run结果。原组合browser job运行约39分钟仍停在Desktop，Console未开始；组合runtime的真实Core步骤已失败，但后续全Go Engine integration持续运行，使完整job日志迟迟不能取得。失败仍是失败，不通过改skip或削减断言隐藏。

仅将既有同PR/同仓公开分支、contents只读、固定actions、无secrets/发布的workflow matrix分成unit-static35分钟、desktop-browser60、console-browser45、real-core130、integration-go150。原命令、fixture构建、历史源码hash/label检查、环境与runner逐项比较保持相同；两个runtime suite各自运行原fixture步骤，三个real-Core步骤与全Go integration不再互相阻挡日志。每PR/suite保持不取消运行中的任务，既有run不受手工取消；增加Desktop有限预算不是宣称其会通过。YAML结构、全部shell块bash语法及命令/权限等价检查通过；尚未触发新拆分run，不宣称其执行结果。

### 17:20 实际浏览器失败的诊断与选择器修复

原run41326705682组合browser job达到45分钟上限被取消，日志仅有598个pass/140个failure结果行，不能把部分计数当整套终态。默认Node spec reporter在整套结束前未输出详细栈；最后可见FS52-A失败后长时间无输出，具体挂起位置尚未证明。仅给原全文件test:browser增加TAP即时失败详情与120秒单测预算，同一tsc、全部test glob及concurrency=1保持，不删skip测试、不降低断言；旧失败继续记录。

新拆分run的真实Core日志已可定位：Desktop recoverOnNewPage等待已按获批Header移除的Works h1超时，实际页面已有Work Ready/Open Work；改为与同文件登录后已有检查一致的实际`.works-page`，后续精确workName、原ID与零POST只读恢复断言保持。Console真实Core7pass/1fail，ModelTest的全页Close与新增通知Close歧义；五处同流程动作精确限定原dialog footer（只限定dialog仍会包含移入的notice host），指定模型真实reply、API payload、保存与请求次数断言不变。语法/style通过，真实链尚待新提交重跑，不能写成修复后已全绿。相同真实Core job的log export已通过原same-key recovery/detail retry/两次明确download与零直接Core浏览器请求检查，单项通过不代替Desktop/Console链。

另从两条反馈测试发现确切测试自身错误：api helper只导入adapter，却试图访问app私有actions/view；改用原editor可编辑、retry/reread提示消失和已有notice/actionstatus/草稿/GET次数/零写入断言表达同一恢复约束，不为测试导出或注入app隐藏状态。正式测试tsc与语法/style通过，实际浏览器仍待执行；其余大量旧用例的共同根因要以TAP栈确认，不做全局选择器替换或恢复普通inline Alerts讨好旧测试。

action-hierarchy旧assembly直接Node复现60/62，两条分别缺少已新增的acceptedExportFlow协作者和已抽取confirmedDirectorySelection绑定，并非已证明产品失败。修复直接import实际file-results与ExportFeedbackRegistry，给既有assembly fixture补显式接收/返回同一flow的协作者spy与原identity注册，**不新增regex提取helper**；原Stop/new/reopen/count断言保持并检查原flow对象，文件选择补确认listing清缺失选择、pending listing保留。官方tsc及action-hierarchy62 +file-results18 +export-feedback15共95/95通过。该旧app装配仍使用原VM表面，不能声称整套已迁移为无VM；新增/已抽取模块继续由直接import测试负责。

17:21调度补充：旧无TAP/单测预算的Desktop job仍占同suite并发组，新的有界诊断可能排队约一小时。只为desktop-browser并发组增加一次固定`-bounded-tap-v1`世代后缀；其他suite组逐字不变，仍cancel-in-progress=false，不取消或隐藏旧run结果，不反复改世代刷并发，不改runner容量/收费设置。此后相同有界版本继续按同组排队；目的是取得当前实际失败栈，不是将测试改为绿灯。

### 17:30 有限旧装配用例修复与重新打开2.2

对未启动Chromium的六个剩余旧assembly文件实际直接执行，149项仅54pass/95fail，集中在缺失sharedIcon/确认目录选择/新feedback所有者/DOM closest等fixture协作者，不把这些直接称为95个产品bug。分别补实际共享、admission、work-chrome、file-results、read-feedback、settings-read-feedback模块import；app-local已存在装配边界仅用显式窄fixture协作者，未新增regex抽函数。导航保留原record/Operation身份及不同route/modal/identity晚响应约束并增加实际原receiptspy断言。不存在的/A.txt选择夹具改为确认listing确有该行，保留bulk-controls断言；Works状态夹具显式toolbar slot只验证原状态/控件委托，不冒称生产toolbar几何。废弃view.toast计时测试改直接NoticeStore控制clock验证3秒与替换旧计时器；file汇总测试改实际resultTone/actionNotice并保持unknown锁优先。官方编译与全部七个旧assembly文件合计211/211、0skip通过，旧VM表面仍明确保留，不称全部已去VM或浏览器已通过。

独立Console browser run实际226pass/25fail。逐项初步定位24项为旧brand/notification owner/模态按钮范围/pending源/读回时序断言需适配，保留文案、请求次数、草稿、未知锁及语言约束，不用.first或force隐藏歧义；其中一项有真实产品缺陷：窄屏notice截获dialog右上Close指针。父任务用正式155资源、实际455×772视口及合成accepted-unknown Create user重现：heading29.86–114.25、footer677.07–741.96、Close中心y67.86，notice63.99–171.79，elementFromPoint实际为notice-unknown；正常点击不能关闭，密码已清空且submit仍锁定。此前known400功能通过不能豁免此几何缺陷，任务2.2重新打开，当前25/31，待窄/宽屏原Close、footer及notice自身恢复/Close可操作再重新判断。

### 17:56 六场景诊断入口不替代全套

为在旧完整Desktop job结束前取得代表性TAP失败栈，现有同PR只读workflow追加desktop-smoke独立20分钟job，仅从两个既有正式编译test文件选择原已失败六例：登录/退出、窄Create几何、D19一次原交付、Chat unknown原key、文件预览读恢复、FS52-A过时文件回调。逐个源码名称唯一、精确锚定，仍120秒单测预算；同官方build/Chromium/pinned actions/无secret配置。原全部71文件Desktop命令、其他jobs及并发组逐字比较未改，不取消旧run、无新增断言豁免。此子集的过滤/通过只用于诊断，绝不作为8.1全浏览器通过。YAML/bash/六个唯一源名称与原steps/安全配置相同检查通过，尚未执行该job。

### 18:09 实际完整Console通过与Desktop剩余失败

2427f074头实际完整Console浏览器251/251通过；对应真实Core Console8/8及log export链通过，后续efb0264真实Core亦重复这两项通过。Desktop真实Core仍在Send message处被全局notice截获；日志显示501 DESKTOP_ROUTE_UNAVAILABLE，但当时没有请求路径，不能仅凭文案断定来源。efb0264的六例诊断实际0pass/6fail、0skip：四项真实notice指针截获，文件预览预期一个error实际两个，过时文件读取预期零error实际一个。原断言保留，尚非全套浏览器通过。

父任务另以正式资源、1190×849实际视口及原文件GET503证明独立几何缺陷：Send中心(1144,751)实际命中notice-error，通知y746–833，而Send y734–768；只填本地草稿，没有Send。该事实不依赖501或测试默认夹具，因此2.2再次打开为25/31，既有modal几何通过不能代替全局保护。拟仅共享DOM展示边界保护可见原控件、modal优先，不改业务状态/身份/通知内容或用force click绕过。

CLI控制路由有独立可执行RED：实际adapter调用的两个既有cleanup GET，在nativeDesktop.ServeHTTP分别返回501（service路径）及400（runId过滤）且未到Core。仅补严格Work/service/run标识与query校验的这两个GET转发；不增加写入或通用proxy。测试验证原用户token只用于转发、不泄露，缺本机会话/异源拒绝、Core403原样保留及12项非法query/path/method不转发；既有Core owner-after-deletion/其他用户与管理员拒绝测试继续通过。此源级修复尚不能回填未记录路径的真实Core501归因；真实浏览器增加仅method/pathname/status>=400诊断，不记录query/body/header/token。

原首轮全Go integration终态含17项失败。只读基线diff确认相关Core/Engine/Agent运行实现与这些测试未由本次UI提交改写，但没有执行同环境baseline，因此不称“基线已失败”。七项有当前契约/实现与旧断言漂移证据（schema、持续Session、Service内存、busy码），一项缺真正旧镜像，三项仅疑似readiness时序，六项原因未定，均保留失败事实，不盲改期待或重写无关后端。该旧4e1e24d run中两个精确Package HTTP/actor-scope测试有实际PASS行（30.61秒、39.72秒）；新增独立package-protocol job按当前头重跑原两例、原镜像/权限与15分钟Go预算，逐个PASS行检查避免零例/skip假绿。完整Go job仍保留，子集不替代整套。

18:13选择性核验：共享23/23（其中notices16）、Console155/155、Desktop既有51直接套件691/691通过；两端官方build/内嵌shared字节一致，新增CLI正式build成功，Go webapp通过13.02秒（consoleassets无测试文件），边界/style/docs/diff通过。几何当前仅保护可见composer且modal优先，尚待实际浏览器确认，不称全部全局/非模态/模态正文动作均已避让。feedback浏览器夹具确实遗漏健康GET preferences，补一条`{coreUrl:null}`默认响应，显式handler仍先执行，PUT与专用失败不被掩盖，原错误数量断言不变。browser.test.ts则使用真实CLI偏好端点，不是相同遗漏，未盲加无效mock；既有离线偏好Go测试通过。

18:17旧完整TAP进一步显示FS52-ZH达到120秒预算；当前测试在无body的204响应上等待`response.finished()`，后续真正“已保存”、not-busy、零error与单次PUT断言尚未到达。测试改为等待实际204 receipt并保留全部后续业务确认断言，不把pending禁用当完成；官方tsc/style通过，浏览器重跑仍待CI。另实际455px窄屏全局notice y63.99–150.78截获Chat导航（按钮y55.45、高40），正常指针失败；键盘进入只用于分离composer检查，不冒称指针通过。共享边界继续仅按真实页Header/Toolbar与composer DOM计算可用区，不以固定96px掩盖问题。

### 18:20 Package/首设协议分层验收（6.4完成，2.2仍打开）

新5406dfc头独立package-protocol实际两个精确测试通过：`TestCorePackageHTTPPublishesAndReplaysFrozenContent` 36.42秒、`TestNativeAdministratorPackageScopeAndAcceptedJobSurviveRevocation` 34.93秒。原测试证明真实Core/Engine的同source/key原冻结内容重放、不同actor不复用、接受后撤权不撤销原job及权限拒绝；不是mock推断。与已执行Console251/251中相同未变Package/Quick setup owner的原key Resume、无假Cancel/百分比、真实ready/preparation六组件与有效首设意图准入，以及直接模块负例合并，满足6.4的分层协议验收。明确不是一次串起浏览器与Core的单一E2E，且全Go17项旧run失败仍记录；4.3/5.4真实Desktop导入导出链未因此完成。当前任务26/31（2.2仍待其余已知几何验证）。

同5406真实Desktop路径日志显示原cleanup GET现在到达Core并返回404，不再是Desktop路由501；该缺失对象的真实读错误继续显示，不通过吞404让测试绿。Send现被原已知名称冲突409等notice阻挡，仍由展示几何修复负责。Console真实Core8/8与log export链再次通过。

18:20新unit run暴露packageprepare清理测试失败；本地原测试50次及GOMAXPROCS8下1000次均通过，不能声称复现原调度。源级夹具却与“只让prepare清理失败”注释矛盾：global failCleanup会同时让并发measure清理失败，使监控错误合法成为主返回。仅测试夹具改为action-scoped fault，保留原primary与ErrCleanup双重断言，并加强只剩prepare live/planned及资源保留。新增确定性测试验证init/measure清理正常、prepare清理失败；忽略目录overlay恢复旧global行为立即RED指向measure，不需sleep。修复后两例×1000、完整package七项、完整package race×10通过。没有改Prepare生产错误优先级或清理准入。

18:22补充仅测试侧的源证据修正：recovery/final-acceptance与feedback一样确实由本地路由模拟Desktop并遗漏默认偏好GET，各补健康默认，显式失败handler优先不变；native browser与静态pending-dots不是该夹具，不乱加mock。真实CLI Service用例原精确`File saved.`已不属于当前Save owner，改为实际editor Saved、Save disabled、原草稿、服务端收到的完整bytes及恰好一次PUT，后续iframe连续性断言不变。两处图片夹具旧相对cwd路径在npm workspace实际ENOENT，改沿邻近既有compiled-module URL；本机从workspace cwd执行旧路径负例和新路径PNG签名正例通过，正式tsc/style通过。以上仍待真实浏览器重跑，不把修测试等同产品验收。

### 18:38 首次读取与通知控制区的后续实际复核

Console实际455px Menu触发按钮已由页Header避让修复，但展开导航超出topbar固有高度，User access链接仍被notice覆盖；不能只测trigger就称菜单可用。仅按既有实际瞬时菜单建立notice1000/menu1001层级，保留notice及原unknown锁，不抬高整个Header、inspector或backdrop，仍待最终正常指针复核。非模态Operation drawer的Pause在宽屏原被全局notice覆盖；按可见drawer header/footer布局区后正常点击可暂停且无新Create，但左侧notice又覆盖可交互背景Search，故非模态区额外按实际pageHeader剪裁可用top，true-modal背景inert规则不改。相关新回归以实际DOM边界而非固定像素高度处理。

同次确认6.1真实缺陷：Users所有GET503，首错显示Data unavailable，原auto retry因shell已存在而误把users默认[]当确认数据。再次打开6.1（25/31），实现独立PageReadState仅保存identity/view/path的loading/unavailable/confirmed回执与时间，不接业务数组/API/cache；shell/locale重绘均不能确认数据。只按当前真实成功读确认，失败刷新保留已有同scope回执，旧scope晚结果拒绝。实际复核已观察首错及全部自动/显式失败重试、EN/ZH切换仍unavailable；真实GET成功显示一账户并清原错；再次503保留一账户；新Models503不借Users数据。读notice原pagekey懒翻译，Runtime数据确认与独立health读失败notice的退休条件分开。最终正常菜单/已有notice语言切换与CI实际新browser回归仍待确认，不提前勾回。

18:40后续旧头4a46ab2完整Go integration终态451pass/16fail/6skip；其中前一run失败的Package activation这次通过，其余旧类别仍失败。它支持按各次实际结果区分不稳定执行与确定性缺陷，不证明未运行baseline，也不回写旧失败为通过。当前头精确Package两协议绿色与这些全套旧头事实分别记录。

18:42最终非模态样本实际通过：宽屏Operation drawer的notice在左侧但现在top64，背景Search原输入y16.75–38.25正常点击/输入，drawer仍打开；Pause正常切到Resume且不新建Create。Export另以真实偏好GET503 sticky error验证：stopped Work2原Export一次POST，宽屏Details/Pause可正常点击；455×772 panel y355.36–755.82，notice y218.35–347.16完全在panel上方，Resume/Pause/Hide正常指针可用；BODY host/show非模态、privacy warning、Details无Operation ID保持。ledger分别含此前原Create一次POST、Work2原Export一次POST及基线service-entries一次POST，不冒称全部POST为零。pending合成夹具未执行Prepare/实际下载/真实archive，不能关闭4.3真实链。

18:54 a444dc29正式资源实际复核收敛：Models503→Users503保留两个独立读notice，返回Models的真实GET200显示合成模型后只退休旧Models读notice，Users失败独立保留；同身份且零写入。只在Console feature选择同identity/path/read旧数字generation，并调用NoticeStore原精确resolve，不修改共享store或清除write unknown。之前加载中8秒GET期间实际EN→ZH仍显示loading骨架，不出现默认表格；首错/自动与手动重试/语言/确认成功/失败刷新/新route隔离也已实际通过。重新完成6.1（26/31）；新增直接owner与notice回归使Console161/161通过，actual-app新增浏览器回归仍待CI，不宣称整套绿色。

最终Console瞬时菜单层级实际455px通过：Models503 sticky error下正常展开导航并点击User access真实进入Users；原Models错误保留，Account→Language正常点击；中文后旧notice仍正确叫“AI模型”，不误用当前Users标题。Users刷新失败仍保留确认的一账户，自己的notice为“用户”而非泛Core。2.2还保持打开，直到Desktop实际pane toolbar/File More触发区的已确认遮挡修复与正常指针复核完成。

### 19:09 有限主要命令行避让与 Requests 原触发点

共享展示只接实际header及显式toolbars/footers只读DOM集合：可见顶部取最深边界，底部同时考虑editor/settings-savebar/composer，而不是第一项命中；统一排除断开、inert、隐藏及祖先裁剪区域。Desktop新增零依赖`notice-page-region`仅收集10项既有主要顶部行和3项底栏，不扫描body按钮或iframe，不复制共享几何、不读取业务状态。直接query-port测试验证精确清单与原节点，真实布局仍由浏览器验证。非模态inspector保留BODY通知宿主/show/aria-modal=false，外侧通知也避让仍可交互的背景Header；原modal优先不变。

父任务以正式资源实际455×772验证File More：旧通知曾覆盖按钮；修复后按钮中心实际命中file-add，通知移到196.89–304.69、位于Files工具栏下。正常More→New folder→Cancel可用，焦点回原file-add，原sticky偏好错误保留且没有MKCOL；Work menu→Settings正常指针操作也成功。宽屏原Create inspector的Pause与背景Search、455px Export非模态Pause/Resume/Hide已经分别实际验证，均保持原POST身份与次数；这些有限事实不冒称全部浏览器矩阵通过。

Requests进入点另有源级缺陷：菜单item移除后其focusKey无法恢复原Service菜单。仅在实际anchored菜单内捕获既有overlayAnchor，直接触发仍用focusKey，refresh保留原entry；原Work/Service/identity与新dialog准入未变。新增实际HTTP浏览器回归保留原Service返回断言，并验证延迟Requests GET不能夺走新Response settings的model焦点；已正式编译，尚未本地运行Chromium。官方Desktop build/embed及52个直接套件694/694、0skip通过，不把新浏览器用例编译称为执行。

旧TAP的已确认导航/反馈契约迁移保留原请求、草稿、未知锁和身份断言：20个Settings入口经显式Work菜单；20个展开Requests场景经原Service或Chat菜单，验证原Work/Service/filter且无旧toolbar shortcut；6个Files确认通知沿原目标与路径汇总、logout沿BODY警告、Export技术ID改通过实际原GET/POST账本证明且Details不显示。Work Header按冻结V13不加Account；原Export/Account共存从Works原行菜单开始，两个Run认证错误先完成原错误/help断言再显式Back到Works全局Account。首设成功通知归notice host且保留Model saved事实，502退出保持unknown而非伪装known failure。均属已批准布局/状态契约迁移，不能据此宣称旧完整浏览器失败已经全部修复。

19:10最终生产源集成门禁实际通过：全部workspace typecheck、maintenance、相对PR原base的style142文件、真实重新生成两端UI逐字一致、Console161/161与共享29/29，Go webapp12.030秒及两个宿主build成功；consoleassets/desktopassets明确无独立test文件。日志为ignored `dist/final-owner-gates.log` exit0。旧Pause5缺失sharedIcon协作者改直接导入实际共享模块，仅补已有assembly参数；Log export入口guard改为原具名wrapper委托，明确只是source wiring检查而非行为单元证明；两个正式编译Node套件10/10、0skip通过。initial-shell浏览器断言按真实静态labelled skeleton校验，后续pending dots动画/固定slot/reduced-motion用例不变，尚待CI实际执行。

19:14实际Requests焦点复验发现第一版捕获位置仍错误：正式3830资源Service options→Requests的filter正确，但Escape后实际焦点落到tab-Services而非原Service菜单。原因不是浏览器不支持，而是既有dispatchAction先cloneNode(false)，handler收到无父节点副本，closest检查必然失效；前述694直接测试不覆盖此DOM事件链，不能据此称焦点修复完成。将原selector快照限定到dispatch入口真实clicked节点、在克隆前捕获并仅向Requests handler传可选entry标量，保留原关闭恢复与作用域guards，实际浏览器待复验。

19:16克隆前捕获版本正式生成物再次逐字校验通过，Desktop typecheck、相对原PR-base style145文件、Go webapp13.150秒及两个宿主build均通过（`dist/final-focus-gates.log` exit0）。最终Desktop app SHA256 `44801a9ce84588701d92b102dba34f132f7a8964e3c5db627bdaf9e1e8f36095`；Console app `e2844f9ebabe014e36b37bbe0db051ebfce94852a2597efe6334918d8c165506`；共享notices `1b1ebfc17b1e4e55ee302258596a7865f154e4571e17624ce30fc83a889b6c34`。三个hash均指官方构建/内嵌，非预览转换产物；功能浏览器结果另记，不从hash推断通过。

19:16同一最终源重跑Desktop52直接套件694/694、0skip；另外实际dispatch协作者涉及的compact-work-controls/file-target/modal-presentation/overlay-role四个旧装配文件88/88、0skip，无需新增fixture协作者或改变断言。两个结果集合分别记录，不机械相加冒称互斥覆盖或浏览器通过。Logs两条改在真实10秒预算前断言pending再释放成功/失败，另加明确10秒超时后只手动重读同GET的浏览器回归；既有diagnostic deadline六项直接测试6/6通过。Cleanup失败重读保留原确认事实与503，Run reconnect普通读取静默结束，unknown路径只对原502行核验原锁/无Retry；都保留请求次数，不用成功toast/隐藏旧数据制造绿灯。新浏览器断言仍待正式CI。

19:18父任务正式455×772 Settings底栏代表性验证：保留sticky偏好读错，仅编辑本地AGENTS草稿；顶部/底部两个真实Save存在。底栏最初部分低于视口，正常键盘Tab滚动进入后Save为601.62–641.62，中心实际命中save-config，通知63.99–171.79不重叠；正常Discard恢复原Synthetic instructions，没有PUT/Apply。此为实际导航/底栏可达性与不重放证明，不是配置写入成功证明。

19:18最终44801正式资源实际复验通过：fresh reload后正常Service options→Requests，实际filter为原Synthetic notes、heading Service Requests与原Work1保持；Escape关闭后document.activeElement确为data-action=service-menu、aria-label=Service选项，不再落tab-Services。原sticky偏好读错仍在，没有force或先关闭通知绕过。结合已经执行的模态/非模态、宽窄屏、背景Header、composer、Files菜单、Settings底栏及Console菜单/首次读失败/语言/跨页原读恢复，2.2与6.1有限验收恢复完成；连同真实Package协议6.4当前27/31。剩余4.3、5.4、8.1、8.2仍等待当前正式CI真实链/完整浏览器及最终核对，不能以本批CUA或直接套件代替。
