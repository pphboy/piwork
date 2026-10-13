# 最新 main 整合验收

日期：2026-10-13 UTC。变更：`fix-desktop-task-completion-and-ux`。本记录只列本次恢复环境重跑结果；[旧候选验收](previous-candidate-acceptance.md)中的通过数、截图及构建身份均不转移到本候选。

## 基线与范围

- 整合基线：`28bfdfa56b4c84b10ade9a63fedb7c2b75c04a90`。旧提案基线：`8b49c2cec1c6708a601d1809a97f81491525d81d`；两者相差28个上游提交。
- 冻结输入的全部67个阶段条目与前像已校验，五组层叠等于53个最终文件；没有直接用旧文件覆盖main。依A导出、B连续性、C控件/导航顺序三方整合，正常build生成嵌入资源。
- 源码/测试冲突位于 `adapter.ts`、`app.ts`、`public/style.css`、`test/recovery.test.ts`；上游新增恢复测试与本次新增测试均保留。生成资源不手工解决冲突。
- 保留上游Stop and send、独立活动Run、Service请求及回复读取、原submissionKey恢复、点击目标快照、名称错误、过期授权响应隔离和Run执行错误。独立只读复核未发现上述行为回退。
- 旧B全局Create pending锁与上游显式改名并发行为存在冲突：现保留不同名称的新显式提交，同名pending及任何未知创建继续锁定，保留latestCreateToken与草稿revision，并增加纯函数回归。
- C取消互斥叠加在上游完整请求观察链上；不恢复旧分页/Retry实现。测试夹具补全现行 `runIds` 字段；观察投影测试继续执行生产renderer及其新增名称辅助函数。
- 三个OpenSpec delta逐Requirement三方整合，保留新增上游命名、聊天中断、导入命名及Service请求展示约束，并去除重复段落/Scenario。主规格和其他change未修改，不归档。
- 根 `docs/` 不重建。仅本次必要[使用说明](usage.md)与验收记录归本change。
- 不改Core/API、依赖/锁文件、凭据、安全设置或用户数据；没有运行Docker。

## 候选身份

实现提交顺序：

1. `9784d98dd76a7f99b68a836f1d41407040e5e478`：精确导出与单次交付
2. `3d7557cbb16bfa6961b8362b265750c6d94115a5`：工作区连续性与文件结果恢复
3. `3dfbd17e9f473666199624bf99919b718507adc5`：上下文导航与完成控件

44个实现/测试/生成变更的排序清单（path、SHA-256、bytes）的排序JSON（Python默认分隔符、不含末尾换行）SHA-256：`96c8495cd8b67059e8c0ce4b798206197e64248e59f6e2ddf3c28c7e43822b46`。

供定向GUI复验的只读asset清单排序JSON（Python默认分隔符、不含末尾换行）SHA-256：`b6998f6322dcc1a7e320d5f5af182c87516684d681275d16bd982bd3d2aaa504`。该快照不随文档更新改变。完整文件清单、命令日志和恢复包单独交付。

## 本次已通过

