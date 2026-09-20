# Work Storage Specification

## Purpose

为 Work 工作文件、会话历史和附属服务数据提供独立于容器存活的持久存储契约，明确数据归属、重启保留、共享挂载、删除留存和显式清理，使恢复行为可以用实际数据而非容器状态验证。

## Requirements

### Requirement: Persist Work and service data across replacement

系统 SHALL 将工作文件、Session／Run 状态和声明为持久的服务数据绑定到稳定 Work／卷身份，在停止、重新启动、daemon 或服务容器替换后重新提供。容器临时可写层和缓存 MUST NOT 被宣称为持久数据。

#### Scenario: Work and service restart

- **WHEN** agent 写入工作文件、服务写入持久卷，然后 Work 停止并再次启动
- **THEN** 原 Work 和服务身份保持不变，两处持久数据内容可读且一致

#### Scenario: Temporary container modification

- **WHEN** 服务容器被重建且之前仅在其临时可写层安装软件或写入文件
- **THEN** 系统按镜像和声明配置重建，不宣称那些未持久化修改已恢复

### Requirement: Mount only authorized managed storage

系统 SHALL 校验卷归属和读写权限，只有本 Work 获准卷可以挂载。共享工作目录 SHALL 显式声明；不允许因路径穿越、符号链接或请求伪造而访问宿主私有数据和其他 Work 数据。

#### Scenario: Explicit read-only shared workspace

- **WHEN** 服务被授予当前 Work 工作目录的只读挂载
- **THEN** 服务可以读取允许文件，但写入被拒绝

#### Scenario: Escape the storage boundary

- **WHEN** 挂载请求或相对路径试图指向其他 Work 或允许根之外
- **THEN** 系统拒绝访问，不能将 Client 指定 cwd 当作宿主路径权限

### Requirement: Preserve deleted resource data unless explicitly purged

删除 Work 或服务 SHALL 默认移除运行实例并保留持久数据、归属和可查询留存记录；只有授权主体显式指定 purge_data 或调用留存清理入口才 SHALL 删除对应数据。仍被引用的卷 MUST NOT 被清除，留存卷仍 SHALL 计入配置的卷数量政策。

#### Scenario: Delete without purge

- **WHEN** 所有者删除具有数据的服务且未指定 purge_data
- **THEN** 服务不再运行或随 Work 启动，数据以带原归属的留存卷形式可查询

#### Scenario: Explicit retained data cleanup

- **WHEN** 所有者或有控制权限的管理员显式清理无引用的留存卷
- **THEN** 系统只清理已解析的目标卷，并提供完成或失败状态

#### Scenario: Purge referenced data

- **WHEN** 请求清除仍由其他服务定义引用的卷
- **THEN** 系统返回冲突并保留数据

### Requirement: Report persistence failure honestly

系统 SHALL 在状态或数据无法持久保存时报告存储故障，并拒绝需要该持久写入的新执行。MUST NOT 在 Run 或 Operation 接受记录未落盘时报告已经持久接受。

#### Scenario: Storage unavailable on submission

- **WHEN** Work 状态存储不可写时用户提交 Run
- **THEN** 系统返回存储失败，不启动未记录的执行

#### Scenario: Volume missing during recovery

- **WHEN** 已存在 Work 的持久卷在恢复时丢失
- **THEN** 系统报告缺失数据，不能用空卷静默替代并报告无损恢复
