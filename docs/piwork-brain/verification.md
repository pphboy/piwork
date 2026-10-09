# OpenSpec 闭环 Review

Change：`simplify-piwork-brain-and-extract-work-memory`，schema：`spec-driven`。日期：2026-10-09。本文保留此前独立只读核验发现的 C1/C2/C3，及随后经授权 Apply 的修复复验。当前 C3 已完成 Go 校验修复、共享正负夹具和真实 Core/helper/SDK 恢复验收；当前结论见末尾，不自动归档。

| 维度 | Review 结果 |
| --- | --- |
| Completeness | tracking 为 36/36；16 个 ADDED/MODIFIED Requirement 均有实现映射，无 REMOVED/RENAMED；9.1–9.3 已有实际修复和复验证据。 |
| Correctness | 16 项实现映射已核对；C1/C2/C3 的已发现缺口已修复，复制条目在 TS/runtime、Go 和 helper 一致接受/拒绝。Scenario Coverage 部分 Not verified：102 个场景没有全部独立执行；真实模型、物理断电等限制见下文。 |
| Coherence | 一套 Runtime、四工具、两卷及代码目录符合原边界；D03/D08 的复制条目来源闭包在 Go 路径已补齐。没有新增 schema、持久化索引或执行机制，也没有另列代码模式偏差。 |

| Requirement | 实现与验证依据 |
| --- | --- |
| WMEM-001 | `memory.ts` / `store.ts`；Memory persistence/owner/pair tests、真实 SDK restart、原 helper/Service mount policy |
| WMEM-002 | `brain-flow.ts` / `brain.js` / `memory.ts`；兼容 stage、revision/invalidation、同条目 CAS、不同条目合并、Service scope tests |
| WMEM-003 | `FeedbackStore.finish` + attached Memory commit；失败 Query/Action/Job/SDK、原 Chat、两库写入错误与 COMMIT 前/后真实 SIGKILL tests |
| WMEM-004 | `acceptRun`、RunManager、资源 loader、brainPrompt；固定 version/selection、scope/中英文、10 条/16 KiB、显式 Recall 边界、禁用/旧 null、实际 SDK |
| WMEM-005 | 冻结 schema 4、受控 migration、Core history Apply、helper；实际旧镜像、MCP 失败回退、Core crash、Stop/Delete/new Apply、降级拒绝 |
| WMEM-006 | 原四工具、实际回执、Desktop/CLI 投影；SDK package digest/Prepare/Apply/generation 不变，原 Run 与请求事实同源 |
| BRN-002 | 四项 Cognition + 原 Skill；真实 SDK Package 与 Kanban/工作站/第三方 Service 原验收路径 |
| BRN-003 | 唯一 Memory、固定实际采用；SDK 新 Session/同 Session/重启、store/flow/source proof tests |
| BRN-005 | 原 BrainCandidates/BrainFlow；实际固定 SDK 输入/checks、成功/失败、原 Action gap 三种恢复、正式 Package Apply/rollback |
| BRN-007 | 初始 `BASELINE.md` 仅包含 Mark 明确八条；不宣称 GitHub 强身份审批，不用学习改决策 |
| ADEP-002 | 原 deployment Skill + workstation SPEC；实际 Kanban Spec 先写、同 UI/Agent 状态、同一测试失败→修复→通过、无开发普通 Action |
| PWORK-003 | 精确 4/5 image/history 校验、原包 framing；Snapshot/contract unit tests、实际离线内容恢复、保留原镜像 |
| PWORK-BRAIN-001 | TS/Go 跨库闭包与 rebuild；两份独立 Work、旧请求历史、新反馈、各自候选实际 SDK、再次导出 |
| CONV-SNAPSHOT-001 | 原 Session/Run/SDK history + schema-aware rebuild；真实 SDK Session 继续、两份导入、context 映射/非法路径/不重放 tests |
| CONV-MEMORY-001 | 同一 adoptedExperienceVersion、持久 selection、实际 loader 和同源工具结果；幂等重放、旧未知、禁用脑包、UI/CLI/SDK tests |
| WSTOR-MEMORY-001 | 原 private 卷、DELETE/FULL、backup/restore/fence、cold journal busy；SQLite/真实 Engine 故障恢复、已发布后 cleanup 诊断与重试 tests |

## 原 CRITICAL 记录（已修复）

### C1 — 无偏好证明的普通经验可被伪造成 preference

定位：`packages/work-store/src/memory.ts:52`、`:192`；`packages/work-store/src/snapshot-memory.ts:50`；`internal/workhistory/memory_linux.go:171`、`:218`。

