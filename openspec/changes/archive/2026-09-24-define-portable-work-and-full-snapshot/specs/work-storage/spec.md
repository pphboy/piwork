# Spec Delta

## ADDED Requirements

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
