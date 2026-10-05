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

属性名精确等于 `security.selinux` 的标签 SHALL 作为宿主安全策略处理，不属于可移植 Work 元数据。源目录、普通文件、符号链接或新的目标根仅有该属性时，系统 SHALL 不因此拒绝捕获或恢复；没有该属性时仍按同一 V1 契约处理。该规则 SHALL 同时覆盖两个卷、保留 context/Skill 树和 Pi package 制品树，不改变这些树既有的类型与链接限制。树采集代码 SHALL 不读取、编码或修改该标签的值；树恢复代码 SHALL 不从包内恢复该属性、不删除或覆盖目标根标签，新增条目 SHALL 使用目标宿主正常创建对象时赋予的标签。此保证以运行时正常挂载准备后的有效标签为起点；Docker 挂载受管卷时的标签规范化属于宿主策略，不要求整个快照流程维持任意私有 MCS 原值。包格式、树元数据字段、helper 挂载与 SELinux 运行策略 SHALL 保持不变。

除精确名称 `security.selinux` 外，枚举所得的任何非空扩展属性列表 SHALL 导致整次操作以 `SNAPSHOT_STORAGE_UNSUPPORTED` 失败，包括 `user.*`、POSIX ACL、`security.capability`、其他 `security.*` 和相似前缀名称；与 SELinux 标签并存的未支持属性也 SHALL 失败。系统 SHALL 不清除这些属性、不静默跳过条目、不发布缺项 Work 或成功快照。

属性枚举发生权限错误、长度变化导致读取失败或其他读取错误时 SHALL 返回 `SNAPSHOT_STORAGE_UNREADABLE`，不能当作空属性列表继续。不能解析为完整、精确允许名称的属性列表 SHALL 拒绝。非空目标根、特殊文件、越界路径、链接跟随、损坏数据、既有资源归属与快照独占条件 SHALL 继续遵循既有拒绝规则，不能因 SELinux 例外而放宽。

#### Scenario: Preserve a development tree

- **WHEN** workspace 含 node_modules/.bin 符号链接、可执行脚本、硬链接和空目录
- **THEN** 导入后文件字节、执行位、链接目标/关系和目录均保留，普通开发命令可使用这些依赖

#### Scenario: Do not follow an external link

- **WHEN** workspace 内的符号链接指向 /etc 或另一个卷路径
- **THEN** 导出保存 link target 字符串而不读取目标；导入不经该链接写文件

#### Scenario: Reject an unsupported entry honestly

- **WHEN** 私有卷有残留 socket 或 v1 无法保留的 xattr
- **THEN** 整个 export 失败并指出安全的相对字段/路径标识，不删除该条目也不产生成功的缺项快照

#### Scenario: 在启用 SELinux 的宿主恢复数据卷

- **WHEN** Fedora 宿主为源文件或新的目标卷自动赋予 `security.selinux` 标签
- **THEN** 快照捕获与恢复保留普通文件和 POSIX 元数据，目标继续使用自己的 SELinux 策略标签；同时存在的用户扩展属性或 ACL 仍导致整体拒绝

#### Scenario: Independent restore and WAL

- **WHEN** Work 数据库的已提交记录仍在 WAL，包被导入两次
- **THEN** 两份均含这些记录且底层卷不同，改变一份不改变另一份或源卷

#### Scenario: Preserve a stale reference after failed removal

- **WHEN** 一个 tombstone service 的运行时移除失败，源 workspace 卷仍保留该 service 的持久引用
- **THEN** 导出包记录该引用；导入把它映射到新 service ID，两个卷的 Work 引用与引用计数也保持一致，不凭 tombstone 擅自解除

#### Scenario: Do not silently omit another retained volume

- **WHEN** 源 Work 除两个当前布局卷外还有未清除的受管卷或无法映射的消费者
- **THEN** v1 导出整体失败并报告不支持，不生成声称完整的两卷包

#### Scenario: 无标签环境与空树

- **WHEN** 源树没有扩展属性，或源树只有带 `security.selinux` 的空根目录，并恢复到仅有该标签的新空根
- **THEN** 捕获和恢复成功，保留根的规定 POSIX 元数据，不要求增加包字段、伪造文件或移除标签

#### Scenario: 不复制来源标签

- **WHEN** 直接调用树库时源与目标的有效 SELinux 标签不同，源树只含允许类型且无其他扩展属性
- **THEN** 树采集不改变源标签，包不含标签元数据；树恢复后的目标根标签与树恢复前相同，新条目采用目标创建策略标签，文件字节和规定 POSIX 元数据保持一致

#### Scenario: Docker 挂载采用宿主标签策略

- **WHEN** Docker 在启动真实 helper、挂载 named volume 时按宿主策略将私有 MCS 标签规范化为共享 `s0`
- **THEN** 系统不复制来源标签或绕过运行策略以阻止此行为，树处理仅检查规范化后属性名称；符合既有访问条件且只有 SELinux 属性的常规受管卷仍可完整捕获和恢复

#### Scenario: context 与制品树使用相同标签边界

- **WHEN** 合法保留 Skill/context 或 Pi package 制品树的根、目录和普通文件带有 `security.selinux`
- **THEN** export 保留完整内容和绑定，不因标签失败，也不放宽 Skill 禁止链接等既有类型约束

#### Scenario: 标签与用户属性并存

- **WHEN** 源文件或新的目标根同时具有 `security.selinux` 与 `user.snapshot-test`
- **THEN** 操作以 `SNAPSHOT_STORAGE_UNSUPPORTED` 失败，源内容与属性值不变，目标属性不被清除，没有新发布 Work 或成功快照

#### Scenario: ACL 与 capability 仍不支持

- **WHEN** 枚举发现 `system.posix_acl_access`、`system.posix_acl_default` 或 `security.capability`，无论是否也有 SELinux 标签
- **THEN** 整体拒绝且保留原属性，不丢弃它们后宣称完整恢复

#### Scenario: 不采用属性命名空间通配规则

- **WHEN** 枚举发现 `security.selinux.extra`、其他 `security.*` 或未来未知属性
- **THEN** 返回 `SNAPSHOT_STORAGE_UNSUPPORTED`，不能因为前缀或命名空间相同而放行

#### Scenario: 属性枚举不可读

- **WHEN** 读取属性名列表发生权限错误、ERANGE、异常长度或读取失败
- **THEN** 返回 `SNAPSHOT_STORAGE_UNREADABLE`，不产生成功快照、不继续发布导入结果；已分配暂存按既有 journal 清理或明确保持待清理状态

#### Scenario: 属性名列表不能完整解析

- **WHEN** 返回的属性名列表包含空名称、缺少名称终止符或不能精确识别为允许名称
- **THEN** 拒绝整次操作，不按部分列表忽略未知属性

#### Scenario: 目标带标签不允许覆盖既有文件

- **WHEN** 目标根有 `security.selinux`，但根内已有文件或目录
- **THEN** 恢复仍按既有非空目标规则失败，原文件和目录保持不变，树处理不修改正常挂载准备后的标签

#### Scenario: 真实 helper 完成再次搬迁

- **WHEN** 在 SELinux Enforcing 宿主通过真实 snapshot helper 导出合法 stopped Work，再导入到兼容安装并再次导出、导入
- **THEN** 每次完整安装仅发布新的 stopped Work，两个卷、context/制品和全部引用闭包完整，不执行包内代码；源与目标宿主标签按各自 Docker 挂载及普通创建策略保持有效，不要求私有 MCS 原值跨挂载保持不变

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
