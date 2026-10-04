# 实施核验：rebase-piwork-brain-onto-go-core

本报告针对本次 master Go 基线的实现，来源功能分支仅作参考。基线为 `a980c189be074c2a6d87cc88d7f942fbab7998c4`，实施分支及工作树为 `rebase-piwork-brain-onto-go-core`。没有合并或改写 master、来源分支。

## 规范同步与归档收尾（2026-10-04）

按用户指定顺序完成主规范同步和 change 归档；实现、正式主规范、文档及本归档构成本次 Git 提交范围。后续测试使用 `/home/p/Projects/piwork__worktrees/rebase-piwork-brain-onto-go-core` 工作树及同名分支。

- 全部十二份 delta 已合入同一 Go 工作树的 `openspec/specs/`：新建 `piwork-brain`、`work-agent-feedback`，更新另外十份主规范，共新增 28 项、修改 15 项要求。既有 Purpose、98 项未修改要求及全部既有场景保留；新能力的 Purpose 使用已批准 delta 内容，没有 TBD 占位。
- 同步后对十二份 delta 的 43 项要求逐项比较，均与主规范一致，重复同步没有待应用内容。`openspec validate --specs` 为 37 PASS、0 FAIL；当前 change 的 strict 校验通过。
- 归档前 fresh status 的四份规划 artifact 全部 done，fresh list 的任务计数为 26/26。归档位于 `openspec/changes/archive/2026-10-04-rebase-piwork-brain-onto-go-core/`；移动时十七份文件逐字节保留，包括 `.openspec.yaml`、tasks 和原核验历史。本节为移动后追加的交付状态，原失败/补跑证据仍保留。
- 当前验收文档中的报告路径已更新为归档位置。FullFlow 的原 change、规范和 Git 提交继续保留为历史来源；当前交付以本 Go 分支的主规范为准。

本次收尾未改动运行实现，也未重新执行长测；此前实际核验范围与本轮未重跑项见下文。同步/归档校验及合并前后内容身份材料在 `/tmp/piwork-brain-final-spec-sync/`。

## 独立核验（2026-10-04 12:25 UTC）

使用 `openspec-verify-change` 独立复核当前实现。重新读取 status、apply context 和全部十五份规划文件（proposal、design、tasks、十二份 delta specs），并核对生产代码、测试断言、当前执行和可追溯的既有验收证据。写入前已通过 `openspec list --json` 确认实施工作树的既有 OpenSpec root；没有创建规划根。任务 `all_done` 仅用作输入，不作通过依据。

**当前结论：CRITICAL 0、WARNING 0、SUGGESTION 0；六项检查均已核验，未跳过适用检查。W1～W5 均无未处理问题，可以归档。** 下方修复前的 WARNING、反例和 FAIL 是历史记录，仍予保留。

| 维度 | 当前结果 |
| --- | --- |
| 完整性 | 26/26 tasks；12 份 delta 的 43 个 ADDED/MODIFIED requirements 均找到实现；无 REMOVED/RENAMED |
| 正确性 | 核对 43 项要求的实现映射、188 个场景的分支和测试/真实验收入口；W5 正反向断言及原 HTTP 反例通过 |
| 一致性 | 十一项设计决定与当前 Go 平台、Service 直连、本地脑包、显式 Apply、schema 4、master UI 和既有代码模式一致 |

| 检查 | 状态与依据 |
| --- | --- |
| Task Completion | 已核验；top-level progress 为 26/26，所有跟踪文件可读，未靠任务勾选代替实现检查 |
| Spec Coverage | 已核验；逐份读取当前 delta，28 个 ADDED、15 个 MODIFIED；各要求可映射到下方覆盖索引中的生产模块 |
| Requirement Implementation Mapping | 已核验；模型与幂等、身份/准入、业务反馈/原对象、候选准备/原 Apply/SDK checks、经验、分享和 UI 入口符合当前要求；重点修复定位见下表 |
| Scenario Coverage | 已核验；188 个场景与代码条件及断言/真实验收入口对应；同时核对异常、期限等值、查询后取消、历史只读和失败证据，未发现缺少处理或覆盖的场景 |
| Design Adherence | 已核验；十一项决定和八条闭环有对应入口。Go 管平台生命周期与分享，Agent 管目标处理，Service 管业务状态；没有引入旧 TS Core 路径 |
| Code Pattern Consistency | 已核验；对比 master Go 基线与当前新增/修改代码，沿用事务、scope、原 ID、结构化错误、根契约生成、原生 helper 和现有对象详情模式；无明显偏离 |

场景数是规划覆盖核对的计数，**不是本轮分别执行 188 次测试，也不是仅凭关键词作 188/188 PASS 声明**。核验使用静态分支与断言审阅、新执行结果以及身份可核对的既有真实验收；六项检查均有适用证据，无 Not verified / Not applicable。

### 原 WARNING 的当前闭合依据

| 原问题 | 当前生产路径与独立复核依据 |
| --- | --- |
| W1：无关保存后漏报失败 Apply | `internal/coreapp/brain_candidates.go`、`brain_candidate_projection.go` 共同使用发布后、同 Work、同启用制品的原 Apply；projection 回归本轮随 Go coreapp 非缓存集合通过，已有真实失败加载/恢复断言仍绑定原目标 |
| W2：Retry 查询后的期限/状态竞争 | `apps/agentd/src/brain-loop.ts:148` 每次 Action/Job/capabilities/query 返回后重读准入；`brain-flow.test.ts:319`、`:344` 的期限及生命周期组合本轮通过，无重复 mutation 或新 Run |
| W3：安全候选详情缺字段 | `internal/coreapp/brain_candidate_projection.go`、Desktop 现有 Details 提供受理基线、固定目标/安全输入/checks 和原 Apply；Go 投影及本轮浏览器完整集合通过，候选详情保留 Service iframe 文档的回归通过 |
| W4：旧失败使新候选验收误通过 | `internal/coreapp/brain_workstation_integration_test.go:319`～`:364` 锁定本次 live requestId、失败 SDK proof/Run、该候选 active/loaded 与有效经验不变。此真实异常专项使用此前实际执行记录，不宣称本轮又执行一次 |
| W5：Job 属于另一 Action 仍可完成 Retry | `apps/agentd/src/brain-loop.ts:148`、`service-interaction.ts:126`、`packages/work-store/src/feedback.ts:375` / `:386`、`internal/workhistory/brain_linux.go:321` 同时保留并校验原 Action/Job。错误归属/替换/缺失关系被拒绝，正确证明、Action 省略 Job 以及正常完成/经验提交通过；原取消状态、有效经验和单次 mutation 有断言 |

W5 的原真实 HTTP 反例本轮重新执行：新 Retry 为 `needs_attention/INVALID_WAIT`、autoRunCount=0、原请求 cancelled、mutation=1，没有错误 verified Job。尝试生产 finish 被拒绝。Go `TestCurrentCompletedJobProofRequiresOriginalActionAndJob` 本轮验证正确关系可读，错误 Action、错误 Job、缺少 Action 均拒绝且源文件字节不变。WorkStore 的 TS snapshot 工具在当前产品平台无调用入口；实际 Go 导入/导出经原生 helper 的 `workhistory` 校验，不将 TS 测试工具当作 Go 分享证据。

### 本轮新执行

