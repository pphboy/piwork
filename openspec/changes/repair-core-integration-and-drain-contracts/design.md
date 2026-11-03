# Design

## Context

见 proposal.md。初始清单来自候选 `99228aca2aa01ead78eb6a251e3929dc20368d80` 的真实集成：452 PASS、16 个顶层 FAIL、6 SKIP；子测试失败不重复计数。没有基线执行证据，不能称为全部旧问题。本规划未运行修复后验收。

源码已核对：`runs.ts:286–305` 在 drain 超时后 abort 并再等最多 2 秒，但 Promise race 返回不区分未 settled；`daemon.ts:127–139` 持有准入栅栏。`dockerengine/resources.go:285–300` 对 Service 强制 Memory=0，旧集成却期待 64MiB；`agent-conversation` 当前要求同 Session 新 Run 使用当前 active context，不要求旧 Session 拒绝继续。`nativeApplyFixture` 共用 5 分钟上下文；Skill 的 generic storage error 出现在等待原 Apply 读操作处，不足以证明重启存储损坏。

## Goals / Non-Goals

**Goals:** 有界确认 drain、正确区分恢复观察与真实完成；使固定 16 项按实际有效契约获得可重现结果，并保留跨 Work、原请求、原 Run 和资源归属保护。

**Non-Goals:** 不回退 Session 新语义、不降低安全约束、不升级生产数据格式、不全仓重构、不增大默认关闭预算、不改 UI 设计或原变更历史证据。

## Decisions

1. **契约优先而非结果优先。** 缺镜像用可追溯真实旧构建或明确不兼容合成夹具，不能将当前镜像改标签冒充旧实现。Service Memory=0、当前 schema、WORK_BUSY HTTP 状态、同 Session 新 Run 均核对权威源再修改断言；保留内容、幂等和拒绝副作用的原检查。
2. **状态归原 owner。** Agent Run/daemon 唯一管理接受和执行结束；`application.ts:495–498` 当前无条件返回 drained=true，RPC 必须只投影已确认/未确认结果；Go workruntime/coreapp 负责剩余预算、容器核验、Operation 和其他 Work 并行收尾。不以放宽上层成功条件掩盖未结束执行。优先复用现有错误/响应协议；若必须改变协议，明确兼容性并按 make generate 同步，不能只改一端。
3. **恢复测试等待真实目标。** Application 启动是异步的，先读既有有界 readiness/目标 Work 状态，再验证精确服务、文件收尾、数据和历史；不写固定 sleep、不把全局 Ready 当每个 Work 已恢复。失败输出只记录安全 phase/outcome/context deadline/原操作状态，禁止完整秘密或用户文件。
4. **未知项有限追因。** 迁移 stop、临时清理、Skill Apply、process diagnostics 分别补充原失败点所缺的证据及确定性 barrier，再作最小修复；不得先改超时、吞错误或删除断言。有效规格已覆盖的行为不另设平行规则。

### 有限失败清单与初始分类

| # | 既有测试 | 初始定位；非完成结论 |
|---|---|---|
| 1 | `TestRealNativeAgentImageStaticCapabilitiesAndBuildEvidence` | 夹具缺失 |
| 2 | `TestRealManagedResourceLifecycleAndOwnership` | 有效 Service 内存契约断言 |
| 3 | `TestNativeBrainWorkstationFeedbackExperienceAndActualCandidateBehavior` | 有效 Session 续聊契约断言 |
| 4 | `TestNativeCoreWebDAVUploadStopApplyRevocationAndRestart` | 恢复 readiness 观察 |
| 5 | `TestNativeMemoryMigrationProcessRecoveryAndStopSupersession` | 迁移 stop 未决 |
| 6 | `TestNativeSchema4ConversationUpgradeRollbackAndDowngradeFence` | 当前 schema 断言 |
| 7 | `TestNativeSchema4ExperienceUpgradeRollbackAndDowngradeFence` | 当前 schema 断言 |
| 8 | `TestNativeCoreProcessHealthIdentityRestartWithoutHostTools` | 安全诊断分类未决 |
| 9 | `TestNativeChatModelSelectionRunsThroughGoAndRealSDK` | 有效 busy 拒绝契约断言 |
| 10 | `TestNativeSDKDeploysServiceThroughGoMCPAndCore` | 恢复 readiness 观察 |
| 11 | `TestNativeServiceRevisionsCounterAndRemoval` | 恢复 readiness 观察 |
| 12 | `TestNativeCancelledCheckpointHistoryAfterEventCompaction` | 当前 schema 断言 |
| 13 | `TestNativeShutdownConfirmsOtherWorksAfterFailedAgentDrain` | drain 真实确认 |
| 14 | `TestNativeSnapshotMovesServicesContextsAndPackagesBetweenOfflineInstallations` | 有效 Session/Run 导入契约断言 |
| 15 | `TestNativeTemporaryCleanupRetriesAfterEngineReturns` | 临时清理 requested 未推进 pending/DOCKER_UNAVAILABLE，request.succeeded 非清理完成 |
| 16 | `TestNativeSkillFailuresRemainSpecificAfterRollbackAndCoreRestart` | Skill Apply 原操作读取遇五分钟 deadline；尚未到 reopen |

