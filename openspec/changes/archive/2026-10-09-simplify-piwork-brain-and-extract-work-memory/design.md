# Design

## Context

动机与范围见 [proposal.md](proposal.md)。以下为当前源码事实，不以历史设计替代当前实现。

| 当前模块 | 当前事实 | 本次处理 |
| --- | --- | --- |
| Go Core / `internal/workruntime/runtime.go` | 两个稳定卷；private 挂载 `/var/data`，workspace 挂载 `/var/data/workspace`；固定 context、镜像与 Service 生命周期 | 保留，不新增 Brain Server 或第三卷 |
| `apps/agentd/src/application.ts` | `WorkStore.open(join(config.dataDirectory, "work.sqlite"))`；真实 Pi SDK、资源加载、RunManager、BrainFlow、BrainLoop | 只接入 Memory、迁移授权和采用内容 |
| `brain.md` / deploy Skill / service-contract Reference | 认知、开发、Service 协议、期限/预算、经验提交和 Package 更新细节有重复 | 固定原则、开发指引、协议细节分工 |
| `extensions/brain.js` | 四个工具转发至 agentd Unix socket，权限实际由宿主校验 | 保持薄层及工具名，扩展经验操作 |
| `packages/work-store/src/feedback.ts` | 验证原目标 Evidence、Action/Job、实际 Query checks 或固定 SDK 采用证明；同事务完成请求和 Experience head | 验证逻辑保留，认知写入改为独立库 |
| `packages/work-store/src/store.ts` | 磁盘 SQLite、WAL、受理时固定 adopted_experience_version、单 Run 和幂等；Run events 有压缩 | 保留执行语义；双库使用 rollback journal，记录实际提供条目 |
| `migrations.ts` / `internal/workhistory/` | 只接受精确 schema 4，没有升级路径；Go/TS 都校验 schema 与完整关系 | 明确增加 4→5 单次迁移及两种已知格式静态校验 |
| `internal/coreapp/work_apply.go` | 捕获候选/旧 context、关闭准入、替换、验证、发布或恢复旧镜像；复用同一 private 卷，没有数据格式恢复 | 只在 4→5 增加归属明确的备份与回退 |
| Go snapshot helper / `.work` | 全量 cold-full 两卷、固定镜像与来源图；受管历史严格校验、导入旧请求 historical | Memory 纳入原 private 树并进行跨库校验 |
| Desktop / Go CLI | Chat 工具活动、请求/Evidence 详情；CLI chat、run watch NDJSON、run show | 使用原工具结果及版本字段，无新页面/Tasks 控制系统 |

核心真实验收入口已存在：`internal/coreapp/brain_workstation_integration_test.go` 中的 `TestNativeBrainWorkstationFeedbackExperienceAndActualCandidateBehavior` 与 `TestNativeBrainAcceptedActionGapRecovery`。原工作站 UI 与 Agent Action 已共享业务实现，不再构建一套操作协议。

当前与目标架构的可预览设计图见 [architecture.svg](architecture.svg)。图中目标结构是计划，不表示已经实现或通过验收。

## Goals / Non-Goals

**Goals:**

- 只增加独立 Memory 产品能力；其它修改用于认知精简、兼容迁移、可信提交及现有观察入口。
- 保留同一目标的真实验证与记忆发布结果，以及已受理 Run 的一致认知。
- 将历史格式升级做成既有生命周期内的可恢复数据操作，不让失败候选损坏旧 active。

**Non-Goals:**

- 不把 Brain Core 移植进 Go Core，也不新增 Rules 引擎、Memory 服务、调度队列、通用 Eval 或开发账本。
- 不自动升级旧 Work 的镜像或冻结 Package，不自动 Apply，不把所有任务强制变成学习任务。
- 不新增用户审批路径、独立 Memory 管理页面、CLI task 命令或真实模型测评产品。

## Decisions

### D01：固定原则留在 Brain，细节归原 Skill / Reference

`brain.md` 保持四项原则及必要边界：理解用户目标；开发时先 Spec；优先使用已有能力；依据真实结果；按需记忆。保留一次读取当前实际资源/权限的提示。详细状态协议、幂等、恢复、预算、Job 与正式 Package 更新说明只在现有 Reference 保留一份，Skill 链接它，固定认知不再重复整套步骤。