`propose` / `commit` 校验原 Chat 偏好证明，但 `snapshot` / 静态校验只检查类别枚举、已完成请求和 verified Evidence。公布候选与 entries 的一致性比较也没有包含 kind。将合法 Query 经验的 entry/candidate kind 改为 preference 后，没有 userPreferenceVerified/promptDigest 原指令证明，TS 的 Memory+Brain 校验和 Go 完整 snapshot 校验仍接受；运行时重开后，无关任务 Recall 返回该伪造偏好（1 条）。

影响：恢复或导入的认知可把业务经验冒充用户偏好，违反 WMEM-003 / BRN-003 / PWORK-BRAIN-001 的可信来源要求。这不证明工具权限被扩大，但说明认知来源与检索优先级能被伪造。

建议：在 runtime 读取和 TS/Go 静态闭包中复用原 Chat 偏好证明核对；校验 published candidate 与 entry 的 kind/来源元数据一致。补齐正常偏好、仅改 entry kind、同时改 candidate kind、无原偏好证明的拒绝测试。对应任务 1.2、2.1、5.1 的验收需要复验。

### C2 — 过期 head 可使已提交 Memory 伪装成合法空认知

定位：`packages/work-store/src/memory.ts:45`；`packages/work-store/src/snapshot-memory.ts:19`；`internal/workhistory/memory_linux.go:161`。

已验证 Memory 发布到 head 2 后，仅将 memory_head.version 改为仍存在的空版本 0，runtime 重开成功并返回 0 条认知。TS 静态校验与 Go 完整 snapshot 校验均接受。现有校验只要求 head 是存在的版本，没有核对它与最新持久发布事实一致。

影响：已有有效认知在损坏/伪造存储中静默消失，违反 WMEM-001 的“正常空与损坏不同”以及 WSTOR-MEMORY-001 的有效 head 校验。

建议：核对 head 与有效发布版本/候选历史的一致性，明确 legacy 部分版本与正常 published 版本的区别。补齐真正初始 0、最后一条失效后的新空版本、head 被退回 0/旧有效版本、悬空 head 的 runtime 与 TS/Go 拒绝用例；不得自动把错误库修成空。

## 首次核验实际验证（修复前，历史记录）

- WorkStore 54 项现有单测通过。
- `go test ./internal/workhistory ./internal/coreapp ./internal/cli ./internal/agentclient` 通过。
- OpenSpec strict 和 `git diff --check` 通过。
- 新负向复现均在独立临时目录进行，没有修改仓库实现、真实 Work 或任务记录。普通 API 创建合法 Memory/证据后修改临时数据库，检验 runtime 及完整静态验证行为。

| 夹具 | TS / runtime | Go 完整 snapshot validator |
| --- | --- | --- |
| 合法 Query 经验 | 正常可读 | 接受，作为正对照 |
| head 2 改为 0 | 接受，返回空认知 | 接受，错误 |
| 无偏好证明的经验改为 preference | 接受，无关 Recall 返回 1 条 | 接受，错误 |

以上不是已存在单测失败；现有测试没有覆盖这些负向条件。测试全绿不覆盖新发现的完整性缺口。

## WARNING 与 Not Verified

WARNING：没有另列独立实现警告；C1/C2 所缺的负向测试归入各关键问题的修复要求。

Not Verified：Scenario Coverage 的实际行为执行仍有限；真实模型自主 Spec/Memory 选择、物理断电、完整所有 integration/Release/真实 SELinux，以及生产跨用户分享未运行。GitHub 强审批和独立 Agent 身份未配置或验证，当前规格也未声称由文档提供强隔离。

SUGGESTION：0；本轮不扩大到风格重构。

## 上次 Apply 的 C1/C2 修复复验（历史记录）

- runtime 有效读取、Propose/Commit、TS/Go 静态闭包统一要求条目实际引用其原 Chat 偏好证明；迁移分类也核对原 source Run、同 Work/请求、verified SDK、userPreferenceVerified 与 promptDigest。有效 upsert 元数据含 kind/createdAt 完整比对。
- head 必须等于 published_at 非 null 的最大真实发布版本；候选号与 legacy null 部分历史不参与。非法发布关系拒绝，已固定 Run 仍可读合法旧版本。
- 共享 `internal/workhistory/testdata/memory-integrity.sql` 与 `memory-integrity-cases.json` 的 22 组夹具，在 runtime、TS Memory/Brain/完整 Snapshot、Go Open 和原 snapshot helper 一致：7 组合法接受、15 组伪造拒绝；拒绝前后输入指纹相同。普通 API 构造的偏好来源/重开、head 与迁移分类测试另行通过。
- WorkStore 59 项、Agent 86 项通过；Go history/snapshot helper 与 `make test`（含 Core/CLI/build/typecheck）通过。真实 SDK 偏好/修订/失效/重启 80.71s，旧 4→5/MCP 回退/降级拒绝 222.34s，工作站两份分享/新反馈/再次导出 628.02s 均通过。
- strict、diff、native source/image boundary 通过；没有 schema 版本变化、新产品能力、Baseline 修改或数据自动修复。