独立于 TS Promise race，Core 路由关闭链存在提前 Revoke/Close、后续 drain 无原连接可用的风险路径；该项由 Go owner 核对并修复，不能只修 Agent 后宣称 drain 链完成。准入撤销与 transport 关闭必须分离：先撤销新请求，按原 Work/代次保留唯一 drain receipt/连接所有权，drain 和停止确认结束后才关闭，失联不能伪造成已 drain；不新增跨 Work 全局成功标志。Core 恢复还须检查现有 `internal/coreapp/work_recovery.go` 及实际 RPC routes 的 drain receipt 消费，按原 Work/代次关联，不能借全局布尔量跨目标确认。另保留已知 Service iframe Stop→Start 偶发的有限诊断：只记录 entry/DOM 代次与受控事件顺序；无根因不加重试/超时、不扩大 UI 改造。

## Risks / Trade-offs

- [异步时序使错误归因失真] → 原阶段安全诊断、确定性 barrier、同一原操作观察，保留失败样本。
- [drain 改动影响取消和并发提交] → 空闲、正常结束、abort 后仍运行、重复 drain、迟到回调、跨 Work 及身份负例直接测试，再做真实容器停止。
- [全量 Engine 验收耗时及外部依赖] → 先分组快速定位再全量；明确环境/镜像来源和 skip 条件，禁止把局部通过写成全量通过。

## Migration Plan

不计划存储迁移或发行。规划、契约/夹具、Agent drain、必要 Core 修复及跨组件验证按依赖组织提交；对应测试和生成物跟随功能提交。回退按功能提交执行，不能删除用户安装或强行解锁未知任务。实现完成后单独提交审阅，不自动合并、归档或发布。

## Open Questions

四项未决失败的原阶段证据仍需在 apply 中取得；这不改变已有契约或有限测试边界。若证据要求改变公开语义、预算或持久格式，停止该项并修订规划，不默默扩大范围。

## 修复候选的全量验证调度

仅完整 `integration-go` 使用固定 `core-repair-v1` 并发组，并由新修复候选替代同组过时运行；其取消结果必须记为未完成，不能视为通过。其他验证组不自动取消，旧 UI 文档候选的不同并发组不受影响。集中发布相关修复后冻结最终候选，必须等待最终 SHA 的完整 Go 套件真实终态，不以目标组或被取消运行替代验收。

## 2026-11-03 停止确认收尾修正

当前完整套件的五项失败均在关闭相关路径出现；继续核对发现 `stopCapturedWorkLockedWithDrain` 在 `StopAgent` 已确认精确容器停止后仍返回 drain 未确认错误。按本 delta 的停止确认契约，drain 未确认写入安全的 Work/代次诊断，容器停止失败仍聚合返回；容器停止、历史收尾和持久状态均确认后，不将该 drain 诊断当作 Stop/替换失败。owner 为 coreapp，直接消费者为 Work Stop、Apply/替换和 Core Close；不改 RPC/预算或丢弃执行历史。原失败用例与真实关闭测试用来验证，3.3 在复验完成前重新保持未完成。

本轮真实关闭采样进一步确认：Docker 已报告原 Agent 停止但仍保留 route 时，向已消失地址发 drain RPC 会耗尽测试的 3 秒进程预算，继而产生存储关闭未确认。该分支直接记录原 Work/代次的 drain 未确认，仍经 `StopAgent` 核验精确容器；只有 live/unknown 容器尝试原 drain RPC，不伪造成功 receipt，不增加任何预算。真实关闭测试保留双 Work 的 Docker 检查、持久诊断及原用户意图断言。

