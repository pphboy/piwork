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

### Requirement: Use one persistent workspace across agent tools and deployments

**Identifier:** WSTOR-SERVICE-001

SDK file/shell execution SHALL use the canonical Work workspace `/var/data/workspace`; deployed services with a workspace grant SHALL use that path or a validated child directory. An image-native service without a workspace grant SHALL explicitly use `/` as its working directory and SHALL receive no persistent workspace. Its storage SHALL have a durable identity separate from agent-private database/history storage. Service mounts SHALL explicitly select workspace access as none, read-only, or read-write, and services SHALL NOT select arbitrary host paths or the agent-private volume. Files written by agent tools SHALL be readable by granted services; files created by a service with write access SHALL be readable and editable by agent tools under the configured shared identity. Only workspace files are persistent application data; container writable layers, /tmp, and process memory are not.

#### Scenario: Write then deploy without copying through Core
- **WHEN** agent SDK write creates apps/demo/server.py and the service receives read-only workspace access
- **THEN** the service reads the same persisted file through its mount without uploading source or mounting a host path

#### Scenario: Share business data
- **WHEN** the service with read-write workspace access writes data/demo/counter.json
- **THEN** agent tools can read it, and service/agent replacement reuses the same bytes

#### Scenario: Enforce a read-only grant
- **WHEN** a service granted read-only workspace access tries to write a file
- **THEN** the write fails without changing workspace contents

#### Scenario: Protect private state
- **WHEN** a deployment requests the agent database volume or attempts to traverse outside allowed workspace paths
- **THEN** the request is rejected before resource creation

#### Scenario: Reject missing storage on recovery
- **WHEN** a previously bound workspace volume is absent
- **THEN** recovery reports CONTEXT_NOT_FOUND or WORKSPACE_NOT_FOUND and does not silently initialize an empty replacement

### Requirement: Retain shared workspace independently of service removal

**Identifier:** WSTOR-SERVICE-002

Deleting or disabling a service SHALL NOT remove shared workspace files or reduce another resource storage access. A workspace SHALL retain a reference while its Work exists, even if no service uses it. Deleting Work SHALL retain both private and workspace volumes by default with owner-scoped records; only explicit authorized purge of unreferenced volumes can delete them. Historical combined storage layouts SHALL fail with CONTEXT_FORMAT_UNSUPPORTED rather than being migrated, reset, or silently mounted as a shared workspace.

#### Scenario: Delete one of two workspace consumers
- **WHEN** service A is removed while service B and the Work reference the workspace
- **THEN** the workspace remains, B can access its data, and an explicit purge returns a reference conflict

#### Scenario: Restart current storage layout
- **WHEN** Core and agentd restart using a Work created by this version
- **THEN** the same two volume identities, program files, business data, and Session history are restored

### Requirement: Preserve complete cold snapshot storage without dereferencing user links

**Identifier:** WSTOR-SNAPSHOT-001

完整冷快照 SHALL 覆盖 Work 的 agent-private 与 workspace 两个受管卷、保留 context 树及这两个卷当前的 Work/service 持久引用，保留普通文件字节、空目录、POSIX 权限与 uid/gid、mtime、符号链接原目标和同一树内硬链接关系。持久缓存也是普通用户内容。卷根 SHALL 分别采集，不能因 private 的 workspace 子路径被运行时挂载遮蔽而丢失底层文件。每卷的 Work 引用及 workspace 上全部 service 引用 SHALL 映射到新身份；不能从当前 service 定义或 tombstone 状态猜测缺失引用。符号链接 SHALL 作为数据保存、绝不跟随读取宿主或其他卷；可保留绝对和悬空 link target，但所有解包条目及其父目录必须限制在新卷内部。相同 inode 的内容只需保存一次；稀疏文件可恢复为稠密文件，字节和逻辑长度必须一致，atime/ctime/inode 号不保证相同。

v1 遇到 FIFO/socket/device、无法保留的 ACL/xattr、不可读取的文件、超限树、额外未清除受管卷或无法映射的卷消费者 SHALL 整体返回 SNAPSHOT_STORAGE_UNSUPPORTED/UNREADABLE，不静默跳过或清理。来源是正常冷停后的逻辑文件快照，不承诺跨文件系统所有元数据等价；容器临时可写层和匿名卷不是现有 Work 的持久数据。已存在的 SDK/平台数据库 WAL 内容 SHALL 完整纳入一致性检查，不能仅复制主 sqlite 文件。导入仅针对新卷操作，不能写入源卷或已有用户卷；缺失必需卷必须失败，不创建空卷冒充恢复。

#### Scenario: Preserve a development tree
- **WHEN** workspace 含 node_modules/.bin 符号链接、可执行脚本、硬链接和空目录
- **THEN** 导入后文件字节、执行位、链接目标/关系和目录均保留，普通开发命令可使用这些依赖

#### Scenario: Do not follow an external link
- **WHEN** workspace 内的符号链接指向 /etc 或另一个卷路径
- **THEN** 导出保存 link target 字符串而不读取目标；导入不经该链接写文件

#### Scenario: Reject an unsupported entry honestly
- **WHEN** 私有卷有残留 socket 或 v1 无法保留的 xattr
- **THEN** 整个 export 失败并指出安全的相对字段/路径标识，不删除该条目也不产生成功的缺项快照

#### Scenario: Independent restore and WAL
- **WHEN** Work 数据库的已提交记录仍在 WAL，包被导入两次
- **THEN** 两份均含这些记录且底层卷不同，改变一份不改变另一份或源卷

#### Scenario: Preserve a stale reference after failed removal
- **WHEN** 一个 tombstone service 的运行时移除失败，源 workspace 卷仍保留该 service 的持久引用
- **THEN** 导出包记录该引用；导入把它映射到新 service ID，两个卷的 Work 引用与引用计数也保持一致，不凭 tombstone 擅自解除

#### Scenario: Do not silently omit another retained volume
- **WHEN** 源 Work 除两个当前布局卷外还有未清除的受管卷或无法映射的消费者
- **THEN** v1 导出整体失败并报告不支持，不生成声称完整的两卷包
