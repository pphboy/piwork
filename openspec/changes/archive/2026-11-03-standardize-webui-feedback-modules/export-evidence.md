# Export 实施与验证记录

本附件只记录本 change 的导出责任批次，不代替最终跨端验收。生产协调器仍为 `apps/desktop-webui/src/export-flow.ts`；未改 Stop/Export/下载准备的协议或自动交付状态机。

## 实际责任与维护范围

| 责任 | 权威实现 / 接口 | 直接消费者 | 检查 |
|---|---|---|---|
| 导出阶段、原 ID、暂停/恢复、一次交付 | `export-flow.ts`: `ExportFlows` / `ExportPort` | app 装配、`export-panel.ts` 只读类型 | `export-flow.test.ts` |
| 准入 / 快照过期 | `export-admission.ts` | 协调器装配、导出展示、内容下载前再次检查 | `export-admission.test.ts`, `export-adapter.test.ts` |
| 导出进度 / 独立恢复展示 | `export-panel.ts`: `ExportPanelInput`, `ExportPanelModel`, `ExportPanelControlPort`, 两个 renderer | app 的 export / export-recovery 两个容器 | `export-presentation.test.ts` 直接 import；`action-hierarchy.test.ts` 的导出展示断言直接 import |
| 原快照/传输读写 | `adapter.ts`: `fetchSnapshot`, `downloadSnapshot`, `checkDownload` | 既有 flow 与具名 action handler | `export-adapter.test.ts`, `feedback.test.ts` D19 浏览器请求/字节回归 |
| 模态 / 背景与焦点 | `overlay-role.ts`, app 的既有 dialog 生命周期 | export 非模态进度 / export-recovery 所属诊断 drawer | `export-presentation.test.ts` 浏览器部分；`browser.test.ts` 失败 Stop 原 ID 恢复 |

调整进度布局只需读 `export-panel.ts` 的 input/model/render 函数、`export-presentation.test.ts` 与已有 `.export-panel` / `.export-details` 样式；仅接口变更才扩读 app 装配。无 Files/Chat/Serve 状态、完整 adapter 或任意字段 setter 参数。app 只组装导出事实，不保留第二份导出展示决策。按钮携带原 ID 作为不可见 action 目标；进度正文不暴露技术 ID。独立恢复容器显示并可复制原 snapshot，Operation 按原 ID 打开已有诊断。

## 来源族映射（本责任批次）

- **D19**：`ExportFlows` 的 checking/stopping/exporting/snapshot/preparing/ready/delivered/unknown/failed/revoked；snapshot preparing/validating/verified/expired/unavailable；transfer 实际字节、Pause、Check、Resume、重开。恢复沿同 Work 原 flow/snapshot/transfer；展示不发请求、关闭不调用 pause。测试：`export-flow.test.ts`, `export-admission.test.ts`, `export-adapter.test.ts`, `export-presentation.test.ts`, `feedback.test.ts` D19。
- **D21 的 Export 子集**：Work 菜单 `find-previous-export` → `export-recovery`；按 ID 读取带 expected Work；先前 Operation 与 snapshot 留在诊断表；选旧快照不自动下载，新意图与旧包下载不同。测试：`feedback.test.ts` DWUI-OPREC-001 与 D19 不同快照场景，`browser.test.ts` Stop 失败恢复，真实 `real-core.mjs` reload/lookup 验证入口。
- **D18 Import**：此批不改变 `inspectionContext`/Import 状态；既有 `real-core.mjs` 验证真实下载包 → Inspect → Import Stopped → 显式 Start。不能把未执行的真实链记为通过。
- **D20 日志导出、D22 About/偏好、D23 全局通知**：不是导出面板状态机的同义状态；保留其各自 owner，由对应 Desktop 来源批次验证，不能用本表宣称这些族已全部完成。

## 验证状态

2026-11-01 首轮编辑：新增直接 import 单测与浏览器断言，尚未执行（本地仓库 npm 依赖未安装，等待批准的锁文件安装）。存在 `/usr/bin/chromium`；尚未宣称浏览器通过。

真实 Docker/Core/Agent/helper 导出、完整 hash/长度、Import Stopped/显式 Start 链尚未运行：当前环境缺少可用 Docker runtime/socket。任务 4.3 不能据纯模型、mock 浏览器或原有历史结果勾选；需要可用隔离 Docker 环境与匹配 Agent/file/snapshot helper 镜像后执行 `apps/desktop-webui/test/real-core.mjs` 的实际链。冻结 V13 与旧验收身份未修改。