`deploy-work-service/SKILL.md` 负责判断操作/开发路径，维护 `apps/<service>/SPEC.md`，修改前读取相关条目与坐标，复用已有测试，检查真实 Service，保留必要文件与证据引用。Spec 的七项最小内容采用普通 Markdown；已有 Spec 只更新受影响部分，缺失旧 Spec 时从真实实现补齐。验收标准不能因测试失败被降低。

三条路径保留：

1. 操作：Intent → 已有 Query / Action → Verify → Result。
2. 开发：Intent → 最小 Spec → 实现 → 原有测试与业务验证 → 实际 Service。
3. 反馈：Service Request → 既有 BrainLoop / Agent → Service → Verify → 原请求回执。

Remember 是成功任务中按需发生的认知保存，不是每条路径中的等待/审批节点。Memory 的规则是偏好或有证据的认知，不是平台权限 Rules；固定权限和 Founder 决策仍在原软件及 Owner 边界内。

保留 `brain_package_update` 与 `brain-candidates.ts` 的固定行为验收。只有明确软件维护目标进入这条路径；新经验不编辑 `.pi/packages/piwork-brain/`。移除该工具会破坏既有正式软件更新与导入验收，因此不采用。新 Memory 操作需要支持 schema 5 的 harness；旧包在新 harness 上继续使用兼容操作，旧固定 harness 的四种操作仍按原行为执行，缺失的新操作如实报告不支持，不以仅加载包宣称 Memory 已独立化。

### D02：物理独立，事务共用一个宿主连接

采用 `join(config.dataDirectory, "memory.sqlite")`；现行运行映射是 private 卷内 `/var/data/memory.sqlite`，该路径由 Core 提供的数据根派生。不是 workspace 文件，不额外挂载，不新建第三卷。目录遵循现有私有权限；数据库与受管日志为宿主所需私有权限（文件 0600），拒绝符号链接与非普通文件，不能借该规则宣称任意 SDK shell 已被沙箱隔离。

在 `packages/work-store/src/memory.ts` 增加有限的存储实现，不另建 workspace package 或后台进程。`WorkStore` 的主连接 ATTACH 该数据库为 `memory`，`FeedbackStore` 通过这个对象访问认知；Evidence / 请求 / Run 继续留在 main，Memory 中只保留来源 ID。Memory 是独立事实源，运行历史仍是独立事实源，共用事务不等于合并内容。

