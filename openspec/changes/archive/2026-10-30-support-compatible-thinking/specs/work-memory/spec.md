# Spec Delta

## MODIFIED Requirements


### Requirement: 一次性迁移既有 Experience 且保留回退

**Identifier:** WMEM-005

系统 SHALL 对精确已知且完整校验的 history schema 4 提供一次性 Experience 迁移；迁移保留全部有效版本、已采用版本、有效 head、staged / failed 历史、entryId、内容、来源、Evidence 与原时间。不能只复制最新 head，不能重新验证旧任务来补造缺失证明。

迁移成功后的受管历史 SHALL 为 schema 7，唯一 Memory 为 schema 1；旧 Experience 不再读取或双写。旧 head 为 0 或无 Experience 的合法历史 SHALL 迁移为明确空版本，不改变既有 Session / Run / Request / Action / Job 身份和执行状态。

legacy 偏好分类 SHALL 使用 WMEM-003 的被条目引用的完整原 Chat 偏好证明。仅有 `userPreferenceVerified` 标志或无关 SDK Evidence 不足以标为 preference；原本按旧契约成立的业务经验可保留为 experience，不能补造指令证明。legacy 已知有效 head 保留原更新时间作为发布时间；未知部分历史保留 null，随后按 WMEM-001 校验发布 head。

迁移 SHALL 只在独占、关闭执行准入且具有可恢复原数据的现有生命周期边界完成。失败、断电/进程中断、候选加载失败或控制操作被替代时，SHALL 恢复一致旧数据或一致新数据，并保留未完成操作以便按原归属收尾，不让旧 active 读取半迁移数据。任意未知/伪造 schema、损坏证据或其他 Work 数据 SHALL 被拒绝，不能执行输入数据库携带的 SQL/trigger 或静默修复内容。

旧固定镜像和 active context SHALL 不因 Core 更新自动升级；schema 4 的 Work 保持原执行，采用新 harness 走既有显式 Apply。已成功激活 schema 7 后，要求 schema 4/5/6 的不兼容降级 SHALL 在替换原运行之前拒绝，不把新记忆反向写成旧 Experience。


本变更的新 Agent SHALL 仅写入 schema 7；schema 4/5/6 SHALL 在经完整备份、可恢复的显式 Apply 中一次转换到 7。schema 4 的 Experience→Memory 迁移 SHALL 在同一事务中建立当前 history 结构与 Memory 引用；schema 5/6 SHALL 先核验精确旧结构和 Memory 所有权，再事务删除 `sessions.active_context_identity` 并写入版本 7，Memory 保持 schema 1。迁移 SHALL 保留原 Session ID、SDK 文件、Run 的 context、幂等和采用事实，不回填兼容推理偏好；已升级的 schema 7 再次初始化只做核验，不重复转换。旧格式的静态读取和导入不触发迁移；升级成功后拒绝仅支持 schema 4/5/6 的旧镜像。

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