### 2026-11-01 08:34 UTC：无新软件预检

使用当前 Node 24 内置 `node:module.stripTypeScriptTypes({mode:'transform'})` 将真实源模块与测试转换到忽略的 `dist/export-preflight/`；依赖使用实际 locale、共享反馈、adapter 源码，不复制业务实现。不替代 TypeScript 类型检查、标准构建或 Playwright。

- `node --test dist/export-preflight/test/export-presentation.test.js`：纯模型/展示 **5/5** 通过（此临时入口只运行同一测试文件的非浏览器部分）。
- `node --test dist/export-preflight/test/export-flow.test.js dist/export-preflight/test/export-admission.test.js`：**87/87** 通过，覆盖 Stop 确认、原 ID、未知写入锁、Pause/Check/Resume、单次交付、身份撤销与 expiry。
- `node --test dist/export-preflight/test/export-adapter.test.js dist/export-preflight/test/log-export-adapter.test.js`：**46/46** 通过，是真实 adapter 的合成响应测试，不是真实 Core。
- `node --test dist/export-preflight/test/action-hierarchy.test.js`：**62/62** 通过；导出展示断言已直接 import。该文件的其他原有功能仍有 legacy VM 测试，不将此事实称为全仓测试边界已完成。
- 新 `export-panel-controls.ts` / `ExportFilePort` 抽取手动保存前的原 snapshot 与 transfer 读回、同对象/身份/可用性检查；只调用具名 read/deliver，没有写入或重建能力。`export-panel-controls.test.js` **7/7** 通过。
- Chromium CLI 尝试生成布局 DOM/截图失败：默认目录不可写，指定获准 `/tmp` 目录后报 `socket() failed: Operation not permitted`。没有生成有效浏览器截图，不记为视觉通过；不继续尝试绕过限制。标准 Playwright、实际服务入口和真实 Docker 链仍未执行。

标准构建后还须重新执行以上测试及 `export-presentation.test.ts` 的 360px/1440px、中英文、reduced-motion、非模态背景与键盘断言；浏览器端 `feedback.test.ts` 的导出请求/下载字节计数已按新独立恢复表面调整，未删去实际内容/hash 验证。

进度重开采用独立恢复页的 `show-export-progress` 入口：携带原 flow/work，核对原身份 epoch 与 Work 后只打开同一个 flow，不借用会创建新导出的 Export 动作。终态原进度也可重开，原当前内容导出入口仍是新意图。`export.progress` 为新增的对应中英文文案。面板模型还核对已有 flow.transferId，不能用同 snapshot 的另一个 transfer 替代原任务进度。

08:40 UTC 更新预检：手动保存增加“snapshot 对象被替换”和“读取返回另一个 snapshot ID”负例，现 **9/9**；面板 **5/5**；与当前 chrome 装配适配后的 action-hierarchy **62/62**，合计 **76/76**。完整浏览器部分新增独立恢复长 ID 七行的几何/键盘/复制/查询断言，未执行状态不变。

08:59 UTC 集成预检：更新当前真实共享通知/chrome 与导出源模块后，面板 5、手动保存 9、action-hierarchy 62 再次通过。另新增 `feedback-message.test.ts` 直接导入实际通知投影/Store、LocalizedMessage 与文件结果/未知锁 owner，**5/5** 通过：保留通知切换语言不重发；完成/读回不重复成功；真实读回失败替换成功；累计文件失败/未知使用正确 tone；重试只由原 ledger 通知；关闭通知不改 ledger 或未知锁。此处仍是 Node 内置 TypeScript 转换运行，不替代标准类型检查、浏览器操作或真实 Core 链。通知改动仅触及反馈投影和原状态 owner，不改导出 admission、任务身份或内容交付。

09:09 UTC 追加同一反馈链审计：原 Work Start/Retry、Service Control、共用 Stop/Delete/Apply/Package/Import acceptance 与 Create acceptance 的 `actions.confirm` 仅代表 HTTP 接受，不代表业务完成；已交接原 owner 抑制接受成功 toast 的定点补丁。新增 `operation-feedback.ts` 只登记本 UI 接受的原 Operation 身份，以实际 checked Work/kind/Service 与原 ID 读回投影；不读取全局历史、不发请求、不轮询、不改变锁、不将 Operation succeeded 当 Work Ready。已验证终态经 host 接受后释放 registry owner；关联读回失败仍优先保留，原 ActionRecord 的弱引用 owner 可在真实恢复后替换错误。直接测试 **11/11** 通过，包含 pending 静默、错误身份/历史 hint/Service 负例、未知/失败/superseded、原 identity、终态释放及读回失败恢复。当前 app 语法转换通过；以上仍非标准类型检查或浏览器证明，不据此勾选整个 5.x。