## 上次只读复验

本轮实际重跑（Node 24.21.0 / Go 1.25.5）：

- `npm run test:unit -w @piwork/work-store`：59/59 通过，无跳过；包括原共享 22 组夹具及普通 API 的来源/head/迁移测试。
- `npm run test:unit -w @piwork/agentd`：86/86 通过，无跳过。
- `go test -count=1 ./internal/workhistory ./internal/snapshothelper ./internal/coreapp ./internal/cli ./internal/agentclient`：全部通过，未使用测试缓存；其中 workhistory 0.933s、snapshothelper 0.320s、coreapp 41.468s、CLI 24.148s、agentclient 0.012s。
- OpenSpec strict 与 `git diff --check`：通过。
- 额外隔离负向复现：正常提交两次 Memory 后只修改复制条目的 kind、createdAt 或正文。三种修改均出现 Go 接受、TS/runtime 拒绝；Go Rebuild 同样返回成功，重建结果被 runtime 拒绝。合法对照在全部路径通过。Go 只读校验前后源数据库 SHA-256 指纹相同。

执行输出：`/tmp/piwork-verify3-store.log`、`/tmp/piwork-verify3-agent.log`、`/tmp/piwork-verify3-go-fresh.log`。复现材料位于被忽略的 `dist/verify-memory-review/`，仅访问本轮临时目录；未更改真实 Work 或产品实现。

上一轮真实 SDK/迁移/分享的成功输出仍可核对：`/tmp/piwork-c1c2-sdk-migration.log`、`/tmp/piwork-c1c2-sharing.log`。本轮未重新运行 Docker/真实 SDK 全套，这些旧成功结果不覆盖下面新增的负向条件。

## 原 CRITICAL — C3：Go 接受来源元数据被改写的复制条目（已修复，以下为历史记录）

定位：`internal/workhistory/memory_linux.go:180`、`:234`；对应 TS 检查在 `packages/work-store/src/memory.ts:80`；Go helper 使用该校验器的位置为 `internal/snapshothelper/history.go:186`。

Go 对 effective candidate 只比较 `entries[candidate.published_version][entryId]`，没有把后来快照中的复制条目与其原 effective upsert candidate 比较。一般来源/Evidence 校验虽仍通过，却不能证明复制的正文和元数据保持不变。TS snapshot 对每个条目寻找同 entryId/sourceRequestId、publication 不晚于该快照的最新 effective upsert，并比较完整内容，因此两者结果不同。

复现使用正常 `WorkStore`/`FeedbackStore` API，而非伪造初始有效状态：

1. 创建隔离 Work，真实调用 stage/finish/completed API 发布 A，head=2。
2. 另一个请求提交不同条目 B，head=4，A 原样复制到版本 4。
3. 关闭后仅修改版本 4 的 A，保留版本 2、原候选、请求、Evidence 和 head。

| 对照/修改 | TS 完整 snapshot | runtime 重开 | Go 完整 Open | Go Rebuild 后 runtime |
| --- | --- | --- | --- | --- |
| 原样复制 A | 接受 | 接受 | 接受 | 接受 |
| A.kind：experience → knowledge | 拒绝 | 拒绝 | 接受，错误 | Rebuild 成功，但 runtime 拒绝 |
| A.createdAt 改为另一合法时间 | 拒绝 | 拒绝 | 接受，错误 | Rebuild 成功，但 runtime 拒绝 |
| A.rule 改为无新候选的正文 | 拒绝 | 拒绝 | 接受，错误 | Rebuild 成功，但 runtime 拒绝 |

影响：Go 导出/导入使用的静态历史闭包接受了运行时不能打开的数据。直接验证和 Rebuild 已实际复现；本轮没有把该夹具包装成 `.work` 并运行完整 Core import，因此不声称已复现完整 HTTP 导入成功。这也不证明伪偏好进入模型：runtime 在这里正确拒绝。

违背现有 D03 第 2 项“已复制到后续版本的有效 entry 仍验证其原来源”、D08 及 PWORK-BRAIN-001 的 TS/Go 一致接受/拒绝要求，属于已批准闭包修复的遗漏，不需要新增产品能力或改变 schema。

