## ADDED Requirements

### Requirement: 将文件任务纳入 Work 状态切换与停止证明

**Identifier:** WLIFE-FILES-001

系统 SHALL 在接受stop/delete目标或开始apply实例切换时关闭该Work的新文件请求及提交许可；仅保存desired配置不提前停止当前文件能力。关闭动作 SHALL 与文件请求接受/提交授权原子排序。此前已经获准提交的任务可在有界收尾内完成，未获准的上传必须取消，不得跨停止完成或新运行实例继续提交。

停止收尾 SHALL 覆盖所有已知、启动中、取消中、迟到创建和只读文件执行资源，并与现有agent/service停止并行协调；必须确认执行资源退出及平台暂存清理，才能报告stopped/deleted或完成新实例切换。某文件资源失败不能跳过停止agent/service的尝试；无法确认退出时保持未完成/失败和可查询诊断，不报告虚假成功。文件收尾 SHALL 并入现有默认30秒drain、10秒终止确认和45秒Core退出总预算，不逐任务累加无限等待。

#### Scenario: 上传过程中停止Work
- **WHEN** stop在上传尚未取得提交许可时被接受
- **THEN** 新文件请求被拒绝，上传取消，暂存和辅助容器收尾后才显示stopped，旧文件保持完整

#### Scenario: 已许可提交与停止竞争
- **WHEN** 提交许可先于stop被接受
- **THEN** 请求可以在收尾期限内完成，停止结果等待其完成/取消证明，stopped之后不再产生迟到写入

#### Scenario: apply切换而普通配置保存不切换
- **WHEN** 用户先保存desired配置，再显式apply
- **THEN** 保存阶段文件访问继续针对当前Work；apply切换阶段关闭并收尾旧文件任务，之后新请求重新核验当前状态

#### Scenario: helper不可停止而agent可停止
- **WHEN** helper退出无法确认但agent/service能够停止
- **THEN** Core仍尝试停止agent/service，Work操作报告未完成/失败，文件访问和export不因数据库状态而绕过残留写入者

### Requirement: 恢复文件资源时不重放用户写入

**Identifier:** WLIFE-FILES-002

Core SHALL 在创建文件执行资源前持久记录归属，并在正常完成后确认回收；HTTP断开或Docker调用超时不等于容器退出。Core重启 SHALL 在该Work恢复文件访问、普通实例恢复或执行冷快照前处理旧任务：失效旧提交权限、确认旧helper退出、清理有确切归属的暂存；不得重放PUT/COPY/MOVE/DELETE。迟到资源 SHALL 继续按已记录归属核对，未知归属资源不得自动删除。

Core优雅退出 SHALL 关闭全局文件准入并按既有总预算收尾，未确认完成以非零退出和恢复记录报告。某Work的cleanup-pending SHALL 阻止该Work的文件访问、实例切换及冷快照，不全局禁用其他Work或service能力。文件任务记录属于Core运行状态，不能成为用户service、Work历史动作或portable配置。仅停止proxy SHALL 取消其连接，不改变Work期望状态。

#### Scenario: Core在写入准备阶段崩溃
- **WHEN** 暂存已创建但Core在提交许可前退出
- **THEN** 重启先收尾旧容器与暂存，不重放上传，目标保持原内容，然后才开放后续访问

#### Scenario: Core在提交后崩溃
- **WHEN** 文件已完成提交但Core未记录HTTP完成
- **THEN** 恢复保留实际完整文件，仅收尾平台资源，不再次执行写操作

#### Scenario: 迟到创建与未知容器
- **WHEN** Docker创建超时后出现本任务容器，同时存在名字相似但归属不符的容器
- **THEN** Core回收可证明属于旧任务的资源，保留未知资源并报告问题，不做全局名称匹配删除

#### Scenario: 关闭本地proxy
- **WHEN** 用户Ctrl+C终止统一proxy
- **THEN** 本地连接关闭、对应文件请求取消并由Core收尾，Work继续保持原期望运行状态
