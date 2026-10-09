# Spec Delta

## Purpose

为每个 Work 提供独立、持久、有证据来源且可版本固定的认知存储，使用户偏好、已验证经验和可信知识能够在后续任务按需采用，并与 Brain 软件、Service 状态及执行历史保持明确职责边界。

## ADDED Requirements

### Requirement: 独立保存 Work 私有认知

**Identifier:** WMEM-001

系统 SHALL 在现有 Work-private 持久化边界内保存唯一权威 Memory，独立于 Brain Package、Service 源码、Service 业务数据库、运行记录与 Founder Baseline。Memory SHALL 保存偏好、经验证经验和具有可查来源的复用知识，不作为业务状态、工具流水、调度队列或开发账本。

记忆 SHALL 具有稳定 entryId、work 或 service 范围、内容、类别、来源请求、Evidence 引用、版本及时间。来源请求和 Evidence SHALL 继续由现有历史存储保存；Memory 只引用其身份，不复制一套证据正文。未初始化或有效版本 0 SHALL 明确表示空认知；已有存储缺失、损坏或来源不完整 SHALL 表示错误，不伪造空集合。

`memory_head.version` SHALL 等于最新可证持久发布版本；版本存在或其内容为空不足以证明它是有效 head。没有非零发布时初始 0 合法；最后一条失效后 head SHALL 指向该次提交的新空版本，不退回 0。legacy 的 `published_at=null` 部分历史仅作为保留历史，不竞争 head，也不以版本号大于 head 判为新的发布。已受理 Run 读取历史固定版本仍允许，不能把当前 head 完整性与历史读取混淆。错误 head SHALL 明确拒绝，不自动回填、丢弃新版本或初始化空库。

#### Scenario: 偏好与经验在重启后可读
- **WHEN** 一个 Work 已提交有效记忆，随后停止并重启
- **THEN** 同一 entryId、版本、内容及来源仍可查询，不依赖容器临时层或重新加载新的 Brain 包

#### Scenario: Service 不获得 Memory 私有存储
- **WHEN** Service 获取当前 Work workspace 挂载，或试图指定 private 存储
- **THEN** workspace 不包含 Memory 数据库，private 请求按现有权限拒绝

#### Scenario: 合法空认知与损坏不同
- **WHEN** 分别读取一个正常空 Memory 和缺失/损坏的已初始化 Memory
- **THEN** 前者返回版本 0 或实际空版本与空集合，后者返回明确错误，不将读取失败记录为未发生学习

#### Scenario: 已发布认知不能因旧 head 被伪装为空
- **WHEN** 已存在非零持久发布版本，head 被改成仍存在的 0 或旧有效版本
- **THEN** 运行时打开/采用及 TS/Go 静态校验均拒绝；不返回正常空或过时 head，不修改输入库

#### Scenario: 失效后的新空 head 与旧部分历史
- **WHEN** 最后一条认知经验证失效，或迁移保留发布时间未知的 legacy 部分版本
- **THEN** 前者使用本次新空发布版本；后者按已知发布事实定位 head，保留部分历史和原 Run 引用，不用最大候选号或未知历史号覆盖 head

### Requirement: 用既有经验工具提供最小 Memory 操作

**Identifier:** WMEM-002

系统 SHALL 演进 `brain_experience`，保留 list、stage、commit、status 及既有字段语义。stage SHALL 是 Propose；新增 recall、read、revise、invalidate，不要求已有调用者改用新的工具名。宿主 SHALL 从当前 active Run 推导 Work、来源与权限，不接受调用者指定另一个 Work 的认知库。

recall SHALL 在当前 Run 的固定版本按任务文本和适用范围检索，返回版本、条目、可查来源和截断标志；read SHALL 按 entryId 读取该固定版本中的有效、已失效或不存在状态。两者不创建新的处理目标。