修复建议：在 Go `validateMemoryHistory` 中对每个有效快照条目匹配其适用的原 effective upsert candidate，核对 kind、scope、rule、evidenceIds、sourceRequestId、createdAt，与 TS 行为一致；保留无 candidate 的合法迁移历史。把正常复制及上述三种篡改加入共享夹具，并覆盖 Go Open、原 helper、Rebuild 与 runtime；拒绝时保持输入不变。任务 8.1/8.3 的对应验收需扩展并复验。

WARNING：0；缺失的复制条目测试归入 C3。SUGGESTION：0。

## 修复前再次核验（2026-10-09，历史记录）

重新读取 OpenSpec status/apply context：仍为 repo-local、spec-driven，33/33 项任务勾选完成，六份规格共 16 项 ADDED/MODIFIED Requirement、95 个 Scenario，无 REMOVED/RENAMED。当前 Go 校验仍只比较 candidate 的首次 published_version；共享夹具仍为 22 组，没有覆盖本次复制条目篡改条件。C3 没有修复，完整性、正确性和设计一致性的评分保持本文顶部结论。

本轮实际重新执行：

- Node 24 下 WorkStore 单测 59/59 通过，无失败或跳过，输出 `/tmp/piwork-verify4-store.log`。
- `go test -count=1 ./internal/workhistory ./internal/snapshothelper` 通过：0.671s / 0.233s，输出 `/tmp/piwork-verify4-go.log`。
- 用正常 API 重新创建独立临时 Work，重新执行 C3 的合法复制对照与 kind/createdAt/rule 三组负向条件；Go Open/Rebuild 均接受三组非法副本，TS 完整 snapshot、runtime 及重建后 runtime 均拒绝；Go 校验及 Rebuild 前后源数据库指纹未变化。完整输出 `/tmp/piwork-verify4-carry.log`。
- OpenSpec strict 与 `git diff --check` 通过。

本轮未重复 Agent 86 项、其余 Go 包或 Docker/SDK 回归，前次结果只作为既有证据保留。真实模型、物理断电、生产跨用户分享、完整 integration/Release/SELinux 与完整 `.work` 负向导入仍未验证。本轮仅更新本报告，没有修改实现或任务勾选，也未归档、推送或发布。

## C3 修复与实际复验（2026-10-09）

- `internal/workhistory/memory_linux.go:255` 对每个有效快照条目查找同 entryId/sourceRequestId、publication 不晚于该快照的最新 effective upsert；核对 kind、scope、rule、evidenceIds、sourceRequestId、createdAt。没有候选的合法迁移历史沿原来源校验；合法修订、失效和旧固定版本保持可用，与 TS 规则一致。
- 原 22 组共享预期保持；新增复制、kind/createdAt/rule/scope/Evidence 差异、固定旧版本、迁移无候选及合法修订/失效，合计 32 组（12 接受、20 拒绝）。runtime、TS Memory/Brain/完整 snapshot、Go Open 和原 helper 全部通过，静态校验及拒绝前后输入指纹保持。另有普通 API 两次提交后的副本篡改回归。
- Node 24 下 WorkStore 60/60、Agent 86/86；Go history/helper 定向测试及 `make test`（含构建、Go/TS 单测、typecheck）通过，输出 `/tmp/piwork-c3-store.log`、`/tmp/piwork-c3-shared-go.log`、`/tmp/piwork-c3-full-tests.log`。
- `TestNativeMemoryCarryValidationBeforeImportPublication` 最终通过（136.07s）。正常 API 构造实际 Work 的复制/修订/失效历史，真实 SDK 读取；合法副本和合法迁移形态两份 `.work` 经真实 Core/helper 完成静态校验、身份 Rebuild、导入 stopped Work、显式 Start，再由实际 runtime 打开并比较完整有效快照及 SDK Recall。旧请求全部 historical。正常 Query 种子为合成 API 夹具，不能称为真实模型自主业务验证。
- 三种非法 `.work` 仅修改最新副本的 kind、createdAt 或 rule，并重算文件、tree、manifest 的封装引用/摘要。真实 Core 在上传校验阶段通过原 helper 返回 HTTP 409 / SNAPSHOT_HISTORY_INVALID，包不进入可导入状态、未发布 Work，输入文件 SHA-256 不变。这是完整 `.work` 入口的实际拒绝，早于导入发布，已补齐先前仅 Open/Rebuild 的证据限制。最终输出 `/tmp/piwork-c3-real-core-final.log`。
- `TestNativeLegacyMemoryUpgradeRollbackAndDowngradeFence` 本轮通过（212.61s）：实际旧 schema 4 工作站升级、迁移后 MCP 加载失败恢复旧数据、成功升级和不兼容降级拒绝。输出 `/tmp/piwork-c3-real-core.log` 中该测试的 PASS。
- 首次新增 Core 测试错误期待 HTTP 400，而既有契约规定 409；三种非法包当时已被正确拒绝，修正测试的状态断言后重跑全部五组通过。该首次组合命令仍记录为失败，不把它的整体退出码称为成功；其中旧格式回归独立显示 PASS。HTTP 上传 Reader 改为保留本地文件以实际核对输入指纹。首次 helper image boundary 因未传 commit、版本显示 unknown 而失败；补齐构建元数据后边界检查通过，未修改边界要求或运行行为。
- native source/image boundary、OpenSpec strict 和 `git diff --check` 通过；没有修改 Founder Baseline、schema、现有工具名、两卷或 CAS 策略，没有新增产品能力。