| 执行 | 结果与本机证据 |
| --- | --- |
| 五个保留 workspace 完整单元测试，均重新编译 | **146 PASS、0 FAIL/skip**：contracts 9、pi-package 8、work-store 39、pi-adapter 16、agentd 74；`/tmp/piwork-brain-w5-reverify-unit.log` |
| `CGO_ENABLED=0 go test -mod=readonly -count=1` | **八包非缓存 PASS**：coreapp、contracts、agentclient、workhistory、workpackage、packagehelper、snapshothelper、cli；`/tmp/piwork-brain-w5-reverify-go.log` |
| Desktop 完整浏览器集合 | **166 PASS、0 FAIL、1 条件 skip**；`/tmp/piwork-brain-w5-reverify-browser.log`。五分钟票据用例默认跳过，其独立实际 PASS（1/1、0 skip）保留于 `/tmp/piwork-brain-fixes-ticket-expiry.log` |
| 原 W5 HTTP 反例，使用当前生产编译模块 | PASS、退出码 0；`/tmp/piwork-brain-w5-reverify-job-origin.log`，请求 `request-3cfa6ac2-64fb-48d1-8f94-cd6373942f50`；executor 是受控夹具，不宣称该异常在 Docker/真实 SDK 内重新注入 |
| 当前源码边界、边界/验收 gate 注入自测、生产/验收/helper 镜像边界 | 全部 PASS、自测 2/2；`/tmp/piwork-brain-w5-reverify-boundary.log`、`gates.log`、`images.log`（同前缀）；涵盖 scripts、配置、锁文件、当前操作文档和镜像内容 |
| 当前 release 全部 `SHA256SUMS` | 全部 OK；`/tmp/piwork-brain-w5-reverify-release-checksums.log`，发布 Core 与 dist Core 的 SHA256 相同 |
| 当前生产/验收 Agent 与原生 helper 身份 | 两镜像内的 brain-loop/service-interaction/feedback 与本轮编译文件 SHA256 全部相同；原生快照 helper 用当前源按 Dockerfile 配置在 `/tmp` 构建，与镜像程序 SHA256 完全相同；`/tmp/piwork-brain-w5-reverify-artifacts.json` |
| OpenSpec strict、diff 格式与写报告后的源码身份 | `openspec validate rebase-piwork-brain-onto-go-core --strict` 与 `git diff --check` PASS；`/tmp/piwork-brain-w5-reverify-openspec.log`；报告写入后再次比较源码和编译模块 SHA256，均未改变 |

原生 helper 的本地未剥离程序与镜像的 `-s -w` 程序原始 SHA256 不同，不能直接当作源不同。已按相同镜像构建参数核对为 `5c24b256763765efd1348d746b431790d0769e882c8e056a3e57e2856a6b1bb4`，两者相同；该检查只产生 `/tmp` 核验文件，没有替换产品发布或镜像。

### 既有实际验收与本轮边界

最新 W5 修复后八回路的真实验收为 `/tmp/piwork-brain-w5-scratch.log`，fixture `piwork-native-host-2808c4db-ddbc-4708-9178-19c4975bcc32`，实际 Go 发布宿主、独立 Engine、NiceGUI 浏览器、真实 SDK/MCP、自动修复、异步 Job、经验采用、候选 Apply/恢复、两份导入各自新反馈和 SDK 证明、实际模型选择全部 PASS。本轮重新核对其脚本断言、发布校验和以下镜像身份，没有重新运行这项长测：

- production Agent：`sha256:8259a6e73fbeb48fdaca92237a15a7dff763c2e52bef78f7f331fd1d00255389`。
- acceptance Agent：`sha256:4a3e745a8fc8cbe836e6187905f621f3da72af2b9ba2f8089969dfa4f3719f3b`。
- snapshot helper：`sha256:5bef4e8bffc2b071ad48ff892d229d49fefc04e198999850c5eb08a13e2d6495`。

215 项 Go 集成的此前实际 PASS、初批失败及补跑保持下方原证据；本轮没有重跑全部集成、Console 全集、干净副本构建或 Desktop real-Core 长测。970 条验收索引只用于记录完整性，不作新测试执行。此前 W1～W4 的真实故障、模型/身份和原 Action 间隙恢复记录结合本轮单元/Go/浏览器回归使用，没有将旧 TS Core 的记录作为当前证明。

### 优先级与最终判断

- **CRITICAL：0**。无未完成任务或缺失实现要求。
- **WARNING：0**。原 W1～W5 已闭合，本轮未发现规范偏差或场景遗漏。
- **SUGGESTION：0**。无需要单列的代码模式改进。

六项检查全部通过，可以归档。本轮仅更新核验报告和生成测试/核验产物，没有修改实现、tasks/specs，没有提交、合并、同步或归档。

## W5 修复核验（2026-10-04 12:11 UTC，历史执行记录）

本轮使用 `openspec-apply-change` 直接修复既有原效果与证据约束，没有新增规范、平台能力或兼容路径。重新打开 3.2、5.2、6.1、8.1、13.1 并在对应验证通过后完成；当前进度为 **26/26**。实施仍在 master Go 基线工作树，未提交、合并或归档。

**当前结论：CRITICAL 0、WARNING 0、SUGGESTION 0。W5 已修复。** 修复前的反例与 FAIL 日志保留在下面的历史核验记录中，没有改写为 PASS。前次 W1～W4 的修复保持；本轮专项核验补充 W5，未声称将 188 个规范场景分别重新执行一次。

- `BrainLoop` 的显式 Retry 与恢复使用相同原 Action/Job 匹配规则，Action 暂未返回 Job 时保留已登记 ID；错误归属或已登记 Job 被替换即停止受理验证 Run。
- `ServiceInteractionClient` 在写 Job evidence 前校验与目标的原 Action/Job 关系，错误回执不写为有效证据；无目标关联的普通只读 Job 观察仍可用。
- `FeedbackStore` 拒绝原 Job 引用替换；完成事务同时校验 Job proof 的 objectRef、details.jobId、details.actionId，所选错误证明不能被另一个正确证明掩盖。拒绝时目标和有效经验不变，正确证明仍能完成并提交经验。
- Go `workhistory` 的静态完成校验同步核对 Job/Action 双重关联，环境分享与导入不能以错误 Job 证明已完成。schema 4、Core API、平台职责和 UI 路线保持。
- 正反向回归涵盖执行中/已终态的错误 Job、替换 Job、缺失 Action、Action 省略 Job、正常 Retry 等待及完成、直接 finish 绕过、有效经验不变与提交。所有 Service mutation 断言仅一次，原取消请求保持取消。

| 本轮执行 | 结果 | 证据 |
| --- | --- | --- |
| WorkStore 与 Agent 重新编译、完整单元集合 | **39 + 74 PASS，0 FAIL/skip** | `/tmp/piwork-brain-w5-unit-fixed.log` |
| Go workhistory/workpackage/snapshothelper/coreapp，`CGO_ENABLED=0 go test -mod=readonly -count=1` | 四包非缓存 PASS；Core 34.898 秒，错误历史拒绝且源文件字节不变 | `/tmp/piwork-brain-w5-go.log` |
| 修复前同一真实本地 HTTP 反例，使用当前生产编译模块 | PASS/0；新请求 `needs_attention/INVALID_WAIT`、自动 Run 0、原请求 cancelled、mutation 1；没有错误 verified Job，finish 因无活跃 Run 被拒绝 | `/tmp/piwork-brain-w5-fixed-retry-job-origin.mjs/.log` |
| 源边界与验收 gate 注入自测 | 2 PASS，当前 source boundary PASS | `/tmp/piwork-brain-w5-boundary-tests.log`、`source-boundary.log`（同前缀） |
| 生产/验收 Agent、两个原生 helper、七个 Go 程序与 release | 构建及发布 PASS；新快照 helper 包含 Go 校验修复 | `/tmp/piwork-brain-w5-build.log`、`release-final.log`（同前缀） |
| 当前镜像边界、release checksum 与验收索引 | PASS；970 条 master 历史索引只证明记录完整，不作本轮新执行 | `/tmp/piwork-brain-w5-image-boundary.log`、`final-checks.log`（同前缀） |
| 新 release、独立 Engine、scratch Go 宿主八回路 | PASS，fixture `piwork-native-host-2808c4db-ddbc-4708-9178-19c4975bcc32`；真实 NiceGUI/SDK、异步 Job、经验采用、显式候选 Apply、两个独立分享副本各自产生新反馈和 SDK 证明；自有资源已清理 | `/tmp/piwork-brain-w5-scratch.log` |
| OpenSpec strict、任务状态、diff 格式 | PASS，26/26，跟踪文件可读 | `/tmp/piwork-brain-w5-openspec.log`、`final-checks.log`（同前缀） |

首轮新增 WorkStore 回归中，正常提交分支曾将经验版本误断言为逐次加一（实际版本允许跳号）；已改为有效版本前进及正确规则存在的业务断言，并完整重跑为上述 39 + 74 PASS。初轮日志 `/tmp/piwork-brain-w5-unit.log` 仍保留为 FAIL，没有掩盖。