| 层次 | 实际结果 | 说明 |
| --- | --- | --- |
| 依赖准备 | 原 `npm ci` 成功，未改package/lock | 初次默认缓存目录不可写，改用任务内缓存；没有修改系统设置 |
| 工具链 | Node24.19.0、npm11.9.0、Go1.25.5、OpenSpec1.13.2 | Go下载使用官方校验值验证，工具仅安装于任务目录 |
| A定向纯函数/adapter | 159 pass，0 fail/skip | A阶段源码；最终集成另列 |
| B定向纯函数/adapter | 216 pass，0 fail/skip | 含新增创建并发边界回归；最终集成另列 |
| C最终纯函数/生产函数/adapter | 303 pass，0 fail/skip | 16个测试文件；包含A/B、导航竞态、取消锁和观察投影，不是浏览器测试 |
| 工作区类型检查 | 全7 workspace通过 | 按现有依赖顺序先build declarations |
| Desktop测试编译 | `tsc -p apps/desktop-webui/tsconfig.test.json`通过 | 包含保留的上游浏览器回归，编译不是执行 |
| TS contracts | 40 pass，0 fail/skip | 含cancel-and-send及Retry原键契约 |
| 正常Go构建 | `bash scripts/build-go.sh`通过 | 全部7个Go入口；保留 `-buildvcs=true`，显式指向本worktree的Git目录修复环境VCS发现问题 |
| Desktop embed | 20个文件与正常dist逐字节一致 | 未手改JS/CSS生成副本 |
| Go CLI传输/文件定向 | 14顶层测试通过，含subtest共17，0 fail/skip | 原snapshot/session、传输校验、清理、文件桥接、图片、未知结果及离线Inspect等；不是真实Core |
| 新上游Go CLI回归 | 3顶层通过 | 名称错误安全投影、允许路由与cancelRunId/Retry原键、聊天输入原键 |
| Go agentclient/contracts | 9与12个顶层测试全部通过 | 细分subtest分别23与7260；不以子项数宣称端到端覆盖 |
| Go client/clientfs/workpackage | 三个package通过 | 同批CLI完整包结果仍失败，见下方限制 |
| 文档治理 | checker及7个相关测试通过 | 当前54份文档、1份迁移清单；没有复活根docs |
| 原生边界 | checker及1个测试通过 | 扫描不代表原生Desktop运行成功 |
| OpenSpec | `validate fix-desktop-task-completion-and-ux --strict`通过 | 只证明格式/结构有效，不表示全部任务完成 |
| Git | `git diff --check`通过 | 未远端推送、发布、合并或归档 |

首次C纯测中5个观察投影测试因旧夹具未加载main新增的 `importNameFeedback` 失败；补为读取并执行生产函数后重跑303项全部通过，没有改变产品逻辑来迁就夹具。

## 未通过或未验证

- Go完整 `internal/cli` 包本轮失败：相关测试报告 `netlinkrib: operation not permitted`、原生Desktop无法启动及control channel不可用。未更改权限或绕过限制。其他三个包通过不能描述为该完整命令通过；后续有明确选择范围的CLI契约测试另列。
- 原仓库Playwright启动：先缺少浏览器，可通过官方项目依赖安装Chromium140.0.7339.186；正常重试后启动仍因 `socket() failed: Operation not permitted` / SIGABRT失败。选中的3个上游授权隔离浏览器回归均在before hook失败，产品断言0执行。清理hook因browser未创建而失败、server未关闭，使用25秒外层时限结束；没有改安全参数、使用raw CDP或绕过socket限制。
- 完整Desktop `test:browser`、原生 `browser.test` / `native-auth`、真实Core停止→导出→校验→下载→Inspect→Import→显式Start链路均未通过本轮完整验收。保留相关测试源码及未勾选门槛。
- 本轮不重复已被审批阻塞的真实Import/file chooser操作；不把合成HTTP、纯函数或GUI演示等同于真实Core结果。
- 360px全矩阵、实际NVDA/VoiceOver、完整键盘/几何/动效矩阵仍未验。任务表维持28/45，不因partial结果勾选剩余17项。
- 仅准备Draft PR，不能据此宣称全部Spec全绿或可直接合并。

## 定向GUI

通过受支持的官方GUI工具操作云浏览器，使用冻结asset及独立合成HTTP后端，以下5组定向复核通过；逐文件manifest均匹配。它们不代替整套仓库Playwright或真实Core验收。

1. 临时503连续性：原iframe保持相同文档/UUID，应用输入保留。
2. Files与命名：12个选择命中区均为32×32；选择前后行位置差为0；Rename初焦且仅选择文件主名A。
3. 轻量关闭与脏导航：Work菜单外侧关闭并返回焦点，Stop影响确认外侧不关闭；Back/Forward保留脏文件确认与草稿。
4. Start完成出口：Start POST为1；原 `operation-start-1` succeeded但Work仍Starting时无Open，Work Ready后才提供Open；不自动离开Works，Service entry POST为0。
5. 停止态导出：原 `operation-export-current-1` / `snapshot-current-1`，Export/prepare/content计数为1/1/1，Stop为0；实际浏览器下载9163字节，SHA-256为 `2b9e7538f91fbfe087ad0cfa0080e30e3480f3d40136997c3121f47dd54788ca`。未把Content GET等同于真实Core生成/完整性链路。