本机候选验证：当前源码 Agent production/acceptance 镜像重建通过，相关 Go 单元与集成包编译通过。以独立测试安装运行五项原失败及真实关闭回归，六项均在 Agent 启动阶段提前失败（AGENT_EXITED），未到达停止收尾断言；结果保存在忽略的 `dist/apply-stop-regression.log`，不能据此勾选 3.3 或全量验收。候选关闭测试同时要求 Docker 精确停止、持久 drain 未确认诊断与原用户意图保留。Playwright MCP 在合成复现脚本执行时断开（Transport closed），再次导航仍失败，UI 复现未完成；临时静态服务器已停止。

## 2026-11-03 apply 来源与环境复核

上表初始结果仍只归属 `99228aca2aa01ead78eb6a251e3929dc20368d80`，当前复核候选为 `3822c238579e1c4db2ff6090acf5786835d9e451` 加未提交 Core 停止修正；不是已执行的更早基线。16 个精确测试名与分类不变：1 项夹具、7 项断言（2/3/6/7/9/12/14）、3 项 readiness（4/10/11）、1 项 drain（13）、4 项待追因（5/8/15/16）。当前测试来源及有效契约对应如下，序号沿用上表。

| # | 当前测试文件（相对仓库根） | 有效规格来源 |
|---|---|---|
| 1 | `internal/dockerengine/image_capabilities_integration_test.go` | `native-runtime-distribution` |
| 2 | `internal/dockerengine/resources_integration_test.go` | `work-services` |
| 3 | `internal/coreapp/brain_workstation_integration_test.go` | `agent-conversation`、`work-configuration` |
| 4 | `internal/coreapp/file_lifecycle_integration_test.go` | `work-lifecycle`、`work-storage` |
| 5 | `internal/coreapp/memory_process_integration_test.go` | `work-memory`、`work-lifecycle` |
| 6/7 | `internal/coreapp/memory_upgrade_integration_test.go` | `work-memory` |
| 8 | `internal/coreapp/process_integration_test.go` | `core-service-startup`、`work-lifecycle` |
| 9 | `internal/coreapp/run_models_integration_test.go` | `agent-conversation` |
| 10 | `internal/coreapp/service_deployment_integration_test.go` | `work-services`、`work-lifecycle` |
| 11 | `internal/coreapp/service_runtime_integration_test.go` | `work-services` |
| 12 | `internal/coreapp/session_history_integration_test.go` | `agent-conversation`、`work-memory` |
| 13 | `internal/coreapp/shutdown_integration_test.go` | `work-lifecycle` 主规格及本 delta |
| 14 | `internal/coreapp/snapshot_import_mapping_integration_test.go` | `agent-conversation`、`work-snapshots`、`work-configuration` |
| 15 | `internal/coreapp/temporary_engine_failure_integration_test.go` | `work-services` |
| 16 | `internal/coreapp/work_diagnostic_integration_test.go` | `work-configuration`、`work-memory` |

环境为 Go 1.25.5、宿主 Node 24.20.0（初始 shell 为 24.2.0）、Engine 29.1.3、Agent 内 Node 24.22.2。宿主 shell 的 `umask 077` 会改变宽权限夹具及 Docker COPY 的输入权限；在独立构建上下文保留当前受跟踪文件字节，按 Git executable bit 规范为 0644/0755，原工作区权限不改。该上下文 hash 为 `49a0f3754de7950e59cfc2cdaa7b9a121b9e2a1f20a02861e5a9d2957237f6b9`，含本轮最终 dead-route 修正之前的 Core 文件；Agent/helper 不消费该 Core owner，Go 测试与宿主构建使用当前工作区。镜像不冒充旧发行，以下均为 commit `3822c238579e1c4db2ff6090acf5786835d9e451`、modified=true 的真实本地构建：

