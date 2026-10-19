# 旧基线候选的历史验收记录

以下完整保留整合前候选的历史结果，仅用于证据追溯。其 302 项纯测试、7 workspace、20 embed、Go 和浏览器结果不能计为 main `28bfdfa` 整合版的通过；本轮实际结果见[整合验收记录](acceptance.md)。历史路径与旧环境名称不代表当前文件或可用环境。

# Desktop 任务连续性修复验收记录

更新：2026-10-13 UTC。对应变更：`fix-desktop-task-completion-and-ux`。

## 当前范围与状态

本次候选基于 `8b49c2cec1c6708a601d1809a97f81491525d81d`，已实施A批导出/下载、B批工作连续性及C批控件/导航/完成出口；各批测试、用户说明和嵌入资源已随正常构建更新。A2.5定向门槛已满足，A/B/C可执行的定向验收已收束，缺少环境或受工具限制的条件逐项保留。当前任务文件为 **28/45**，其余项目只在完整满足验证条件后勾选。

本次交付覆盖完整A/B/C前端修复，按已完成的可执行验证准备Draft PR；没有把A单独作为最终交付。仍有早期双击交互未归因观察、原生control channel失败和真实Core未验，不表示可合并或可发布。本轮不改Core业务逻辑/API、项目依赖、凭据或安全设置，不运行Docker，不同步主规格或归档change。其他在途delta没有修改。提交按A导出功能、B工作连续性、C导航/控件各自的源码与对应测试/生成资源，再依次提交使用文档、OpenSpec规划与验收材料；不归档。

早期开发候选在环境重建后不再可用，其通过结果没有转移到此候选。本记录只把当前源/构建hash及重新执行的结果作为验收依据。原31项状态测试和1项native boundary基线已重跑通过；首次全仓typecheck的agentd声明缺失保留为已有构建前置问题，按现有workspace依赖生成声明后全7项typecheck通过，没有扩展为后端修改。

浏览器证据使用已有受支持的云Chromium154及官方Playwright接口；没有重新启动被拒的本地Chromium、raw CDP或降低安全设置。HTTP后端为独立合成夹具，真实download事件与文件字节/hash已实际检查；它们不代替CLI完整校验或真实Core链路。

## 冻结A构建

最终候选通过现有 `node scripts/build-cli.mjs --target linux/amd64` 构建入口重新编译Desktop、同步15个embedded资源并生成原生CLI。源码生成资源逐字节一致；独立冻结资源供定向浏览器复验。完整manifest、截图、DOM、请求ledger、下载文件及命令日志作为外部验收附件另附，不是本仓库内的可点击证据链接。

| 产物 | SHA-256 |
|---|---|
| app.js | `24dc9c717b8a22f1c2d464a54a68d86abbd0c55e495c4924b9b154f2754a0350` |
| adapter.js | `3267b6710b16718edcfcc7af02ca76e8bac73e265bcf71c4fed4c30903c4e08a` |
| export-flow.js | `12badc25f58ae5b256f473c2de9594d1f454f2e232e889904c897d2cd2205557` |
| Linux amd64 CLI | `852ad8c45865ae2ab4d679c91be57ed4789304f961a24d36a69aa2a5320c0fe0` |

## 已执行的验证

| 层次 | 当前实测结果 | 边界 |
|---|---|---|
| 冻结A纯状态/adapter测试 | **159 pass，0 fail/skip**：原31、export adapter40、flow83、admission5 | 不计作浏览器测试 |
| B第三候选纯状态/adapter测试 | **215 pass，0 fail/skip**：保留A159，B adapter/文件协议35、草稿/结果锁21 | 正常build、17项embedded一致、源码/测试编译通过；浏览器按各hash分列，未整体通过 |
| C当前r2纯状态/生产函数测试 | **302 pass，0 fail/skip** | 包含原A/B、导航交错、取消锁和观察投影；不是整套browser执行 |
| native boundary | 扫描通过，**1项测试通过** | 不代表native bridge运行 |
| 类型/编译 | 全7 workspace typecheck、Desktop源码/测试编译通过 | 编译不计作Node browser执行 |
| 构建 | A为15项、B为17项、当前C r2为20项embedded逐字节一致；均正常CLI构建 | 宿主control channel仍有失败 |
| A Go契约 | **27 pass / 7 fail / 0 skip，34顶层项** | 7项在control初始化失败，未到业务断言 |
| 文件安全Go契约 | 40项全部通过 | clientfs/workfiles/fileprotocol/filehelper |
| Work package Go契约 | 4项格式/完整性测试通过 | 与34项A契约分列 |
| 主/不同内容夹具自测 | 37 / 46项分别通过 | 无socket夹具自测，不是产品浏览器验收 |
| 首候选定向浏览器 | A01–A18中17项功能通过；A13恢复失败；A12强化另发现目标变化缺口 | 18项安全计数通过不等于18项功能全通过；旧hash证据保留 |
| 首候选边界浏览器 | A19–A33已执行，29阶段请求/时序断言及9份实际下载文件校验通过 | 记录ready字节投影问题；最终hash仍须复验受影响路径 |
| 最终A候选定向浏览器 | 主组25+6阶段/10+4下载、边界组35阶段/10下载的机器断言通过 | 合计66阶段checkpoint、24实际下载；覆盖A01–A33的主场景，不是66独立场景；另列1个早期双击未归因观察 |
| 完整Node browser/native-auth | 全套未执行；原runner单次选中2项beforeunload均失败标记，0pass，随后挂起并中断exit130 | 清理hook后同命令自然exit1，明确当前环境socket EPERM/SIGABRT，2项产品断言0执行；CUA结果不冒充整套runner |
| 真实Core/Engine | 未执行 | NoDocker阶段保持未验 |
| NVDA/VoiceOver | 未执行 | DOM检查不能代替真实辅助技术 |