GUI使用的 `app.js` SHA-256为 `a8cf325f050e5911304222183944cfbd6de8e76319b55afc6609af6d17caf25a`；`asset-manifest.json` 原文件（含末尾换行）SHA-256为 `8810639ca2c3f8a2f15e2f25f7cac25df02255725da0b40e863ab0a9725e5562`。

## 2026-10-13 用户反馈增量：主流程与管理入口分层

### 基线与修改

本轮开始时只读确认PR #2仍open/draft且未合并，远端head为`615e7d92432cf1218d4d292bb164a993ca5e9393`，base仍为`28bfdfa56b4c84b10ade9a63fedb7c2b75c04a90`。本地`d9e633d`树与该远端head相同，工作树干净；不覆盖其他提交。用户三张反馈图已实际查看。

- Works/Work：Ready行直接Open Work，Stopped保留Start；Stop与Work information归当前Work更多菜单，移除Work顶栏About图标；删除列表底部重复Create a Work，空列表引导保留。
- Admin：全局About与Known operations归账号下拉；外点和Escape只收起菜单，不受背景草稿/任务阻断，不扩大危险确认白名单。
- Export：原入口本来就直接建立一次新意图，本轮不重写协调器。改为非遮罩紧凑进度/结果，技术ID、旧快照、Pause/Check按需展开；成功保留同文件下载，明确失败保留原快照Retry download，未知结果只读核对；running仍有Stop and export影响确认。
- Files：移除空选择提示条；批量图标放入原工具栏，选择命中、覆盖/删除/未知结果保护不变。
- Service/Agent：请求入口用有aria-label/title的就近图标；Service仅可靠hasRecords时显示且保留当前Service过滤，Agent保留全Work范围，无计数或新API。

只改Desktop源码、对应测试、正常生成的嵌入资源和本change材料。未运行Docker，未改Core/API、依赖/锁文件、凭据、安全设置；不发布、合并或归档。

### 本轮实际验证

- 17个纯函数/生产renderer/adapter测试文件：321 pass，0 fail/skip。新增18项覆盖新层级、停止态直接导出、running确认、在途去重、准确旧快照、failed准备重试、dialog模态切换、Admin身份转义、批量工具栏与图标作用域等；这不是浏览器通过数。
- 全7 workspace typecheck与全部Desktop测试编译通过。原browser/native-auth/feedback/recovery/real-core测试定位器按Admin及Work更多菜单迁移；新增360/500px回归源码已编译，未声称本地Playwright实际运行通过。
- 正常Desktop build、Go1.25.5全部入口构建通过；20个嵌入资产与dist逐字节一致。Node24.19.0；没有为构建修改项目依赖或安全参数。
- 文档治理、native boundary checker通过；两个checker测试文件合计5 pass。OpenSpec strict与git diff --check通过。
- 独立只读review发现并修复failed下载准备的同snapshot恢复缺口、账号标题转义及旧测试入口迁移遗漏；新增回归没有删除旧安全断言。

### 官方云浏览器定向复验

使用独立合成HTTP夹具与冻结正常构建资产，不接真实用户Core。最终`browser/app.js` SHA-256为`4fed5167039aabeeb4216b7802fbcbb65761fd9067a155832c80dd24b9a2f82a`，`public/style.css`为`ac7a157cecef9ded380c5d429f26410292efa7eb06053718c21e50047eaf95fd`。

- Admin外点/Escape关闭并回焦点，About/Known可打开，底部重复创建CTA不存在。Known operations读取pending时仍可外点收起，gate释放后不重新打开，零业务mutation。
- 已存在两份snapshot时，首次Export只有一次点击；Export/prepare/content为1/1/1，实际下载9163字节并匹配本次current内容，未误用旧snapshot。紧凑卡片非modal，Details默认折叠，背景Search可输入；背景New Work能正常切换回模态窗口。完成后再次明确Export只再新增一次新意图，两次明确操作合计Export/prepare/content为2/2/2，Stop为0，两份包均9163字节并匹配各自当前内容。
- 两类请求图标均有title/aria-label，Service入口保留原Service过滤。
- Files宽屏与500px首次选择、末次清空行位置保持不变；500px A行Y均251，复选框label32×32，scrollWidth与innerWidth均500；批量Copy打开原A.txt/B.txt目标。500px Work更多菜单和Stop影响确认可达。
- 首轮窄屏实测曾发现两行工具栏被父flex压至57px、原first-child隐藏规则误隐藏唯一Work更多按钮；两处已修，最终冻结重新测量并截图确认，不沿用失败截图为最终结果。

