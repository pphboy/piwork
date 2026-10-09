# Piwork-brain 简化与独立 Memory 验收

变更：`simplify-piwork-brain-and-extract-work-memory`。验收日期：2026-10-09（Asia/Shanghai）。OpenSpec tasks 36/36 完成；包含后续 C3 修复与真实恢复复验。经 Mark 显式请求，六份 delta 已同步主规格，变更已[归档](../../openspec/changes/archive/2026-10-09-simplify-piwork-brain-and-extract-work-memory/tasks.md)。实现和测试保留在本工作树；没有 Push、Git Tag 或 Release。

## 1. 原有架构

Go Core 管理 Work、权限、Docker、Service、固定配置/Package 和两个数据卷；容器内 `apps/agentd` 使用真实 Pi SDK 执行模型与工具。BrainFlow 负责业务能力与证据门禁，BrainLoop 负责显式 Service Request、等待和恢复，RunManager 管理受理、取消与单 Work Run 槽。

`piwork-brain` 已是包含 Cognition、Skill、Extension、Reference 与例子的 SDK Package，已有 Query/Action/Job、实际 Evidence、Package Prepare/Apply 与完整 Work 分享。旧 Experience 放在 `work.sqlite` 的 revisions/heads 中，已具备候选、验证后生效和固定版本采用。本次复用这些机制。

## 2. 简化后的架构

[浏览器预览 HTML](architecture.html) · [独立 SVG](architecture.svg)。图中上半部表示变更前，下半部表示当前实现。

操作：**Intent → 发现已有能力 → Query / Action → 实际验证 → Result**。

开发：**Intent → 必要的 Service Spec → 实现 → 原测试和业务验证 → Runnable Service**。

反馈：**Service Request → 原 BrainLoop → 同一 Agent / Service → 验证与回执**。

Brain Core 收敛为 Understand/Specify、Act、Verify、Remember。开发细节归原 `deploy-work-service` Skill；协议、恢复和正式软件维护沿用原 Reference。保留四个顶层工具；在 `brain_experience` 增加必要操作。执行仍由原 Runtime 负责，没有新增 Brain Server、Workflow/Eval 引擎、开发账本或多 Agent 编排。

可复用的认知规则随 Memory 演进，Service 设计随 `SPEC.md` 演进。工具权限、平台配置和 Founder Baseline 不由 Memory 修改。Brain 软件修改仍通过正式 Prepare/显式 Apply/固定行为验收；普通学习不走软件更新。

## 3. Memory 设计

独立文件为 `join(config.dataDirectory, "memory.sqlite")`，现行运行映射 `/var/data/memory.sqlite`，与 `work.sqlite` 同处既有 private 卷。Service 和 WebDAV 仍只获得 workspace；没有第三个卷。

| 存储 | 权威内容 |
| --- | --- |
| `work.sqlite`，history 5 | Session/Run、请求、事件、Evidence、配对 binding 和采用明细 |
| `memory.sqlite`，schema 1 | meta、不可变 versions、有效 entries、候选 candidates、head |
| `apps/<service>/SPEC.md` | Service 当前设计和实现坐标 |
| Founder Baseline / 固定 Package | 授权架构决策 / 软件实现 |

最小能力是 Recall、Read、Propose（沿用 stage）、Commit、Revise、Invalidate。Recall 使用范围、规范化关键词和中文 bigram；不使用向量库。受理时固定版本及实际选择的 entry IDs，默认至多 10 条/16 KiB；显式 Recall 为 1–20 条/64 KiB。当前 Run 不切换 head，后续 Run 采用新有效版本，旧 null 明细不伪装成已知选择。

不同条目的等待候选合并；同一条目从 expectedVersion 起变化则报冲突。这是 Mark 在本次任务中明确确认的策略。失效创建新版本，最后一条失效后也保留真实空版本，旧版本可读。

Main 与 Memory 使用同一个 SQLite 连接 ATTACH、DELETE journal/FULL synchronous。原 finish 验证通过后，同事务发布 Memory 和 completed 请求；Query/原 Action/Job、固定 SDK 证明和原 Chat 偏好的验证保留。失败、取消、超期和冲突不产生有效学习。Evidence 和请求仍在 Main，Memory 只引用来源，不复制业务数据库或每个工具调用。

旧格式使用冻结的精确 history 4。新 harness 不在普通 Start/Import 中偷偷升级：必须显式 Apply。Core 在已有 `runtime/history-upgrades/<operationId>` 保存旧主文件/WAL/SHM；原 helper 在 `/var/data` 核对新文件 inode/store 归属，迁移候选 initializationOnly，并先通过 mTLS 核对原 Apply、当前代次和 saved manifest。联合事务复制旧有效/已采用版本、候选、失败和原时间，再删除旧 Experience 表。