错误 Job 的异常组合本轮通过生产代码与真实本地 HTTP 测试验证，模型 executor 是受控夹具，不将其宣称为 Docker/真实 SDK 的异常注入。scratch 是正常工作站全链路回归。本轮没有重跑未改动的浏览器集合或完整 215 项 Go 集成；前次实际执行和失败/补跑记录在下文保留。本轮影响到的 Agent、完成证据及 Go 快照历史校验均有新单元、构建、发布和实际分享证据。

## 修复前独立核验（2026-10-04 11:46 UTC，历史反例）

使用 `openspec-verify-change` 重新读取当前 proposal、design、tasks 和十二份 delta specs，并核对实现、测试断言、已有实际执行日志及本轮新测试。`openspec status` / `instructions apply` 确认 spec-driven、26/26 tasks、所有跟踪文件可读；all_done 只作为任务状态。本报告写入前通过 `openspec list --json` 确认上述实施工作树为既有 root，没有创建其他规划根。

**当轮结论：CRITICAL 0、WARNING 1、SUGGESTION 0。** 前次 W1～W4 修复已确认；本轮发现并复现新的 **W5：显式 Retry 与完成证据缺少 Job→Action 归属校验**。上一轮的零 WARNING 是当轮结论，不能替代本轮结论。源码/镜像边界仍通过，未发现旧 TS Core 运行、构建或测试入口。

| 维度 | 核验结果 |
| --- | --- |
| 完整性 | 26/26 tasks；43 个 ADDED/MODIFIED requirements 均找到实现模块，未发现整个要求缺失；无 REMOVED/RENAMED |
| 正确性 | 已重新核对 43 项实现映射及 188 个场景的代码/测试入口；存在 W5 的原效果归属与完成依据偏差，不记为全部满足或 188/188 PASS |
| 一致性 | Go 平台职责、Service 直连、显式 Apply、本地脑包、schema 4、master UI 产品路线及现有代码模式一致；原对象核对在 Retry 路径存在 W5 缺口 |

| 检查 | 状态与依据 |
| --- | --- |
| Task Completion | 已核验；top-level progress 为 26/26，无 unavailableTrackingFiles；没有因发现问题改写任务勾选 |
| Spec Coverage | 已核验；12 份 delta 的 43 项当前要求可映射到下文模块，场景数按原文重新提取为 188 |
| Requirement Implementation Mapping | 已核验，存在 WARNING；WAF-006/007/009 的原对象核对与来源证据在 W5 组合下不足，其余重点边界见本轮及前次证据 |
| Scenario Coverage | 已核验，存在 WARNING；检查了原场景与现有断言，新增 Retry 错误关联反例 FAIL，正常关联与普通等待拒绝的对照 PASS；不能用现有单元集合 PASS 覆盖这个负向场景 |
| Design Adherence | 已核验；十一项设计决定及八回路入口有对应实现/测试；W5 偏离第 2/6 节“核对原 Action/Job”及实际结果才完成的边界 |
| Code Pattern Consistency | 已核验；使用当前事务、scope、持久原 ID、固定私有 RPC、原生 helper、根契约生成和既有 UI 对象详情；无新增模式建议 |

以上六项均执行，没有因 artifacts 缺失或不可读跳过检查。核验包含静态代码/断言审阅和已有执行证据，不等于每个场景本轮重新跑一次。

### WARNING W5：Retry 可把属于另一 Action 的 Job 回执当作原目标证据

- **触发条件**：原目标已有 `export-original` / `job-original` 并进入等待；用户取消后显式 Retry。当前 Service 的 Job 查询仍返回 `jobId=job-original`，但回执的 `actionId=export-another`，状态为 succeeded。原 Action 查询和输入仍匹配，业务验证 Query 返回通过。
- **生产路径**：`apps/agentd/src/brain-loop.ts:148`～`:165` 的 Retry 分支查询原 Action/Job 后复查 live、期限和生命周期，但没有像普通等待 `:96`、恢复 `:212`～`:216` 那样核对 Job 与原 Action 的关系。`apps/agentd/src/service-interaction.ts:126`～`:134` 只校验 Job ID/结构/产物路径，并把该终态写为 verified Job evidence；`packages/work-store/src/feedback.ts:414`～`:418` 的 completed 检查按 Service、Job ID、终态及验证 Query 判断，没有校验 Job evidence 的 `details.actionId`。
- **本轮复现**：使用当前编译的生产 BrainLoop、BrainFlow、ServiceInteractionClient、WorkStore 与真实本地 HTTP Service。先让正常原 Action/Job 完成合法等待登记，再仅修改随后 HTTP Job 回执的 Action 归属。Retry 实际启动一个新的 verifying Run（autoRunCount=1）；通过生产 `brain_feedback.finish` 提交刚取得的 verified 证据后，新的 Retry 请求被错误写为 **completed**，旧请求仍为 cancelled。预期错误归属应需处理且不启动验证，故反例断言退出码 **1**。证据来自真实 HTTP 查询及生产存储，未直接插入伪造 proof 或完成状态。
- **对照**：相同 fixture 返回正确 Job→Action 时，Retry 正常进入验证，退出码 0；普通等待返回错误关联时，生产等待分支正确收尾 `needs_attention/INVALID_WAIT`，不增加执行次数，退出码 0。三种情况业务 mutation 均只执行一次。
- **影响边界**：这是 Service 回执关系不一致时的归属与误完成问题，未发现重复 mutation 或跨 Work 权限绕过。模型 executor 为受控单元夹具；本轮未在 Docker/真实 SDK 内另行执行这个异常组合，也不把它描述为线上实际发生。
- **规范依据**：WAF-006“登记原对象/只续接原目标”、WAF-007“新处理先核对原 Action/Job 真实结果”、WAF-009“来源对象正确的可查询证据”；对应“明确重试未知结果”“根据证据查证完成”等场景和 design 第 2/6 节。
- **修改方向**：在现有 Retry 原效果核对中复用普通等待/恢复的 Job→Action 匹配规则；已登记的原 Job 不得被不一致回执替换。完成证据的持久层同时要求 Job details 的 Action 归属匹配原 reference。补充正确关联、错误关联及直接 finish 拒绝的回归，断言不受理新验证 Run、不改原引用、不提交有效经验、不重复 mutation。范围集中于 Agent/WorkStore 和对应测试，不需新增平台能力或兼容路径。
- **本机证据**：`/tmp/piwork-brain-current-verify-job-fixture.mjs`、`/tmp/piwork-brain-current-verify-retry-job-origin.mjs` 与 `.log`；正确关联对照 `retry-job-control.mjs/.log`、普通等待对照 `wait-job-control.mjs/.log`（文件名前缀均为 `piwork-brain-current-verify-`）。当前源码与构建文件 SHA256 记录在 `/tmp/piwork-brain-current-verify-implementation-hashes.json`。

### 本轮新执行与此前证据的边界

| 检查/命令 | 本轮结果 | 本机日志/依据 |
| --- | --- | --- |
| `CGO_ENABLED=0 go test -mod=readonly -count=1`，coreapp/contracts/agentclient/workhistory/workpackage/packagehelper/cli | 七包非缓存 PASS；Core 44.056 秒、CLI 23.762 秒 | `/tmp/piwork-brain-current-verify-go.log` |
| `npm run test:unit --workspace @piwork/agentd --workspace @piwork/work-store` | 当前源码重新编译；72 + 37 PASS，0 FAIL/skip | `/tmp/piwork-brain-current-verify-agent-store.log` |
| Desktop `npm run test:browser` | 首轮 165 PASS、1 FAIL、1 条件 skip；失败为 R1 editor 等待 open-file 超时。单独原用例复跑 1 PASS；随后完整原集合复跑 **166 PASS、0 FAIL、1 条件 skip**，79.418 秒，没有改实现或测试 | `/tmp/piwork-brain-current-verify-desktop.log`、`editor-repeat.log`、`desktop-repeat.log`（同前缀） |
| 错误 Job→Action 的 Retry 及生产 finish 反例 | **FAIL，退出码 1，实际 completed**；两项对照 PASS/0 | W5 上述三个日志；失败保留，不用正常单元 PASS 掩盖 |
| 当前 source boundary、注入自测、image boundary | 全部 PASS；脚本/运行构建/lock/docs 与生产及验收镜像范围均核对 | `scripts/check-native-boundary.mjs`、其 `.test.mjs`、`check-native-image-boundary.mjs` |
| release `SHA256SUMS`，Core release/dist 文件身份 | checksum 全部 PASS；二者 Core SHA256 相同 `9550bee09f8ed55e6f8437b0173a288a92257c628c51350a747ec4907d385710` | 当前 `dist/release/piwork-linux-amd64-a980c189be07/`；不是本轮重新构建或 scratch 执行 |
| OpenSpec strict | PASS | 当前 artifacts 严格校验；只证明规划格式 |