### 仍未通过或未测

原45项中28完成、17未测状态保留；新增层级工作另列11.x。最小可用官方Chrome窗口实际innerWidth为500，360px实际GUI未测，不能以新增回归源码或CSS推断通过。完整键盘矩阵、真实读屏、原生授权与真实Core停止→导出→校验→Inspect→Import→显式Start仍受原门槛约束。

一次较宽的测试命令误包含需本地浏览器的feedback/preferences/recovery夹具，初始化未完成，后中断退出130；这些失败/未执行不计入321项通过数。随后按17个不需浏览器的文件明确重跑成功。未绕过既有浏览器/socket限制，也没有把官方云浏览器合成GUI替代整套browser/native-auth或真实Core验收。


## 2026-10-13 后续完整界面范围：工作区层级与一致控件

### 输入与实现身份

本轮接续PR #2的已确认Draft候选（远端输入`f6b9a84172c6048cb76e05ea3b2da204ead445f1`，本地`4eb0e3f`同树`411faad55c9a8fa48b46df41253f12481c3f74b7`）。完整11模块范围先更新本change的proposal/design/三个delta/tasks，文档提交`5249c14fa65aeacdf88f4e49cc5ee498cab60b8f`；随后按功能实施，原17项未测保持原状态。

| 本地提交 | 边界 |
| --- | --- |
| `b1561e3e8a63b0e3eb6e725799d4fca95265740e` | Work级请求检查、真实Run上下文、Service选择器、稳定分栏与实际高度 |
| `e7414658491b833968a8060cca983fe9c3188c76` | Files/Settings/Works/Admin减重、active Run与窄屏可达性 |
| `b1d53d06e6894559242ddb1f336c8a8925ea8053` | Modal展示状态机、footer几何与角色、Stop装饰、等待与Apply状态 |
| `c1faaf475bfa8934abc9643c10ba20bc2d372d44` | 浏览器发现的快速重开吞点击、Files模板括号、unknown Apply原ID保护 |
| `31516d5ace5e0e6a9e0cf3f61c25db74e266d516` | 退出后已恢复composer光标与导航期间Apply受理原ID |

最终功能tree为`eb284faea74c1b630015dde3ea5769a8e360186c`；后续仅文档提交不改变功能资产。22文件冻结清单原字节SHA-256为`da67ab11c9dcda1ea2cee28614d2352b74a2d3750db94380cf24f8b736627b48`，`app.js`为`195c9276d4e5cb6c4265c4af48e2845f03534d159ea18566ef88283c10177b37`，`style.css`为`329dd9f4438d52bed7b7425d8bcf2cc8e197d17bf5799691f049e9f405724b2e`。清单、命令日志及每次提交的path/mode/blob/content校验保存在忽略的`dist/workspace-update-delivery/`，不把旧冻结结果标成新资产通过。

### 11模块实际实现