stage / revise / invalidate SHALL 仅形成当前目标的候选，不立即改变有效 head。revise SHALL 保留 entryId 并携带新内容与依据；invalidate SHALL 携带 entryId、原因与依据。旧 stage 对已有 entryId 的替换语义保持兼容。候选 SHALL 使用预期的有效版本；同请求的重复同内容操作保持同一候选，异内容替换候选仅在尚未提交时允许。版本检查 SHALL 针对被修改条目：其它条目推进 head 时继续合并原候选，被修改条目的内容或来源已变化时明确拒绝，保留旧 head 和候选，不静默覆盖新认知。

#### Scenario: 既有工具继续使用
- **WHEN** 旧脑包调用 stage 和 commit，随后调用 list / status
- **THEN** 调用经同一 Memory 权威存储执行，保留 adoptedExperienceVersion、snapshot 和 effectiveVersion 的既有含义，不同时写回旧 Experience 表

#### Scenario: 提出与提交分开
- **WHEN** 当前目标 stage 一条记忆或 revise / invalidate 一条有效记忆，但尚未验证完成
- **THEN** 后续默认读取仍看到原 head，候选只属于当前目标且不能被当成已验证认知

#### Scenario: 失效与修正可查
- **WHEN** 有效条目经验证被修正或失效
- **THEN** 新版本提供新内容或从默认检索中移除条目，read 可说明当前失效原因及来源，旧已采用版本仍可读取原内容

#### Scenario: 版本冲突和越权
- **WHEN** 候选的预期版本中同一条目已被修改，或自动 Service 目标试图修改另一 Service 的范围
- **THEN** 分别明确冲突或拒绝权限，原 head、其他范围内容及工具策略保持不变

#### Scenario: 等待候选合并无关认知
- **WHEN** 候选 A 等待实际结果期间另一个目标提交不同 entryId 的 B，A 随后完成真实验证
- **THEN** 新 head 保留 A 和 B，不因全库版本推进拒绝 A；各旧 Run 仍读取原固定快照

### Requirement: 经真实验证原子提交记忆

**Identifier:** WMEM-003

自动学习 SHALL 复用现有请求完成验证：证据属于同一 Work 和原目标，真实 Query / Action / Job 或固定 SDK 行为证明满足相应检查，不能以模型文字、普通事件、文件存在或 Run succeeded 替代。用户明确偏好或明确认知纠正 SHALL 引用原受理 Chat，不把工具/Service 输出伪造成用户指令。

每个有效 `kind=preference` 条目 SHALL 在其 `evidenceIds` 内引用至少一个原 Chat 偏好证明：同 Work/来源请求，verified SDK Evidence，关联该请求的 source Run，`userPreferenceVerified=true`，且 promptDigest 与该原受理 Run 一致。该要求 SHALL 在提交、有效快照读取/采用、恢复和 TS/Go 静态校验中保持；普通 verified Query、其他请求的用户指令、单独 kind 字段或 historical 标记均不能替代。已发布 upsert candidate 与发布版本的 entry SHALL 核对 kind、scope、rule、Evidence 引用、sourceRequestId 和 createdAt 一致。失败/尚未验证的候选仍按原状态保留，不因缺少有效证明被升级成有效认知。

上述一致性 SHALL 覆盖每个有效快照中的复制条目，而非仅候选首次发布的版本。校验 SHALL 查找同 entryId、同 sourceRequestId、published_version 不晚于该快照版本的最新 effective upsert candidate；存在该候选时比较 kind、scope、rule、evidenceIds、sourceRequestId、createdAt，TS/runtime 与 Go SHALL 保持一致接受/拒绝。合法修订按该版本适用的新来源校验，未来候选不能改写旧固定快照的判断。无对应候选且已通过原有迁移与来源校验的合法历史条目 SHALL 按既有规则保留，不补造候选或把全部迁移历史当作缺少来源拒绝。