09:42 UTC D02–D12 相邻来源补漏：已实现 Work/Settings/Service 的有限只读来源接口与 Desktop 本地通知 episode helper。实际读取错误通过原 resource owner 发通知，并精确归并既有 read ActionRecord；任何 mutation/readback 和未知写入锁不归并。清空 error、进入/退出 loading 均不算成功，只接受同 owner 新的成功读取时间戳或原结果 receipt 引用；微任务清理仅回收原 read record，并再次检查当前 proof。当前直接 read-feedback 测试 **18/18**，含 Settings 原入口、重复错误归并、语言切换、source reset、Service preview 的实际 unknown 与普通 HTTP 读取 error 区分。代理 Files 子批直接测试与既有预览回归 **35/35**（只读反馈 14、目录截止 4、既有预览 17）；实际 PROPFIND 头部/正文使用既有 10 秒 read deadline，旧 generation 不得结束新读取。首配置失败不能展示默认空配置编辑器；Packages 有独立 GET 状态恢复且不覆盖 dirty config；Service 日志首读 skeleton、cleanup 刷新保留已确认内容。浏览器新断言已交接，未以 Node 预检冒充执行通过。

范围判定：成功读取中恢复的 Work/Service 历史 Failed/Unknown 仍由现有 projectWork、Service 本地状态与恢复入口呈现；不会仅据历史状态自动宣告新任务或弹出新任务通知。当前 UI 接受的异步意图由原任务的专有反馈 owner 处理。该区别不是漏掉业务事实，也不授权制造通用 Operation 或历史事件广播。

09:52 UTC 有限来源契约再验：真实源模块经同一 Node 内置转换，`file-results`、`file-admission`、`action-state`、`feedback-message`、`read-feedback`、`operation-feedback`、`file-preview-adapter`、`service-read-feedback-adapter` 共 **98/98** 通过（忽略目录 `dist/export-preflight/5.2-contract-results.log`）。新增 Service 实际 adapter 两例证明 preview HTTP 403 只保留入口访问失败、HTTP 503 保留已有入口并按普通 read error 呈现，只有新的成功原 probe receipt 才恢复；非真实服务器/浏览器证明。

### 5.2 有限证据矩阵（不以类型/构建缺失笼统替代逐项判断）

| 条款 | 已运行直接契约 | 尚未证明的实际 app 行为 |
|---|---|---|
| 局部/部分/未知文件写入 | `file-results` 的原 attempt、204/403/unknown、不可重放与锁；`file-admission` 实际 adapter 207/Stop 边界；`feedback-message` 累计 ledger 单通知和原锁不变 | 浏览器混合上传/批次操作与 notices/行内结果同时呈现未运行 |
| 旧草稿/新选择 | `file-preview-adapter` 旧请求不覆盖新 target/identity，403 保留原预览；Files 精确 read owner | `feedback.test.ts` 的 dirty 文件重读、显式 discard、Core 切换晚回调仍是已写未运行浏览器断言 |
| Save/Apply 确认与读回失败 | `action-state` 确认不被 readback failure 改写；`operation-feedback` 原 receipt 与关联 readback 优先级/identity | 实际 app 配置保存期间新编辑、Save 成功后 503、Apply/Package 保留原 ID/草稿的浏览器用例未运行 |
| Packages/Skills 元数据 | `read-feedback` 有限 config/packages/catalog owner、实际成功 proof、不会归并 mutation | 新 package GET 恢复保留配置 dirty draft/no PUT 浏览器用例未运行；不能用配置首读 CUA 替代 |

父代理的配置首读失败/恢复 CUA 属于实际选定路径证据，范围是初次失败不出现空配置编辑器和原读取恢复；不推及上述未运行路径。5.2 的勾选需据这些实际 app 剩余验证决定，而不是凭直接测试数量或整个 8.1 是否完成。

09:56 UTC D19/D20 异步 owner 接入：新增 `export-feedback.ts` 只登记本 UI 接受的原 Export flow / log-export task，不扫描恢复历史、不发请求、不接管锁或重试。Export pending/Stop 等待/版本等待/外部控制等待/transfer 尚无事实均保持原本行内指导且不发错误或成功通知；真实 read/observation/delivery 失败由源 `feedbackIssue` 与保留的 `feedbackError` 标识，不按翻译后字符串猜测。只在同一原资源读回确认后清除 read issue；Pause/Hide/Resume 开始/错误字段暂时清空不是恢复。原面板同时保留该 issue，不以 toast 为唯一事实。原 phase failed/unknown 的业务错误仍优先。