| 模块 | 实现及事实边界 | 定向自动回归 |
| --- | --- | --- |
| Pi Requests | Work级跨Chat/Service入口，Service过滤保持；右侧列表/详情保留来源上下文；目标/结果优先，Executions/Technical details折叠 | `workspace-hierarchy`、`pause-projection`；多Run succeeded仍保持目标waiting，terminal残留waitRef仅作历史证据 |
| Run Details | 每个真实runId一次就近入口；legacy不猜测；无消息对应的明确活动Run独立展示；confirmed-null不提供旧Cancel | `workspace-hierarchy`、`chat-projection`；外部same-session active与不同Run ID不串 |
| Service/Chat布局 | 页面内身份/Work独立比例、普通显隐与Focus分开；拖拽/键盘/重置；窄屏单面板；祖先节点不改换 | `workspace-layout`、`continuity-adapter`；最小宽度与360/500数学边界只证明函数，不冒充真实viewport |
| Service选择器 | 名称、真实状态、声明端口、选中行和管理出口统一；单/多端口分层，不自动Start | `workspace-hierarchy`、现有Service准入回归 |
| Files | 一个常规Refresh，busy/Updated原位；保留错误及未知核对；Upload/New folder归＋，WebDAV/空态保留 | `compact-work-controls`、`action-state`、`file-results`；生产files renderer检查重复入口及字面模板字符 |
| Work settings | Back位于内容左上；一致状态轻量显示；dirty/not applied/applying/failed/unknown动作保留 | `compact-work-controls`、`navigation-review-regressions`；两次Apply、恢复真实kind、unknown无ID不借旧ID、导航晚受理仍绑定原ID、身份失效不绑定 |
| Works | Refresh/Import/New图标主次及tooltip/aria；空态文字CTA保留 | `compact-work-controls`、`action-hierarchy` |
| Modal footer / Stop | footer直接按钮统一40px最小高度/间距；角色顺序；仅移除Stop假复选框装饰，Delete真框保留 | `modal-presentation`及原危险动作/文件准入测试 |
| Admin | 一次账号身份，明确Role/Core标签；收起不受背景草稿阻断 | `compact-work-controls`、`action-hierarchy` |
| 底部高度 | root按真实可用高度flex分配；内层滚动，不再减157/150硬编码余量；不修改Service业务DOM | `workspace-layout`及GUI几何，最多保留一条Service StatusLine |
| 动效与短反馈 | 140ms opacity/4px；reduced-motion同步终态；逻辑关闭立即失效，非模态inert视觉快照退出；保留具体错误/必要风险 | `modal-presentation`；choice/identity/route/node、重复完成、event缺失fallback、快速重开、新背景焦点与composer caret；Export保持非模态 |

### 自动构建与回归

以下仅列本轮实际执行，不累加历史批次通过数：

- `npm run build -w @piwork/desktop-webui`、`npm run typecheck -w @piwork/desktop-webui`、`tsc -p apps/desktop-webui/tsconfig.test.json`通过。
- 21个不启动浏览器/socket的Desktop纯状态、adapter及生产函数测试文件：最终357 pass，0 fail/skip。测试包括本轮新增的workspace-layout、workspace-hierarchy、compact-work-controls、modal-presentation；完整Playwright没有因此被视为执行。
- `node scripts/check-native-boundary.mjs`通过；native boundary与repository docs相关5个测试通过；`node scripts/check-repository-docs.mjs`通过；`git diff --check`通过。
- `openspec validate fix-desktop-task-completion-and-ux --strict`通过。校验只证明变更结构，不等于所有验收门槛完成。
- Go1.25.5、Node24.19.0通过现有`build-cli.mjs --target linux/amd64`构建宿主；最终构建身份和资产对照见下方收尾记录。没有Docker、Core业务/API、依赖/锁或安全配置修改。

### 本轮回归中发现并修正

1. 已取消Request保留历史waitRef时，原展示仍写Waiting。改为只在waiting_result/waiting_apply显示当前等待，历史字段仍可展开核对。
2. 活动接口有same-session Run但Session快照尚无记录时缺就近入口；补明确执行记录，同时authoritative null不回退旧Run取消。
3. 退出视觉节点仍处于native modal top layer，Escape后第一次New Work点击被吞。保留动画但同步解除native modal阻断，使用不可交互的非模态快照与淡出背景；旧定向GUI失败保留，修复后同流程复测单列。
4. Files＋后的模板多余字符通过实际renderer测试复现并删除；Apply恢复kind、旧Operation选择、unknown无ID和导航晚受理按真实对象分别加测试。
5. 退场回调不得抢新背景焦点或回退已重新使用composer的光标；来源已不可见时选择合法可见目标，旧identity/route/choice/node不能恢复新窗口焦点。


### 宿主与未测边界

最终功能提交`31516d5a`的Linux/amd64宿主构建通过，14253318字节；SHA-256为`4170330711cf2df149d0e38da7af3ac3dd98c84affd3b18d0fa1b0bdc0da6391`，DesktopUIHash为`e70d4c5303e7d1d74d0f7b2b82a666266c6acf5d9d7fc14352f0d02eb9581b5c`。构建时仅本change的usage/acceptance文档尚未提交，所以build.json如实记录`modified: true`；功能源码与冻结资产完全一致，22/22 build/dist/embed/frozen SHA-256相符。没有把文档dirty身份改写成clean。`internal/desktopassets`可编译但没有测试文件，不作为新增测试通过数。

