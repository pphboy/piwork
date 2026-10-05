# SELinux 冷快照兼容设计

## Context

动机和范围见 [proposal.md](proposal.md)。本方案将会话中已有的未提交临时修复转为可评审设计；方案文件的完成不代表已执行正式发布，也不代表下列补充验收已通过。

### 触发条件与普遍性

旧版本 `internal/snapshottree/capture_linux.go` 的文件描述符和符号链接检查只查询扩展属性名列表长度，长度非零就返回 `SNAPSHOT_STORAGE_UNSUPPORTED`。`restore_linux.go` 在向新空根写入任何条目前复用该检查。Fedora 新 Docker 卷虽然没有用户文件，仍可具有宿主赋予的 `security.selinux`，因而会稳定触发该拒绝。

这是一类有明确条件的兼容问题：只要旧代码能够枚举到这个标签，就可能影响 import/export；不能概括为所有 Linux 或每个 SELinux 安装必然失败。本次实测是 Fedora 43、SELinux Enforcing、Docker 29.6.2、overlay2；其他发行版的相同风险由代码条件推得，尚未做跨发行版实测。无可见标签的环境不会因这一属性触发故障。

SELinux 将文件安全上下文存为扩展属性，这是宿主访问控制机制的一部分。[Fedora 官方说明](https://fedoraproject.org/wiki/SELinux/SecurityContext)。Permissive 模式仍创建标签，因此 `setenforce 0` 不会消除“属性存在”这一条件。[Red Hat 官方说明](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/using_selinux/changing-selinux-states-and-modes_using-selinux)。本次拒绝是应用的元数据策略判断，与内核 AVC 权限拒绝需要分别诊断。

### 已有证据

| 项目 | 已观察结果 |
| --- | --- |
| 原包 | 755,394,377 字节；SHA-256 `c05e224c1fa670208612d9d99931a0e3f3feb6b63041ed644d6d024c199c014a`；上传完成并通过包验证 |
| 原导入 Operation | `operation-c684f7095b0c935461dae26489bb24f5`，failed，持久错误 `SNAPSHOT_STORAGE_UNSUPPORTED`，阶段 runtime-prepare，未发布 Work |
| 属性证据 | Docker 卷根可枚举到 `security.selinux`，值为 `system_u:object_r:container_file_t:s0`；旧恢复检查会拒绝该根 |
| 临时修复 | 精确允许该属性名；新增白名单和目标用户属性保护测试；修改包格式说明及主规格中的标签边界文字 |
| 单元验证 | `CGO_ENABLED=0 go test ./internal/snapshottree ./internal/workpackage ./internal/snapshothelper` 已通过；静态树测试二进制曾在 Fedora Enforcing 运行通过 |
| 修复交付 | 已替换 Fedora Core 与 helper；helper 为 `piwork-snapshot-helper:server-590f86d35331-selinux`，镜像 ID `sha256:f825c154f76ae096f717538e72cde1428a7545a6c5c873e7de31cc06aa4c3d6e` |
| 原包重试 | 复用 `package-07a095ee-584f-4774-b2d5-2b95ea0c1e80`；`operation-83906a69b97843dc6263e556eba652b6` succeeded；发布 `work-202f61b9-a802-4610-bbf4-f8d67f7286df`，名称 `Kanban Fedora`，stopped |
| explore 阶段再核对 | 当时仅通过 Windows SSH 只读检查既有重试记录、helper 镜像身份和 `getenforce`，仍为 Enforcing；该阶段没有再运行导入、导出或部署 |

上述真实导入证明该修复解决了本次恢复阻塞，不能代替完整平台和生命周期验收。apply 阶段已补充树库在 Enforcing 下的不同标签实测；真实 helper 和 Core 的常规受管卷闭环结果以验收及部署记录为准。

### apply 阶段确认的保证边界

Fedora Docker 29.6.2 实测：专用 named volume 根在 create 前后均为 `container_file_t:s0:c11,c12`，启动挂载它的 helper 后成为 `container_file_t:s0`；`volume-nocopy` 不阻止这一挂载时规范化。该行为发生在树处理开始前。直接树库测试则已在不同源／目标 MCS 标签下通过，树库没有读写标签值。

用户已选择修订保证范围并完成常规卷兼容。保证因此限定在树采集／恢复代码：不读取、复制、设置或删除标签值；Docker 自身的正常挂载标签规范化归目标宿主策略。真实 helper 验收使用正常共享 `s0` 受管卷，私有 MCS 不变的断言仅在直接树库测试中成立。本次不改挂载方式，不禁用容器标签，也不扩大 helper 权限。

## Goals / Non-Goals

设计目标是让扩展属性检查表达“无不支持的可移植属性”，而不是“完全没有宿主标签”。检查逻辑集中于现有树库，保证 Core 采集和 helper 卷恢复采用相同政策，并且无需改变包或持久数据结构。

设计边界：不读取、设置或删除 SELinux 标签值，不调用 relabel 工具，不增加 privileged、host mount 或绕过内核权限；`CaptureOwned` 的 Skill 禁止链接、制品硬链接展开及既有冻结表示保持原样。只允许精确的单个名称，不建立 `security.*` 命名空间通配白名单。

## Decisions

### 1. 将宿主标签排除在可移植元数据之外

沿用已有热修方向：仅忽略属性名精确等于 `security.selinux` 的存在。它不进入 V1 树，因此既不会复制来源宿主的策略，也不会形成导入时设置权限的指令。以 Docker 等运行时完成正常挂载准备后的标签为树处理起点，树恢复不改变目标根标签，新条目通过现有文件创建流程获得目标策略标签；创建失败仍如实失败。不得把这个代码保证扩展成整个 import/export 流程的任意 MCS 原值保证。

“完整快照”仍指完整用户内容和已声明的元数据子集，不能将该规则宣传为完整复制任意文件系统元数据。非 SELinux 的 xattr、ACL、capability 继续整体拒绝，保留对数据损失的明确边界。

| 备选方案 | 对本次问题的作用 | 取舍 |
| --- | --- | --- |
| 精确允许 `security.selinux` | 消除空卷和源树标签误拒绝 | 推荐；不改包格式或宿主策略，用户属性仍受保护 |
| 改成 permissive | 标签仍存在，不能修复应用拒绝 | 不采用 |
| 关闭 SELinux或清除标签 | 部分环境可能绕开触发条件，既有标签也可能仍在 | 不采用；依赖宿主状态且改变访问控制或源元数据 |
| `:z/:Z`、`restorecon` | 用于标签和访问许可配置，不消除属性名称 | 按宿主权限问题另行使用，不作为此缺陷的修复 |
| 忽略所有扩展属性 | 可绕过检查，也会漏掉用户属性、ACL、capability | 不采用；违反已有完整性契约 |
| 全面支持扩展属性/ACL | 可作为未来格式能力 | 本次不采用；需要独立定义表示、权限映射和跨宿主策略，不能直接复制来源安全属性 |

Docker 的 `z/Z` 会修改宿主文件标签，语义并非移除扩展属性。[Docker 官方说明](https://docs.docker.com/engine/storage/bind-mounts/#configure-the-selinux-label)。因此换用这些选项或更换 Docker 存储后端不针对本次检查缺陷。

### 2. 保留文件描述符及不跟随链接的边界

普通文件和目录继续通过已固定身份的 fd 调用 `Flistxattr`；符号链接继续使用既有 dirfd 路径和 `Llistxattr`，检查链接自身而不跟随目标。两个入口复用一个属性名称判定函数；不引入递归 shell 命令、不读取用户属性值、不改变既有 inode/mtime/ctime 一致性检查。

先查询列表长度，再有界读取名称列表，按 NUL 分隔逐项比较。查询长度为零正常通过；正长度最多分配 64 KiB。负长度、超出上限、读取返回长度超出缓冲区、权限错误和 `ERANGE` 返回 `SNAPSHOT_STORAGE_UNREADABLE`，不做无界重试或降级放行。空名称、未终止名称和非白名单名称返回 `SNAPSHOT_STORAGE_UNSUPPORTED`。读取期间属性变化导致 syscall 失败时，当前任务失败后走原清理流程，用户可在问题消除后以新幂等键重试。

### 3. 保持格式、恢复与失败语义

V1 manifest、TreeEntry、树版本、framing、hash 和容量限制均不新增字段。相同文件字节和规定元数据在有/无宿主标签时产生相同树表示；该断言通过受控 fixture 比较，不要求不同导出任务的整个 `.work` 文件相同，因为包内已有生成时间和来源事实。

导入仍验证全包，分配新暂存，恢复完整树，最后原子发布 stopped Work。恢复检查只读取目标根属性；对已有用户属性的目标必须先失败，不能删除属性以创造“空”目标。非空根、损坏 blob、恶意路径和特殊文件仍按已有规则拒绝。

```text
verified package --> new staging --> restore trees --> publish stopped Work
                                      |
                                      +--> failure --> journal cleanup

Docker normal mount policy --> effective host labels
source effective label --> name check --> excluded from package metadata
target effective label --> tree restore --> no label writes by tree library
```

复用 `SNAPSHOT_STORAGE_UNSUPPORTED` 与 `SNAPSHOT_STORAGE_UNREADABLE`，不改 API/DTO。当前 `operation_read.go` 会将部分快照错误投影为通用 `WORK_OPERATION_FAILED`；改善用户可见诊断应另立变更。本方案以 helper/持久 Operation 的实际错误和资源结果验收，不声称已修复桌面的错误说明。

### 4. 为真实宿主保留验收证据

常规单元测试不等于 SELinux 平台验证。正式验收应使用可列出真实 `security.selinux` 的 SELinux Enforcing VM/runner；不能将没有该属性的普通容器测试标记为 SELinux 通过。只在专用测试 Work、目录和卷建立 fixture，不再复写用户的 `Kanban Fedora`。

| 验收面 | 固定预期 |
| --- | --- |
| 精确属性策略 | 空列表和仅 SELinux 通过；混合用户属性、access/default ACL、capability、相似名、未知 security 属性全部拒绝 |
| 枚举边界 | 查询与读取错误、ERANGE、异常长度、空名称和未终止名称拒绝；无界分配和静默忽略不可发生 |
| 新根与既有属性 | 带标签的空根可恢复；非空根和带用户属性根拒绝，原文件、用户属性值和规定元数据不变；树处理不修改挂载准备后的标签 |
| 文件类型与元数据 | 卷根、目录、普通文件、符号链接、硬链接、空树及既有字节/uid/gid/mode/mtime 规则通过；外部链接不跟随 |
| 来源/目标策略不同 | 直接树库测试使用经策略允许且测试进程可读的不同有效标签；源标签不变，目标根标签与树恢复前相同，子项符合相同创建上下文的对照对象标签 |
| Docker 受管卷策略 | 真实 helper 按既有挂载和安全配置验收正常共享 `s0` 卷；记录 Docker 对私有 MCS 的启动时规范化，不要求树库阻止宿主行为 |
| Core 自有树 | 带标签的 Skill/context 和制品完整采集；Skill 禁止链接规则仍执行，目标 catalog 不被覆盖 |
| 格式兼容 | 既有 V1 fixture 仍可验证；标签不进入 manifest/tree，除该标签外相同内容的树摘要相同 |
| 正常生命周期 | 真实 helper 完成 export/import/re-export/re-import，发布 stopped，完整卷/制品/引用图保持，不在导入执行包代码 |
| 失败生命周期 | 含未支持属性的专用 Work 导出失败且源未变；拒绝后的暂存有明确归属与清理结果，既有 Work 未变 |

权限限制使真实 ACL/capability fixture 无法设置时，常规测试可以明确跳过该实物用例，但必须保留名称策略测试；正式平台验收必须记录真实支持能力和未执行项，不能据跳过宣布全部完成。

## Risks / Trade-offs

- [仅忽略一个宿主属性，仍不能移植其他属性] → 文档继续列明 V1 限制；未知属性整体拒绝，全面属性迁移另行设计。
- [Core 与 helper 混用修订，卷恢复可用但 context 导出仍失败] → 同修订构建二者，记录二进制摘要和 helper 不可变镜像身份，在接纳快照前完成配套切换。
- [目标标签合法但实际容器访问仍受 AVC 拒绝] → 在专用导入副本显式启动后验证读写与已有服务访问，记录拒绝与标签；按目标宿主部署策略修复，不复制来源标签或扩大权限。
- [将树处理保证误读为整个 Docker 流程的 MCS 原值保证] → 记录启动时的实测规范化；分开验收直接树库与真实受管卷，不把私有 MCS 挂载保真纳入本次交付。
- [已有热修直接改了主规格，规范记录与正式变更不同步] → 以提交前 `WSTOR-SNAPSHOT-001` 为行为基线，保留完整原有场景；后续核对当前未提交文字与本增量的一致性，再由标准同步/归档流程完成主规格整理。本轮不再改主规格。
- [回退二进制后重新出现原拒绝] → 回退不删除已成功导入 Work、卷或用户文件；记录快照能力回退的已知限制，修复版本可再次升级。

## Migration Plan

1. 评审本方案，并将当前两个代码文件、包格式说明和主规格热修对应到此变更；保留无关工作区文件，不自动提交或回退。
2. 补齐上表缺口，运行树库、包验证、helper 和 Core 快照相关测试；完成独立 SELinux Enforcing 平台验收。真实用户导入成功仅作为事故修复证据，不能代替测试副本。
3. 使用同一修订构建 Core 与 snapshot helper，保存二进制 SHA-256、不可变镜像 ID、原 Core 文件与 helper 配置。没有 DB/包格式迁移，也不修改 `.env.test` 中账号、模型和秘密。
4. 确认没有 active snapshot job、临时 worker 或未完成清理后切换；若仍占 gate，等待其终态和收尾，不强制清除。更新 Core 和 helper 配置后重新启动 Core，确保后续任务使用配套版本。
5. 在专用测试副本验证导入为 stopped、完整导出闭环和显式启动后的文件读写；记录 `getenforce`、标签、版本身份和 Operation 终态。运维检查通过 Windows `/mnt/c/Windows/System32/OpenSSH/ssh.exe` 连接目标 Fedora。
6. 如需回退，仅在同样的任务收尾条件下恢复配套 Core 文件及旧 helper 配置并重启；保留新 Work、卷、原包和 Operation 历史。不得重新导入覆盖原 Work，也不得清除标签作为回退步骤。

现有 Fedora 临时修复的 Core 备份为 `/opt/piwork/current/bin/piwork-serve.before-selinux-fix`，环境备份为 `/etc/piwork/env.test.before-selinux-fix`；原始 `.env.test` 另保存在 `/etc/piwork/env.test.original`。备份和重试记录仍按宿主私有权限保管，方案不复制其凭据。后续正式发布更新部署记录，并核对备份路径和镜像实际身份后使用。
