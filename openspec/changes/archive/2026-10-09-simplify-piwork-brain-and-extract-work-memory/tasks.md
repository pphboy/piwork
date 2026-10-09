# Tasks

## 1. 精确历史与 Memory 格式

- [x] 1.1 冻结 `internal/workhistory/schema-v4.sql` 及对应 schema 对象，定义 schema 5 的 `work_memory_binding` / Run selection 与 Memory schema 1 的五张表；扩展 `scripts/generate-work-history.mjs` 并生成 TS/Go 材料。验证：`make generate` 后二次生成无额外 diff，原 schema 4 golden 仍精确匹配，未知对象/版本与缺失绑定被拒绝。（WMEM-001/005，CONV-SNAPSHOT-001，T01/T05）
- [x] 1.2 为 TS/Go 的受管历史校验补齐 Memory 配对、空版本、head、采用版本/entryId、来源请求/Evidence 与候选关系；保留原 Package SDK 行为证明校验。验证：`packages/work-store/src/snapshot*.test.ts` 与 `internal/workhistory` 单测覆盖合法 4/5、错库、悬空来源、额外 trigger、伪造 effective、未知 selection；不会执行输入 SQL。（WMEM-003/005，PWORK-BRAIN-001，T03/T05）
- [x] 1.3 在 `docs/piwork-brain.md` 记录 history 4 / 5、Memory 1 与两个卷的格式边界，并更新相关测试说明。验证：文档版本/路径与生成源一致，链接及 `git diff --check` 通过。（WMEM-001/005，PWORK-003）

## 2. 独立 Memory Store 与可信提交

- [x] 2.1 在 `packages/work-store/src/memory.ts` 实现 version/head、有效内容、候选及来源读取，`WorkStore` 按 private 根安全 ATTACH `memory.sqlite`，实际确认两库 DELETE / FULL；原 Evidence/请求保持 main 权威。验证：打开/写入/关闭/重开测试、目录/文件权限、符号链接、已有缺失/错配 Memory、WAL 模式拒绝与真实空库区分。（WMEM-001，WSTOR-MEMORY-001，T01/T03）
- [x] 2.2 将 `FeedbackStore` 的 list/stage/commit/status 路径委托给唯一 Memory，增加 revise/invalidate 候选、expectedVersion 和不可变历史；旧 stage 保持替换与返回语义。验证：对应单测覆盖重复候选、提交前修改、版本冲突、最后一条失效后的空新版本、read 失效原因及 100 条/4 KiB 边界，主库不再有 Experience 双写。（WMEM-002/003，T03/T04）
- [x] 2.3 在既有 finish 事务中保留全部验证并联合提交 Memory head、候选结果和请求 completed，失败/取消/超期保留无效候选。验证：成功 Query/原 Action/Job/SDK 证明、错误来源、失败 checks、虚假文字、原 Chat 偏好、取消/期限竞争均有测试；注入两库任一写入失败时两者整体回滚。（WMEM-003，BRN-005，T03/T06）
- [x] 2.4 在 work-store 单测中增加真实 SQLite 子进程故障测试：在事务写入后提交前、完成提交后中止 writer，再原路径重开并检查一致性；保留 journal 模式和无任务重放断言。验证：只出现旧状态/旧 head 或已验证 completed/新 head，明确进程故障结果不替代物理断电测试。（WMEM-003，T01/T03）
- [x] 2.5 补充 Memory 状态/错误/来源及联合事务的开发文档，验证内容与工具兼容输入、原验证逻辑和现有错误投影一致，未增加后台调度或 Eval 解释器。（WMEM-001–003）

## 3. 一次迁移与既有 Apply 回退