五分钟票据用例本轮默认集合条件跳过，其上次独立实际 PASS（300.90 秒）见 `/tmp/piwork-brain-fixes-ticket-expiry.log`，没有宣称本轮再次等待五分钟。真实工作站/模型/身份、候选 RPC、三类副作用中断、完整 scratch 八回路及两份独立导入，使用下节修复后的实际执行日志并重新核对关键断言/身份；本轮没有重跑这些长测、215 项集成全集、干净副本构建、Console 全集或 Desktop real-Core 验收。原记录的执行范围及时间限度保持，不把索引 gate 或旧 TS 测试作为当前实现证据。

此前 W1～W4 分别核对了当前共享 Apply 查询与捕获配置、四种 Retry 查询返回后的期限/状态检查及 28 个子组合、安全候选 DTO/分项详情，以及本次坏行为请求/Run/失败 checks/实际 active-loaded/有效经验不变的断言。对应新测试已通过；W5 是另一项未覆盖的关系校验问题，不表示旧期限修复无效。

本轮只更新本核验报告及 `/tmp` 核验材料，没有修改实现、tasks/specs，没有提交、合并、同步或归档。按 advisory 分类没有 CRITICAL、存在一项 WARNING；依照本 change 要求完整闭环的目标，建议修复 W5 并完成对应回归后再归档。当前不能宣称零 WARN 或全部闭环。

## 上一轮修复核验（2026-10-04 11:33 UTC，历史执行记录）

用户确认后，已更新六份规划并完成 5.2、7.3、10.2、11.2、13.1，当前为 **26/26**。本次修复核验结果：**CRITICAL 0、WARNING 0、SUGGESTION 0**。W1～W4 均已有对应修复与新的回归结果，下文的 10:49 UTC 反例保留为历史，不能继续当作当前未处理问题，也不能将原失败日志改写为 PASS。

| 原问题 | 已落地修复 | 本次证据 |
| --- | --- | --- |
| W1：无关保存后漏报失败 Apply | 发布事务在既有回执记录 Operation 顺序边界；私有和公开查询共用同 Work、发布后受理、相同启用制品的 Apply 关联；只采用真实受理的捕获绑定与最新匹配原 Operation。缺失计划/context 明确不可用 | Go `brain_candidate_projection_test.go` 覆盖原 context/无关保存、发布前、同版本异内容、禁用/移除、其他 Work与最新匹配；真实工作站已执行无关 AGENTS Save 后加载失败、原请求收尾、prior active 恢复及编辑保留 |
| W2：Retry 使用查询前时间 | Action/Job/capabilities/验证 Query 返回后调用现有 live/期限/生命周期门禁，登记原效果等待使用当前时刻；保持原对象只读及已有终态 | `brain-flow.test.ts` 两项新增测试覆盖四类查询 × 三个截止边界与四种竞争状态，共 28 个子组合；该文件 21 PASS；Agent 完整单元 72 PASS，无新 mutation/Run 或期限续期 |
| W3：候选详情缺字段 | 根 Go schema/生成 DTO 及安全投影提供受理选择匹配摘要、固定目标/能力、安全输入摘要/checks、原 Apply；现有 Details 分项显示并按原 ID 查询，区分未 Apply/未知/加载失败/行为失败 | Go 私有/公开关联一致及隐私/缺失 authority 回归 PASS；候选浏览器专项 8 PASS，Desktop 166 PASS + 五分钟票据过期 1 PASS；原 Operation/请求只读入口、失败读取保留后成功清除、iframe 文档不变均有断言 |
| W4：旧失败使新候选验收误通过 | 锁定本次新 live requestId，核对失败 SDK checks 与该 Run 的 requestId、当前候选 active/loaded 和有效经验不变；保留旧 broken 失败记录作对照 | 新工作站测试 PASS，489.16 秒；`request-c76ba018-1179-440d-8018-386f29a162c9` / `run-04d335df-51a2-4d14-9b43-42b68543f51a`，`completed_review: passed; review_format: failed`，该候选仍 active/loaded，experience unchanged |

本次批准后的规范范围为 **12 份 delta、43 个 requirements、188 个 scenarios**；新增八个场景均有对应回归。场景数不是独立测试次数。未重新执行整个 120 分钟的 215 项集成集合；未受影响项目沿用下文已经逐名称核对的执行证据，不能据此扩大本次新执行范围。

本次新执行：

- `make generate build test` 的 generate/build 全部完成，首次 test-go 在既有 CLI 测试的临时端口/控制文件名碰撞处失败；已修复夹具，只选择没有遗留控制对象的端口，不清理其他实例。随后 `make -o build test` 全部 PASS，保留首次退出码 2 的日志 `/tmp/piwork-brain-fixes-build-test.log`。最终三包非缓存 Go 回归也 PASS（Core 43.261 / contracts 0.299 / CLI 23.615 秒，`/tmp/piwork-brain-fixes-go-final.log`）。
- 保留 TS 单元 142 PASS（contracts 9、pi-package 8、WorkStore 37、adapter 16、Agent 72），源码边界/验收索引注入自测 PASS，两套 WebUI 类型检查 PASS：`/tmp/piwork-brain-fixes-test-final.log`。
- Desktop 166 PASS、一个五分钟测试独立运行后 PASS（300.90 秒）；Serve UI 49 PASS：`/tmp/piwork-brain-fixes-desktop-browser.log`、`/tmp/piwork-brain-fixes-ticket-expiry.log`、`/tmp/piwork-brain-fixes-console-browser.log`。首次新增候选浏览器测试因夹具缺少契约必需 runIds 而失败，补全夹具后专项 8/8 与完整集合通过，未修改生产请求契约来绕过断言。
- 五个真实 Go/SDK/Service 专项均 PASS：工作站 489.16 秒、双模型 42.92 秒、身份/重放 79.21 秒、候选 RPC/显式 Apply 73.15 秒、三类中断恢复 112.28 秒；日志 `/tmp/piwork-brain-fixes-native.log`（611.299 秒）及 `/tmp/piwork-brain-fixes-native-candidate-recovery.log`（185.445 秒）。真实专项之后，公开视图补充的“丢失 Apply context 不得当成没有候选”异常分支由上述最终非缓存 Go 回归验证。
- 真实 Go Core/CLI Desktop Save/Apply、Service 与 iframe、Run、WebDAV、未知写入、Stop/Export/Inspect/Import/Start、Delete 原 ID及响应式全流程 PASS，`mainReloads=0`，本安装资源清理为零：`/tmp/piwork-brain-fixes-desktop-real-core.log`。
- 新生产/验收 Agent、file/snapshot helper 镜像及 release 重新构建；当前源码/镜像边界和 970 条既有验收索引 gate 均 PASS。索引 gate 只检查已有记录，不等于本次重跑全部场景。最终 release Core 二进制与 `dist/go` SHA256 相同：`9550bee09f8ed55e6f8437b0173a288a92257c628c51350a747ec4907d385710`；最终 scratch 使用这份二进制，日志 `/tmp/piwork-brain-fixes-scratch-final.log`。

最终 scratch fixture `piwork-native-host-da5f22b9-7c3a-4db7-bff2-f310b1ec077b` **八条回路全部 PASS，退出码 0**：两个新 Work 的旧记录 historical，新反馈、候选 Apply 与实际 SDK checks 各自独立；Console 退出后 Core/CLI 与已受理 Operation 继续完成。宿主进程清单只有 `piwork-serve`、`piwork-cli`、`piwork-console`，无解释器或外部工具，fixture 容器/volume 已清理。此前主体修复后的独立 fixture `piwork-native-host-6cf0ff75-d814-4ef6-b01e-1a377f25821b` 同样 PASS；最终结果以包含丢失 Apply context 拒绝分支的后一份二进制为准。