- Agent production `sha256:8f64f0d370d2d934f8dba91a44358cca1e0f33180537d24463df8f16cbc20ded`；acceptance `sha256:fed525adbedf8bf5879681335d399942d45601bf85bff301dc6e8a322103ff2f`，非 root 实际导入 `@piwork/contracts` 通过。
- file helper `piwork-file-helper:apply-3822c23`，`sha256:ecd00a1e887b5a2e907483496413a00e54f23fc04871327aaff48bb209a45475`；snapshot helper `piwork-snapshot-helper:apply-3822c23`，`sha256:9a31d4bc50a76572701f389be09e4a0fb6d57f56e34b9c0154d110731553b9f9`。
- 真实旧 SDK 0.86.0 夹具 `sha256:bc6b754b929bacf78a5f8baed73b392390ceedd8b7fa745eb04f792fcc0371bc`；unavailable-registry `sha256:a4dd638f3185891c72846c3370c97d911cceb2b277149dd4d790d60cd964fa66`；不兼容 helper 合成夹具继续保留明确合成标识。

`TestRealEngineCleanupLeavesOtherInstallation` 和 `TestScopeRejectsBroadCleanupBeforeIO` 实际通过：只按本次 UUID installation 标签核对并移除自身资源，另一个安装保持。`dist/apply-drain-022.log` 的 Agent 权限失败及 `dist/apply-drain-canonical.log` 的关闭预算失败均保留。修复 dead-route 分支后，原关闭测试在 `dist/apply-drain-confirmed.log` 通过，仍使用 250ms/100ms/3s 的原测试预算并检查双 Work 容器、持久未确认诊断与持久用户意图；Go agentclient/workruntime/coreapp 的对应负例及 race 通过，Agent `runs.test` 18/18 通过。协议未变，3.3 据此完成，不代表完整集成通过。

本轮 `make build` 通过（`dist/apply-build-final.log`）；随后 `make -o build test` 完整执行其余 `make test` 依赖和配方并通过（`dist/apply-test-final.log`），没有删减测试。前者只在构建进程指定当前 Git worktree，保留 `-buildvcs=true`；后者不传 Git 目录变量，使用 Node 24.20.0、umask 022 和 `GOFLAGS=-buildvcs=false`，该 flag 仅避免本机 Go 1.25.5 将 worktree `.git` 文件之外的父级空 `.git` 目录误作仓库，适用于测试内部临时二进制。最初全局 Git 环境透传导致临时 Git 测试误提交当前改动，已撤回该误提交并恢复原 HEAD/4 个未提交文件，后续不再透传；首轮失败日志保留。Node 24.2.0 的 symlink rmSync 环境失败和 umask 077 的宽权限夹具失败亦未改成 skip。单独 Desktop 直接测试 1002/1002、Console unit 161/161、共享 UI 34/34、资源再生成漂移与增量 source-style 通过；协议/历史未改，不运行无关生成链。

4.5 的有限复验使用正式 Go/Core、Agent 和新 helper，以及 `real-core.mjs` 现有的 entry 响应事件、原 Work/Service/port、iframe DOM service key、文档 pathname/readyState/标题采样。在 `dist/apply-desktop-real-core.log` 这一轮，原 Stop 和唯一 Start 后，原页面 `Real Service` 标题在原 20 秒预算内出现，未复现该 iframe 故障；随后失败发生在另一新页面的原 Operation 技术详情展示，不能混同为 iframe 失败，亦不能称整个真实链已通过。不新增 Service 重试、sleep、预算或 UI 改造，原失败附件保留；5.3/对应 WebUI 8.2 继续未完成，单次未复现不证明根因已消除。

随后 `dist/apply-desktop-real-core-diagnostic.log` 实际 exit 0，原查询八项守卫全部保持并通过，原 Operation、唯一 Stop/Start、605727168 字节单次 Export/prepare/download、Import Stopped/显式 Start、原 Session/Thinking、跨安装离线历史链接恢复及精确安装清理均通过。第一次查询失败记录保留，不宣称根治偶发。Administration 正式 258/258、串行真实 Core 8/8；真实日志 GUI 在 `dist/apply-log-export-gui.log` 通过原 key/详情恢复、两次显式下载相同 hash、真实 partial 缺口与 redacted 合成标记，浏览器直连 Core 为 0。仅日志 GUI 的测试 Go overlay 将 mTLS listen/advertise 同置独立端口 59581，避免与完整 Go 的生产 7172 进程测试争用；生产源码及默认值不变。夹具身份和未再运行的独立 CLI/Core 容器部署边界同步记录在 WebUI implementation-evidence；5.3 据此完成，不替代 5.2。

