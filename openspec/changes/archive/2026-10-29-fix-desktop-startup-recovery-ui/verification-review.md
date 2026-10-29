# Verification Report: fix-desktop-startup-recovery-ui

## 最新核验结论（修复后，2026-10-29）

| Dimension | Status |
| --- | --- |
| Completeness | 20/20 任务完成；5/5 ADDED/MODIFIED Requirement 有实现；无不可读取的任务文件，无 REMOVED/RENAMED Requirement |
| Correctness | 5/5 要求完成实现映射，50 个 Scenario 已对照代码与测试证据；本轮未发现未解决偏差 |
| Coherence | 七项设计决策与源码模式已核对；原设计 3、4 的两项偏差已消除，未发现新的不一致 |

六类核验均已执行：Task Completion、Spec Coverage、Requirement Implementation Mapping、Scenario Coverage、Design Adherence、Code Pattern Consistency。没有因证据缺失跳过的核验项。apply 的 `all_done` 只用来核对任务，未替代代码和测试核验。

**CRITICAL：0。WARNING：0。SUGGESTION：0。** 原 WARN-1、WARN-2 已关闭：

- WARN-1：`app.ts:940` 的恢复缓存渲染通过 `adapter.ts:1391` 重新判断 iframe 保留条件；Stop、Delete、Work/Service 权限撤销及 Service 停止/失败/禁用/移除均撤回 iframe，其他编辑节点与草稿保持。八种持久回归及原正常恢复节点连续性场景均通过。
- WARN-2：`adapter.ts:436` 的任务投影检查匹配 Service 的新鲜事实、未确认归属和清理义务；`app.ts:327` 的单一当前任务入口覆盖所属任务。Ready Work 中的失败 Service 仍保留当前入口，实际恢复后归历史，原 failed 保持；不同 Service、终态缓存、未确认读取和清理状态的测试通过。展示判定不删除协调证据或解除未知锁。

本轮实际重新执行：

| 检查 | 结果/证据 |
| --- | --- |
| admission/pending adapter | 17 项通过，`dist/startup-reverify-adapter.log` |
| Core 启动、历史、正常连续性及两项 WARN 浏览器场景 | 16 项通过，`dist/startup-reverify-browser.log` |
| native-auth 完整文件 | 6 项通过，包含上次全量失败的认证恢复用例，`dist/startup-reverify-native-auth.log` |
| 已知记录及身份桥接 Go race 测试 | 通过，`dist/startup-reverify-records.log` |
| 规格/边界 | 严格规格验证、UI 语言、原生边界、文档边界、`git diff --check` 通过 |
| 成品一致性 | Desktop 构建资源与 Go 嵌入资源一致；生产源码与 GUI 快照 `fb89800426f532231f95febaf3213d690a9ab37c` 一致；桌面 exe 校验和与本次核验产物一致 |

本轮浏览器/adapter 共 39 项通过。上次全量的 1160 通过、1 认证时序失败、1 真实 Engine 场景跳过仍按原事实保留；本轮没有重跑整套 1162 项，也不以局部结果改写那次全量记录。认证实现与断言没有因复跑而修改。真实 Docker 重启、Windows GUI 窗口与同 Guest 隔离端口页面使用已有可读验收证据，没有再次启动用户安装；现场 Retry 具体失败来源及默认端口 GUI 全流程等范围限制仍见 [验收记录](verification.md)。这些限制不被计为已通过的测试。

本轮核验未发现未解决问题，可以进入归档流程。未修改实现、任务勾选、主规格，未提交或归档。

## 首次核验记录（修复前）