执行命令：`PIWORK_TEST_RELEASE_BIN=dist/release/piwork-linux-amd64-a980c189be07/bin node scripts/native-host-acceptance.mjs`。生产 Agent：`sha256:32067d55468907f65adcd5a8a83f28fae89f6ba588c731079caf83ae8d1876b8`；验收 Agent：`sha256:1fdb697b1dae78b1d0ced973dac4dad490bd83d80b7ff5f5676d62986b696fd0`；file helper：`sha256:fc88bd025502d13cb1984296f4c3e6118fe7909f7b79540e0e9d532971a4cc07`；snapshot helper：`sha256:8cb1e6bdde8f4affe235ace7d5f22ad175e9dc2978aeff8d39a2d8d19ceae113`。release 为当前未提交工作树构建，master revision 标记不表示实现已提交。最终任务、严格规划校验、源码/镜像 gate 与 release checksum 另按当前产物复查；没有提交、合并或归档。

## 修复前再次核验（2026-10-04 10:49 UTC，历史反例）

本轮针对“我不信，你再检查一下”重新检查实际实现和反例。上一轮 10:37 UTC 的“零 WARNING、全部场景闭合”结论过于乐观，本轮撤回该结论。现有测试通过记录仍然有效，但不能据此推导未被断言的组合场景正确。

当轮结果：**CRITICAL 0、WARNING 4、SUGGESTION 0**。其中两项是临时回归复现的实现偏差，一项是候选详情遗漏，一项是真实验收测试的断言缺口。没有发现整个要求完全无实现的情况；不能因此将这些局部偏差当作通过。

| 核验维度 | 检查 | 当前结论 |
| --- | --- | --- |
| 完整性 | Task Completion | OpenSpec 26/26；跟踪文件均可读。勾选完成不代表本轮正确性通过 |
| 完整性 | Spec Coverage | 12 份 delta、43 个 ADDED/MODIFIED requirements 均有对应实现模块；无 REMOVED/RENAMED |
| 正确性 | Requirement Implementation Mapping | 已追踪 43 项；存在 W1～W3 的实现偏差，不能记为 43/43 完全满足 |
| 正确性 | Scenario Coverage | 已审阅 180 个规范场景的实现/测试映射；W1、W2 的组合反例失败，W4 的负向集成断言不足，不能记为 180/180 已证明通过 |
| 一致性 | Design Adherence | Go 平台、业务直连、显式 Apply、master UI 路线总体一致；期限复查和候选展示存在下述缺口 |
| 一致性 | Code Pattern Consistency | 沿用事务、scope、原 ID 和原生 helper；未新增模式类建议 |

六项检查均进行了检查，没有因缺失或不可读 artifact 而跳过的检查。未重新运行整个 120 分钟集成批次、全部浏览器及 scratch 验收；下文明确区分本轮新执行与此前日志证据。

### WARNING W1：无关配置保存后，候选查询漏掉真实失败的 Apply

- 触发流程：脑包候选发布到 context C1 → 用户保存无关 AGENTS/Skills，生成包含同一脑包制品的 C2 → 显式 Apply C2 加载失败并恢复旧 active → 查询原候选。
- 代码位置：`internal/coreapp/brain_candidates.go:283` 只用候选发布回执的 `receipt.ContextID` 查询 Apply；C2 对应的失败 Operation 因此被漏掉。`apps/agentd/src/brain-candidates.ts:103` 只有取得 `candidate.apply.state === failed` 才报告加载失败；当旧 active 已恢复、desired 仍是候选且 Apply 字段缺失时，走继续 `waiting_apply` 的分支。
- 复现：临时 Go overlay 调用生产 `brainCandidateState` 与真实 CoreStore 事务，构造同一脑包 digest、不同 AGENTS 的 C1/C2 及已失败 Apply 元数据。C1 的对照查询 PASS；C2 的回归 FAIL，返回 `Candidate.Apply = nil`。这证明了生产查询的错误；“原目标继续等待”由后续 Agent 生产分支推导。本轮没有在 Docker 内另行执行这个配置组合的加载失败。
- 规范依据：PKG-BRAIN-002“加载失败后恢复”、BRN-005“更新失败或被用户替代”、DWUI-007 的无关编辑保留及原 Apply 如实呈现。
- 修复方向：在当前 Work 内按 Apply 受理的捕获配置与候选制品身份关联，而非仅比较发布时 context ID；返回原 Apply ID/状态。保留其他编辑及旧 active，不重新 prepare/Apply。补测“发布 → 无关保存 → 加载失败 → 原目标明确失败/需处理”，同时保留原 context 对照。
- 证据：`/tmp/piwork-brain-audit-apply-context_test.go`、`/tmp/piwork-brain-audit-apply-control_test.go`、`/tmp/piwork-brain-audit-go-overlay-control.json`、`/tmp/piwork-brain-audit-apply-controls.log`。命令退出码 1，不记为通过。

### WARNING W2：Retry 查询原 Job 返回时跨过期限，仍写入等待

- 触发流程：用户 Retry 一个已有原 Action/Job 的请求 → 新请求在截止前 1 ms 查询原 Job → Job 仍运行，查询返回时恰到截止或晚 1 ms。
- 代码位置：`apps/agentd/src/brain-loop.ts:144`～`:156` 的 Retry 分支在 `readAction`、`job` 和 `discover` 后没有调用最新状态/期限复查，向 `waitForOriginalRetry` 传递 tick 开始时的旧 `now`。`packages/work-store/src/feedback.ts:260`～`:271` 用这个旧时间判断事务中的截止条件。
- 复现：复用真实 BrainLoop/BrainFlow/WorkStore 与现有 HTTP Service fixture，控制时钟返回于期限前 1 ms、等于期限、晚 1 ms。前者 PASS；后两者 FAIL，期望 `needs_attention/REQUEST_EXPIRED`，实际 `waiting_result` 且 `error = null`。本轮是确定性 HTTP/时钟复现，没有等待真实 24 小时或在 Docker 内重跑此边界。
- 影响限度：这次复现没有新增 Run 或重复 mutation，原效果仍一次；后续 tick 会再处理到期。问题是本次迟到核对仍登记等待，没有按规范在返回后立即正确收尾，不能扩大描述为永久续期或重复业务执行。
- 规范依据：WAF-006 查询返回后重新核对 live/期限、等值视为到期，WAF-007 Retry 核对原效果，以及 design.md 第 6 节。
- 修复方向：Retry 每次外部查询后使用已有 `observing` 门禁与最新时间；等待事务仍检查当前目标及有效期限。补测期限前/相等/之后以及查询期间取消的 Retry 原对象路径，断言原 ID、次数和业务效果不变。
- 证据：`/tmp/piwork-brain-audit-loop-fixture.ts`、`/tmp/piwork-brain-audit-retry-before.mjs`、`retry-equal.mjs`、`retry-after.mjs` 及相应 `/tmp/piwork-brain-audit-retry-*.log`。对照退出码 0，等值及超期退出码均为 1。

### WARNING W3：候选详情遗漏受理基线、验证目标及对应 Apply 状态

- 代码位置：`internal/contracts/dto_generated.go:630` 的公开 Candidate 只有 source、operationId、requestId、preparation、desired、active、adoption；`internal/coreapp/brain_candidate_projection.go:34`～`:46` 也只投影这些字段，没有安全的基线摘要、固定工具/input/checks 或对应 Apply。`apps/desktop-webui/src/app.ts:709` 的 Package Details 直接显示这份对象，`:2126` 仅显示加载及泛化行为状态；请求详情 `:626` 也没有固定验收项。
- 规范依据：DWUI-007 明确要求候选详情展示“来源摘要、受理基线、验证目标、准备/发布结果及真实 Apply 状态”，design.md 第 8、10 节也要求安全目标与现有 Pi Packages 流程。
- 用户影响：用户看得见 Saved/Loaded/Behavior，却无法在候选详情判断候选接受了哪个基线、要验证哪项能力、哪个 Apply 已失败或生效。内部私有 descriptor 中存在这些数据不能代替产品展示。
- 修复方向：沿用根契约生成与当前 Go 投影，增加不含秘密、宿主路径或制品 digest 的基线/验收摘要及原 Apply 关联，在现有 Package Details 展示；不新增页面或导航。浏览器断言候选实际验收项和 Apply 状态，不能只检查 Saved/Loaded 标签。
- 证据类型：公开 DTO、Go 投影、Package/请求详情的静态逐层核对；没有把“浏览器未报错”当作这些字段存在的证据。