补建历史 fixture 使用现有 CI 固定来源 `20fb8334f1dce93bfa79cb6b5c86acf1cc460963` 的 git archive，schema.sql hash 实际为 `07179ce0116e6c1fb6f5db77f249ec2e1175ac43487d35b6eb0325f201fa73f9`。原 schema-4 acceptance 为 `sha256:2376213c20210fff465980788300cc8ad4154d59039322b657da29398e2cdb48`；只替换确定性部署 driver/Service MCP 的既有桥接 fixture 为 `sha256:26000d925aa901691c699858db29172ce6d8d49fd2c56ed42852015d448d0bfa`，没有冒称已发布旧镜像 digest。两个原 schema-4 升级/回滚/降级栅栏真实测试以同一新候选 Agent/helper 通过（`dist/apply-history4-tests.log`）。最初 16 目标组中的两项进程测试因与 GUI 争用 7172 失败、这两个 schema4 因未指定环境键沿原条件 skip；原 `dist/apply-core-targets.log` 完整保留，不能称该次目标命令全部通过。

本轮读取/修改边界为 `work_start.go` 的停止 owner（约 520–675 行）、`application.go:568–711` 的关闭预算、`work_recovery.go:505–550` 的跨 Work 协调、agentclient Drain、workruntime StopAgent/routes 及其直接测试；只有 coreapp 停止 owner 和原真实关闭测试有实现 diff。为原 ID 诊断扩读 Desktop `app.ts:4315–4345`、`adapter.ts:1775–1832` 和原浏览器恢复 helper，未修改其业务。没有新增写入所有者、协议/历史/配置或部署消费者，无相应生成/双语命令同步。交付按 Core 停止功能及对应真实测试、两个 change 的任务/验收记录两组审阅；当前不执行 Git 提交、主规格同步、归档或发布。

用户明确选择“先结束本轮，保留后台测试”。本轮结束时完整 `test-integration-go` 的原五包 Go 命令仍在运行（Go PID 690583，Core 测试 PID 690933），使用上述当前 Agent、新 helper、旧 SDK/registry 夹具、Node 24.20.0、umask 022 和测试专用 `GOFLAGS=-buildvcs=false`，不带 `-run`/`-skip`，日志为 `dist/apply-integration-go-full.log`。Make 中的镜像/宿主/harness/workstation 前置已分别真实构建，执行等价完整 Go 命令时只替换新 helper 的明确引用。此运行开始时未传 history4 环境键，两个 schema4 原条件 skip 须与已单独通过的 `dist/apply-history4-tests.log` 一起核对，不能改写成完整命令中的通过。后台摘要 `dist/apply-integration-go-result.json` 仅解析日志，自动收集终态、失败、条件 skip、包结果和当前输入 hash，不自动勾选任务。5.2 保持未完成，后续先取该运行真实终态并核对原 16 项，不以本轮阶段输出宣称全量通过。

该轮完整集成最终 478 PASS、5 FAIL、8 原条件 SKIP，原日志保留。原 Workstation 失败对应的实际本地 Web base 将 `piwork_web.py` 等打包成 root:root 0600，non-root `import piwork_web` 明确报 PermissionError；在线包测试的只读 bind 模型夹具也继承宿主 0600。权威源分别是 Web base Dockerfile 与在线包 integration fixture；前者将代码资源的容器内权限固定为 0644，后者仅将合成脚本复制到本次测试目录并设为 0644，不改变用户数据或放宽容器权限。Agent runtime 的 workspace package.json 也固定容器内只读权限，避免同一受限宿主模式再次造成 Agent 无法启动。消费者为非 root Agent/Service 与真实测试；须从源重建镜像、验证身份并复跑原失败和完整集成。进程测试的 7172 端口须串行，历史测试显式使用已验证 schema-4 桥接镜像；不把这些环境修正写成旧运行已通过。

修正后在宿主 `umask 077` 下从当前源码重建：Agent runtime 的 `/workspace/apps`、`/workspace/packages` 保证目录可遍历且工作区依赖可读，Web base 的 `/opt/piwork-web-base` 同样保证非 root 可读/可遍历；没有改变用户 Work 数据卷。旧 Agent、旧 Web base 的非 root 读取分别失败，新镜像分别成功（`dist/apply-fix-permission-negative.log`）；`TestRealNativeAgentImageStaticCapabilitiesAndBuildEvidence` 增加生产/acceptance 两个真实镜像在非 root、只读根文件系统、无网络下读取入口并导入四个 workspace 包的正例，实际通过。此时实际镜像分别为 Agent acceptance `sha256:13f9a848cb3d82a9027da9963250c382deb7dd22774601482576468df042e3e9`、production `sha256:12fc82b1bee7f03f5d9274255a9ad14d34cd79a5704305a26ff1333775d9f1ac`、Web base `sha256:6254c3683e3556ca6a62bde764ed693d330281ebb28cc6eb9cecc6bc6235b472`，均为真实本地 dirty 构建，不改写此前身份。

