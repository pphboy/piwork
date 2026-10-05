# SELinux 冷快照兼容验收

本流程对应 `fix-selinux-snapshot-compatibility` 的 `WSTOR-SNAPSHOT-001`。验证对象是可移植内容与宿主标签的边界：仅允许精确名称 `security.selinux`，树采集／恢复代码不读写或迁移其值；其他属性或属性枚举失败仍整体拒绝。Docker 正常挂载时的标签规范化归宿主策略，任意私有 MCS 原值跨挂载不变不在保证范围。所有实物操作使用新测试目录、卷和独立安装身份。

## 范围与先决条件

适用触发条件是树检查能枚举到 SELinux 标签，单一宿主上的结果不能视为所有发行版验收。目标宿主必须真实运行 SELinux Enforcing，支持可见的标签和 Docker 本地受管卷。测试需要可设置专用目录标签的权限；Python 3、Docker CLI、`setfacl`/`setcap` 仅供开发验收使用，产品 Core 和原生 helper 不依赖这些工具。

使用配套 Core 与 snapshot helper 修订。Agent 使用固定 acceptance 镜像，file helper 使用固定原生镜像，模型为测试驱动的确定性 profile，不读取部署环境的模型 key 或登录凭据。Go 构建使用 1.25.5、`CGO_ENABLED=0`；生产宿主没有 Go 时，可以在开发机编译相同用例的原生测试二进制后传至目标宿主执行。

Core 集成测试的临时目录应预先按目标宿主授权策略设置 `container_file_t`，供正常 helper bind mount 访问。只标注专用测试父目录，不递归 relabel 用户卷或现有 Core 数据。临时目录和文件保持原测试/程序权限，执行环境使用 `umask 022`，避免把新文件权限问题混入标签兼容验收。

## 局部回归

```bash
CGO_ENABLED=0 go test ./internal/snapshottree ./internal/workpackage ./internal/snapshothelper ./internal/coreapp -count=1
```

该命令覆盖精确属性名称、混合属性、异常枚举、用户属性保护、Skill 链接约束、制品硬链接表示，以及既有 V1 golden 包字节与验证结果。`TestSELinuxHostLabelsAndOwnedTrees` 在无 opt-in 环境明确跳过；它的跳过不能作为平台验收通过。

`TestTreePreservesCommittedWALAndIndependentRestores` 使用真实 SQLite WAL，关闭自动 checkpoint，在没有事务或其他写入者的 fixture 中捕获，验证两份恢复包含原 WAL 字节及已提交记录，修改一份不影响另一份或来源。该用例已在本机和真实 Enforcing 宿主执行通过。`TestSnapshotVolumeClosureRejectsExtraRetainedVolumesAndUnknownConsumers` 验证额外保留卷和无法映射的消费者整体拒绝，卷记录及引用不被清理或遗漏。

## 真实标签与 helper

在 Enforcing 宿主的专用测试目录执行：

```bash
PIWORK_TEST_SELINUX=1 CGO_ENABLED=0 go test ./internal/snapshottree -count=1 -v
python3 scripts/verify-selinux-snapshots.py \
  --helper-image "$PIWORK_TEST_NATIVE_SNAPSHOT_HELPER_IMAGE" \
  --evidence /path/to/test-evidence/helper-selinux.json
```

Go 平台用例用不同有效标签覆盖普通卷、空卷、Skill 与制品树，验证源标签不变、目标根标签保留、新对象标签匹配目标普通创建策略、POSIX 元数据一致，以及标签值变化不改变树摘要。helper 脚本使用真实原生镜像，固定解析后的镜像 ID，创建带 `piwork.installation_id=piwork-test-<uuid>` 的受管卷和容器；运行时仍受 SELinux 策略约束，不启用 privileged。

helper 脚本按既有 helper 安全配置验收共享 `container_file_t:s0` 的常规受管卷，核验完整文件树、空卷、外部链接、硬链接、目标用户属性保留、非空目标保护，以及用户属性、access/default ACL、文件 capability 的实物拒绝。不同有效标签的保留保证由直接树库用例验证。每项结果和精确清理状态写入 JSON；工具缺失会明确记录 skipped，整次结果为 incomplete，不能宣称全部通过。清理前逐个 inspect 核对安装标签，不执行 prune 或模糊匹配删除。

