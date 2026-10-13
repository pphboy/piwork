# Design

## Context

动机与已确认范围见 [proposal.md](proposal.md)。起始源码为 `93a1ab3`；四个规格/归档提交已完成原三项的语义合并，旧 delta 与冻结证据保留历史事实。当前没有待应用的旧 delta，本变更也不把归档目录当成当前实现依据。

本轮只读检查已定位下列实现和测试。表中“已定位”表示可以追踪源码与断言，不表示本变更已执行或通过验收。

| 核对对象 | 当前场景数 | 实现位置与已有测试 |
| --- | ---: | --- |
| DWUI-001：连接与用户会话 | 11 | `adapter.ts` 的 requestOnce、acceptSession、checkBrowserAccess、initialize；`local-auth.test.ts`、`preferences.test.ts` 和 Go Desktop 授权/偏好测试 |
| WACC-DESKTOP-001：本地授权边界 | 8 | `internal/cli/user_desktop*.go`；`user_desktop_recovery_common_test.go`、`container_desktop_process_test.go`、`native-auth.test.ts` |
| DWUI-004：Session/Run 观察 | 15 | `adapter.ts` 的 recoverRunHistory、resumeRun 与独立 activeRuns 投影；`recovery.test.ts` 的 R3、Controls recovery 场景 |
| DWUI-007：配置与能力目录 | 11 | `configuration.ts` 的 synchronizeConfiguration、`app.ts` 的 saveConfig、adapter 目录读取；R2、R7 与 Brain 相关回归 |
| DWUI-008：Inspect/Import | 13 | adapter 的 inspectionContext、abandonInspection、importWork；R4、R5、Work naming 及 Go Desktop transfer 测试 |
| Core 正常关闭要求 | 5 | `internal/coreapp/application.go` 的 Close、`shutdown_policy.go` 与受管 Work 关闭；shutdown 单元及 integration 测试 |
| CST-NATIVE-001：Go 存储边界 | 4，作为关联核对 | `internal/corestore/store.go` 的 Format、SchemaVersion、Open；`store_test.go` 的格式拒绝、初始化中断和目录内容保持测试 |

原六处错误对应 63 个现行 Scenario；CST-NATIVE-001 的四个场景用于确认同时修正的存储语义。相邻规则只用于判定这些链路的实际行为，例如匿名首次登录、单 Work 活跃槽、文件条件写入及操作身份，不扩展成整个 Go 迁移或全平台审计。

已观察事实：授权恢复带身份代次和认证检查序号；410 降级读取原 Run/Session；配置提交捕获完整草稿；Import 保留原 transfer 和未知状态；Core Close 共用有界关闭 context；Go 存储拒绝未知格式及无 marker 的非空目录。这是规划阶段的只读结论；本轮复现与实际结果见 `evidence/verification.md`。

## Goals / Non-Goals

**Goals:**

- 以现行 Requirement 正文与 Scenario 为判断依据，得到可追踪的源码、测试、执行结果及剩余缺口。
- 针对已合并链路间的交错顺序和失败分支验证行为；确认违约时以最小实现修改恢复既有约束。
- 复用有效回归，记录本轮实际验证层级；保证归档证据、其他安装及那十项未完成任务不被改变。

**Non-Goals:**

- 不新建 API、数据库迁移、产品工作流或通用规格语义推断工具。
- 不要求旧归档 delta 与当前主规格字节相同，不重新应用、改写或取消其归档。
- 不把测试缺失直接判为功能错误，也不通过修改期望、增加默认超时或删除场景掩盖复现。

## Decisions

### 1. 以当前主规格核对，保留原三项作为来源

实现阶段首先读取上述七个 Requirement 的完整正文与 Scenario，并核对从原三项合并的规则仍在当前主规格中。来源关联仅记录变更身份、当前 Requirement/Scenario、源码符号、测试名称与本轮结果，不恢复旧 active 目录。

专项核验记录使用 `evidence/verification.md`；原始日志、受控失败输出与截图放在 `dist/reconcile-pending-spec-deltas/`。必要附件只在本变更内保留安全摘要。新记录不复用历史通过状态，不把旧迁移的 970 场景矩阵改造成当前清单。

已考虑直接重放旧 delta；它会重新引入场景遗漏及过期存储约束。已考虑建立新长期汇总目录；现有变更附件足以承载本轮结果，因此不增加另一套规范来源。

### 2. 从已有断言补足交错证据

本轮实现为过时 LOCAL_AUTH_REQUIRED、LOCAL_CSRF_OR_AUTH_REQUIRED 拒绝及 CSRF 回查补齐认证序号归属校验，避免旧拒绝清理或接管新初始化。原 Run 的执行错误另存于客户端 executionError，观察错误不再覆盖或清空该事实；它不进入 API 或持久历史格式。

优先运行并核对已有测试的请求、身份和状态断言。仅当现有断言不能区分正确和违约结果时，增加受控 gate、虚拟时钟或故障注入，固定触发顺序。重点判别点如下：