候选发布、有效 head 更新与对应请求的 verified completed SHALL 具有同一持久提交结果。任何检查失败、取消、期限到达、存储错误或提交中断 SHALL NOT 单独留下新的有效 Memory 或无依据 completed；旧 head 保持或与真实完成结果一起更新。恢复只恢复存储事务，不重新执行原模型、mutation 或任务。请求 failed / cancelled / needs_attention 的候选保留为未生效失败历史。

每个有效快照 SHALL 最多 100 条有效认知，每条 rule 最多 4 KiB UTF-8；不静默裁剪规则或删除失败依据来通过提交。超限明确失败，并保留原有效版本。

#### Scenario: 实际业务检查通过后学习
- **WHEN** Service 改进的原 Action 结果与相应 verification Query 实际通过，且候选证据关联正确
- **THEN** completed 与新 Memory head 一起持久生效，后续 Run 可采用并查询原证据

#### Scenario: 失败经验不生效
- **WHEN** 检查失败、证据属于另一目标或只存在成功 Run 文字
- **THEN** 提交被拒绝或目标真实失败/需处理，原有效认知不变，候选与失败理由仍可查

#### Scenario: 提交窗口进程中断
- **WHEN** 在请求完成与 Memory 写入之间的持久提交窗口中断进程并重启
- **THEN** 恢复结果是旧请求与旧 head，或真实完成请求与新 head，不出现单库成功的虚假有效认知，不重放原任务

#### Scenario: 原始用户偏好
- **WHEN** 当前受理 Chat 明确要求记住偏好或撤销过时认知
- **THEN** 候选引用该原 Chat 的宿主证据，沿用验证提交，不因服务输出含有相似文字而自动认定用户已授权

#### Scenario: 容量边界
- **WHEN** 候选使有效条目超过 100 或 rule 超过 4 KiB
- **THEN** 提交明确超限失败，原版本完整可读，不宣称已经采用部分新规则

#### Scenario: 普通经验伪造偏好类别
- **WHEN** 只有合法业务 Query 证明的有效经验被改成 preference，无论只改 entry 还是同时改 published candidate
- **THEN** runtime 读取/采用及 TS/Go 静态校验均拒绝；不得把它作为用户偏好注入无关任务

#### Scenario: 偏好证明必须由条目实际引用
- **WHEN** 同请求另有原 Chat 偏好 Evidence，但该有效 preference 未引用它，或引用的是其他请求/Run 的证明
- **THEN** 校验拒绝；不能借同库或同请求中的无关联证明使条目有效

#### Scenario: 已发布类别与来源元数据被改写
- **WHEN** 有效 upsert candidate 与其发布版本 entry 的 kind 或 createdAt 不一致
- **THEN** TS/Go 静态闭包拒绝，并保持输入不变，不忽略元数据差异接受包

#### Scenario: 不同条目提交保留合法副本
- **WHEN** 正常请求发布条目 A，另一请求提交不同条目 B，新有效快照原样保留 A
- **THEN** A 按原适用候选及来源保持可读，TS/runtime 与 Go 接受该快照，不要求为复制条目重新提交候选

#### Scenario: 后续快照中的副本被改写
- **WHEN** 仅修改后续快照中 A 的 kind、createdAt 或 rule，而首次发布版本、原候选、来源请求和 Evidence 不变
- **THEN** runtime、TS 完整 snapshot 与 Go 静态校验一致拒绝，保持输入不变，不以首次发布版本仍合法接受非法副本

#### Scenario: 合法修订与失效保留原固定快照
- **WHEN** 同一 entryId 经新请求实际验证后修订或失效，旧 Run 仍固定采用此前版本
- **THEN** 新快照按适用的新候选和来源校验，失效条目不进入新默认读取；旧快照按原候选保持可读，不用未来候选否定历史内容

#### Scenario: 迁移条目没有对应新格式候选
- **WHEN** 合法 schema 4 Experience 已完整迁移并通过来源校验，保留条目没有对应 Memory effective upsert candidate，后续提交继续复制该条目
- **THEN** TS/runtime 与 Go 按既有迁移和来源规则接受合法历史及副本，不补造候选或重放旧任务