- [x] 3.1 实现受控 4→5 迁移：复制全部有效/已采用版本、staged/failed 历史与原时间/来源；在一条 attached 事务中建立绑定、删除旧表并发布 schema 5。验证：含多版本、有效/失败/空经验及候选的 schema 4 夹具迁移前后逐行语义一致，重复打开不再迁移，无授权及未知 `memory.sqlite` 碰撞拒绝且不改旧数据。（WMEM-005，T01/T03）
- [x] 3.2 扩展原 snapshot helper / Engine helper policy 的 `checkpoint-history` 与 `restore-history-backup` 内部动作，保存精确旧历史、预创建可证归属 Memory，并在原 `/var/data` 路径完成原生日志恢复后还原。验证：helper 单元/真实卷测试覆盖 WAL、失败/中断、错误摘要/归属、替换 inode、链接和无权限；只清理同 Operation 的已证明文件。（WMEM-005，WSTOR-MEMORY-001，T03/T05）
- [x] 3.3 在 `workApplyPlan`、runtime 私有配置及 agent 初始化增加 design D07 的 historyBackup/historyMigration 字段与授权核对，迁移候选 initializationOnly，发布前关闭模型/反馈/快照准入；同步 `make generate` 契约与生成测试。验证：Core/agent 单测证明外部 Run 输入不能授权迁移，saved 备份缺失或身份错配不启动 writer。（WMEM-005，WSTOR-MEMORY-001，T06）
- [x] 3.4 将备份恢复/清理纳入原 Apply 发布、失败回退和恢复路径；当前 fence 持有者收尾被 Stop/Delete/新 Apply 取代的迁移，已发布后不得恢复旧备份。验证：`work_apply*_test.go` 与进程故障测试覆盖迁移后加载失败、发布前 Core 中断、控制被替代、恢复失败、发布后清理失败，旧 active/data 或新 active/data 保持真实一致，业务数据库不回滚。（WMEM-005，WSTOR-MEMORY-001，T01/T03/T06）
- [x] 3.5 扩展 image/readiness 为精确支持 history 4/5，检查镜像声明与实际版本，新镜像标记 5，schema 5 降级到 4 在替换前拒绝。验证：agentclient/imagestatic/workruntime 单元契约及对应真实 image 检查覆盖旧镜像继续运行、错误版本、旧 Package 在新 harness 可用、无静默 image/active 升级。（WMEM-005，PWORK-003，T06）
- [x] 3.6 在 `docs/piwork-brain.md` 与测试说明记录迁移/回退、旧固定镜像、明确不支持降级和 journal 未恢复时的失败处理。验证：正常升级不新增人工步骤，文档命令使用原 Start/Apply/Export 入口且与测试一致。（WMEM-005，WSTOR-MEMORY-001）

## 4. Agent 接口、固定采用与脑包精简

- [x] 4.1 在 `brain-flow.ts` 与薄 `extensions/brain.js` 增加 recall/read/revise/invalidate，保留原四工具、操作与错误语义；commit/finish/request_get 返回 design D04 的安全 Memory 回执。验证：brain-flow 单测覆盖 Work/Service scope、原 Chat 依据、无新请求的只读、非法/空/失败响应、old extension 兼容及真实 committed 版本。（WMEM-002/006，T03/T04/T06）
- [x] 4.2 实现 design D06 的范围与关键词筛选，在受理事务固定版本和 selection，RunManager/资源 loader/brainPrompt 使用实际选择；后续 recall/read 不切换 head。验证：store/run/resource 单测覆盖中文及英文、排序、无关范围、空命中、10 条/16 KiB、显式 1–20、字节截断、旧 null 明细、禁用脑包、旧受理/新 Run/幂等重放及同 Session 继续。（WMEM-004，CONV-MEMORY-001，T02/T03）
- [x] 4.3 将 `brain.md` 收敛四项原则，Service Spec/开发/部署/验证归原 Skill，协议/恢复/预算/软件更新去重到现有 Reference；保留 brain_package_update 正式路径。验证：实际 Package tree/SDK 加载测试及工具清单不退化，认知学习指引不修改源码或触发 Prepare/Apply，Service 操作不启动开发流程。（BRN-002/003/005，ADEP-002，T04/T06）
- [x] 4.4 在原 Service 参考夹具中提供必要 `SPEC.md` 与实现坐标、受影响测试入口并同步说明；只作为 Skill/验收样例，不成为平台业务或强制技术栈。验证：源码/Spec/现有 Service 能力与 Acceptance Criteria 对齐，模板原测试继续通过，普通 Action 仍使用同一业务实现。（ADEP-002，T06）
- [x] 4.5 更新 `docs/piwork-brain.md` 并创建 `docs/piwork-brain/BASELINE.md` 初版，只记录 Mark 给定八项不变量、版本及测试引用；验证 Git diff 中没有新增未经授权的架构决策，不把文件/Git 历史声明为 GitHub 强制审批。（BRN-007，T04）

## 5. 冷快照与独立导入

- [x] 5.1 在 TS/Go snapshot/history 校验和 Core capture/preflight 中读取实际 4/5 契约，完整保留两个库及来源闭包，热 joint journal 明确 busy；维持 formatVersion=1、storageLayout=2 和两卷 framing。验证：schema 4 WAL、schema 5 稳定联合提交、空 private、缺失/损坏/错配 Memory、未知版本及未恢复日志的拒绝测试通过，不修改源树。（PWORK-003，WSTOR-MEMORY-001，T05）
- [x] 5.2 扩展原 Rebuild 映射 Memory Work/store 归属及配对 binding，保留版本/entryId/来源本地 ID/正文，旧请求和候选只读 historical。验证：Go/TS restore 对照测试、两份目标库不同 store_id、有效来源可读，旧 staged/失败/失效内容保持且不自动提交/重放。（PWORK-BRAIN-001，CONV-SNAPSHOT-001，T05）
- [x] 5.3 更新当前用户文档的导出/导入与 Memory 保留说明，记录未恢复日志需先完成原存储恢复的错误路径。验证：使用原 stopped Export、Import、显式 Start 和再次 Export 命令，不新增用户 bindings 或迁移脚本要求，链接一致。（PWORK-003/BRAIN-001，T05）