- 原第1—11节17项未测保持不变；本轮没有重试此前已因环境socket限制失败的完整Playwright/native-auth入口，也没有使用额外浏览器安全参数或权限绕过。
- 真实Core/Docker、完整导出导入链路、真实NVDA/VoiceOver、360px真实窗口、完整Modal/状态/键盘/缩放组合仍未验。官方云Chrome可达窄窗口约500px，函数360px边界不替代真实GUI。
- Reduced motion仅生产分支和退出状态机的定向自动测试通过，没有本轮实际系统减少动态效果GUI证据；恢复Apply的真实kind/unknown/晚受理通过生产函数测试，不等于真实Core Apply验收。
- Files“无新增成功行”限定本轮常规Refresh读取。New folder等写入完成仍可能显示原有结果行；合成New folder完成后观察到约55px行位移，保留为范围边界，不冒充Refresh失败或批选几何通过。混合失败、未知结果与逐路径恢复不会因此被隐藏。
- 第12—16节实现均已落地。任务复选框按完整验收门槛保守维护，包含尚未执行广矩阵的任务继续待验；不能把本轮定向截图、纯函数或合成HTTP结果描述成全部规格全绿。PR继续作为Draft，不归档或合并。


### 官方云浏览器定向验收收尾

使用官方云浏览器与独立合成HTTP夹具，未运行真实Core或Docker。最终资产`31516d5a`逐文件served SHA-256为22/22匹配；定向范围无未解决FAIL。原始JSON、请求ledger和以下原图随恢复包保存，不将截图视为未执行操作的证据。

| 实际候选/场景 | 结果及可核对事实 |
| --- | --- |
| 首批`b1561e3e`工作区 | 21/21 served hash；请求过滤/Back回原行焦点；两条Chat Run各读原runId；选择器不自动Start；分栏、Hide、Focus及1180→502→1180过程中iframe与Chat祖先detach均0，document UUID/load保持1，文字和真实PNG草稿保留 |
| `b1d53d06`未受后续守卫修改的路径 | Refresh慢读、成功、失败均在本控件/错误区域正确反馈；外部same-session active Run详情与Cancel绑定原ID，取消后authoritative null移除旧Cancel并恢复Send；初次快速重开FAIL单独保留，没有将它计作通过 |
| 最终`31516d5a` Modal | Escape后立即首击New Work，3/3打开且焦点create-name；正常动画computed 0.14s；退场后新背景search焦点与输入保留，无旧窗口/假背景残留 |
| 最终代表footer | Create、New folder、Stop、Delete、Export、Request直接按钮computed高度40px；Stop 0 checkbox，Delete真确认框保留；取消查看不提交Stop/Delete/Create |
| 最终请求 | terminal Request保留历史waitRef但不再显示当前Waiting；原Request cancel 1 POST，另一Request状态保持running，无Run cancel或Service控制/Start |
| 最终Files | 普通Refresh只有1入口，成功同按钮Updated、0额外feedback行，A.txt行Y=226；＋后的多余字符已消失；首选/清空末项宽屏Y=226/226/226，500px时Y=251/251/251 |
| 最终Settings | 正常Configuration轻状态，无多余warning；Back to Work回到Files而非默认Services；真实Apply恢复/迟回跨页仅自动测试，GUI未测 |
| 最终500px普通/Focus | 普通Show Chat保留Work导航；Focus隐藏导航但Exit可用；回宽屏后同document UUID，Service与Chat草稿逐字保留 |
| 最终实际高度 | 1180×757 viewport下app/work-layout/main-panel/service-bottom底边全部757px；work-layout top=122px、height=635px，body/main底padding为0，无原35px外壳空带 |

最终合成ledger：Service entry 1次，New folder MKCOL 1次，原Request cancel 1次；Start/Stop/Service control/Create/Delete/Import/Inspect均0。它证明本次实际操作范围，不证明这些未提交动作的真实Core成功链路。测试夹具仅停止本轮自有进程，已校验processAbsent，不清理其他进程或安装数据。