### Requirement: 按任务采用固定版本且记录实际提供内容

**Identifier:** WMEM-004

新 Run SHALL 在持久受理时固定有效 Memory 版本及初始实际提供条目，执行与幂等重放使用相同版本和条目。已有兼容 Session 与新 Session 均适用。当前 Run 后续 recall / read SHALL 使用这个固定版本，不因 effective head 后来推进而替换上下文。未启用脑包的 Run 不宣称采用未提供的认知。

默认上下文 SHALL 按任务相关性提供有界条目，最多 10 条且编码内容不超过 16 KiB；显式 recall 的 limit SHALL 为 1–20，结果仍遵循既有安全结果大小边界。自动 Service 目标 SHALL 只检索 work 范围及其来源 Service 范围；手动目标按任务文本或明确 Service 范围筛选。空命中返回真实空集合；因条数/字节预算未提供的匹配条目 SHALL 明确标为截断，不把全库版本号当作已阅读全部内容的证明。

默认检索 SHALL 只采用有效条目。Memory SHALL 作为可复用事实/偏好提供，不能改变 Tool allow/deny、平台凭据、运行时配置、Founder Baseline 或自动生成新的 Agent 目标。无关认知不能在每个 Run 无限追加，已失效版本只能通过历史读取查证。

#### Scenario: 受理后更新 Memory
- **WHEN** Run A 已按版本 v1 受理，之后有效 head 更新为 v2
- **THEN** A 的初始内容和后续 recall / read 都使用 v1，后续 Run B 按任务读取 v2，重放 A 返回原版本与原内容

#### Scenario: 实际提供与未命中
- **WHEN** 版本中有多个 Service 的认知，而目标仅涉及 kanban，或没有任何相关条目
- **THEN** 记录实际提供的 entryId 与固定版本，前者不注入其他 Service 的无关认知，后者提供空集合而非全库兜底

#### Scenario: 上下文达到预算
- **WHEN** 相关记忆超过默认条数或字节预算
- **THEN** 初始上下文保持预算并记录截断，Agent 可在同一固定版本明确 recall / read，不隐式继续追加全部规则

#### Scenario: 失效不会改写进行中的 Run
- **WHEN** v1 的一个条目被后续提交失效为 v2
- **THEN** 已受理的 v1 Run 保持原认知，新 v2 Run 默认不再采用，历史读取说明版本而不伪造当前有效性

#### Scenario: 记忆包含越权要求
- **WHEN** Memory 文本要求扩大 Tool 权限、改变平台模型凭据或改写 Founder 决策
- **THEN** 实际权限与配置仍由既有运行时边界控制，该文本不能成为权限授权或 Package 更新触发器

### Requirement: 一次性迁移既有 Experience 且保留回退

**Identifier:** WMEM-005

系统 SHALL 对精确已知且完整校验的 history schema 4 提供一次性 Experience 迁移；迁移保留全部有效版本、已采用版本、有效 head、staged / failed 历史、entryId、内容、来源、Evidence 与原时间。不能只复制最新 head，不能重新验证旧任务来补造缺失证明。

迁移成功后的受管历史 SHALL 为 schema 5，唯一 Memory 为 schema 1；旧 Experience 不再读取或双写。旧 head 为 0 或无 Experience 的合法历史 SHALL 迁移为明确空版本，不改变既有 Session / Run / Request / Action / Job 身份和执行状态。

legacy 偏好分类 SHALL 使用 WMEM-003 的被条目引用的完整原 Chat 偏好证明。仅有 `userPreferenceVerified` 标志或无关 SDK Evidence 不足以标为 preference；原本按旧契约成立的业务经验可保留为 experience，不能补造指令证明。legacy 已知有效 head 保留原更新时间作为发布时间；未知部分历史保留 null，随后按 WMEM-001 校验发布 head。