完整运行的五个失败均已在上述候选及对应隔离 fixture 下复验通过：文件崩溃恢复与在线 Package 见 `dist/apply-fix-process-online-v3.log`；Workstation 全链、accepted-action gap 和 legacy Memory 见 `dist/apply-fix-workstation-targets.log`。历史用例明确设置 `PIWORK_TEST_NATIVE_HISTORY4_IMAGE=piwork-memory-history4-web-base:acceptance`，未重标原 schema-4 镜像；单项复验不等于整套集成通过。`make -o build test`、Docker Quick Start 与其 30 项测试、增量风格、边界及 diff 检查通过。仍须使用固定新候选执行 16 项原目标组和完整 `make test-integration-go` 并核对全部 skip，5.2 保持未完成直到最终结果满足该条件。


`optimize-core-integration-test-execution` 已授权替换执行层。5.2 改由一次完整运行的 `plan.json`、结构化事件及 `result.json` 消费原 16 项证据，不再额外预跑重复目标组。必须 full/passed、清单恒等、原 16 项逐项 PASS、包/进程成功、skip 条件可解释、源码/配置/二进制/镜像身份未漂移、清理确认。局部 partial、旧候选、缺失历史镜像、aborted 或后续修改均不能提前勾选；运行器不写任务。旧失败、原 SHA/dirty/image 身份、schema-4 来源与可选边界继续保留，实际新全量终态产生前 5.2 保持未完成。


新的并行完整门禁实际复现 WebDAV 撤销独立上传会话后原会话 GET 返回 401。只在忽略的 dist/auth-session-diagnostic 使用诊断 overlay，确认 Identity.Authenticate 的存储错误来源为 db.Conn 的 parent=context canceled、store=<nil>，不是用户会话被撤销。文件取消通过过期连接读 deadline 解锁 I/O，会取消 net/http 的连接级 context；清除 deadline 不能使连接可复用，AfterFunc 的 stop 也不等待已启动回调。修正在 file_http/file_execution owner：等待 I/O/body-close 回调收束，已取消连接在未发响应时标记 Connection: close，已发响应时以原 ErrAbortHandler 关闭。会话规则、原文件内容/操作次数和期限未改，WebDAV 测试也未加绕过或成功重试。独立四进程各三次共 12/12 PASS，相关直接/race 回归通过，最终完整运行另行核对。


并行门禁随后实际复现 Package queue 的 ListContainers 在 list→inspect 间目标 helper 被回收，原封装把一次确认 404 当作整次 Engine 观察失败。Runtime.ListContainers 只忽略该已确认消失的 ID，继续 inspect/核对存活资源；503/其他错误与存活项跨 installation 标签仍失败。direct fake Engine 三种分支与 race 通过，真实队列/容量/新上下文合并场景单独复验；不改队列容量、慢脚本或生产重试预算。

完整门禁最终收束：dist/core-integration/2026-11-03T05-53-27.832Z-2653395/result.json 为 full/passed，499 个顶层测试按实际清单各执行一次，493 PASS、0 FAIL、6 条已解释可选 skip，原 16 项全部 PASS。五包全部真实进程/包终态成功、身份未漂移且精确清理确认；源码 SHA256 913a29bfe42e2a6e81f24793cd0b9654ab6125f404777e4255472ff7d57a5007，Git 3822c238579e1c4db2ff6090acf5786835d9e451 / dirty=true，逐镜像 ID 与 binary hash 见所属新 change 的最终验收及原 JSON。总墙钟 673.189 秒。原 schema-4 两项均 PASS；可选真实模型/schema-5/SELinux/独立 DIND/旧 Core ELF 条件未配置的 6 项保留跳过。旧失败、中止及原 SHA/dirty/image 记录全部保留，未移植旧候选通过项。按同次完整结果消费原 16 项，5.2 现已满足，当前完整验收 CRITICAL 收束。