本轮Go：transfer/feedback3/3、snapshot/storage6/6、transfer cleanup2/2、recovery10/17、files bridge1/1、snapshot access5/5。7个失败均是Desktop control channel初始化返回不可用/不兼容；具体syscall未定位。一次strace诊断本身被ptrace EPERM拒绝且未启动目标，不把它写成control根因，也没有尝试旁路。旧环境的netlink失败本轮未复现。

可在仓库执行的前端验证命令：

```sh
npm run typecheck
npx tsc -p apps/desktop-webui/tsconfig.test.json
node --test apps/desktop-webui/dist/test/action-state.test.js \
  apps/desktop-webui/dist/test/chat-projection.test.js \
  apps/desktop-webui/dist/test/lifecycle.test.js \
  apps/desktop-webui/dist/test/export-adapter.test.js \
  apps/desktop-webui/dist/test/export-flow.test.js \
  apps/desktop-webui/dist/test/export-admission.test.js
node scripts/check-native-boundary.mjs
node --test scripts/check-native-boundary.test.mjs
node scripts/build-cli.mjs --target linux/amd64
git diff --check
openspec validate fix-desktop-task-completion-and-ux --strict
```

正常构建需要仓库约定的Node24和Go1.25.5。`build-cli.mjs`会重新生成Desktop dist；需要再次编译测试后运行纯测试。现有完整browser/native/real-core测试源码已更新到新导出动作和真实download断言，未执行的部分没有计入通过数。

## 失败复现与修复对应

- 基线实际复现停止态Prepare→View package→Download多段接力、旧包遮蔽新导出、按B查询却展示并准备A、Stop完成后未续导出、Close/换Work后无自动交付，以及丢准备响应后原UUID已ready但没有交付。短Close样本在准备响应仅挂起0.586秒后释放，随后12秒没有download事件/content，避免把长时间挂起误当唯一反例。
- 首候选A13的完整 `PERMISSION_DENIED` HTTP403被当作永久unknown，0Export虽安全但恢复不正确。精确Stop/Export+code+status现终止该意图，仅新显式动作可重试；任意403、错status、丢失/畸形响应和未知准备仍不解锁。普通非owner Stop通常返回NOT_FOUND404，此403用例是合成结构化拒绝恢复验证。
- A12强化用实际HTTP字段复现Work99/running后Work100/stopped借旧Stop继续Export。实际Operation envelope不返回targetVersion，因此没有新增假字段。当前在提交Stop前捕获可靠Work.controlVersion的保守一次增量界限，后续不抬高；fresh Core控制受理精确+1，复用不执行effect、拒绝回滚。超界、已确认相反目标、无法确认原界限均不能借新目标继续旧意图。外部控制恰好在本Stop受理前发生时可能保守停止，须用户重新显式授权。
- 原生ready POST只含size/digest、不含transferred，曾使成功UI显示0 bytes。现在只在身份、原transfer/snapshot/Work、size/digest和ready全部验证后，按完整已验证size显示CLI准备进度；仍只提示Download started，不声称浏览器已保存。

不同内容夹具独立验证：查看A后明确下载B，实际文件5187字节，SHA `01f3b88249576c50441614cb5e5fc1590ff633cfe06ce667d6ea899f336fe05c`；之后明确导出当前内容为9163字节，SHA `2b9e7538f91fbfe087ad0cfa0080e30e3480f3d40136997c3121f47dd54788ca`，不同transfer、A准备请求0。这一首候选证据没有被改写为最终hash；同一不同内容链路也已在最终候选重新验证通过。

模拟自动content拦截是夹具HTML预先定义且独立attempt的测试行为，不宣称真实浏览器策略拒绝。实际reload、合成pagehide、真实可见登录/注销分别记录。污染/错误交互的探索attempt保留并标无效，不进入通过统计。

