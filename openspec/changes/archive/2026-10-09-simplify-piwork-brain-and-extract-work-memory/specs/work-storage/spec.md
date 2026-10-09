# Spec Delta

## ADDED Requirements

### Requirement: 在既有私有卷内持久保存独立 Memory 并恢复迁移

**Identifier:** WSTOR-MEMORY-001

Work Memory SHALL 作为独立受管认知数据库保存在当前 agent-private 持久卷中，复用 Work 所有权、shared workspace 隔离及删除/清理政策；不新增第三个持久卷或对 Service/WebDAV 授予 private 数据访问。Memory 路径 SHALL 由当前受管 private 数据根派生，不采用用户指定的绝对路径或符号链接替代数据库。

Work 历史与 Memory 的联合提交 SHALL 在进程/主机中断后保持 WMEM-003 的一致结果；已初始化 schema 5 所需 Memory 缺失、错配或不可写时 SHALL 明确失败，不初始化空库替代。冷快照 SHALL 检查两个受管库及其必要日志，保留所有已提交数据；不直接忽略日志或跟随链接读取外部文件。尚未完成联合事务恢复的 cold export SHALL 明确返回 SNAPSHOT_HISTORY_BUSY，不在复制位置猜测原日志路径或用半事务数据发布包。

runtime 和静态历史校验 SHALL 同时检查最新发布 head、有效 preference 原 Chat 来源，以及 published candidate/entry 元数据闭包，分别遵守 WMEM-001/003。存在但过期的 head 不算完整存储；schema/Evidence 单独合法不能替代这些关系。错误来源、类别或 head SHALL 明确失败，保持原输入，不自动降级认知或改成空库。

该元数据闭包 SHALL 覆盖每个快照中的复制条目，遵守 WMEM-003 的适用候选选择及迁移兼容规则。后续版本的副本即使仍引用合法 Evidence，也不能在正文、类别或来源时间与其原候选不一致时通过重启或 Go/TS 静态快照校验。拒绝 SHALL 保持源数据库不变，不通过修复条目、丢弃版本或生成空 Memory 让存储可用。

涉及 schema 4 → 5 的 Apply SHALL 在关闭准入、确认旧 writer 退出后保存准确归属的历史恢复依据；在新 active 发布之前 Memory 迁移候选不能执行模型或推进反馈。候选/迁移失败须确认新 writer 退出并恢复旧历史之后才能重启旧 active。发布前未完成恢复、来源无法确认或失败恢复的清理未完成 SHALL 维持现有持久 Operation 的明确故障与关闭准入，不发布成功、不猜测删除用户文件。新 active 已持久发布之后的过期备份清理失败 SHALL 保留真实诊断与精确归属，不恢复过时备份或撤销新 active 下已提交的 Memory。恢复依据不包含 Service 业务数据回滚，也不成为长期读取源。

#### Scenario: 两个卷保持原身份
- **WHEN** 新 Work 创建、记忆提交并重启，或删除一个使用 workspace 的 Service
- **THEN** 仍只有原 private / workspace 两个卷，Memory 保持私有且持久，不因 Service 移除而删除

#### Scenario: 数据库替换链接或混用
- **WHEN** Memory 数据库被替换为指向其他 Work 的链接或不匹配当前历史的受管库
- **THEN** 操作拒绝，不读取另一 Work 认知，不将错配存储当成空库

#### Scenario: 已提交事务与快照
- **WHEN** 联合事务提交后 Work 停止并导出，或旧格式的已提交内容仍位于 WAL
- **THEN** 完整校验与导入保留已提交历史、Memory 与引用闭包，不因日志尚未清理漏失记录

#### Scenario: 未恢复的联合事务拒绝导出
- **WHEN** schema 5 的两个库仍存在未恢复的联合提交日志，直接进行 cold export
- **THEN** 返回 SNAPSHOT_HISTORY_BUSY，正常存储恢复并停止后才能导出一致结果，不产生半事务成功包

#### Scenario: Apply 回退恢复原数据格式
- **WHEN** 新 harness 已迁移私有历史但随后加载失败
- **THEN** 候选停止后恢复原 schema 4 历史，旧固定镜像能够读取原经验与会话，原业务数据库不被回滚或清空

#### Scenario: 恢复或清理失败
- **WHEN** Core 不能证明备份归属、恢复成功或 writer 已退出
- **THEN** 原 Operation 显示失败/待处理，执行及快照准入保持关闭，保留原数据与精确归属记录，不宣称 Work 已无损恢复

#### Scenario: 已发布后只清理过期备份
- **WHEN** 新 active 发布并使用新 Memory 后，备份清理发生错误
- **THEN** 保留新数据与真实诊断，仅按原归属重试清理，旧备份不能作为随后回滚或覆盖新认知的依据

#### Scenario: 有效存储中的类别或 head 被伪造
- **WHEN** 真实发布后 head 被退回 0/旧版本，或无原 Chat 偏好证明的经验被改成 preference
- **THEN** 重启、默认采用及静态快照校验拒绝，不输出伪空或伪偏好，不修改原数据库

#### Scenario: 合法来源不能掩盖复制条目被篡改
- **WHEN** 两次正常提交产生含旧条目副本的新版本，副本的 kind、createdAt 或 rule 被单独修改，而其引用的原请求/Evidence 仍合法
- **THEN** runtime 重开与 TS/Go 静态校验一致拒绝，输入指纹保持；原样复制及合法迁移条目继续通过，不以源 Evidence 合法替代副本一致性