当前 CRITICAL：0；WARNING：0；SUGGESTION：0。这些是已检查范围的结论，未运行检查不计为通过。

## 修复后的独立只读核验（2026-10-09）

重新读取 repo-local / spec-driven 的 status、apply context 和全部规划制品：36/36 项任务完成，16 项 ADDED/MODIFIED Requirement、102 个 Scenario，无 REMOVED/RENAMED、缺失制品或不可读 tracking 文件。Task Completion、Spec Coverage、Requirement Implementation Mapping、Design Adherence、Code Pattern Consistency 已检查，未发现新的关键问题或警告；Scenario Coverage 仍为部分 Not verified，范围如下。

本轮重跑 Node 24 的 WorkStore 60/60、Agent 86/86，均无失败、取消或跳过；`go test -count=1 ./internal/workhistory ./internal/snapshothelper ./internal/coreapp ./internal/cli ./internal/agentclient` 全部通过（0.816s / 0.353s / 38.050s / 24.003s / 0.008s）。共享 32 组夹具仍为 12 接受、20 拒绝，普通 API 的复制条目回归存在并通过；C1 偏好引用证明、C2 最新 head 和 C3 每个快照的适用候选比较在现行源码与测试中相符。OpenSpec strict 和 `git diff --check` 通过。当前输出：`/tmp/piwork-verify5-ts.log`、`/tmp/piwork-verify5-go.log`。

复核了真实 Core 测试源码和上一轮输出：合法副本/迁移形态经过完整 `.work` 导入、Rebuild、显式 Start 和实际 SDK 读取；三种非法副本在既有 HTTP 409 / SNAPSHOT_HISTORY_INVALID 上传校验门禁被拒绝，未发布 Work且输入不变。Core 使用既有受管 helper 和隔离安装，不新增执行机制。136.07s 的 C3 与 212.61s 的旧格式测试是上次 Apply 的实际结果，本轮没有重新运行 Docker/SDK、完整 `make test` 或镜像边界，不将历史输出计为本轮重跑。原组合命令的初次失败仍按上节保留，没有用其中单项 PASS 覆盖整体失败退出码。

当前 CRITICAL：0；WARNING：0；SUGGESTION：0。未修改实现、tasks 或规划，仅更新本报告；未归档、Push、Tag 或 Release。

## 规格同步与归档（2026-10-09）

在上述核验之后，Mark 显式要求同步并归档。六份 delta 已合并到主规格：新增 9 项、修改 7 项，无删除/重命名；保留既有 Purpose、未涉及需求和原场景，六份合并结果逐项匹配且重复合并无变化。全库主规格校验 39/39 通过，变更制品及任务均完成（36/36）。归档保留 `.openspec.yaml`，目录为 [2026-10-09-simplify-piwork-brain-and-extract-work-memory](../../openspec/changes/archive/2026-10-09-simplify-piwork-brain-and-extract-work-memory/tasks.md)，已从 active changes 移除；文档任务链接已修复。

归档不改变上述测试事实或 Not verified 范围，没有重新执行产品验收，没有 Push、Git Tag 或 Release。

## Final Assessment

C3 在本轮共享负向、恢复及完整 `.work` Core/helper/SDK 检查中已闭环，没有剩余已发现关键问题，任务 36/36 完成。

Scenario Coverage 部分 Not verified：真实模型自主 Spec/Memory 行为、物理断电、生产跨用户分享及完整 integration/Release/SELinux 未运行；与 C3 无关的整套浏览器和全部旧运行时场景本轮没有逐项重跑，其前次结果保持历史证据。GitHub 强审批和独立 Agent 身份也未验证，当前规格没有把文档当作强隔离。上述限制单独报告，不新增归档前置要求；不宣称全部检查通过或 Ready for archive，也不自动归档、Push、Tag 或 Release。