已有真实 Docker 验收观察到：专用 named volume 根在 create 前后均为 `container_file_t:s0:c11,c12`，启动挂载它的 helper 后变为 `container_file_t:s0`，即使使用 `volume-nocopy` 也如此。这个变化在树处理前发生。按常规受管卷兼容验收，标签比较需明确是在直接树调用前后，还是 Docker 正常挂载策略下进行，并记录本次 Engine 版本及实际标签。

## Core 完整搬迁与失败收尾

按既有测试文档配置以下变量：`PIWORK_TEST_NATIVE_AGENT_IMAGE`、`PIWORK_TEST_NATIVE_FILE_HELPER_IMAGE`、`PIWORK_TEST_NATIVE_SNAPSHOT_HELPER_IMAGE` 与 `PIWORK_TEST_DOCKER_HOST`。执行：

```bash
go test -mod=readonly -tags=integration -count=1 -v -timeout=20m ./internal/coreapp \
  -run '^(TestNativeCoreExportsCompleteStoppedWorkAndDownloadsSameSnapshot|TestNativeSnapshotMovesServicesContextsAndPackagesBetweenOfflineInstallations)$'
```

两个用例须真实运行，不得以 skipped 记为通过。它们覆盖静态完整恢复、历史及 context/制品、目标独立身份、stopped 发布、原文件/服务行为、离线制品恢复和故障后的 Work/名称/配额/卷收尾。再次导出/再次导入、显式启动后的共享读写和真实未支持属性失败，补充在同一独立测试安装验证；结果需记录 Operation 终态与精确资源归属。

离线搬迁用例已加入再次导入断言：复用再次导出的包，先验证新 Work 为 stopped、未创建 Agent／Service 容器，再显式 Start 比较原有与新增 Session 的消息，最后再次 Stop。Session API 要求 Work ready，历史比较因此在显式启动后执行。真实属性失败另执行 Linux opt-in 用例：

```bash
PIWORK_TEST_SELINUX=1 go test -mod=readonly -tags=integration -count=1 -v -timeout=12m ./internal/coreapp \
  -run '^TestNativeSELinuxSnapshotRejectsUserAttributesAndRetries$'
```

该用例在所属 workspace 的文件上添加 `user.snapshot-test`，验证持久错误、原字节、POSIX 元数据和标签／用户属性值，确认 journal 为 cleaned、没有活动包或包文件，并以新 key 成功重试。失败包记录可按既有 GC 规则保留为 expired；它不代表成功快照或未释放 gate。

跨机器可在开发机用相同 build tags 生成测试二进制：

```bash
CGO_ENABLED=0 go test -mod=readonly -trimpath -c -o snapshottree.test ./internal/snapshottree
CGO_ENABLED=0 go test -mod=readonly -trimpath -tags=integration -c -o coreapp.test ./internal/coreapp
```

将测试二进制传至架构匹配的 SELinux Enforcing 宿主，执行 `snapshottree.test -test.v -test.count=1` 和带相同 `-test.run`、`-test.timeout=20m` 的 `coreapp.test`；前者设置 `PIWORK_TEST_SELINUX=1`。`-trimpath` 构建的后者需在测试工作目录提供 `piwork/fixtures/pi-packages/tools-v1`，并保持既有固定 fixture 字节。传输方式由部署环境决定，不需要在目标宿主安装用户 CLI。

## 规格与交付记录

`WSTOR-SNAPSHOT-001` 的完整标签、属性和生命周期边界已同步到主规格，共 18 个场景，其他存储要求保持。源码范围限于树库属性检查及回归，不调整 Desktop、登录、Docker 镜像后端或 V1 schema。

变更采用 spec-driven 流程，17/17 项任务已完成，规划文件已归档至 [归档方案](../openspec/changes/archive/2026-10-05-fix-selinux-snapshot-compatibility/proposal.md)，原规格增量和任务证据一并保留。

交付前确认快照任务和清理 gate 已收尾，配套切换 Core/helper 并记录二进制 SHA-256、镜像 ID、备份和 Core 健康状态。回退在独立测试安装验证，仅恢复二者版本，保留已成功导入的 Work、卷、包和 Operation；旧版本重新拒绝标签是已知能力限制。

宿主目录授权及配套部署条件见 [SELinux 宿主上的 Core](selinux.md)。具体安装的版本、测试结果和回退路径保存在部署者控制的私有验收记录中。凭据、模型 key、用户文件或原包内容不得进入普通验收日志。