迁移或加载失败恢复原文件，再启动原固定镜像；Core 中断及 Stop/Delete/新 Apply 由当前 fence 收尾。成功升级后，schema 4 镜像在替换前被拒绝。已 committed 的备份不能恢复旧格式；清理失败保留文件，在既有 Work reconciliation 重试，清理失败写入原 Operation 的安全诊断和原 Apply plan，不改变成功状态，不能回滚新 active。

`.work` 的 formatVersion 1、storageLayout 2 和两卷 framing 不变。导入重新分配 Work/store 归属，保留版本、entry IDs、正文、来源与证据；旧请求和候选是历史，不复活 Runtime 或执行。缺库/错配/未知 schema 拒绝，未恢复 joint journal 返回 busy。

## 4. 实际修改的文件

| 模块 / 路径 | 修改目的 | 验收 |
| --- | --- | --- |
| `internal/workhistory/{schema.sql,schema-v4.sql,memory-schema.sql}`；`scripts/generate-work-history.mjs`；生成产物 | 精确冻结 4，定义 5+1，跨语言格式一致 | T01/T05 |
| `packages/work-store/src/{memory,store,feedback,memory-migration}.ts` | 唯一 Memory、联合可信提交、版本、选择、迁移 | T01–T04 |
| TS `snapshot*`；Go `internal/workhistory/{memory,brain,rebuild,backup}_linux.go` | 配对/来源校验、历史重建、原路径恢复 | T03/T05 |
| `internal/coreapp/work_history_apply.go`、`work_apply.go`、Start/Stop、snapshot capture/export | 原 Apply 备份、授权、发布/回退、fence 恢复和真实格式导出 | T01/T05/T06 |
| `proto/work-services.proto`；`service_rpc.go`；`work-private-client.ts`；契约生成产物 | 内部迁移 mTLS 授权；不增加模型工具或用户控制面 | T03/T06 |
| `internal/{imagestatic,agentclient,workruntime,snapshothelper,dockerengine}`；image/release 检查 | 声明/实际 history 4/5 匹配，复用受限 helper | T05/T06 |
| `apps/agentd/src/{brain-flow,runs,application}.ts` | 八项兼容操作、安全回执、受理时固定采用和实际 Context | T02/T03/T06 |
| `internal/coreassets/piwork-brain/{brain.md,extensions/brain.js,skills/deploy-work-service/SKILL.md}`；原 workstation `SPEC.md` | 稳定认知、薄 Extension、Service Skill 的 Spec-first 与真实验证 | T04/T06 |
| Desktop `adapter/chat-projection`；`internal/cli/user_conversation.go`；嵌入浏览器资源 | 同一已保存工具结果的 Memory 摘要；原 NDJSON/envelope 保留 | T02/T04/T06 |
| `packages/pi-adapter/src/deterministic-kanban.ts`、原确定性 provider；对应 Go integration tests | 真实 SDK/Service/浏览器验收夹具，未成为额外 Runtime/Eval 平台 | T01–T06 |
| `docs/piwork-brain.md`、本目录、`docs/work-package-format.md`、`docs/testing.md` | 当前结构、格式、治理、使用入口和验收事实 | 全部 |

Package 的真实结构仍为 `brain.md`、`extensions/brain.js`、原 `skills/deploy-work-service/`、`references/`、`templates/workstation/` 和 `package.json`。加载、Session、模型/工具执行直接复用 Pi SDK，Memory 放在 Package 之外。

Kanban 夹具由真实 SDK 写入七节 `apps/kanban/SPEC.md`、`app.py`、`columns.json` 和已有 unittest。SDK JSONL 与 Run events 对应同一 tool call，证明 Spec 在实现之前成功写入。真实浏览器将 A 从 Todo 移到 Doing，Agent 用同一 `Board.move` 移到 Done；修改先把 Review 写进 Spec，原 Review 测试实际失败，再修改列配置，同一测试通过，实际 Action/Query 验证 Review。普通 Action 没有 read/write/bash 开发调用。它是验收 Service，临时安装已清理，可通过测试复现。

Memory 实际样本：原 Run `run-ba89789c-b456-4bba-bac6-2727e1ac47e7` 保留 adopted version 0；后续读取、修订与失效对应版本 2/4/6。第一条来源 `request-1f256b9e-34e1-4a87-bc8e-bcc64349e7d2`，Evidence `evidence-69d4e37f-7747-4a28-868a-e724af90aee7`。Main 实际没有 Experience 表；Memory 候选与这些原请求/Evidence 关联。UI/CLI 摘要消费同一 host tool result，不根据模型最终文字认定生效。

## 5. 测试结果

环境：Go 1.25.5、Node 24.21.0、Docker Engine 26.1.5，真实 Pi SDK 0.86.1。通过独立 installation ID 和数据目录运行；只清理本次精确标签的资源。