以下保留首次核验的两项 WARN 与原始证据，不表示当前仍有两项未解决 WARN。修复与最新 GUI 身份见 [验收记录末节](verification.md#两项-warn-修复复查2026-10-29)。

核验日期：2026-10-29。Schema：`spec-driven`。核验对象为当前未提交工作区；本轮只维护核验附件及忽略的临时复现材料，没有修改实现、任务勾选、主规格或归档。

## Summary

| Dimension | Status |
| --- | --- |
| Completeness | 17/17 任务勾选完成；5/5 ADDED/MODIFIED Requirement 找到实现；无 REMOVED/RENAMED Requirement |
| Correctness | 已对照 5 项要求及 50 个 Scenario 的实现/测试证据；定向复现发现 2 处偏差，见 WARN-1、WARN-2 |
| Coherence | 七项设计决策及源码组织已核对；设计 3、4 存在对应偏差，其他未发现显著模式不一致 |

任务勾选与 CLI 的 `all_done` 不作为实现完全正确的证明。本轮六类核验均有可用证据，没有因证据缺失跳过的核验项；没有把下述未执行的测试环境视为通过。

## CRITICAL

无。未发现整项要求缺失或未勾选任务。

## WARNING

### WARN-1：Core 恢复期间的页面缓存绕过已确认的运行能力撤销

位置：`apps/desktop-webui/src/app.ts:3514`、`apps/desktop-webui/src/app.ts:3524`。

`retainedCoreView` 只检查门禁、身份、路由和缓存存在性，恢复时直接复用 `lastAdmittedHTML`，未重新检查 Work/Service 是否仍允许保留。这与设计 `design.md:55` 的 Stop、Delete 与能力撤销规则，以及“使用中确认 Core 进入恢复”场景中的“适用 iframe”约束不一致。

复现顺序：挂载已就绪 Service iframe → Core 明确 RECOVERING → 从同身份原 Work 查询确认 desired=stopped、observed=stopped。adapter 已得到 `work.status=Stopped` 且 `project(work).retainWorkspace=false`，页面仍保留一个旧 iframe。预期撤回该 iframe 的断言失败，实际数量 1、预期 0。inert 只能阻止用户交互，不能撤回旧应用文档及其运行。

建议：复用缓存前检查当前 Work 与适用 Service 的保留条件；确认停止、删除或权限撤销时优先撤回 iframe/运行能力，合法草稿按原规则保留。将此组合场景加入持久回归，同时保持普通 RECOVERING→READY 的 iframe 节点连续性测试。

### WARN-2：Work Ready 掩盖仍未恢复的当前 Service 操作失败

位置：`apps/desktop-webui/src/adapter.ts:436`、`apps/desktop-webui/src/adapter.ts:443`、`apps/desktop-webui/src/app.ts:1976`。

`operationNeedsAttention()` 对 failed 结果主要检查 Work 状态，未检查原 Service/其他实际动作对象。Work/列表读回完成后，即使对应 Service 仍为 Failed，当前失败也被认作已结束历史。这与 DWUI-OPREC-004（delta `specs/desktop-webui/spec.md:131`）关于“明确失败且仍对应当前控制问题”的分类及设计 4 的对象问题投影不一致。

复现顺序：在 Ready Work 对一个 Service 明确提交一次 Restart → 原 Operation 按匹配 Work/Service ID 确认为 failed → Work、列表及 Service 全部读回。此时 `workSynchronizationPending=false`、Work=Ready、Service=Failed、原任务=failed，但 `operationNeedsAttention=false`；操作记录的“当前任务”筛选找不到该原 ID（实际 0、预期 1）。该失败仍可在全部/已结束和 Service 原入口找到，未被删除，也未证明未知写入锁被解除；问题是当前问题被错误分类。

建议：按操作类别和原对象的新鲜事实判断是否仍有匹配处理义务，纳入 Service 归属及当前失败状态；不要把全部 failed 一律保留为当前任务。补充“非必需 Service 失败但 Work Ready，读回已完成”的回归，验证其恢复后才归入历史。

## SUGGESTION

无。新文件命名、纯投影模块、私有记录存储复用、双语资源及 Go 嵌入资源组织符合仓库模式，未作风格性扩项。

## Requirement 与 Scenario 证据

| 要求 | Scenario 数 | 实现和测试证据 |
| --- | --- | --- |
| DWUI-012 对象等待与独立操作 | 7 | `requestRaw()`、`assertCoreReady()`、既有 ActionState/对象控制锁；反馈 D11/D19、W1/W2、Stop 取代 Start、晚结果与脏草稿回归 |
| Desktop Core 启动恢复 | 10 | `core-admission.ts`、adapter Core 观察、`coreStartupPage()`、动作/路由门禁；`core-admission.test.ts`、feedback 启动/失败/直达/草稿/iframe、local-auth 超时与登录、真实重启验收；恢复期间能力撤销存在 WARN-1 |
| Work 当前行状态 | 5 | `projectWork()`、`workControl()`、恢复观察；自动重试/两个 Work 真实重启、旧成功/新 Stop、原 Operation 404、五条 failed 历史回归 |
| DWUI-OPREC-004 当前任务/历史 | 9 | `operationNeedsAttention()`、终态提示/身份存储、历史筛选和原详情；旧格式/500 条/并发/身份、五条历史跨重载、未决与同步保护；对象级当前失败存在 WARN-2 |
| UIL-PENDING-001 统一等待与 Core 例外 | 19 | 保留原 Pending/Service 行为，新增 Core 四格位移动效和静态出口；overlay-role、feedback/pending 的双语、窄屏、减少动态效果、状态终结及节点连续性测试 |

七项设计决策均找到对应代码或验收证据：统一 readiness、跨路由有界观察、首进/中途恢复分别渲染、当前任务/历史投影、兼容终态记录、Retry 来源与只读计数、受影响构建模块。前两条警告分别影响设计 3 和设计 4；记录字段没有新增数据库模式，展示历史未通过自动删除实现。

## 执行与证据

- 本轮重新执行记录/身份相关 Go race 测试，通过：`dist/startup-verify-records.log`。
- 本轮重新执行 admission/pending adapter 16 项、既有启动/历史/连续性浏览器 7 项，全部通过：`dist/startup-verify-adapter.log`、`dist/startup-verify-existing-browser.log`。
- 本轮定向复现 3 项：2 失败对应上述 WARN，1 通过为“初次 readiness 取消后返回可见页面重新确认”，不将未复现的可见性疑点列为问题。日志：`dist/startup-verify-probes-final.log`；临时源码：`dist/startup-verify-probes-source.js`。复现未改生产源码；临时测试文件已移出正常 `dist/test/*.test.js` 匹配范围。
- 复核 apply 阶段 Desktop 全量日志：1151 通过、0 失败、1 跳过；Go 三包、Console availability 13 项及真实 Docker 重启日志均有通过结果。全量测试此前未涵盖本次两个组合边界；不把此前通过等同于这两项通过。本轮没有重跑整套全量、Docker 或 Windows VM。
- 本轮 `openspec validate ... --strict`、UI 语言、原生边界、文档边界及 `git diff --check` 通过。构建后的 Desktop 文件与 Go 嵌入文件一致；桌面 exe SHA256 仍与已核验产物一致。
- 原套件跳过的真实 Engine 浏览器用例、用户现场 Retry 的实际来源、原生 GUI 默认端口完整启动的限制保持原验收记录说明，不增加已经验证的承诺。Windows 分别验证 GUI 窗口和同 Guest 的隔离端口真实页面，详见 [原验收记录](verification.md)。

## Final Assessment（修复前）

发现 0 CRITICAL、2 WARNING、0 SUGGESTION。六类核验均已执行；可以按 OpenSpec 的提示性核验规则带已知改进项进入归档流程，建议先修复两个已复现的 WARN 再归档。本轮未修复或归档，也不将“17/17 勾选完成”表述为全部行为检查通过。
