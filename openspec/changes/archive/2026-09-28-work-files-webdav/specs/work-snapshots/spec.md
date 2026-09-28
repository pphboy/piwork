## ADDED Requirements

### Requirement: 冷快照核验文件写入者并保留 WebDAV 数据

**Identifier:** WSNAP-FILES-001

在WSNAP-001既有停止、运行实例和操作检查之外，export SHALL 确认该Work无未收尾文件任务、无活动/迟到/孤儿文件helper及无未处理的平台暂存。此检查 SHALL 在接受独占快照锁时与文件准入/提交原子互斥，并在实际采集前复核；持久任务未清理返回409 WORK_BUSY，发现实际运行资源返回409 SNAPSHOT_REQUIRES_STOPPED，无法确认Docker状态返回503 SNAPSHOT_RUNTIME_UNAVAILABLE。不可因为数据库已标stopped或HTTP连接已关闭而绕过检查。

快照锁持有期间 SHALL 拒绝新文件任务与提交；文件清理未完成不允许export成功，不通过删除无法证明归属的内容强行收尾。Core异常恢复 SHALL 先处理旧文件写入者，再进行快照恢复或普通Work恢复。平台内部收尾可在Work停止状态执行，但不能开放用户WebDAV访问。

WebDAV成功提交的普通文件和目录 SHALL 按现有workspace快照契约导出，保留现有完整性与元数据规则；文件helper镜像、本地临时密码、文件执行journal不得进入portable工作配置/历史/镜像集合。无需修改`.work`格式。import仍发布新的stopped Work，用户显式start后通过新workId访问恢复文件；未支持的文件类型仍按既有快照规范整体报错。

#### Scenario: 上传到迁移后的下载
- **WHEN** 用户WebDAV上传根文件、隐藏文件及data子目录文件，停止Work后export/import并启动新Work
- **THEN** 新Work的WebDAV下载字节与原文件一致，使用新workId，原Work及其卷不被覆盖

#### Scenario: 假停止但仍有文件写入者
- **WHEN** 数据库显示stopped但存在活动helper或尚未清理任务
- **THEN** export被拒绝，不生成可下载的成功快照

#### Scenario: export与文件准入竞争
- **WHEN** 冷快照锁取得与文件任务接受/提交并发发生
- **THEN** 只有满足同一门禁的一方获准，不能边写workspace边产生成功冷快照

#### Scenario: 清理身份不确定
- **WHEN** 文件临时项身份无法确认
- **THEN** 保持待清理和快照拒绝，不删除疑似用户文件或静默跳过生成不完整包

#### Scenario: WebDAV限制不改变原导出范围
- **WHEN** workspace包含WebDAV首版不支持读取的symlink但属于既有快照支持类型
- **THEN** export仍按原规范保存链接本身，不跟随、不因DAV访问子集过滤快照内容