| 层级 / 实际入口 | 结果与范围 |
| --- | --- |
| `make generate`；`make test`（含 build） | 通过；跨语言生成、Go/TS 单测、宿主/浏览器构建、类型检查 |
| WorkStore 单测 | 60 项通过；独立性、可信提交、CAS、字节/范围边界、迁移、复制条目一致性、导入重建、真实 SQLite writer 在 COMMIT 前/后 SIGKILL |
| Agent 单测 | 86 项通过；实际 SDK Package 加载、原 Runtime、固定采用、Memory 回执及自动来源 scope |
| Go workhistory/Core 定向单测 | 通过；原 schema 4、5+1、来源/伪造证明、WAL writer 故障、精确恢复与清理失败门禁 |
| Desktop `test:browser` | 221 通过，1 个既有时间门控场景跳过 |
| Desktop `test:real-core` | 通过；真实 Go Core/CLI、Run、文件、Service iframe、Save/Apply、Stop/Export/Inspect/Import/Start、Delete 和响应式布局 |
| 真实 SDK Memory | 通过；重启、后续读取、修订/失效、采用版本、Package bytes/Prepare/Apply/Runtime 代次不变、物理两库和 Export |
| 真实 SDK Kanban | 通过；Spec 顺序、浏览器/Agent 同一业务、真实失败/通过测试、实际修改与普通操作路径 |
| 工作站反馈/分享 | 通过；实际 Query/Action/Job、Memory、固定候选 SDK 验收、两份独立 Import、各自新反馈/软件 Apply、两份再次 Export |
| 旧 4→5 / MCP 失败回退 / 降级拒绝 | 通过；使用冻结旧镜像，原经验、来源和原 active 恢复/保留 |
| Core 进程故障与取代 | 通过；迁移 writer 已退出而新 active 未发布时 SIGKILL，及 Stop、Delete、新 Apply 取代 |
| 原 Runtime 回归 | 通过；已接受 Action/wait 未登记的三种恢复、Busy/Stopped Apply、MCP 失败及主错误/回退错误、Skill/MCP 移除、真实 SDK Session 重建、Package 多版本/同版本失败/重启/回退/停止 Apply |
| Console 浏览器 / real-core | 46 项 / 3 项通过；管理员、权限、默认配置及实际包安装 |
| native source/image boundary | 通过；宿主 Go 边界及生产/验收镜像边界 |
| OpenSpec strict / diff / SVG | strict 与 `git diff --check` 通过；HTML/SVG 已用 Chromium 打开、渲染并检查截图 |

过程中的失败均保留真实结果并定位后重跑：备份写锁遗漏、Core spool 放错受管目录、迁移取代后的已退出 writer 检查、真实 SDK 的额外 streaming announcement、零版本投影，以及测试观察上下文超时。SDK 证明校验仍要求固定实际输入、唯一有序执行与成功结束，重复执行/伪造输入仍拒绝。既有 Desktop real-core 脚本的 Model 单独弹窗选择器与 HEAD 的 Response settings 已不一致，只同步测试选择器和关闭弹窗操作；没有改变产品 Model UI 或验收业务预期。

未验证：真实模型的自主认知选择、Memory 质量/相关性及人工干预收益，物理断电/文件系统故障，不同真实用户之间的生产分享，完整全部 integration suite、真实 SELinux Enforcing 主机与 Release 验收。本次确定性 provider 证明执行和契约，不替代真实模型的自主行为验收。

## 6. 架构演化说明

认知从 Brain 软件自修改转向独立 Memory；服务设计从通用 Cognition 分离到原 Skill 和 Service Spec。删去重复通用认知规则，保留现有四工具、执行、反馈和软件维护边界。新增的后端代码主要承担独立存储的联合事务、严格迁移/回退与可携带历史，不是新的 Agent 编排。

普通用户不需要新增 Spec/Plan/Eval/Memory 审批或命令。确定性验收中，开发步骤与学习由 Agent 自动执行，普通操作走已有业务接口；正式软件 Apply 继续保留原用户入口。没有据此宣称真实模型的用户干预次数已经下降。

初始 Founder Baseline 为 [v1.0.0](BASELINE.md)，仅包含 Mark 给定的八项不变量。本次没有新增未经批准的设计原则，没有把 Memory 或未批准建议写成 Baseline。变更由本次明确任务与 Apply 授权；未来决策通过 Mark Review 和 Git 历史追踪。本次未配置或声称 GitHub 强制审批/独立 Agent 身份生效。

## 7. 遗留问题

需要真实模型验证一项能力：在同一固定 Service 任务的下一次 Run 中，是否选择正确的已验证 Memory 并减少人工纠正，同时保持实际 Query/Evidence 验收。当前测试尚不能证明这项认知收益。