## 6. 复用 UI 与 CLI 的真实反馈

- [x] 6.1 在现有 Chat 工具活动/请求与 Run 投影中按需调整 Memory 安全摘要，区分 adoptedVersion、提交 effectiveVersion、候选/失败/失效/空结果；不新建表/事件类型/页面。验证：Desktop browser/projection 测试读取实际工具回执，不用最终模型文字判定生效，空与错误分开，private path/secret/digest 不泄露。（WMEM-006，CONV-MEMORY-001，T02/T04）
- [x] 6.2 核对并补齐 `internal/cli/user_conversation.go` 的 chat、人读工具反馈、run show / watch NDJSON 对同一 Run 的 Memory 回执展示，保持原 envelope 与断线/取消行为。验证：CLI conversation/process 测试比较同一版本、结果和 Evidence 引用，确认退出观察不取消执行，不新增 task 或 Memory 管理命令。（WMEM-006，CONV-MEMORY-001，T02/T04/T06）
- [x] 6.3 同步现有用户文档中的 Memory 反馈字段及读取入口；仅在 README 导航确需改动时同步英文/中文两份。验证：文案与真实 SDK/CLI/页面投影一致，未宣称永久开发账本或独立 Tasks 产品。（WMEM-006，BRN-002）

## 7. 跨模块实际验收与交付

- [x] 7.1 扩展原真实 Pi SDK/MCP/Docker 工作站验收完成 T01–T04：有效偏好/经验跨 restart、同 Session/新 Session 采用、固定旧 Run、失败与失效、两库真实性及 Package bytes/Prepare/Apply/Runtime 代次不变。验证：记录真实 requestId/runId/version/evidenceId 与前后状态，不用直接改数据库/管理器 mock 替代 SDK 路径。（WMEM-001–006，BRN-003，T01–T04）
- [x] 7.2 通过真实 Engine/helper 执行 schema 4 Work 显式升级、迁移失败回退、Core 中断/替代操作恢复及 schema 5 Export/Import 两份/再导出；Start 后生成新反馈。验证：原版本与来源完整、三份 Work 相互隔离、old Runtime/request/outbox/Job 不复活；实际旧镜像在未升级 Work 中继续可用。（WMEM-005，PWORK-003/BRAIN-001，T01/T05/T06）
- [x] 7.3 在已有确定性 SDK Service 验收中覆盖 kanban 创建与修改的 Spec→实现顺序、同 UI/Agent 业务状态、受影响测试实际通过/失败及普通操作不开发；重跑原工作站反馈和 Action 已接受/wait 未登记的三种恢复、Package 固定行为成功/失败验收。验证：使用真实 SDK 工具/Service/浏览器与实际 Evidence，保留原验收条件；确定性脚本只证明执行/契约，不宣称真实模型的自主认知行为已验证。（ADEP-002，BRN-002/005/006，T06）
- [x] 7.4 执行依赖改动的统一回归：Node 24 下 `make generate`、`make build`、`make test`，相关 `make test-integration` / 既有真实 Core Desktop/CLI 测试及 native boundary/image 检查。验证：记录每项实际命令、版本、通过/失败/跳过；Docker 只清理本次精确 installation ID，未运行的检查不标为通过。（T01–T06）
- [x] 7.5 提交中文验收报告及可直接预览的最终 HTML/SVG，按原有架构、简化结构、Memory 设计、实际文件、测试结果、演化说明和真实遗留问题组织。验证：事实与当前实现/执行输出一致，分开标注单元、真实 SDK/Service、真实模型及未验证项目；无 Push、Tag 或 Release。（全部验收与本次交付约束）

## 8. Verify C1/C2 修复与复验

原 1–7 的勾选记录先前执行，不表示 C1/C2 已解决。以下任务完成并复验前，本 change 不再作为完整验收通过；不修改 Founder Baseline，不变更 schema 5 / Memory 1 或新增产品能力。

