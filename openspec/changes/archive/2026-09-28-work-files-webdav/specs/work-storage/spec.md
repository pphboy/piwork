## ADDED Requirements

### Requirement: WebDAV 直接操作现有 workspace 持久数据

**Identifier:** WSTOR-FILES-001

WebDAV SHALL 访问当前Work已有的workspace卷，根对应整个`/var/data/workspace`，包含用户根文件、隐藏文件和任意普通子目录，不强制apps/data布局、不复制成另一份同步目录、不改变service挂载定义。pi-agentd和获准service SHALL 通过原挂载读取WebDAV提交的文件；WebDAV SHALL 读取它们写入workspace的文件。未授予workspace或写在该路径外的应用数据不自动进入此范围。缺失卷 SHALL 明确失败，不创建空卷冒充原数据。

文件执行 SHALL 使用共享uid/gid=10001；新文件0644、新目录0755，PUT替换保留既有普通权限位（含执行位但排除特殊权限位），COPY保留源普通权限位，MOVE保留源inode。无权限返回403，不递归chown或提升权限。WebDAV不承诺保留硬链接关系、ACL/xattr、上传来源mtime等完整元数据；完整冷快照仍遵循WSTOR-SNAPSHOT-001。

#### Scenario: 文件双向共享
- **WHEN** service在data/demo写入文件，随后用户通过WebDAV上传另一个文件
- **THEN** 客户端能下载前者，agent和获准service能直接读取后者，内容均来自同一卷

#### Scenario: 重启与service移除
- **WHEN** WebDAV上传完成，Work重启或其中一个service被移除
- **THEN** 文件仍在原workspace，其他消费者和后续WebDAV请求可读取

#### Scenario: 执行权限与只读挂载
- **WHEN** WebDAV覆盖既有可执行脚本，另有service仅获只读workspace
- **THEN** 脚本保留普通执行位，service能读新内容但仍不能写，未扩大其挂载权限

#### Scenario: 卷缺失
- **WHEN** Work记录存在但workspace卷被外部删除
- **THEN** 文件访问报告不可用，不新建空卷、不宣称数据恢复

### Requirement: 文件提交与失败清理保留真实结果

**Identifier:** WSTOR-FILES-002

PUT和单文件COPY SHALL 先暂存完整内容，确认长度、限额、写入成功并持久化后，在有效提交许可下原子发布目标；禁止先截断旧目标。提交前失败的新目标保持不存在，旧目标保持完整。成功响应 SHALL 以完成提交、持久化及执行资源收尾为前提；提交已发生但响应丢失或资源移除失败时必须允许客户端通过重新查询判断结果，不承诺失败即回滚。无条件上传不进行自动重放。

每Work mutation SHALL 串行准入直至收尾完成；HTTP条件仅约束WebDAV请求，agent/service直接写入不获得同一全局锁。目录递归操作可以部分完成并如实返回207，运行中普通下载不等同数据库一致性备份。

系统 SHALL 记录自身精确暂存归属并在取消/恢复时清理；不能按通配或文件名前缀删除、隐藏用户文件。无法确认暂存归属或写入者退出时保持FILE_CLEANUP_REQUIRED，阻止该Work继续文件访问和冷快照，不静默删除疑似用户内容。自动清理只作用于有归属证明的平台暂存，既有用户隐藏文件始终属于可访问/可导出数据。

#### Scenario: 上传中断保持旧文件
- **WHEN** 覆盖上传在取得提交许可前断开
- **THEN** 原目标字节不变，暂存被收尾，没有以目标名称出现的半文件

#### Scenario: 提交后响应丢失
- **WHEN** 完整文件已提交但响应没有到达客户端
- **THEN** 文件允许是完整新版本，代理不自动重复写入，重新查询能反映当前实际内容

#### Scenario: 临时名与用户文件冲突
- **WHEN** 用户已有看似平台临时前缀的文件，或已记录暂存项被替换为另一inode
- **THEN** 平台不按名字前缀隐藏/删除用户文件；不能核验身份时报告待清理而不猜测删除

#### Scenario: 部分目录失败
- **WHEN** 已删除一些目录子项后其余项不可访问
- **THEN** 返回准确失败项，已删除部分不被宣称回滚，也不返回整个目录已成功删除