## 编号01–26验收索引

下表区分已实际完成、仅源码/函数验证以及尚未取得的环境证据。旧规划图不计为新候选通过；同一功能在旧hash验证而新hash未直接执行时保留原归属。

| 编号 | Requirement / 本轮目标 | 当前可定位证据 | 剩余门槛 / 口径 |
|---|---|---|---|
| 01 | DWUI-002/016/019、BSA-005；临时503/超时保留应用 | B最终主组：实际10秒超时与503保持原UUID、iframe/Chat祖先、输入/焦点；撤权/停止对照通过 | 合成浏览器；不承诺真实崩溃恢复 |
| 02 | DWUI-005、BSA-005；所选Starting→Ready入口 | B最终主组：Ready后entry POST1、真实Service文档、重复读去重及错误Retry | 合成浏览器；真实Core未验 |
| 03A/B/C | DWUI-009/016、DUL-009；一次导出目标与Stop续接 | A01–A33最终hash主/边界证据；Stop前0Export、原ID/次数及真实下载字节 | 真实Core停止/生成仍未验 |
| 04 | DWUI-009；精确快照与新导出 | 最终A精确A/B/当前不同字节、乱序metadata与原ID请求 | 早期即时双击未归因样本单列 |
| 05 | DWUI-017；Works刷新 | B实际返回、Refresh503保留行/搜索、旧列表不盖新Stop | 原生hidden→visible被客户端阻断，5.1未勾 |
| 06 | DWUI-002、DUL-002；区域与目录恢复 | C r1 Chat/Files/path、加载不闪Services、Work隔离、404父回退、晚目录不盖Chat；r2真实函数补历史/目录竞态 | r2实际Back/Forward dirty与双目录竞态已过；身份切换记忆完整浏览器矩阵未单独执行，7.1保留未勾 |
| 07 | DWUI-004、DWUI-IMAGE-001/002；聊天离页保护 | 全身份内草稿纯回归与真实PNG/跨Session/Work保留；无Run/上传 | native beforeunload及Settings正控均未观测确认，不计通过 |
| 08 | DWUI-003、DWUI-CREATE-LAYOUT-001；新建revision | B2受理后B默认、拒绝/未知、旧A晚回保留新B、POST次数和按钮几何通过 | B r3精确hash证据保留 |
| 09 | DWUI-017；暂停投影 | 生产函数4类反例→最小修复；独立24/24及仓内7项通过，恢复只读原ID | 调度不变；不等于真实读屏 |
| 10 | DWUI-005、DUL-007；Service真实文案 | C-controls实际Starting/Failed/Disabled/Unknown分别截图；缓存embed denial投影另有生产函数回归 | 最终r2相关代码逐段相同，保留控件hash归属 |
| 11 | DWUI-011/019；即时局部反馈/慢请求 | C-controls命名首反馈52ms、31.6秒hold、按钮几何0变化、MKCOL总1；403/unknown保留输入 | reduced-motion及完整服务/生命周期延迟矩阵未验 |
| 12 | DUL-007；搜索/Composer焦点 | C-controls真实Tab均出现2px蓝色轮廓，computed style和稳定截图一致 | 合并Response settings渲染/焦点/键盘9段与基线精确一致；无新双选择器 |
| 13 | DWUI-019、DUL-007；checkbox命中/行位 | C-controls32×32独立label、留白click与Space各切换1次；首/末选择row y276差0px，filename只打开 | 新版360px尚未验 |
| 14 | DWUI-006、DUL-015；初焦与Enter | C-controls初焦、空Enter0、普通Enter/重复Enter/禁用按钮双击总MKCOL1；403与unknown保留值/焦点 | native IME/isComposing/229与overwrite Enter未实测；纯规则通过不替代 |
| 15 | DWUI-006、DUL-015；basename选区 | C-controls实际中文、点文件、多点、无扩展名与目录共6组初焦/选区正确 | Rename成功后原行trigger消失，activeElement为BODY；不称为成功回焦通过 |
| 16 | DUL-007；Remove危险色 | C-controls实际normal/hover/focus为danger红，与普通链接蓝区分 | 当前列表入口无正常可达独立disabled状态，记N/A；危险写入另经确认准入 |
| 17 | DUL-007；轻量外部关闭 | C-controls inside/跨界4变体保留；外侧关闭Work menu/info与Service menu回焦；Stop/Remove/dirty/unknown保留 | 生产白名单规则逐项拒绝Delete/Overwrite/Inspect/Import；pointercancel无真实输入API，单列未测 |
| 18 | DWUI-005、DUL-007；Close与Cancel | C-controls两个Close均0POST，原live取消POST1；cancelling/history/无权限无取消；受理后GET503仍锁 | r2实际复验受理后GET503持锁、成功Refresh清旧警告且0额外POST |
| 19 | DUL-007；reduced-motion | 原规则保持 | 仅支持实际媒体偏好时验证；不能用源码代替 |
| 20 | DUL-007；持续聊天与状态播报 | 风险脚注，未因此改live范围 | 无真实NVDA/VoiceOver，未测 |
| 21 | DWUI-009/012/013；收起后交付 | 最终A66阶段checkpoint/24实际下载含原ID、Pause、身份、未知矩阵 | 66不是独立场景数；无跨关页队列 |
| 22 | DWUI-003/005/008/016、DUL-002/009；完成出口 | C r1 Start/Retry及Service成功/失败/未知原对象出口已实测；r2实际函数Import一次意图和Close/选择变化门槛通过 | r2未知Service显式核对已过，7.2完成；Import最终浏览器受工具阻塞，7.3未勾 |
| 23 | DWUI-006、DUL-015；保存版下载 | C r1真实download8字节保存版、PUT0，31字节draft与30/30caret保留 | 7.4完成；整组窄屏仍待最终报告 |
| 24 | DWUI-007、DUL-002；brain source直达 | B2精确brain GET、dirty取消/Discard、503Retry、换Work/Core/账号晚回、Save/Apply0通过 | 真实Core内容链路独立未验 |
| 25 | DWUI-005；日志不阻断详情 | B最终挂起/503、合法Stop/Remove确认与B控制、晚A日志隔离、Retry只GET通过 | 6.1完成 |
| 26 | DWUI-006、DUL-015；文件结果恢复 | B2真实failure-only207/unknown、COPY A/B/C1/3/1、DELETE仅B重试、原锁与外部A字节保留 | 6.2–6.4完成；native全套仍不混称通过 |