- [x] 8.1 修复有效 preference 来源及发布元数据闭包：在 `memory.ts` 有效读取/采用、`snapshot-memory.ts` 与 Go `memory_linux.go` 核对条目引用的原 Chat SDK 证明（同 Work/请求、原 source Run、verified、userPreferenceVerified、promptDigest），核对 effective upsert candidate/entry 的 kind 与 createdAt 等元数据；`memory-migration.ts` 用同一完整证明分类旧偏好。验证：合法偏好/普通经验/迁移/历史读取通过；只改 entry kind、同时改 candidate kind、未引用证明、跨请求/Run、错误 digest、类别/时间不一致均拒绝；合法 staged/failed 历史保留，不降级伪造新格式来接受。（C1，WMEM-003/005，PWORK-BRAIN-001，T03/T05）
- [x] 8.2 修复有效 head 与真实发布事实的一致性：runtime 与 TS/Go 静态校验要求 head 等于 published_at 非 null 的最大有效版本，区分初始 0、新空发布、legacy null 部分版本及未发布候选；保证已受理 Run 的合法旧版本仍可读。验证：初始空、最后条目失效新空、迁移部分历史、未来 staged/failed 候选号通过；已发布后 head 退回 0/旧版本、悬空 head、非法发布关系均拒绝且不改输入、不伪造空。（C2，WMEM-001/004/005，WSTOR-MEMORY-001，T01/T02/T03/T05）
- [x] 8.3 补齐跨语言相同正/负夹具及复验：通过普通 API 建立可信 Memory 后篡改独立临时副本，对 runtime、TS Memory/Brain 完整校验、Go workhistory Open 和原 snapshot helper 验证一致结果；检查拒绝时输入指纹不变、没有 Work 发布或旧任务重放。运行 WorkStore/Agent/Go history/Core 定向回归、受影响真实 SDK 偏好/修订/失效、schema 4 迁移及 schema 5 分享回归；更新当前验收和 Verify 报告，原失败复现改为被拒绝后才标完成，未运行项目如实保留。（C1/C2，T01–T06）

## 9. Verify C3 复制条目闭包修复与复验

原 1–8 的 33 项勾选保留为先前执行记录，C1/C2 的直接复现条件已有修复证据；C3 曾表明 Go 接受 TS/runtime 拒绝的非法副本。以下三项全部完成并复验前，不宣称本 change 已完整验收。保持 schema 5 / Memory 1、两卷、现有工具与条目级 CAS，不修改 Founder Baseline，不新增产品能力或执行机制。

- [x] 9.1 在 `internal/workhistory/memory_linux.go` 补齐每个有效快照条目的来源一致性：匹配同 entryId/sourceRequestId、published_version 不晚于该快照的最新 effective upsert candidate；存在适用候选时比较 kind、scope、rule、evidenceIds、sourceRequestId、createdAt，与 `memory.ts` 的现有行为一致，不只核对首次发布版本。保留无对应候选且已通过原有迁移/来源校验的合法历史，合法修订和旧固定快照分别使用适用来源。验证：正常复制与迁移历史通过；只修改后续副本的 kind、createdAt 或 rule 均被 Go Open 拒绝；旧版本仍可读，失败不修改输入、不补造候选或证明。（C3，WMEM-003，WSTOR-MEMORY-001，T03/T05）
- [x] 9.2 扩展现有共享正/负夹具及测试：通过正常 WorkStore/FeedbackStore API 发布 A，再提交不同条目 B 得到 A 的后续版本副本，在独立临时副本上构造 kind/createdAt/rule 三种篡改，并加入正常复制、合法修订/失效、固定旧版本及无对应候选的合法迁移历史对照。沿用 `internal/workhistory/testdata/memory-integrity*` 与 TS/Go 原测试入口，保留原 22 组预期。验证：runtime、TS Memory/Brain/完整 snapshot、Go Open、原 snapshot helper 对同一输入一致接受/拒绝；拒绝前后源指纹相同，不依赖候选首次发布版本已合法作为兜底。（C3，WMEM-003/005，PWORK-BRAIN-001，T01/T02/T03/T05）
- [x] 9.3 复验恢复与导入发布边界并更新报告：运行 WorkStore 与 Go history/helper/Core 定向回归，复用现有真实 Core/helper 验收入口，确认合法副本及迁移/修订/失效历史可完成 Rebuild、Export/Import 和显式启动，非法副本在静态校验与导入发布前拒绝、不重建非法数据、不发布 Work、不执行旧模型/请求/Job。验证：合法重建结果由实际运行时打开并核对原版本/内容/来源，三类非法副本的拒绝与输入指纹有真实记录；区分直接 Open/Rebuild、真实 helper/Core、真实 SDK、真实模型及未运行项目。更新当前验收/Verify 记录，OpenSpec strict 与 `git diff --check` 通过；不得用原成功日志或只勾选 tasks 宣称 C3 已闭环。（C3，PWORK-BRAIN-001，WSTOR-MEMORY-001，T03/T05/T06）