手动保存端口仅在原 snapshot/transfer/epoch 验证并完成现有浏览器 handoff 后返回原身份 receipt；`confirmDelivery` 只清除完全匹配、已自动消费的 delivery issue，不更改业务 phase、未知锁、次数或物理磁盘保存语义。已发布终态 owner 从强 registry 回收，弱原对象关联仍能精确移除其失败通知；不重复发交付成功。日志导出只有实际 ready 才表示压缩包就绪（不是磁盘已保存）；实际 incomplete/warnings 按 warning，未知/读取失败按原任务恢复。显式新日志任务不能让旧 notice 打开新任务：旧 key 已不保留时，现有日志 dialog 明确不可用并仅允许关闭，不创建历史/重放接口。

最终当前源转换测试 **167/167** 通过：ExportFlows、admission、实际 export/log adapter、直接 notification projection、手动控制 port、纯 panel；包含实际协调器→浏览器交付异常→通知终态回收→原手动保存 receipt→弱 owner 静默恢复完整直接契约。`dist/export-preflight/export-final-results.log` 为临时结果；8 个相关增量源风格检查通过。该结果不替代 TypeScript 类型检查、标准 WebUI build、Playwright 或真实 Core/下载字节链。忽略的合成 CUA fixture 另提供真实 handler 状态控制，最终视觉/交互证据由父代理记录。

10:01 UTC 最终有限恢复补证：当前合计 **170/170** 通过，无 skipped/failed。原 snapshot 读取恢复但 package 仍 preparing 时只清读取错误，不生成 ready/交付；原 transfer POST 受理未知后，只有目标匹配且实际 `seen+checkedAt`（或已验证 ready）的 transfer receipt 才静默恢复通知，preclaim 404 返回本地 pending placeholder 不算确认，原 Pause/单次 POST/无交付保持不变。日志 GET 恢复为真实 collecting/packing 时，以原 task ref/key/identity+已知 receipt 且无 error 静默清除旧错误；creating/unknown/error 清空等开始状态不算确认。`FlowFacts` 为只读有限 Pick，不暴露可写全 flow。最终当前源与直接契约已冻结等待父代理选定 CUA；真实 Core/标准构建/完整 Playwright 的未执行边界不变。

10:21 UTC 有限 bootstrap 补漏（父代理明确批准 D01/D02/D21 三个原来源，不扩展扫描）：`bootstrap-read-feedback.ts` 仅接收 status / known-operations 的 readonly identity、reading、error、opaque successful receipt；Works 始终复用原 canonical collection owner。实际 status GET 失败与 downstream Works/records 失败有源内 provenance，不能用相同错误文字归并；status receipt 只来自实际接受的响应，重试开始不清保留 issue。known-operations 使用既有 10 秒只读 deadline，私有可变 state 配窄 readonly getter，epoch/readgeneration 隔离，完整数组及原 operationId 校验先于插入，失败保留旧 records，不制造任务或更改业务锁。

实际 initialize/status 与 adapter/source owner 新测试 **7/7**；连同既有 pending/session/control/continuity/export/log adapter 回归 **105/105** 通过（`dist/export-preflight/bootstrap-adapter-results.log`）。覆盖相同 server checkedAt 不妨碍新 receipt 证明、source 同文不同归属、malformed batch 原子保留、旧身份晚响应、deadline 后响应无效，以及底层 GET 去重时只发布一次记录。三个实际 app 浏览器断言已写但未运行；零 Works/零记录时关闭通知后的既有固定恢复入口仍需对应集成补丁与父代理 CUA，不能以这 105 项宣称该 UI 条款已通过。标准构建/类型/全 Playwright/真实 Core 边界不变。

10:23 UTC 固定恢复入口补丁已集成：零记录但原记录 GET 失败时仍显示既有 Works header task entry，不显示虚假“0 个任务”计数；既有 works-tasks drawer 保留错误/只读 Retry，并以明确 `original-task` scope 进入已有 operations modal 的复制原 ID 输入，不隐式选择某个 Work、不复制输入实现、不增加历史表面。关闭通知不清 adapter 错误或隐藏该固定入口。对应零 Works/关闭通知/复制 ID/GET Retry 浏览器断言已补齐，执行证据仍由父代理的选定 CUA/后续标准浏览器检查记录。