除上节限制外，本轮未测试Import/上传file chooser、全部历史Modal组合、触控以及真正OS fullscreen；不将宽屏/500px与生产函数检查写为完整浏览器矩阵通过。任务表最终38/67完成，原33/50状态不变；新增5项达到本轮完整任务门槛，其余12项实现已提交但广矩阵验收仍待执行。

代表原图（合成数据、无真实凭据）及SHA-256：

- `final315-05-workspace-wide.jpg`：`235cd5240e151bf0498074e71feeccece0c8e293970e188189a41689c6f220e8`。
- `final315-06-request-detail.jpg`：`bbb1c861b8b67f3152cab1a00e6f0e9a353539e9ddd2db7e0d852bfd0d375416`。
- `final315-07-files-compact.jpg`：`30c6b1ceecfcae99d430e3577d6984e1a98062210779a938d09778f86fe2b4eb`。
- `final315-02-settings.jpg`：`3753db0c1a2f8ef60cfff9028f43798862db11975c219fff1780b2645044f96b`。
- `final315-08-stop-modal.jpg`：`479d13f567cd5e7f0194e0bbd82497eb4144ba9b470bddb142aee8f91b087580`。
- `final315-04-focus-500.jpg`：`c5b26e7268b638ef4acf8c139823d0f7120cbc14bad60532a8fea156eab36274`。


## 2026-10-13 末轮反馈：Chat入口去重与Settings对齐

用户指出最终315截图中的Chat“双放大”和Configuration in use未对齐，以下为追加修复，原315验收不冒充本次补验：

- `91d05d9abbe1f3dbe3b623c80fbde9970a30f35c`：窄屏service-chat头部原先同时包含focusControls的浏览器Full screen与追加的Focus chat，二者复用同一四角SVG。移除头部浏览器全屏入口，归入Agent/Service的⋯菜单，显示Browser full screen/Exit browser full screen文字；Focus/Restore保持主布局入口，Hide chat使用不同方向/聊天图标。菜单调用仍直接使用原Fullscreen API与错误处理，未修改执行协议。
- `d5e221a190fd085e363e55fd8e3a07cf4491532b`：Back与标题原在同一左侧块，状态与Back顶对齐，Details又被flex-basis:100%强制换行。现Back独立导航行，标题与右侧状态/Refresh/Details同排居中；600px以下整组移至标题下。Details按需展开不撑歪标题；dirty/Apply/unknown行为不改。
- 新增10项Chat布局/菜单生产renderer断言覆盖1180/500与workspace/service-chat/service-only/chat-only；新增Settings结构及CSS对齐回归。最终纯状态/adapter/生产函数368 pass，0 fail/skip；Desktop build、typecheck、测试编译及diff检查通过。既有Fullscreen浏览器测试入口同步改为先打开菜单；该完整Playwright并未执行。


补验结果：

- 最终功能冻结`1cba80bceb68af6a458f954af5c59a88fc6c2711`，官方云浏览器实际HTTP served 22/22 hash匹配。上一冻结d5的Chat代码与最终完全相同；最终同时复验500px入口。
- 1180px普通Chat头部只有一个Focus四角图标，Hide为独立箭头；Chat Focus使用Restore箭头和Exit ×。500px普通/Chat Focus/Service Focus均无头部浏览器全屏入口；Agent/Service⋯里的Browser full screen文字、aria-label、aria-pressed=false可达，未进入OS fullscreen。布局还原/折叠保持Service document UUID及草稿。
- 1180px Settings标题、状态、Refresh、Details中心Y全部231px；Back独立在上行。500px状态组统一位于标题下，组内中心Y=257.5px，scrollWidth=500。
- 首次500px Details展开发现左侧裁切，追加`1cba80bc`仅调整窄屏浮层定位并补CSS约束回归；最终浮层x=20/right=300、正文完整、scrollWidth=500，实际补验通过。失败原图不作为最终展示。
- 最终368项纯测试再跑通过，0失败/跳过；typecheck、build、native boundary、diff检查通过。宽窄对齐和入口定向已执行；OS fullscreen、真实读屏、完整Playwright及原其余未测矩阵状态不变，任务仍38/67。