### WARNING W4：真实工作站负向验收可以被旧失败请求满足

- 代码位置：`internal/coreapp/brain_workstation_integration_test.go:284` 已确认 `go-native-broken` 为 `needs_attention`；随后 `:286`～`:304` 检查 `go-native-bad` 时，仅寻找任意 `state == needs_attention`，没有锁定新的 requestId、目标或 live disposition。旧 broken 请求即可让断言成立。`:306`～`:309` 也只检查 Work ready，没有核对坏行为候选仍为实际 active/loaded。
- 影响：本轮该真实测试仍 PASS（471.39 秒），但它不能证明“新包已加载、必要 checks 失败、新目标需处理而不回退”。这是一处验收证据缺口，不据此宣称该生产行为必然错误。
- 规范依据：ADEP-003 与 BRN-006 要求真实 SDK 的加载成功/行为失败负向路径，BRN-005 要求失败归属原目标及保留真实加载状态。
- 修复方向：记录 bad 候选原 requestId，等待并读取该 ID 的 `needs_attention`、失败 SDK checks 和原 Run；核对 active/loaded 仍属于该坏行为候选，且没有提交已验证经验。旧 broken 请求不得满足新候选断言。
- 证据类型：真实测试执行 PASS 加精确断言审阅。scratch 脚本的 candidateProof 是正向流程，不能补足这个负向断言。

### 本轮新执行证据

| 检查 | 结果 | 本机证据 |
| --- | --- | --- |
| 六个 Go 单元测试包，`-count=1`，非缓存 | 全部 PASS；coreapp 33.051 秒 | `/tmp/piwork-brain-adversarial-go-unit.log` |
| 真实 Go/SDK/NiceGUI 工作站、Chat 双模型、Service 身份与持久重放三个 integration 测试，`-count=1` | 3 PASS，分别 471.39 / 35.71 / 75.49 秒；总 582.610 秒，命令退出码 0。工作站负向断言限制见 W4 | `/tmp/piwork-brain-adversarial-native.log` |
| 候选 Apply 的原 context 对照与无关编辑回归 | 1 PASS + 1 FAIL，证明 W1；退出码 1 | `/tmp/piwork-brain-audit-apply-controls.log` |
| Retry 原 Job 核对在期限前/相等/之后返回 | 1 PASS + 2 FAIL，证明 W2；迟到用例未重复 mutation/Run | `/tmp/piwork-brain-audit-retry-before.log`、`retry-equal.log`、`retry-after.log` |
| 当前 Go 原生源码边界 gate | PASS；扫描源码、脚本、运行/构建配置、locks 和 docs，未发现旧 TS 平台入口 | `node scripts/check-native-boundary.mjs` |
| 报告更新后的 OpenSpec strict 与 diff 格式检查 | PASS；验证 artifact 格式及补丁空白，不作为实现正确性的证明 | `openspec validate rebase-piwork-brain-onto-go-core --strict --no-interactive`、`git diff --check` |

临时反例文件只在 `/tmp`，Go 使用 overlay，没有加入生产源码或测试目录。三项真实 integration 沿用 Makefile 的五个镜像变量，运行 `CGO_ENABLED=0 go test -mod=readonly -tags=integration -count=1 -v -timeout=30m ./internal/coreapp -run '^(TestNativeBrainWorkstationFeedbackExperienceAndActualCandidateBehavior|TestNativeChatModelSelectionRunsThroughGoAndRealSDK|TestNativeServiceInteractionIdentityAndDurableEventReplay)$'`。本次只改核验报告，没有修改实现、任务、规格，也没有提交、合并、同步或归档。

### 核验判断

按 OpenSpec advisory 分类，没有 CRITICAL，4 项 WARNING 可作为带改进项的归档结果；这不表示“全部闭环”。鉴于本次需求明确要求完整闭环，建议先修复 W1～W4，再进行对应回归和核验。调整可集中在既有 Go 候选关联、Agent Retry 门禁、公开候选投影/现有详情及验收断言，不需要重做架构或引入 TS Core 兼容。

## 上一轮执行证据（10:37 UTC，并非本轮重跑）

- 原测试名称合并核对：除可选线上模型 smoke 外，215/215 必需顶层测试都有实际 PASS；初批次及两次补跑命令的失败退出码如实保留，没有重跑整个 120 分钟命令。这是现有测试执行集合的结果，不能排除本轮发现的反例或断言遗漏。
- 当前源码、测试、协议、脚本及构建配置与独立构建测试副本逐文件比较，724 文件相同。浏览器及 scratch 的执行见后文已有日志，没有声明本轮重跑。
- `npm run test:unit --workspace @piwork/agentd --workspace @piwork/work-store`：70 + 37 PASS、0 FAIL/skip，日志 `/tmp/piwork-brain-verify-agent-store.log`；六个 Go 包在上一轮是缓存 PASS，本轮另已非缓存执行。
- 上一轮源码/镜像边界、注入自测、`git diff --check`、OpenSpec strict 与 release SHA256SUMS、两份 proto 和镜像身份/labels 核对通过；checksum 日志 `/tmp/piwork-brain-verify-release-checksums.log`。

## 核验范围

已逐项检查 proposal、design、tasks 和十二个 delta spec：43 个 ADDED/MODIFIED requirements，188 个 scenarios；没有 REMOVED 或 RENAMED 项。检查包括任务完成、实现映射、场景及测试对应、设计一致性、当前代码模式、原生依赖边界和实际闭环。场景数是规范覆盖数，不是独立测试执行次数。

当前任务与原 W1～W4 修复状态以顶部“修复后的核验”为准。完整批次、同名专项及超时后补跑曾核对出 215 项必需顶层测试均有 PASS（Core 169、其他四包 46）；1 项需要线上凭据的 smoke 为可选。该执行集合不包含本轮临时反例，也不能弥补已有测试的错误断言。初批次失败及超时仍如实保留，不能改记为 PASS。

## 实现与场景映射

下表是全部 requirements 的实现与测试入口索引，不是每个场景已经充分证明的清单；场景数量按 delta spec 统计。时间、取消、身份及实际 SDK/Service/浏览器分别有相应证据，原组合和断言缺口及本次对应修复见顶部 W1～W4 记录。