未编号的深层目标目录候选不在本次范围。所有未测或阻塞项在任务文件保留。


## A2.5门槛与回归范围（2026-10-13）

最终主组25阶段checkpoint/10实际下载以及边界组23阶段/8实际下载已完成机器断言；159项纯状态、全7 workspace typecheck、正常构建/资源一致性也通过。使用说明与实际UI/请求一致，因此A2.5定向门槛满足，可以进入B实现。它不要求把未运行的Node runner称为通过，也不消除原生/真实Core的独立门槛。

最终主组覆盖A01、A07–A13及新增的已观察/未观察目标跳变、受理晚回包、确定Export拒绝与未知结果、A16–A18和不同B/current字节。最终边界组覆盖A19–A22、A25–A28、A33，并补确定拒绝/未知响应与Pause交错。最终ready阶段实际显示9163/9163；原snapshot校验未完成仍0content；Resume先读原Operation/snapshot/transfer；两种ready先后次序都仅交付一次。

后续同一冻结A最终hash补验已收束：主组补A03/A05/A06/A14/A15，A02/A04映射同hash已完成不同B/current字节样本；边界组补A23/A24、A29–A32，包含HTTP expired→null、换账号、授权失效、实际reload、合成pagehide和可见注销/重登录。主组新增6功能阶段/4真实下载，边界累计35阶段/10真实下载，原报告及其hash不被改写为另一候选身份。至此A01–A33主场景均有最终hash定向证据。

另有一项**未归因观察**：刚完成原snapshot查询、在同一工具调用内立即双击下载时，12秒内0准备/0content，面板仍是只读snapshot。截图可见文字选中，但没有点击handler入场证据；稳定面板后的真实双击为1准备/1content且A实际4201字节正确。两个attempt阶段均保留，不把前者称为PASS或已确认产品失败；仍需核对工具动作时序/命中和原请求完成状态。它不被混入6个新增功能通过统计。

A2.5及B4.1初始收束时已勾1.1、1.3、1.4、2.2–2.5、3.2–3.4及4.1，共11/45；最新总数见顶部和任务文件。2.1的多snapshot乱序基线失败矩阵、3.1的全部原版晚响应失败矩阵尚未作为完整独立红例集收束，保留未勾；已取得的停止态接力、旧包遮蔽、B错A、Close/换Work/丢响应反例并不被忽略，也不替代遗漏的精确矩阵。1.2、3.5及10.x的native/full browser/真实Core复合门槛仍未完成。

## B候选构建与分层浏览器记录（阶段历史，最新状态见下）