## 本次规格场景对应证据

下表对应变更增量的全部 18 个场景；英文场景名保留原规格的匹配标识。局部用例已在本机执行；真实标签、helper 和 Core 集成用例已在 SELinux Enforcing 宿主执行，平台结果没有以 skipped 代替。后续部署须记录自身的宿主、版本和执行结果。

| 规格场景 | 已执行证据 | 结果 |
| --- | --- | --- |
| Preserve a development tree | 树库字节／mode／mtime、空目录、符号链接和硬链接回归；`helper-selinux.json` 完整树恢复；Core 文件与服务共享计数 | 通过 |
| Do not follow an external link | 树库外部／悬空链接回归、Skill 禁止链接断言；真实 helper 保存外部 target 字符串且不读取目标 | 通过 |
| Reject an unsupported entry honestly | 树库特殊类型与真实用户属性拒绝；helper 四类未支持属性；`core-attribute.log` 整体失败、源保护及无成功包 | 通过 |
| 在启用 SELinux 的宿主恢复数据卷 | `tree-selinux.log` 四类真实标签树；`helper-selinux.json` 八项实物检查；两项指定 Core 完整测试 | 通过 |
| Independent restore and WAL | `TestTreePreservesCommittedWALAndIndependentRestores` 在本机和 Enforcing 宿主保留真实已提交 WAL、两份恢复及修改隔离；Core 独立卷／Session 副本 | 通过 |
| Preserve a stale reference after failed removal | 离线搬迁用例在 Start 前核验 tombstone service 持久引用、映射后新 ID 及两个卷的引用计数 | 通过 |
| Do not silently omit another retained volume | `TestSnapshotVolumeClosureRejectsExtraRetainedVolumesAndUnknownConsumers` 两个子场景整体拒绝，卷登记和引用前后完全相同 | 通过 |
| 无标签环境与空树 | 本机无标签树回归、Enforcing 宿主空卷直接树用例和 helper 空根恢复 | 通过 |
| 不复制来源标签 | 四类直接树用例使用不同有效 MCS；源值不变、目标根保留、子项与普通创建对照一致，改变来源标签不改变树摘要 | 通过 |
| Docker 挂载采用宿主标签策略 | `docker-label-observation.json` 记录正常挂载前后 private MCS→共享 `s0`；真实 helper 按既有挂载和安全配置完整恢复 | 通过 |
| context 与制品树使用相同标签边界 | `CaptureOwned` 类型约束回归；Skill／制品树真实标签用例；Core 离线 context 和多个版本包恢复 | 通过 |
| 标签与用户属性并存 | helper 来源用户属性、目标用户属性值保护；Core 真实带标签 workspace 整体失败及新 key 重试 | 通过 |
| ACL 与 capability 仍不支持 | 精确名称策略单元测试；helper 的真实 access/default ACL 与 capability 拒绝，原属性保留，无跳过 | 通过 |
| 不采用属性命名空间通配规则 | 名称策略测试覆盖相似 SELinux 前缀、未知 `security.*` 和其他非允许名称 | 通过 |
| 属性枚举不可读 | 枚举测试覆盖查询／读取权限错误、ERANGE、负长度、超过 64 KiB 和返回值超出缓冲区；均为 UNREADABLE | 通过 |
| 属性名列表不能完整解析 | 空名称、缺少终止符和夹杂未知名称的枚举测试；均整体拒绝 | 通过 |
| 目标带标签不允许覆盖既有文件 | 非空目标单元回归和真实 helper 检查；原文件、根元数据及有效标签不被树处理修改 | 通过 |
| 真实 helper 完成再次搬迁 | `core-mapping.log/json` 真实 export/import/re-export/re-import；独立 stopped、Start 前无执行容器，Start 后文件／服务／历史完整 | 通过 |

每次验收记录完整命令、最终退出码、版本摘要、镜像身份和精确资源清理结果；失败或 skipped 不计入通过。专用 Work 的 Delete 按产品契约保留卷登记和持久数据，不能把默认留存误判为失败或写数据库伪造 purge。需要清理 fixture 时，按安装／Work 标签及零引用核验精确删除。

独立安装的回退验证应覆盖旧配套启动、数据保留、已知标签拒绝，以及恢复修复配套后成功导出。逐场景核对、源码边界检查和严格 OpenSpec 校验分别记录，不能以历史验收替代当前部署检查。