**跨库事务决定：** main 与 memory 均为磁盘文件，`journal_mode=DELETE`、`synchronous=FULL`；继续 `BEGIN IMMEDIATE`、foreign_keys 和原 busy_timeout=5000。验证前检查实际返回的 journal mode，不接受 WAL/OFF/MEMORY 或设置失败。SQLite ATTACH 在非内存主库及非 WAL 模式支持跨库原子提交；保留 WAL 的两个独立 COMMIT 不能提供该保证。依据：[SQLite ATTACH](https://www.sqlite.org/lang_attach.html)。

不采用新的 outbox/两阶段发布协调器。现有每 Work 单模型执行、同一同步数据库连接和冷快照边界适合 rollback journal；并发读取性能的代价在现有回归中测量，不能改弱一致性绕过失败。

### D03：Memory schema 1 的最小模型

受管 SQL 由 `internal/workhistory/memory-schema.sql` 定义，经现有生成脚本同步 TS SQL/schema 对象及 Go 静态校验材料；Work schema 5 的主源仍是 `internal/workhistory/schema.sql`，冻结一份 `schema-v4.sql` 和对应 schema 对象用于精确 legacy 校验。生成结果不能手工漂移。

| Memory 数据 | 必需字段 / 关系 | 责任 |
| --- | --- | --- |
| `memory_meta`（单行） | schema_version=1、work_id、store_id | 固定归属与 main 的 `work_memory_binding` 匹配 |
| `memory_versions` | version（0 起）、published_at、legacy 标记 | 不可变有效版本；版本 0 明确空；旧不可知发布时间保持 null |
| `memory_entries` | version、entry_id、kind、scope、rule、evidence_ids_json、source_request_id、created_at | 某个版本的有效内容，最多 100 条；kind=preference/experience/knowledge |
| `memory_candidates` | candidate_version、entry_id、source_request_id、operation、base_version、候选内容/依据、reason、status、published_version、created_at/updated_at | 只保存认知候选与已提交/失败历史；operation=upsert/invalidate |
| `memory_head`（单行） | version、updated_at | 默认有效版本指针 |

候选状态为 staged / effective / failed；invalidate 是带原因的候选操作，提交后的 read 根据最后一次已提交操作说明 invalidated。有效快照只含当前有效条目；旧有效内容与失效依据分别保留在旧版本和候选历史，不无限把 tombstone 加入 Context。

版本号沿用原 Experience 数字命名空间，分配时取已有 version / candidate_version 的最大值加一，不重编号旧 Run 的引用。Commit 生成一个新的完整有效快照；空快照也具有显式 version 行，因此最后一条失效不能被误认为库丢失。

main schema 5 移除 `brain_experience_revisions` / `brain_experience_heads`，增加 `work_memory_binding(work_id, store_id, memory_schema_version)`。`runs.adopted_experience_version` 保留原名；增加 nullable 的 `adopted_memory_selection_json`，记录 `{entryIds,matchedCount,truncated}`。旧 Run 为 null，明确代表明细未知；新 Run 保存实际选择，包括空数组。

跨库不能依赖 SQLite FOREIGN KEY：宿主与静态校验显式检查 Work/store 配对、版本存在、来源请求、Evidence 所属与验证、已采用条目存在；所有表只允许精确已知 schema/index，禁止额外 trigger/view/table。旧有效证明复用原 `validateBrainHistory` / Go `brain_linux.go` 的逻辑，不扩展新的来源信任规则。

**Verify C1/C2/C3 的闭包修复：** 保持 schema 5 / Memory 1、两卷、原工具名和条目级 CAS 不变，补齐下列现有关系，不引入自动修复、签名存储或新协调器。原 C1/C2 的直接复现条件已有修复证据；C3 的 Go 复制条目校验及任务 9.1–9.3 已完成实际复验。设计要求与实际执行仍需区分，结果和未验证范围见当前验收记录，不能以本文取代测试事实。

1. 有效 preference 的证明必须在该 entry 的 evidenceIds 内。同 Work/来源请求的 verified SDK Evidence 必须指向原 Chat source Run，带 userPreferenceVerified=true，且 promptDigest 匹配该原受理 Run。复用原 Chat 证明检查，不只检查 Query verified 或 category 枚举。runtime snapshot/默认采用与 TS/Go 静态校验同样执行；historical、复制的旧版本和 carry-forward entry 均不豁免。failed/staged 历史仍按未生效状态保留。
2. 有效 upsert candidate 与 published_version 对应 entry 核对 kind、scope、rule、evidenceIds、sourceRequestId、createdAt。不能只核对正文而漏掉影响默认检索的类别或来源元数据。对每个快照中的有效 entry（包括已复制到后续版本的条目），查找同 entryId、同 sourceRequestId、published_version 不晚于该快照版本的最新 effective upsert candidate；存在该候选时比较上述完整内容，不能只比较首次发布版本。合法 revise 使用该快照适用的新来源，不能拿旧候选否定新修订或用未来候选否定旧固定快照。无对应候选且已通过原有迁移与来源校验的合法历史条目按既有规则保留，不补造候选。Go 的有限关系校验与现有 TS/runtime 保持一致，不新增持久化索引、表或执行状态。
3. 当前 head 等于 `memory_versions` 中 published_at 非 null 的最大 version；正常发布（legacy=0）必有 published_at，所有 effective candidate 的 published_version 指向真实发布版本。版本 0 是初始空基础；最后一条 invalidate 后的新空版本是新发布，不回退为 0。legacy=1、published_at=null 的部分有效历史不参与这个最大值，候选号也不参与。现有时间字段原样保留，不重新给未知历史补时间。
4. 在 WorkStore 打开完成后与 Run 采用/默认读取的可信入口校验这些关系，错误使用原 Memory/历史无效的安全错误投影，不能返回正常空或运行原模型来生成证明。当前 head 的一致性检查不阻止已固定 Run 显式读取一个合法旧版本；旧版本的内容也不能因 head 推进而变化。

验证夹具同时包含合法原始数据和仅一处/多处字段篡改：只改 entry kind、entry/candidate 同改 kind、证明未被引用/跨请求/错误 digest、kind/createdAt 对不上，以及 head 从真实发布退回 0/旧版本。相同夹具在 runtime 和 TS/Go 完整静态验证中必须给出一致拒绝；拒绝前后输入字节不变。

C3 增加正常 API 的跨版本对照：请求 A 发布条目 A，另一请求提交不同条目 B，新快照原样保留 A；关闭后仅修改新快照 A 的 kind、createdAt 或 rule，保留首次发布版本、原候选和 Evidence。三组篡改必须在 runtime、TS 完整 snapshot、Go Open 和原 helper 中一致拒绝；正常复制、合法修订/失效、旧固定快照与无对应候选的合法迁移历史保持可用。沿用同一共享夹具集合，保留原有 22 组的预期，不把拒绝条件改成接受来通过。

### D04：保留工具名，新增有限操作

`extensions/brain.js` 只声明参数/操作并转发，业务权限和持久写入留在 `brain-flow.ts` 与存储层。四个顶层工具名及原 readiness 要求保持；不以新增第五个必需工具使旧包失去 ready。

| operation | 输入 | 返回与行为 |
| --- | --- | --- |
| list / status | 原输入保持 | 保留 adoptedExperienceVersion、snapshot、effectiveVersion；snapshot 只读固定版本，明确 actual selection / truncation；status 可含自身目标候选摘要 |
| recall | query（非空 UTF-8 ≤8 KiB）、serviceName?、limit=10（1–20） | `{version,items,truncated}`；受范围与结果预算约束；空命中是正常空 |
| read | entryId（原 ID 规则） | `{version,entry,status:effective/invalidated/not_found,reason?,evidenceIds?}`，当前 Run 固定版本；失效原因来自该版本之前的已提交认知操作 |
| stage（Propose） | 原 entry / userPreference；可选 kind、expectedVersion | 原 `{version,status:staged,evidenceIds}`；kind 省略为 experience，明确原 Chat 偏好为 preference |
| revise | entry、expectedVersion、userPreference? | 与 stage 相同，要求已有 entryId，保留 ID 并形成 upsert 候选 |
| invalidate | entryId、reason（非空 ≤4 KiB）、evidenceIds、expectedVersion、userPreference? | 形成 invalidate 候选；目标必须在预期版本有效 |
| commit | 原 result / evidenceIds | 继续走原目标 finish(completed)，只在原验证通过后发布；保留真实请求字段，增加可选 memoryCommit 回执 |

旧 stage 没有 expectedVersion 时取本 Run 固定版本；新操作必须携带版本。内部恢复现有 staged 候选沿用其登记 base_version。版本冲突按 entryId 检查：比较 base_version 与当前 head 中该条目的内容、类别、范围和来源（含缺席状态）；其它条目变更不冲突，保留原等待候选合并行为。相同目标的候选可在提交前修正内容；已提交后不原地改历史。未知操作、非法范围、读取损坏、错配或超限明确失败。

自动来源严格沿用现有来源 Service scope；只读允许 work + 来源 Service，写入不可越过原自动目标边界，不能用 rule 正文作为范围授权。人工 Chat 按原 Work 权限执行。明确用户偏好/纠正复用现有宿主生成的原 Chat SDK Evidence；Service 或工具内容不能自行设置 userPreference 来通过。

旧调用的 EXPERIENCE_*、VERIFICATION_REQUIRED、MUTATION_NOT_ALLOWED、REQUEST_EXPIRED 错误保持；新增版本冲突为 MEMORY_VERSION_CONFLICT、受控迁移未完成为 WORK_HISTORY_MIGRATION_REQUIRED、未知既有 memory.sqlite 与迁移输出碰撞为 MEMORY_STORAGE_CONFLICT，持久化异常按既有安全 storage/初始化错误投影。合法 read 不存在返回 not_found，不能与读取失败混同。

commit / brain_feedback.finish 在确有认知候选时追加 `memoryCommit:{version,status,entryIds,evidenceIds}` 及安全摘要；版本来自原请求已提交候选的 published_version，不借用后来推进的全库 head。request_get 保留 request/evidence 原字段，追加只读 Memory 摘要；list/status 保持原字段并提供同一候选状态。旧字段语义不变，UI/CLI可以从真实工具结果看出已提交版本，无需依赖模型文字。失败时返回原错误/实际失败候选，不构造 effective 回执。

### D05：验证与发布沿用原事务

`FeedbackStore.finish` 保留原状态、取消、期限、原 Action/Job、相应 verification Query、固定 Package SDK 行为证明的检查。通过后，在同一 attached 事务内：核对各 staged 候选所修改条目自 base_version 以来未变化；验证候选 Evidence；在最新有效 head 上合并候选并生成新有效快照/候选结果；推进 memory.head；更新 main 请求 completed。任一步失败整体回滚。

2026-10-08 实施回归 Review 后，Mark 确认使用「不同条目继续合并、同一条目变化时报冲突」，修正提案原先全库 head 相等检查与既有等待候选合并测试的冲突；该调整保留 Runtime 执行语义，不改变 Founder 不变量。

failed / cancelled / needs_attention 的候选在同一事务标为 failed，但不能进入默认快照。一个普通任务没有候选时只执行原完成逻辑，不产生空学习目标。重复提交终态保持原结果，不重复分配版本。认知纠正可在旧内容仍为有效历史的前提下生成新版本，不能覆盖被某个旧 Run 采用的条目。

SQLite 原生事务恢复解决提交中断；不新增后台队列、自动模型修复或重放。测试注入 SQL 写入异常、磁盘/权限失败及子进程在提交前/后被终止，检查两库一致结果；主机断电保障依赖 SQLite 的持久事务条件，进程故障测试不能冒称已进行物理断电验收。

### D06：一次选择、固定版本、按需检索

在 `WorkStore.acceptRun` 的既有受理事务中，先查幂等，再固定 head 并计算初始选择。`RunManager` 与资源 loader 从持久记录读取该 selection，`brainPrompt` 只提供选中的内容及版本/截断说明。没有启用脑包时 version=0、selection 为空，不宣称提供认知。旧 schema 4 Run 的 null selection 不反推历史提供明细；它们不会重新执行，历史 read 仍可按原版本查证。

检索是最多 100 条有效认知上的确定性筛选，不新增 FTS/向量库：

- 任务文本 NFKC 规范化并小写，提取字母/数字词和汉字二元片段；scope 名称参与匹配，索引字符串只由内容派生。
- 自动 Service 来源只考虑 work 和 source service；手动 Chat 如工具显式 serviceName 则同样筛选，否则按任务文本相关性筛选 Service 条目。
- 适用的 preference 排先；其他条目需要文本命中，或确属显式来源 Service 的范围。排序按类别优先、命中数量降序及 entryId 升序，保证同版本/输入结果固定。
- 初始最多 10 条，序列化实际提供内容最多 16 KiB；超过条数/字节预算的条目不注入且 truncated=true。不得截断 rule 冒充原认知，确有超预算单条时可显式 read，并保留结果大小故障。
- 显式 recall 使用相同固定版本、1–20 条及原 64 KiB 安全结果边界；后续工具读取的 version/entryId 已在实际 SDK 工具记录中可查，不将它误计为初始注入。

Memory 更新后旧 Run 的上下文与任何 Memory 查询仍使用原版本，新 Run 才检索新 head。新 Session 不要求 Apply。Version / entryId 是提供事实，不是已经遵从规则的行为证明；业务/软件采用仍看实际结果。

### D07：兼容矩阵与受控迁移

| 数据 / 环境 | 本版行为 |
| --- | --- |
| 未初始化、Work/Memory 主文件及 sidecar 全无 | 新 harness 在正常首次初始化创建 schema 5 + Memory 1；旧固定镜像仍按原格式初始化 |
| 精确 schema 4 + 原固定镜像 | 本版 Core 可观察/导入/启动，保留原 active 与镜像；不在普通 restart 或 import 中迁移 |
| 精确 schema 4 → 新 harness | 只在显式 Apply 独占边界中一次性迁移，保留旧历史备份直到新 active 持久发布 |
| schema 5 + Memory 1 | 校验配对、引用和采用内容后使用；缺失 Memory 不创建空替代 |
| schema 5 → 只支持 schema 4 的镜像 | 替换之前以 CONTEXT_FORMAT_UNSUPPORTED 拒绝；不支持成功升级后的反向数据降级 |
| 其他历史/Memory 版本或多余 schema 对象 | 明确不兼容/无效；不执行输入 SQL，不猜测迁移 |

Core readiness / image 校验允许精确已知的 history 4 与 5，并检查所加载镜像声明与实际 readiness 版本一致，不能泛化为任意正整数。新镜像标记 history 5。`.work` 仍使用已有 compatibility.workHistorySchema 字段，storageLayout=2、formatVersion=1；导出取实际历史契约，不硬编码所有 Work 为 5。无初始化数据时按冻结 active（或创建配置）的运行镜像契约声明，不使用当前 Core 默认猜测。新增文件在既有 private 树内，不增加 framing 字段/组件。

Core 在既有 `workApplyPlan` 增加仅用于 4→5 的 `historyBackup` 归属/阶段信息：`{operationId,workId,fromSchema:4,toSchema:5,backupKey,manifestDigest,state}`，state 为 planned / saved / restored / committed；备份 manifest 保存主文件/必要 sidecar 的精确相对名称、是否存在、大小/摘要及迁移新文件归属。扩展原 Go snapshot helper 为 `checkpoint-history` / `restore-history-backup` 两个内部动作；它们只访问本安装本 Work 的 private 卷与该 Apply 的 Core spool，不是用户新 API。helper 输入通过归属 spool 内的 `history-backup-request.json` 传递上述固定身份、backupKey、已知版本和 expectedManifestDigest（恢复必需）；不接受用户绝对路径或任意文件名单。输出是安全状态、manifestDigest 与实际历史版本，恢复使用可信 manifest 的精确清单。

Core spool 位于已有受管 `runtime/history-upgrades/<operationId>/`，不新增 Core 顶层存储格式目录。恢复事实保存在原 Apply plan；新 Apply 仅在同一 prior context 已恢复且 Engine 确认无 Agent 时省去向已退出 writer 的空闲检查，普通 busy 检查不变。

backupKey 在任何文件写入前由 Core 持久分配。checkpoint-history 保存旧库后，预创建带 Memory schema 1 / 空版本 0 / 当前 Work 的 Memory 文件，store_id 固定为该 backupKey；记录新文件 inode 与父目录归属。旧 schema 4 已有未知 memory.sqlite 时拒绝，不覆盖。候选只在相同 store_id 和 saved 备份授权下填充新库；恢复凭原 manifest、inode 与 store_id 核对归属，不能按文件名前缀删除。恢复动作在 trusted helper 中把该 private 卷按原 `/var/data` 路径提供给 SQLite，先完成原生 joint journal 恢复/关闭，再恢复原 schema 4 文件并移除已证明本迁移新建的空/新 Memory；这项可写恢复仅属于失败 Apply，导出/导入静态验证不获得此授权。无法核对日志或归属时明确恢复失败并保留文件。

备份从已退出旧 writer 的主库和必要 WAL/SHM/日志取得，并用既有静态校验证明完整性；备份不会被 Runtime 当作读源。新 agent 的迁移授权由 Core 在私有 runtime 配置中提供 `historyMigration:{operationId,workId,fromSchema:4,toSchema:5,storeId,backupManifestDigest}`，并以现有代次/mTLS 控制身份核对原 Apply 与 saved 备份；普通模型输入不能生成该授权。没有授权的 schema 4 输入交给 schema 5 harness 时报告 WORK_HISTORY_MIGRATION_REQUIRED，不偷偷转换。

候选 4→5 初始化必须 initializationOnly，不调用模型或推进 live 请求；必要时复用原初始化后正式启动流程再进入 running。正式启动也受已有 Core control 准入检查，只有新 active 发布后才执行。新候选不能从 ready 标志自行获得提前执行权。

### D08：导出/导入与真实错误边界

`workhistory` / TS snapshot 验证器选择精确 schema 4 或 5，schema 5 将 Memory 一起复制到隔离校验空间，校验两个已稳定数据库的 schema、integrity、版本/head、来源闭包与选中条目。不打开输入数据库执行携带 DDL/trigger，不通过把 Memory 当作普通 opaque SQLite 避开校验。

正常关闭的 schema 5 两库不留下进行中的 rollback journal。遇到可疑未完成 joint journal / super-journal，cold export 返回既有 SNAPSHOT_HISTORY_BUSY；要求先沿既有 Start/Stop 路径完成 SQLite 存储恢复再导出，不直接忽略日志，也不在移动到另一位置的校验副本中猜测旧绝对 journal 路径。重启在原受管路径完成 SQLite 原生联合恢复，始终不重放模型或 mutation。此故障边界必须加入测试，不把进程中断后的半事务包宣称为成功快照。

Go Rebuild 在新目标存储构建可信 schema，映射 Work/context、声明控制引用与 Memory Work/store 归属；Memory store_id 在目标生成新值并同步 main binding。entryId、version、来源 request/evidence/run 本地 ID 及文本保持；旧请求/候选归属 historical，不自动提交 staged 候选或重开等待。旧知识与有效偏好可以在接收者的新 Run 中按范围读取，source historical 不意味着失去只读证据。

D03 的来源比较覆盖后续快照中的复制条目；historical 与导入身份重建不豁免比较。Go Open/原 helper 的静态校验须在重建或发布导入 Work 之前拒绝 C3 非法副本，不允许出现“Rebuild 成功，但运行时因同一来源不一致而无法打开”的结果。合法对照重建后须由真实运行时打开并保留原版本/内容；非法输入在拒绝前后保持指纹不变，不运行旧模型/任务或修复正文。复用现有 Core/helper 的验收入口验证合法恢复启动和非法副本导入拒绝；没有执行完整 `.work` 导入时，报告明确限定为直接 Open/Rebuild 的证据，不能声称已证明 Core 发布前拒绝。

源 Core 控制身份、Runtime 代次、凭据与外部权限不从 Memory 导入。导入两份、继续使用、删掉原 `.work` 文件后再次导出均保留完整认知及实际证据。

### D09：可见反馈与 Baseline 使用现有机制

不新增 Run semantic event 类型：现有 AgentService 映射非 text/tool 事件为 state，仅向 Store 追加新名称并不能让 UI/CLI完整看到它。Memory 结果沿真实 tool-start/tool-end 与原请求/Evidence 返回，初始版本继续使用 adoptedExperienceVersion。UI 文案明确 Memory 版本与 proposed/effective/failed/invalidated 的含义，CLI NDJSON 保持原 envelope，人读结果说明是否生效；不为观测改变单槽、排队、取消或执行。

Spec 与开发修改通过原 SDK 文件操作记录、Service 文件和实际结果可查，不提供独立任务时间线。旧 Run event 压缩策略保持，不能承诺未建立的永久 Development Ledger。Memory 的有效版本与 Evidence 关联保持独立持久，不依赖保留每个工具 event。

实现阶段创建 `docs/piwork-brain/BASELINE.md` 初版 1.0.0，只记录本次 Mark 给定的八项不变量及测试链接，不引入评测后台/Golden 框架/CI 治理重建。之后文档变更须 Mark 授权；本 change 的材料是待 Review 规划，不自动批准新的边界。Git 记录和规则不等于强身份审批；不声称已经配置 GitHub 强制保护。

### D10：文件与验收映射

| 真实模块 / 文件 | 计划改变 | 验收 |
| --- | --- | --- |
| `packages/work-store/src/{memory,store,feedback,migrations}.ts` 及单测 | 独立库、兼容接口、联合事务、版本/失效/检索、受理 selection | T01–T04；WMEM-001–006 |
| `internal/workhistory/{schema.sql,memory-schema.sql,schema-v4.sql}`、生成脚本与产物 | 精确 4/5 + Memory1 schema、来源图及恢复 | T01、T03、T05；WMEM-005、WSTOR-MEMORY-001 |
| `apps/agentd/src/{brain-flow,brain-resources,application,runs}.ts` / tests | 操作桥接、实际采用、迁移准入、薄资源加载 | T02–T04、T06；CONV-MEMORY-001 |
| `internal/coreapp/work_apply.go`、`internal/workruntime/runtime.go`、Go helper/Engine helper policy | 有归属备份、迁移授权、初始化/正式准入、失败回退 | T01、T03、T06；WMEM-005、WSTOR-MEMORY-001 |
| `internal/{agentclient,imagestatic,workpackage}` 与 snapshot capture/preflight、contracts/generate、image build | 已知版本兼容、真实格式导出、拒绝不兼容降级 | T05–T06；PWORK-003、CONV-SNAPSHOT-001 |
| `internal/workhistory/{history_linux,brain_linux,rebuild_linux}.go`，TS `snapshot.ts` / `snapshot-brain.ts` | 双库静态校验与目标归属重建 | T05；PWORK-BRAIN-001 |
| `internal/coreassets/piwork-brain/` | 四项固定原则；Skill 管 Spec/开发/验证；Reference 去重；扩展现有工具 | T04、T06；BRN-002/003/005、ADEP-002 |
| Desktop 现有工具活动投影、`internal/cli/user_conversation.go` / 对应 tests | 按需要调整 Memory 文案/安全结果投影；不新增操作入口 | T02、T04、T06；WMEM-006、CONV-MEMORY-001 |
| `docs/piwork-brain.md`、`docs/piwork-brain/BASELINE.md`、验收记录 | 当前职责、版本/兼容限制与实际证据 | BRN-007；文档链接检查 |

T01：持久化与 restart；T02：已有/新 Session、新 Run 采用与旧受理快照/幂等；T03：成功/失败/取消/超期/版本冲突/修正/失效与提交故障；T04：Package bytes 与 active/desired 不变，Prepare/Apply=0，Runtime 代次不变；T05：两 Work 隔离、4/5 Export/Import、双副本与再导出、坏图拒绝；T06：既有 BrainFlow/Loop、Service Query/Action/UI 同状态、反馈、原 Action/Job 恢复、Package 更新与固定 SDK 行为验收。

## Risks / Trade-offs

- [WAL 改为 DELETE 的读写竞争] → 维持原单 writer / busy timeout，不改变执行调度；实际单元/集成回归检查读写与 observer 续接。若必要回归失败，报告后修复，不能静默换回失去跨库保证的配置。
- [SQLite 未跨库外键] → 宿主提交及 TS/Go 静态校验都验证来源图、store 绑定与已采用版本，不信任 Memory 文件自述 verified。
- [已迁移新库使旧镜像失效] → 新 active 发布前可恢复原 schema 4；正式升级后的降级明确拒绝；普通包更新保持同一兼容 harness 的原语义。
- [初始化与正式激活间启动反馈] → 候选 initializationOnly 和既有 control fencing 同时关闭模型准入；真实 Docker 注入测试验证没有请求/Job 重放。
- [热 journal 的跨路径复制破坏判断] → cold-full 只接受稳定联合存储，未恢复 journal 明确忙碌，不用副本路径缺失当成事务已完成。
- [中文关键词检索不能保证语义召回] → 固定汉字二元片段/范围筛选与可显式 read 的最小行为；测试事实只验证有界、相关性与隔离，不夸大为语义搜索。
- [SDK 文件工具不是任意代码沙箱] → 保留现有权限边界，不以 Memory 拒绝某段文字声称所有脚本/Extension 获得强沙箱隔离。

## Migration Plan

1. 本次先交付规划。实现时同步 schema/契约、TS/Go 校验与新镜像标记；旧 schema 4 校验材料固定，旧 Work 不被默认替换。
2. 显式 Apply 捕获原 context 和新镜像；预检数据/镜像兼容性及存储空间，关闭原 Run/自动目标/文件/冷快照准入。旧 active Run 忙碌沿原规则拒绝，不强行中断。
3. 确认旧 writer 退出，持久登记本 Apply 的备份归属后调用既有原生 helper 获取完整旧 history 备份并核验；备份不完整则不启动迁移。Core 恢复能依据记录区分「尚未备份」与「可恢复备份」。
4. 新候选以迁移授权与 initializationOnly 初始化。先精确验证旧库及 Evidence；checkpoint 原 WAL，切换并确认双库 DELETE/FULL；在一条 attached 事务中复制全部 Experience 到 Memory，建立 binding，增加 selection 列，删除旧认知表，设置 history=5。失败回滚并由原 Apply 恢复备份；旧候选有效时间不被延长。
5. 旧有效行按原 version 分组保留，staged/failed 行保留状态与原 candidate_version。旧明确原 Chat 偏好仅按该条目引用的完整原指令证明标为 preference（含原 Run、verified SDK、userPreferenceVerified 与匹配 promptDigest），不能只看同请求内某个标志；其余合法经验为 experience，不补造证明或推断新知识类别。旧候选未记录 base_version 的，登记迁移边界的真实旧 head 为后续 CAS 基础并明确 legacy 来源，不冒称原提出时版本；旧时间和已采用版本保持。只有真实旧 head 的已知更新时间写成发布事实，其他未知部分版本保持 null，不参与当前 head 的选择。
6. 检查 schema 5 / Memory1 配对、所有来源与各旧 Run 的原 version。加载/资源/新库验证失败时，先确认候选退出，再恢复原主库与必要 sidecar/精确归属新文件；重启旧 active 的成功/失败按原 Apply 结果报告，不清空业务数据库。
7. 需要 running 时按原正式启动和控制准入流程发布新 active。Core 发布事务同时标记该备份 committed；只有 active 发布后才允许执行和新版本学习。发布前 Core 崩溃按原持久 Apply 计划继续或恢复，不靠猜测当前文件选择 active。
8. 旧 Apply 被 Stop/Delete/新 Apply 取代时，由持有当前控制 fence 的现有 worker 确认 writer 退出并收尾原迁移记录，再允许下一 writer/快照。旧 worker 不越过新 fence 恢复文件，不能回滚已发布 active 下产生的新 Memory。
9. 发布后备份只用于归属明确的清理，不再提供回退到 schema 4 的权限；清理失败保留原记录与真实诊断，不能恢复已过时备份。未发布的失败恢复/清理不完整则保持准入关闭。所有清理只针对精确记录，不按文件名前缀删除。
10. 新旧格式分别完成真实 SDK / Service 与 Export/Import 验收。导入不执行升级，导入得到 stopped Work，后续 Start/Apply 与原身份/授权规则一致。验收记录分开标注单元、真实组件、真实模型、未执行与失败，未运行不标为通过。