- 先对原adapter/lifecycle添加确定失败回归，再修复展示保留与新动作准入、Service入口精确对象/去重/权限代次、列表读去重、独立日志及上传每次实际写入准入。首候选纯测试为212项通过，后续404/410回归使第三候选为215项通过；其中真实格式207使用最小DOM协议替身做纯解析检查，仍须浏览器真实DOMParser验收。
- app已接入稳定工作区、真实entry pending/error/retry、全部身份内文本/图片/待受理草稿beforeunload、New Work revision、精确brain source导航、逐路径失败选择与未知结果锁。Upload在打开选择器时捕获Work/目录/身份，返回后重新核对；批次中先前unknown结果不因后续Work失效而丢失。
- 独立审查发现并修复entry403后Stopped→Ready自动解锁、独立窗口invalidport被改3000，以及文件选择器晚返回写向新对象三项。两项UI修复仅源码复核，浏览器仍待验。
- 累计新增12项Node浏览器回归源码（含原生Settings离页正控），测试编译通过；原runner只尝试其中2项beforeunload，均在before hook失败且产品断言0执行，其余回归未执行；已有图片测试增加无错误配置解码断言，尚待原runner执行。B夹具v1/v2/v3分别13/25/27项自身测试通过，C独立准备夹具45项通过，均不是产品浏览器通过。
- B已用正常CLI构建同步17项embedded，逐字节一致；全7 workspace typecheck、212纯测试、native boundary扫描/1测试、CLI help均通过。A冻结资产另存，旧行为反例与新B候选使用不同目录和实例，不继承A产品浏览器通过。
- B app.js SHA `f973e92163d1a4880af81ec18c03a1603fe7671bdc67e66ba5b2c6e3c131983d`；adapter.js SHA `c83c1359647a2f0e45bc8e281ce67979b413af9797c4c39d5061c3eac9070be8`；Linux amd64 CLI SHA `8495a01f0f0b8c339a1c338e10742adf7c65d4c9df64eef9ebb05bf70741a7f1`。完整源码/产物manifest作为验收附件保存。
- B服务夹具最初的`*.localhost`应用origin发生invalid-response且无真实Service文档，请求未达到预期，因此该启动样本不计行为反例或PASS。夹具v3已改用明确独立loopback origin并实际加载独立Service文档，仍通过受支持浏览器路径验证，不修改产品安全设置。


### B基线4.1与当前实际结果

- 冻结A基线真实浏览器重现单次503导致iframe/Chat祖先脱离、应用输入/焦点丢失；实际10秒请求超时在释放响应前显示原生读超时提示且iframe消失，恢复后文档UUID变化。所选Service Starting→Ready连续35秒读取仍0entry POST/0文档。原版Stop202受理及独立Work403对照均及时撤销iframe。请求、声明式DOM探针、前后截图及原hash可交叉核对，满足4.1；不以纯usable布尔断言代替。
- 第一B候选已实际通过503/超时保留文档、Focus恢复、Starting→Ready去重、无效独立端口不降级、旧Service/port/Work入口晚返回隔离、entry403经Stopped→Ready仍须显式Retry、列表返回刷新及503保留行/搜索、日志503详情可达且Retry只GET。其证据属于第一B hash；整组矩阵尚未完成。
- 第一B候选真实发现Work404仍保留旧iframe；brain脏取消离开原详情、首次读取/Discard/503 Retry虽GET成功却未退出Settings；关闭unknown Copy后新modal缺原路径恢复说明；选择PNG虽有正确预览却被通用配置文件监听器额外解码。后续修复分别有adapter纯回归、编译控制流与独立源码审查；这些不能代替第三候选实际浏览器复验。
- 文件浏览器已见真实failure-only207部分子路径成功、一个传输未知；显式只选已知失败项重试后成功/未知计数不增加。Delete成功A与失败B重试为A/B=1/2，外部重建A保留。上述属于第一B hash，后续仍检查新版modal恢复、上传准入与原生离页门槛。
- 原生beforeunload在受支持云浏览器里尚未观测到可取消对话，Chat与既有Settings脏表单正控均在真实激活后直接刷新，工具自动处理与产品原因未区分。该项没有通过；将用新环境下仓库原支持runner另行验证，若受限仍保留未验。图片选择的首次超时/长picker无chip探索也不计产品失败；后续真实PNG选择已确认chip及跨Session保留，并据此定位额外UTF8错误。

第三候选（r3）通过完整正常构建、17项embedded字节一致、215纯测试、全7 workspace类型检查、native boundary扫描/1测试及CLI help。SHA-256：

| 产物 | SHA-256 |
|---|---|
| app.js | `fcfc914d7240cbdb10146a2b14eb68bc62ca0b2e68e4bf575156c9bfd4cf3330` |
| adapter.js | `4bf636fccb2dbb80ab7b093a9924b49dcfde924f9d8e94bed16efee8f7437df4` |
| Linux amd64 CLI | `24caf3ab1e1c9b56d1ec754475fc675881a71b46f53581a8d9d7012dab67b78a` |

A导出flow/admission模块未改变，第一B与中间第二B资产也保留独立manifest。该阶段第三候选修复对应浏览器验收正在进行，C尚未开始；最新B与C状态见下文。没有把旧hash全部结果转写为新hash通过。