旧固定 schema-4 Work 必须通过显式软件 Apply 才获得独立 Memory；成功升级不能反向交给 schema-4-only 镜像。恢复文件归属无法证明时保留数据并真实报错，不能自动覆盖。GitHub 身份隔离与强审批不由 Markdown 提供，也未纳入本次产品实现。

闭环 Review 见 [verification.md](verification.md)。

## C1/C2 修复补充验收（2026-10-09）

此前 Verify 发现的伪偏好与过期 head 校验缺口已经按更新后的任务 8.1–8.3 修复。有效 preference 的引用证明在读取和静态恢复时仍核对；candidate/entry 的 kind 与 createdAt 等元数据一致。head 依据真实发布事实核对，初始 0、新空发布、legacy 部分历史和已固定 Run 历史读取保持原语义。

22 组共享正/负夹具在 runtime、TS 完整历史、Go snapshot 和原 helper 一致通过；15 组无效输入均被拒绝且输入指纹不变。另有普通 API 来源、head、迁移分类回归。WorkStore 59、Agent 86、Go 定向及 make test 通过。真实 SDK Memory、旧格式迁移/加载失败回退、两份导入/新反馈/再次导出均重跑通过。原先“伪造仍接受”的结果是修复前事实，不代表当前行为；详见更新后的 verification.md。

## C3 复制条目修复补充验收（2026-10-09）

Go 之前只核对候选首次发布版本，后续快照中的副本可以与原候选不同，却被静态校验和 Rebuild 接受。现在每个条目按该快照适用的原 effective upsert 比较完整来源元数据与正文，与 TS/runtime 一致；合法迁移无候选条目仍走原校验，修订/失效和旧固定版本不受未来候选影响。没有新增格式、表、索引、工具或执行机制。

| 本轮文件 | 修改原因 |
| --- | --- |
| `internal/workhistory/memory_linux.go` | 补齐每个快照中复制条目与适用候选的关系比较 |
| `internal/workhistory/testdata/memory-integrity-carry.sql`、`memory-integrity-cases.json` | 增加两次提交后的副本对照、篡改、修订/失效及迁移兼容夹具；保留原 22 组预期 |
| `internal/workhistory/memory_test.go`、`internal/snapshothelper/history_test.go` | 原 Go 校验/helper 执行相同的 32 组夹具并检查源输入不变 |
| `packages/work-store/src/memory-integrity.test.ts`、`memory.test.ts` | TS/runtime 执行共享夹具，并通过普通 API 两次发布验证副本不可被单独改写 |
| `internal/coreapp/memory_carry_integration_test.go` | 完整合法 `.work` 的真实 Core/helper/Rebuild/Start/SDK 读取；封装摘要仍合法的三种非法副本拒绝、不发布 Work与输入指纹不变 |
| 本验收、`verification.md` 和本 change 的状态文本/tasks | 记录实际修复、初次失败及复验事实；完成 9.1–9.3 |

本轮 WorkStore 60/60、Agent 86/86，Go history/helper 及 `make test` 通过；32 组共享夹具为 12 接受、20 拒绝。真实 `TestNativeMemoryCarryValidationBeforeImportPublication` 最终通过 136.07s，合法副本和合法迁移形态可恢复并由实际 SDK 读取，kind/createdAt/rule 三种非法副本在包上传校验阶段被原 helper 拒绝（HTTP 409 / SNAPSHOT_HISTORY_INVALID），早于导入发布，输入不变。正常 Query 种子为合成 Store API 数据；实际 SDK/运行时与完整 Core 恢复被执行，不宣称真实模型自主学习已验证。

实际旧格式 `TestNativeLegacyMemoryUpgradeRollbackAndDowngradeFence` 本轮通过 212.61s，覆盖 4→5、MCP 失败回退及降级拒绝。初次组合命令因新测试错误期待 400 而整体失败，实际契约一直返回正确的 409；修正测试后 C3 全部五组重跑通过，该旧格式测试在原组合输出单独 PASS。上传 Reader 保留本地文件用于真实指纹核对。helper 首次构建缺少 commit 元数据导致 image boundary 失败，补齐后检查通过；未修改业务拒绝条件或边界规则。

输出：`/tmp/piwork-c3-store.log`、`/tmp/piwork-c3-shared-go.log`、`/tmp/piwork-c3-full-tests.log`、`/tmp/piwork-c3-real-core-final.log`、`/tmp/piwork-c3-real-core.log`、`/tmp/piwork-c3-image-final-boundary.log`。source/image boundary、OpenSpec strict 和 diff 检查通过。前文的 C1/C2 22 组与 59 项计数是上轮历史事实，当前计数以本节为准。真实模型、物理断电、完整 integration/Release/SELinux 和生产跨用户分享仍未验证，未运行项目不标通过。