- 授权：有效本地 Cookie 与旧 ticket、CSRF 拒绝后的只读检查、旧业务 401 的晚响应、HTTP/HTTPS Core origin 切换；旧 token/内容不得进入新身份，恢复不得自动重发修改。
- 历史：原用户 Run 进入 410 历史恢复，同时另一 Session/Service 有活跃 Run；原 Run/Session 查询、当前用户错误和后台停止目标保持分别绑定，终态不继续轮询，不重新提交 prompt。
- 配置：Advanced 与普通表单共用完整草稿、非法 JSON 阻止提交、旧 Save/目录/候选读取晚返回时后续编辑仍保留；成功保存与 Apply、加载及行为验证分别表达。
- 导入：匿名 Inspect 完成后首次登录原 Core，再遇到显式名称冲突、留空自动命名或丢回执；原 transfer、sourceName、原 Operation 和用户后续输入不能被错误替换、删除或重复提交。

R1 文件条件写入与 R6 Console 包阶段已有明确回归，可作为原数据恢复变更的邻接验证；不据此扩大产品范围或重新设计文件版本协议。

### 3. 对关闭总预算做可观测验证

起始实现的 `Application.Close` 先处理服务控制 gRPC 和 HTTP，再等待协调 worker 并关闭受管 Work。现有 `TestNativeShutdownConfirmsOtherWorksAfterFailedAgentDrain` 已覆盖 Agent drain 失败后其他 Work 仍被停止；`shutdown_policy_test.go` 覆盖默认预算、期限与 store 锁释放。

本轮受控请求已复现 gRPC 和 coordinator 阻塞会让首次 Work 收尾取得已过期 context。修复选择在准入关闭、协调取消和内容身份撤销之后立即并行启动受管 Work 收尾，复用现有 Work 锁及停止流程；结束前核对其结果。控制 gRPC/HTTP 共用原 drain 窗口，连接或 worker 的等待不再先占完 Work 的停止预算；任何未确认收尾仍返回错误。该选择不改变默认预算、持久运行意图或公开接口。

同时核对 enabled/disabled Service 选择与 desiredState 保持、正常退出后重启恢复、SIGKILL 不被记为已确认停机，以及拒绝旧 TS/未知存储目录时原内容保持。缩小测试预算只用于确定性复现；默认 30/10/45 秒及部署 60 秒窗口另行核对，不修改生产默认值。

### 4. 复现先于修复，验收结果决定交付

判断过程为：

```text
Current requirement --> Existing source and assertion
                                  |
                                  v
                     Controlled execution and readback
                                  |
                     +------------+-------------+
                     |                          |
                     v                          v
               Behavior matches           Reproduced mismatch
                     |                          |
                     v                          v
             Record actual result       Minimal implementation fix
                                                |
                                                v
                                      Same regression and integration
```

确认缺陷后先保留失败轮次及判别断言，再修复所属模块，重跑同一测试和受影响集成。无法复现的问题保留未验证/待判定，不虚构修复。若全部范围已符合契约，允许以真实核验、必要测试和本变更证据完成，不制造无目的的实现差异。

不改 Requirement 的实现修复继续使用 `skip_specs: true`。如果需要改变权限、恢复语义、存储兼容性或其他产品契约，先记录冲突并取得明确范围授权，再更新规划；不能把当前主规格直接改成实现的错误行为。

### 5. 使用隔离链路并按实际变动构建

浏览器 HTTP 夹具用于确定性交错，不冒充真实 Core/Agentd 验收。真实链路复用 Desktop real-core 与 Go integration 的独立数据目录、合成模型、精确 installation 标签清理；需要时复用 `PIWORK_TEST_LOCAL_AUTH_RECOVERY=1`、`PIWORK_TEST_CHAT_CONTROLS=1`，构建与浏览器测试不并行清理同一 dist。

需要 Docker 的检查在匹配的本地 acceptance Agent/file/snapshot helper 镜像和当前 Go 程序上执行。真实后端中的故障注入只限隔离夹具，不在生产路径增加开关。没有对应环境或证据时保留未完成，Linux 结果不代表 Windows 原生验收。

浏览器源码变动才重建 Desktop、Go embed 与 CLI；Go 契约或生命周期变动执行所属单元/契约及真实 integration。最后复查有效主规格、文档边界与 diff；不追加镜像发布或网站交付。

## Risks / Trade-offs

- 规格校验和测试名称容易被误认成实际行为证据 → 每个核对项记录具体断言、执行命令、代码身份、层级和实际结果。
- 轮询或迟到响应会掩盖一次短暂回退 → 在 gate 释放后立即核对目标和状态，再验证后续稳定性。
- 关闭测试可能影响其他安装 → 创建独立安装并只按其精确标签检查和清理；禁止全局 prune。
- 归档后看似任务全部结束 → 单独保留原十项未完成任务，专项核验不得更新它们的勾选或发行状态。
- 无新故障时变更可能只产生核验与测试成果 → 以既有契约的可核验一致性为完成目标，不将无实现修改视为失败或据此编造缺陷。

## Migration Plan

不迁移用户数据或格式。若产生实现修复，按所属功能提交实现与相关测试，浏览器变更包含匹配嵌入资源；专项核验附件随本变更维护。回退对应实现/测试提交即可，不能回退已确认的主规格约束或改写历史归档。