原runner的首次单次尝试保留原日志：2项失败标记、文件失败标记，挂起后人工中断exit130，没有可确认的具体launch异常。只读检查发现after在browser未赋值时先调用close抛错，导致本测试自有HTTP server未关闭。已做测试专用finally清理，实际编译hook的4项无socket检查通过；不改启动参数、不吞原始失败、不改产品资产。清理后只重跑一次相同原命令，自然exit1且不再挂起，明确为Chromium process_singleton_posix.cc的socket() EPERM/SIGABRT；2项before hook失败，产品断言0执行。该路线已停止，没有更改launch参数或替代启动方式。

B r3另发现已知失败B路径的再次重试继承其他C路径unknown锁，第三次显式B重试错误禁用；真实请求A/B/C=1/2/1，原字节修改未重放。已添加编译函数失败回归及源码修复，摘要不再创建未知mutation身份，原未知仍由实际提交结果绑定锁。同批旧反馈同步新累计计数。该发现当时的后续修复尚未构建/浏览器验收，不混入B r3通过结果；后续B r4最终结果见下文。


## B主组收尾与C首候选记录（后续r2结果见下）

B主组最终r3冻结资产的真实合成浏览器验收已收束：Work503/实际10秒超时期间原Service文档、应用输入与焦点/选择及iframe/Chat祖先保留；Ready自动一次entry；可信401/403/404/410、Stopped、Deleted及Stop202仍撤销旧frame；entry403经Stopped→Ready仍保持撤权直到显式Retry；换身份晚entry不挂载；端口移除、Focus/Chat Focus/恢复、独立窗口与本地授权失效均有原UUID、DOM和请求证据。日志挂起/503不阻塞详情，Retry只读原Service日志；列表返回刷新、503保留及旧Ready列表晚到不盖新Stop已验证。r4仅改文件结果同步，主组r3结果按精确差异保留原hash归属，不冒称r4直接执行。

Works真正hidden→visible子场景未完成：普通HTTP中性夹具页被客户端阻断，不能拿路由返回或Refresh替代。beforeunload原生确认、完整Node runner、native恢复、真实Core与真实读屏继续作为独立未通过门槛。C浏览器使用各自新冻结目录和独立端口，无覆盖旧候选；最终记录见末节。

C-controls冻结版包括Download saved version、固定选择栏和32px独立checkbox、局部focus/Remove颜色、命名初焦/选区/Enter/IME守卫、轻量外部关闭与Pi/Service真实文案。独立源码反例驱动修复了取消受理后GET503或旧running导致二次POST、跨hash同Work未知恢复可被外点关闭，以及缓存embed denied盖过Starting/Failed/Unknown说明。276项纯测试、全测试源码编译、Desktop类型检查、正常build/sync和Linux amd64 CLI通过；这不代表实际指针/像素/下载验收通过。

C-navigation r1另增页面内区域/文件位置恢复、404/410父目录回退、原对象Start/Service进度、Import明确一次Start and open与身份/视图边界；该首导航候选286项纯测试、正常build/CLI通过；其独立审查与定向浏览器结果见后续记录。app.js SHA256 `f1c0e3ef53cb90cd86894ad583cdca159a0bd6477576ba7011cf9b77c18f117c`，CSS SHA256 `027a9715f20e5cdaf122b0e563faac0a25906cd90072e704bee119388d5962da`。后续修订保留新manifest，不改写这一版身份。新增/更新的C01–C03及原Start/Service浏览器测试目前只完成编译，不计执行通过；最终勾选以完整条件和对应实际证据为准。


### B主组任务勾选依据（B2收尾前的阶段记录）

4.2、4.3、4.4及6.1已按B最终主报告的实际iframe文档/祖先/焦点/输入、精确entry与日志请求、声明端口和权限撤销矩阵完成并勾选。报告索引覆盖56个分层账本条目，其中已明确无效/未完成项不计通过。5.1仍因native visibility子场景未验不勾；5.2/5.5的原生离页复合门槛、6.4的剩余B2上传与原生组合门槛，以及全10.x在该阶段仍未勾。B2最终状态见下一节；C修改后的相关安全回归独立记录，不用B完成状态冒充C直接浏览器结果。


### B2可执行收尾、C保存下载及9.1观察投影

B2最终可执行项已完成：57项原证据snapshot与新增四个按本tab前置DOM锁定释放时序的场景共同校验，最终72项证据snapshot的请求次数、body字节及hash无不一致。B-r4重复COPY A/B/C=1/3/1且累计2确认/1未知；DELETE仅B重试，外部重建A的33字节保留。brain source在Work切换及同账号换Core后晚回均不显示旧编辑器、无Save/Apply。未知上传A PUT1、B PUT0；独立UI生命周期中B HEAD1，在本tab实际看到stopped后释放旧404，PUTB仍0且显示Not submitted。r3已验证New Work受理默认/拒绝/未知/晚A保留新B与按钮几何、brain dirty Cancel/Discard/503 Retry、真实PNG和跨Session/Work草稿，以及picker返回时目录/Work/身份改变0HEAD/PUT；保留各自hash，不称为r4重跑。