迁移 SHALL 只在独占、关闭执行准入且具有可恢复原数据的现有生命周期边界完成。失败、断电/进程中断、候选加载失败或控制操作被替代时，SHALL 恢复一致旧数据或一致新数据，并保留未完成操作以便按原归属收尾，不让旧 active 读取半迁移数据。任意未知/伪造 schema、损坏证据或其他 Work 数据 SHALL 被拒绝，不能执行输入数据库携带的 SQL/trigger 或静默修复内容。

旧固定镜像和 active context SHALL 不因 Core 更新自动升级；schema 4 的 Work 保持原执行，采用新 harness 走既有显式 Apply。已成功激活 schema 5 后，要求 schema 4 的不兼容降级 SHALL 在替换原运行之前拒绝，不把新记忆反向写成旧 Experience。

#### Scenario: 含全部历史的旧 Work 升级
- **WHEN** schema 4 Work 有不同采用版本的 Run、有效经验及 staged / failed 候选，显式 Apply 新 harness
- **THEN** 迁移后每个旧 Run 仍可定位原版本，失败候选不被激活，来源证据完整，旧 Experience 不再是权威存储

#### Scenario: 迁移失败不损坏旧 active
- **WHEN** 拷贝/校验、提交或新候选加载失败
- **THEN** 在确认候选退出后恢复原历史并按现有 Apply 回退结果显示，旧 active 可继续原数据，不以删除经验或恢复空库完成回退

#### Scenario: Core 在迁移与激活之间中断
- **WHEN** 数据已转为新格式但 Apply 尚未正式发布时 Core 中断
- **THEN** 按原 Apply 记录核对并完成发布或恢复原数据，期间禁止模型执行、冷快照及其他迁移写入，不重放任何历史目标

#### Scenario: 未升级与不可兼容降级
- **WHEN** Core 重启但旧 Work 未 Apply，或已经升级的 Work 请求仅支持 schema 4 的镜像
- **THEN** 前者保持原镜像、active 和旧格式；后者明确不兼容并保留原运行与新 Memory

### Requirement: 认知演进不触发软件更新并复用现有观察入口

**Identifier:** WMEM-006

Recall、Read、Propose、Commit、Revise 和 Invalidate SHALL 不修改 Brain Package bytes、active/desired context，不触发 Package Prepare / Apply、无关 Runtime 重建或新的自动目标。Memory 不是完成普通业务任务必须进行的额外人工确认/等待步骤；只有确实需要保存认知时才创建候选，正常只读检索在 Run 准入内完成。

用户和 Agent SHALL 通过现有 Run 工具结果、请求与 Evidence 查询同一实际提交结果和采用版本；UI / CLI 不维护第二份可修改的 Memory 操作记录。返回信息 SHALL 区分 proposed、effective、failed、invalidated、空命中及读取失败，公共内容按现有安全边界提供来源引用和必要摘要，不泄露内部路径、凭据或推理原文。

#### Scenario: 学习无需更新脑包
- **WHEN** 一个任务提交有效新认知并在后续 Run 使用
- **THEN** 前后 Brain 内容、active/desired 及 Runtime 代次保持，Prepare / Apply 调用数为零，业务结果按原路径完成

#### Scenario: UI CLI 和 Agent 查同一事实
- **WHEN** UI 工具活动/请求详情、CLI chat / run watch / run show 及 Agent 查询同一 Memory 操作
- **THEN** 版本、生效或失败结果及 Evidence 引用来自同一原请求与实际工具结果，不用 Agent 完成文字替代存储事实

#### Scenario: 普通操作没有学习阻塞
- **WHEN** 用户只要求移动已有 Service 的一个卡片，没有可复用新认知需要提交
- **THEN** Agent 直接 Action / Query 验证并返回结果，不创建 Spec、Memory 候选、Package 候选或额外审批任务