| 能力与要求 | 场景 | 实现依据 | 主要测试依据 |
| --- | ---: | --- | --- |
| agent-conversation：CONV-RUN-001、CONV-SNAPSHOT-001、CONV-MODEL-001、CONV-SOURCE-001 | 16 | `apps/agentd/src/runs.ts`、`sessions.ts`、`brain-flow.ts`；`internal/coreapp/run_models.go`；`internal/workhistory` | Agent `runs.test.ts`、`sessions.test.ts`、`brain-flow.test.ts`；Go `run_models_test.go`、`run_models_integration_test.go`、`snapshot_history_integration_test.go`；十三表 snapshot tests |
| agent-service-deployment：ADEP-001～003 | 14 | `internal/coreapp/bundled_brain.go`、`internal/coreassets/piwork-brain`；真实 SDK/MCP 服务工具 | `bundled_brain_test.go` 的原子种子、失败、事务恢复、管理员定制；`bundled_brain_integration_test.go`；`brain_workstation_integration_test.go`；原生部署回归 |
| control-cli：CLI-BRAIN-001 | 3 | `internal/cli/user_conversation.go`、Desktop API 转发与共享凭据；`internal/client` | Go conversation/desktop/control/credential tests；Desktop browser 原 ID、身份及对象锁测试；真实 Go Desktop 验收 |
| desktop-ui-language：DUL-002、006、012、DUL-BRAIN-001 | 14 | `apps/desktop-webui/src/app.ts`、`adapter.ts`、`action-state.ts` | Desktop 原布局、单输入、Service iframe 保留、关闭不取消、模型和反馈浏览器测试；真实 Core 生命周期与导入导出验收 |
| desktop-webui：DWUI-004、005、007、DWUI-MODEL-001、DWUI-FEEDBACK-001 | 22 | 同上；现有 Chat/对象详情、Files/Settings/Pi Packages | Browser `Brain` 场景及原 DWUI/D01～D18/W1～W2 场景：未知模型保存只查原 Session、历史不可 Retry、稳定 Retry 键、候选 Saved/Loaded/行为分离；完整浏览器回归 |
| pi-package-management：PKG-BRAIN-001、002 | 13 | `internal/packagehelper/brain_source.go`、`internal/coreapp/brain_candidates.go`、`brain_candidate_projection.go`、`apps/agentd/src/brain-candidates.ts` | `brain_source_test.go` 捕获前冲突/捕获后冻结/危险路径；`brain_candidates_test.go` 稳定 actor 与最新 desired；真实私有 RPC/显式 Apply；Agent 固定 SDK 工具/input/checks、同内容、跨期限/取消/失败测试 |
| piwork-brain：BRN-001～006 | 22 | 本地 extension、每 Run 认知、受限 bridge、`brain-flow.ts`、WorkStore 经验/evidence；Go 候选捕获 | 实际 SDK 资源加载；brain flow/candidates/resources tests；WorkStore feedback 容量/失败经验/固定 head；实际工作站代码修复、下一 Run 采用、两份导入 SDK 证明及两类加载/行为失败 |
| portable-work：PWORK-003、PWORK-BRAIN-001 | 14 | `internal/workpackage`、`workhistory`、`snapshothelper`；Core export/import/bindings | Go 静态十三表图/SDK 证明、路径/trigger/关联篡改拒绝；TS 当前 snapshot 13 项；原生离线全包来源及保留上下文；两个新 Work 各自的新反馈和新候选证明 |
| runnable-work-runtime：模型凭据保密、RUNTIME-CONTEXT-001、RUNTIME-FEEDBACK-001 | 14 | `internal/coreapp/run_models.go`、`work_binding.go`、Service identity bindings、`internal/internaltls`、`internal/workruntime`、Agent mTLS | Go 模型安全列表及严格 selector、真实两个 SDK 模型；当前完整 handshake、旧 SDK/不可用 registry 拒绝；Service 身份轮换/撤销/越权/Agent Apply 与 lifecycle fence |
| serve-control-plane：GO-DELIVERY-001、002 | 5 | Go 七个入口、Makefile、原生镜像及 release；精准源码 gate | 原生 build/test/integration/release；源码注入自测、生产/验收/helper 镜像检查；三个发布程序在无解释器 scratch 宿主完成八回路；种子失败和管理员空选择保持 |
| work-agent-feedback：WAF-001～009 | 43 | `apps/agentd/src/service-interaction.ts`、收件/回执与 `brain-flow.ts`；WorkStore 持久事实、目标、Run、wait、evidence；业务数据留在 Service | 实际 HTTP Action lost response/版本守卫/Job；事实不启动模型、重复内容/容量/来源校验；4 次/30 分钟/24 小时/首次 7 天/4999～5000ms；返回后事务重读与取消/终态；真实 Agent 接受 Action 无 waitRef 三类崩溃恢复；分页与安全输出 |
| work-configuration：WCFG-005、WCFG-BRAIN-001 | 8 | 当前 context/存储严格校验；schema 4 初始化/同版恢复；偏好/经验与 active/desired 分离 | Go context/store/history 拒绝旧格式且保留原数据；TS migrations/snapshot 不迁移；模型/经验 Run 快照及普通 Stop/Start 不热更新；实际 Apply 与旧 Session 不兼容的显式错误 |

## 设计核对

1. 平台入口、生命周期、凭据、资源和环境分享均归 Go；Service 与 Agent 的业务传输直接进行，业务状态仍归 Service。当前源码、脚本、构建/配置、锁文件及操作文档由精准 gate 检查。
2. 脑包是 Work `.pi/packages/piwork-brain/` 下的普通本地 Pi extension；编辑副本、captured active、desired、runtime loaded 与实际 SDK 行为各有事实，不热加载、不自动 Apply。
3. 普通页面/业务事件只产生事实；合法显式请求进入固定单槽循环。等待释放 Run，续接依据原 Action/Job，只读核对不消耗新的自动次数。普通等待、恢复与 Retry 每次查询返回后均重读状态和期限，原效果仍运行也不绕过；对应 W2 新回归通过。
4. 手动省略/null/显式模型语义参与幂等，重放先于解析；实际模型和经验快照固定。自动 Run 使用受理时 active 默认模型和独立兼容 Session；Chat 原目标不伪造 Service 来源。
5. 新候选在准备前固定一个工具、输入和必要 checks；实际 SDK 证明与 active/loaded 分开记录。Apply 失败恢复按发布后捕获的相同制品关联原请求，无关保存不会漏报；真实已加载行为失败断言锁定本次请求/Run、active/loaded 和有效经验，W1/W4 新专项通过。
6. 分享静态校验十三表及引用/SDK 证明，只映射声明身份；业务 payload、代码和控制 Operation 原内容保留。两份新 Work 历史只读，Start 建立新身份；各自新反馈、新候选重新取得 SDK 证明。
7. UI 保持 master 的 Work List、Service 主区、Agent 辅助栏、Services/Files/Chat、Settings、单一输入上下文；未知修改恢复原对象，iframe 不因元数据查询重载。候选详情通过现有安全投影显示受理基线、固定验收项和原 Apply，W3 浏览器回归通过。Python/NiceGUI 仅作参考 Service。
8. Go/TS 使用根 proto 一次生成；package-helper=2、history=4、模型/反馈=1。拒绝非当前格式，不提供旧平台或旧数据兼容分支。代码沿用既有事务、scope、原 ID、结构化错误和 fixture 资源所有权模式。

## 此前已取得的执行结果（不能替代本轮结论）

- `make generate build test`：Go 与保留 TS 测试、两套 WebUI 类型检查通过；新 CLI 上传错误保密回归及整个 `internal/cli` 再次通过。
- `TestNativeBrainWorkstationFeedbackExperienceAndActualCandidateBehavior`：此前 PASS，488.43 秒；两份副本各自完成新反馈和新候选 SDK checks，加载失败回退与旧 Session 明确拒绝有断言。已加载行为失败部分的原结论受 W4 限制，不能仅凭测试名/PASS 声称已充分证明。
- `TestNativeBrainAcceptedActionGapRecovery`：三个真实中断分支全部 PASS，116.13 秒；原 Action 的唯一实际效果保持一次，旧 Run interrupted。
- Agent 当前单元测试 70/70；Desktop browser 164/164，另外实际五分钟票据过期测试 PASS（300.85 秒）；Serve UI browser 49/49。
- 真实 Go Core/CLI Desktop 全流程 PASS：配置 Save/Apply、Stop/Start、启用/禁用 Service、二进制 WebDAV、未知写入、Stop/Export/Inspect/Import/Start、导入后实际应用、原 ID 删除与响应式布局。主区域重载次数为 0；只清理本安装的资源。
- 大包上传回归实际发现隔离 helper 的 OOM（exit 137）：约 600 MiB 归档的所有 blob 被额外复制到 tmpfs，超出 512 MiB helper 限额。已改为校验全体 blob 后直接按归档区段读取，只为 SQLite 检查物化必要文件；保留资源上限及每 blob 完整性校验。helper/unit 与上述真实大包 Desktop 导入均通过，诊断代码未进入源文件或发布。
- 完整批次还揭示两处 Go 恢复边界：名称已被导入占用时，Work 创建现在在包环境探测/复制前拒绝，受理事务仍保留原检查防并发竞争；Service 的身份已持久化、Docker 创建生效但 Container ID 未写回时，先核对当前身份，再由 EnsureContainer 验证完整 immutable spec 后绑定原实例。已绑定其他实例、旧 revision 和缺身份仍不能被采用。
- 独立源码副本不复制 node_modules/dist，并使用单独的 GOCACHE；重新 `npm ci`、`make generate build` 后，执行已构建依赖下的 `make -o build test` 全部通过。构建只读取本工作树 Git 元数据供 revision 标记，单元测试不继承该 Git 环境；最终 helper 修复也纳入此副本。
- 该独立副本已同步上述两个最终 Go 修复，再次 `make generate build` 和无 Git 环境的 `make -o build test` 全部 PASS（`/tmp/piwork-brain-clean-source-recovery-build.log`、`/tmp/piwork-brain-clean-source-recovery-test.log`）。未复制被忽略的构建产物或依赖目录。
- 最终 release 的 scratch 八回路全部 PASS：包含最终 Go 恢复修复的 fixture `piwork-native-host-7f72537d-d340-4d3f-a250-1ecf4785f331`，两个独立导入保留历史记录，各自完成新反馈、新候选 Apply 和实际 SDK checks；Console 退出不影响 Core 或已受理 Operation。三个平台程序及其进程没有解释器依赖，fixture 已按所属范围清理。前一轮 fixture `piwork-native-host-30cd0556-96c4-4bbf-88b4-38d31bd0d521` 还实际覆盖 CLI 限时观测结束后只查询原 Operation，确认成功，不重新提交 import。
- 源码边界及注入自测、当前生产/验收/helper 镜像检查、native release 闭包检查、OpenSpec strict 均通过。
- master `check-go-acceptance.mjs`：970 条既有记录的索引完整性通过。此命令只检查记录，不能代替本次实际回归结果；既有历史报告保持只读。