结合已通过40项文件安全Go契约、现有条件写入和根/越界纯回归，本次勾5.3、5.4、6.2、6.3、6.4；5.2及含原生离页门槛的5.5仍不勾。无效HEAD提前释放、错误Core前置DOM和被前一unknown锁阻挡的探索均保留并排除。

C-navigation r1实际Download saved version产生浏览器download事件和8字节 `Saved A\n`，精确文件GET两次（初读一次、下载一次），PUT0；编辑器31字节未保存草稿及30/30caret保留。7.4据此完成；宽屏行为已验，360px门槛未验，整组7.5不勾。

9.1使用生产adapter、提取的实际Operation renderer及Pause/Resume handler，在受控时间下先复现4种已暂停却显示Pause checking的反例：第四次503、401但会话仍有效、404及410。最小修复仅令operationPaused同时读取手动Set和同原ID的metadata paused；观察调度未改变。修后独立24/24通过，含1/2/5秒退避、hidden/visible、手动Pause保持、404/410失败Resume后60秒零额外GET、成功Resume、身份退出与真实合成Start仅1POST。仓内新增7项生产函数回归，9.1完成。它不替代9.2真实媒体偏好或9.3真实读屏。


### r2当前分层集成结果

在r2源码和正常构建的新Linux amd64 CLI上，重新执行全7workspace typecheck、全部Desktop测试源码编译、302项纯状态/生产函数测试（0失败/跳过）、native boundary扫描及1项测试、OpenSpec1.13.2 strict、git diff检查，均通过。20项Desktop embedded与构建资源逐字节一致。真实Core测试脚本两处普通Start旧弹层断言已同步为本体进度并通过语法检查，但没有运行该脚本或Docker。

可用Go回归重新执行：clientfs/workfiles/fileprotocol/filehelper共40项、Work package格式/完整性4项、CLI原快照传输/反馈/存储/清理/Files bridge12项，均0失败/跳过；这些测试使用当前CLI构建。原control初始化7项失败以及Chromium runner的socket EPERM/SIGABRT仍保留为已知环境限制，没有重复改参数或旁路，也没有因上述56项通过将完整native门槛勾完。


### C控件冻结版实际浏览器结果

C-controls app.js SHA256 `4f7e43dea734bd7d579826115b9e1d6cef9e2e38de27ad403e6fed58840af2c7`、CSS `c879723519e539093504b4d2bbaa3132d181933930596f0332b2ab09bb9be85d`。在实际1180×757、DPR1窗口，真实Tab确认搜索和Composer均有2px可见轮廓；Remove正常/hover/focus为danger红。Files独立label为32×32，点击留白和Space各切换一次，首/末选择同一行y坐标276px不变，filename只打开。

New folder初焦、空Enter零请求、普通Enter后重复Enter及禁用按钮双击合计1MKCOL；52ms内显示局部反馈与锁，31.6秒实际等待仍显示真实等待文案且按钮几何不变。Rename六类basename初焦与选区正确；403和截断207未知结果保留输入/caret，未知重复Enter零重发。New folder完成回原按钮；Rename完成时原行消失且activeElement为BODY，作为已观察边界保留，不扩为本批回焦成功结论。

Work menu四种内部/跨边界指针交互均不关闭；纯外侧点击关闭Work menu、Work information及Service menu并回原触发控件。Stop/Remove确认、dirty文件下菜单及同Work未知命名恢复不被外点关闭。Pi列表与detail的Close各0取消POST；真实Cancel仅原live对象1POST，受理后GET503仍保持锁，历史/无权限/cancelling无修改入口。Service Starting、Failed、Disabled、Unknown有各自稳定截图和真实状态说明。

旧控件若干截图在DOM改变后尚未完成绘制，已明确排除并保留原件；新报告采用前一步动作稳定后独立截图并实际查看像素。r2控件源码逐段对应、control-rules完全相同，CSS保留控件版的完整前缀而仅增本体进度样式358字节；对应关系只支持定向复验范围，不把控件旧hash说成r2全量实跑。

当前工具没有已确认可用的目标窗口360px调整或媒体偏好入口；DevTools组织拒绝后未重试。真实IME/isComposing/229、pointercancel、完整Response settings、reduced-motion仍明确未验。Remove列表无正常可达独立disabled态，记不适用，不新增状态；Delete/Overwrite/Inspect/Import的外点排除由生产白名单规则逐项测试，未冒称全部真实浏览器事件。真实NVDA/VoiceOver同样未测。

