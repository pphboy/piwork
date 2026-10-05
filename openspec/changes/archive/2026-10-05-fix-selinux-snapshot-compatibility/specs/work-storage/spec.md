# Work 存储规格增量

## MODIFIED Requirements

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