## 此前命令与证据索引

以下日志是本机本次执行证据，规范映射与命令另存于本报告和当前验收文档，不把临时日志当作产品依赖。

| 实际命令/测试 | 结果 | 本机日志 |
| --- | --- | --- |
| 独立源码副本 `npm ci`、`make generate build`、`make -o build test` | PASS；最终 Go 恢复修复后再次通过，31 个 Go 测试包，保留层 140 项 TS 测试，2 项 boundary/index 自测，两套 UI 类型检查 | `/tmp/piwork-brain-clean-source-recovery-build.log`、`/tmp/piwork-brain-clean-source-recovery-test.log`；首次无依赖/产物副本构建另见 `clean-source-final` 日志 |
| 当前 `go test ./internal/cli` | PASS，23.057 秒 | `/tmp/piwork-brain-final-cli-unit.log` |
| Snapshot helper、workpackage、workhistory 单元回归 | 3 包 PASS，含所有 blob 完整性及不物化大镜像的断言 | `/tmp/piwork-brain-streaming-upload-unit.log` |
| 实际 workstation 全闭环专项 | PASS，488.43 秒 | `/tmp/piwork-brain-workstation-final.log` |
| 三类实际 Action 无 waitRef 崩溃恢复 | PASS，116.13 秒 | `/tmp/piwork-brain-gap-recovery.log` |
| Desktop 全部 browser 测试 + 单独实际票据过期 | 164 PASS + 1 条件跳过，该项另行实际 PASS，300.85 秒 | `/tmp/piwork-brain-final-browser-retry.log`、`/tmp/piwork-brain-real-ticket-expiry.log` |
| Desktop 真实 Go Core 全流程 | PASS，包含约 600 MiB .work 的实际上传/导入/Start，主区域重载 0 | `/tmp/piwork-brain-real-core-final-streaming.log` |
| Console browser | 49 PASS | `/tmp/piwork-brain-console-browser.log` |
| 当前原生 helper/Agent 镜像及 `make release` | PASS；发布包含 streaming helper 和最终 Go 恢复修复 | `/tmp/piwork-brain-streaming-helper-images.log`、`/tmp/piwork-brain-final-recovery-release.log` |
| 最终发布包 `PIWORK_TEST_RELEASE_BIN=dist/release/piwork-linux-amd64-a980c189be07/bin node scripts/native-host-acceptance.mjs` | 两轮八回路 PASS；最终轮包括 Go 恢复修复，两个独立导入各自 SDK 证明，退出码 0 | `/tmp/piwork-brain-scratch-recovery-final.log`；原 ID 观测恢复另见 `/tmp/piwork-brain-scratch-original-id-final.log` |
| Source/image 边界、注入自测、release 闭包、OpenSpec strict | PASS | `/tmp/piwork-brain-recovery-source-boundary.log`、`/tmp/piwork-brain-recovery-image-boundary.log`、`/tmp/piwork-brain-streaming-boundary-selftest.log`、`/tmp/piwork-brain-strict-final.log` |
| 五包完整 Go Engine integration 与同名补跑 | 全部 215 项必需测试有 PASS 证据；初批次 191 PASS、13 FAIL、Coreapp 90 分钟超时，不记 PASS。全部失败与遗漏已复验通过 | `/tmp/piwork-brain-final-integration.log`，下面列出补跑证据 |

完整 Go 集成沿用 Makefile 的五个镜像环境变量，实际执行 `CGO_ENABLED=0 go test -mod=readonly -tags=integration -v -timeout=90m ./internal/testsupport ./internal/dockerengine ./internal/coreapp ./internal/workruntime ./internal/packageprepare`。前置 build/fixture/image 已由对应独立命令完成，Desktop/Console/scratch 也分别实际运行，不用历史索引或复用旧测试报告代替这些命令。

新增真实场景后初批次超出原来的 90 分钟限额，当前 Makefile 已将单包上限调为 120 分钟；这不改变业务请求、Run、Job 或 Apply 的期限。本次采用逐项补跑核对完整集合，没有将未重新执行的 120 分钟命令宣称为 PASS。HTTP fixture 的首次启动和 Core 重启均启用真实当前模型 RPC，低层 runtime fixture 则提供受安装/Work/代次限制的 mTLS 模型 RPC，不引入生产模型回退。

## 此前初批次执行失败及补跑

| 原失败或遗漏 | 最终证据 |
| --- | --- |
| workstation 在 Apply 后沿用旧 context 的 Session | 当前 helper 建立新兼容 Session，原旧 Session 明确拒绝；专项 PASS 488.43 秒，`/tmp/piwork-brain-workstation-final.log` |
| HTTP conversation 缺当前模型 listener/catalog，重启 fixture 也缺 listener | 两次启动均接入 Go 模型 RPC，完整专项 PASS 64.46 秒，`/tmp/piwork-brain-final-http-conversation.log` |
| WebDAV 首次脑包准备失败 | 同名原生全流程 PASS 99.13 秒，`/tmp/piwork-brain-final-failed-core-rerun.log` |
| CLI 大包上传/导入失败 | streaming helper 后同名全流程 PASS 90.35 秒，同上；真实 Desktop 大包及最终 scratch 两份副本也 PASS |
| activation/concurrency/recovery/mapping 的旧 package 数量假设 | 保留默认脑包并核对业务包，分别 PASS 274.38、191.46、69.22、317.94 秒，同上 |
| Service 创建效果生效后未绑定身份即崩溃 | 持久身份与完整 Docker spec 验证后采用原容器；三分支 SIGKILL PASS 168.13 秒，同上 |
| Snapshot 名称冲突在包探测后才检查 | 复制前检查 + 受理事务重检；原完整导出/故障导入/名称保留用例 PASS 103.46 秒，同上 |
| 默认 Work/Skill diagnostics 的旧独立默认 Skill 假设 | 默认脑包实际 loaded 的完整生命周期 PASS 127.01 秒，`/tmp/piwork-brain-final-default-work.log`；显式普通 Skill 的故障/回退/重启 PASS 96.32 秒，`failed-core-rerun` 日志 |
| 底层 runtime 没有当前模型 RPC | 当前限定 scope 的真实 mTLS 模型 RPC + 实际 SDK Run PASS 21.20 秒，`/tmp/piwork-brain-final-runtime-model-rerun.log` |
| 初始化重试 fixture 未使用 captured package 的 NameKey 路径 | 恢复原候选、新键重试、AGENTS 错误、MCP 显式移除的完整用例 PASS 161.10 秒，`failed-core-rerun` 日志 |
| 90 分钟超时后的原生初始化/恢复用例 | 超时点就绪期限用例、无 MCP 的 snapshot、实际 Core 崩溃采用全部 PASS，`/tmp/piwork-brain-final-integration-tail.log`；该补跑早期旧断言失败由上述专项覆盖，补跑命令本身仍保留 FAIL |
| 超时后的普通 Go 用例 | 7 项全部 PASS，`/tmp/piwork-brain-final-unexecuted-unit.log` |

`/tmp/piwork-brain-final-failed-core-rerun.log` 的 11 个用例中 10 个 PASS，HTTP 用例首次补跑仍漏了重启 listener，随后独立修复并 PASS，因此这一补跑命令退出码 1 也如实保留。初批次注册清单（Core 170 项、其他四包 46 项）与日志按原名核对，215 项必需测试均有 PASS，只有可选线上模型测试不适用。这仅说明既有必需测试集合已有执行结果；10:49 UTC 核验当时的新增反例仍 FAIL，W1～W4 当时尚未修复；其后修复及对应新执行以顶部记录为准，不改写原失败日志。