8.4以分层证据完成：真实双端点指针矩阵、三种白名单回焦、Stop/Remove与dirty/unknown保留，结合生产白名单规则对Delete/Overwrite/Inspect/Import逐项拒绝及跨hash同Work恢复的实际函数回归。原Tab/Escape在真实菜单中保持；不把未支持的pointercancel事件称为已执行。

8.1以真实Tab/2px轮廓和Remove normal/hover/focus危险色完成；无独立可达disabled列表态记N/A。合并Response settings的6个渲染/焦点函数、modal分支、Arrow菜单导航和Tab焦点限制共9段与基线源码逐字相同，未退回双选择器。该源码对应证明保留已有行为，不声称新运行了完整Response settings浏览器套件。


C最终r2已另行短回归：app.js SHA256 `3bc26a03e32b6ce55758deadc7a4970254ac55605efb83788a125313da65c75e`。真实原Pi live-a取消POST1，随后GET503保持锁，显式Refresh读到cancelled后清除旧503警告且不重新开放Cancel；live-b及history均0取消POST。该hash另复验Works搜索Tab2px、Files32×32留白点击/Space及首末选择0px位移、Rename archive.tar.gz初焦0..11。8.5结合控件版四Service真实状态与历史/权限边界、r2精确源码对应和本次取消短回归完成。


### C导航最终r2与交付边界

r2非上传实际浏览器收尾覆盖四个独立attempt：同站Back/Forward的Keep editing与Discard均先走dirty guard；取消保留原Work、草稿及caret，Discard才离开且PUT0。两个真实目录PROPFIND各1次，较新target先返回、旧tree随后释放，最终仍target。普通Start仅POST1；原Operation succeeded但Work Starting时无Open Work，实际Ready后出现显式出口，点击前仍留Works。Service A/start响应丢失后保留unknown；Check progress只读同Service，明确Ready后恢复合法Stop/Restart，原结果仍标未知，A/start1而B控制0。Download saved version再次取得8字节保存内容，GET增1、PUT0且原草稿/caret36保留。

保存证据的22条一致性检查全部通过，这是四个实际attempt的文件/请求核验，不是22项额外浏览器测试。r1另实际覆盖Chat/Files恢复、首次Services、Work隔离、缺目录404局部回退、晚目录不盖新Chat、Start failed/superseded/unknown和Retry、Service A/B上下文与真实Ready出口；各自保留app hash。7.2据此完成。7.1的核心区域恢复与r2交错修复已有实际结果，但身份切换后记忆恢复的完整浏览器矩阵未单独执行，继续不勾；生产身份回调明确清空选择记忆并使旧读取失效，作为源码检查而非实际身份浏览器PASS。

最初第二次Back进入about:blank的探索涉及跨文档native beforeunload及工具默认行为，未归因产品故障；后续明确同站序列没有越过dirty guard。未把历史取消后完整浏览器栈保持不变列作保证。最终附加只读viewport/按钮状态调用被平台拒绝后已停止，不重试或换路；此前成功DOM/截图证据不改写。360px没有确认可用的目标窗口，继续未测。

Import最终候选上传工具先长时间等待后中断，后续只读工具也挂起；该工具终态不算产品FAIL，也不作为Import通过。旧版真实Import完成/查看0Start反例以及r2实际函数的一次Start、原导入/启动ID、真实Ready、Close/新选择取消自动打开均单列；7.3及相关7.5完整浏览器条件保持未完成。

最终再执行正常build-cli、全7workspace typecheck、全Desktop测试编译、302项纯测试、native boundary扫描/1项、OpenSpec strict与diff检查全部通过。61项源码/embedded仍与r2冻结manifest相同；20项embedded逐字匹配dist，并确认完整字节出现在正常构建的Go宿主中，CLI SHA256 `9ef815531ea486f862dd4f8ece2f404b8e6c04e06a7a8b4819941fb72cdd281f`。10.2构建/生成资源一致性完成；这不把独立受阻的native control/auth运行归为通过。

本次可交付的是已修复并完成可运行验证的前端候选。Draft PR仍保留全native runner/control、原生离页/可见性部分场景、360px、真实IME、reduced-motion、读屏、最终Import浏览器链路与真实Core/Engine的限制；不能据此声称整个OpenSpec全绿或可直接合并。成功Rename原trigger消失后的BODY焦点边界已记录，没有在本轮扩展fallback设计。

10.4已汇总01–26与三个delta对应、各冻结hash和通过/失败/阻塞/未测口径；已核对只修改本change，保留相邻在途delta和主规格。strict通过，五组提交按A/B/C各自源码/测试/embed、使用说明、OpenSpec与验收组织；不归档。其完成只表示交付核对完整，不表示未勾条件已通过。
