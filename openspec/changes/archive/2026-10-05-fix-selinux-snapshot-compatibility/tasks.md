# SELinux 冷快照兼容任务

第 1 组记录 explore 之前的临时修复；第 2–4 组按 apply 阶段实际执行证据更新，未勾选项仍待完成。所有任务对应 `WSTOR-SNAPSHOT-001`，关联场景在各项中注明。用户已批准将标签不变保证限定在树处理代码，Docker 正常挂载规范化属于宿主策略。

## 1. 已有临时修复与事故证据

- [x] 1.1 将文件描述符和链接自身检查调整为仅允许 `security.selinux` 名称，添加空属性、单标签、混合用户属性、ACL、capability、相似名称与枚举错误测试；已通过 `CGO_ENABLED=0 go test ./internal/snapshottree ./internal/workpackage ./internal/snapshothelper`，对应“标签与用户属性并存”“ACL 与 capability 仍不支持”“属性枚举不可读”。
- [x] 1.2 添加 `TestRestoreRejectsTargetUserXattrs` 并核验失败后目标 `user.snapshot-test` 的原值仍为 `keep`；同批测试通过，对应目标属性不删除及恢复失败保护。
- [x] 1.3 在包格式说明和未提交主规格中记录宿主标签例外；已检查差异确实说明不迁移标签、保留目标策略及继续拒绝其他属性，对应“不复制来源标签”。2.5 已完成差异核对与记录，最终主规格同步由后续标准 sync/archive 流程处理。
- [x] 1.4 将 Core 和 helper 热修部署至 Fedora，并复用原上传包完成导入；既有重试记录为 succeeded、`Kanban Fedora` 当时为 stopped，explore 阶段只读核验 helper 镜像 ID 和 Enforcing 状态，详见 design.md 证据表，对应“在启用 SELinux 的宿主恢复数据卷”。

## 2. 正式化源码与局部回归

- [x] 2.1 补齐名称策略及有界枚举测试：default ACL、未知 `security.*`、空名称、查询/读取负长度、超过 64 KiB、返回长度超过缓冲区；执行 `CGO_ENABLED=0 go test ./internal/snapshottree -count=1`，断言未支持名称为 UNSUPPORTED、读取/长度错误为 UNREADABLE，对应“属性名列表不能完整解析”“不采用属性命名空间通配规则”“属性枚举不可读”。
- [x] 2.2 补齐真实文件树的用户属性拒绝及原内容保护测试，覆盖普通文件、子目录、目标根和非空目标；运行树库测试并比对失败前后字节、属性值、根元数据，复用外部链接及硬链接回归，对应“标签与用户属性并存”“目标带标签不允许覆盖既有文件”“保留开发文件树”“不跟随外部链接”。
- [x] 2.3 对 `CaptureOwned` 采集路径加入或补齐标签条件的回归，核验 Skill 禁止链接和 Pi package 既有表示；运行树库、helper 和 Core 的局部测试，并在第 3 组使用真实标签复验，对应“context 与制品树使用相同标签边界”。
- [x] 2.4 使用 `internal/workpackage/testdata/golden*.work` 执行现有验证/inspect 回归，确认无需重写 fixture 或添加字段；运行 `CGO_ENABLED=0 go test ./internal/workpackage ./internal/snapshothelper ./internal/coreapp`，核对非空目标、损坏 blob 和特殊文件仍拒绝，对应 V1 兼容和既有拒绝边界。
- [x] 2.5 核对热修涉及的两个代码文件、包格式说明与本规格增量的一致性；完善说明中的属性边界、Enforcing 验收方法与本次适用范围，记录未提交主规格相对基线的差异以供后续标准同步；以 `git diff` 和 `openspec validate fix-selinux-snapshot-compatibility --strict` 验证没有夹入 Desktop、登录、Docker 后端或其他属性迁移变更，对应完整元数据边界。

## 3. SELinux Enforcing 平台验收

- [x] 3.1 在独立安装身份的 Fedora 43 Enforcing 测试环境准备与 Core 同修订的 snapshot helper，按 `docs/go-migration-acceptance.md` 配置固定 Agent/file helper 与 Docker endpoint；记录 `getenforce`、平台、镜像 ID 和测试根可见的 `security.selinux`，确认用例不是无标签环境的跳过结果，对应“在启用 SELinux 的宿主恢复数据卷”。
- [x] 3.2 通过真实 helper 在采用正常共享 `s0` 标签的专用受管卷捕获／恢复空树、文件、子目录、链接和元数据；比较正常挂载策略下的标签和目标普通创建对照对象。直接树库另用不同有效源／目标标签验证源不变、目标根保留及标签值不影响树摘要；Fedora 的四类直接树用例及 helper 八项检查全部通过，清理完成。记录 Docker 启动时的私有 MCS 规范化事实，不改 helper 挂载或权限；对应“无标签环境与空树”“不复制来源标签”“Docker 挂载采用宿主标签策略”“不跟随外部链接”。
- [x] 3.3 Fedora Enforcing 上以同 build tags 的原生测试二进制真实执行两项指定 Core 用例，完整导出／导入用例 132.24s 通过，包含再次导入的离线搬迁用例 508.84s 通过；卷／context／制品闭包、stopped 发布、失败 Work／名称／配额／卷收尾均有断言，未跳过。证据为 `core-snapshot-complete.log` 的指定成功段及 `core-mapping.log/json`，对应完整恢复及失败原子性场景。
- [x] 3.4 离线搬迁用例完成真实 export/import/re-export/re-import，每次先断言独立 stopped Work；再次导入在显式 Start 前确认无 Agent／Service 容器，Start 后比较原有与新增 Session 消息并再次 Stop。原文件、服务共享计数、制品与独立副本均通过；另以真实 SQLite WAL 的两份恢复验证已提交记录及修改隔离（本机与 Fedora 均通过）。仅使用专用身份及新 key，对应“真实 helper 完成再次搬迁”“独立恢复并保留 WAL”。
- [x] 3.5 在专用源树实际设置用户属性及 access/default ACL、capability，真实 helper 四类拒绝均通过且源属性／内容不变；名称策略与实物测试无跳过。Core 独立属性用例通过：失败 `operation-9bf9d89a0741b707ec6482a8a720518b` journal 为 cleaned、锁和未清理制品为零；新 key 重试 `operation-f7ae27f7c4caa04b0ea53cc8b30584f0` succeeded。版本、标签、Operation 终态和 expired 记录的 GC 边界已写入部署验收记录，对应“不静默遗漏”“ACL 与 capability 仍不支持”及失败清理。

## 4. 配套交付与回退验证

- [x] 4.1 通过 Windows SSH 完成同修订 Core/helper 配套切换；Core SHA-256 为 `5c4a99b1…`，helper 不可变镜像 ID 为 `f825c154…`，正式备份位于 `/opt/piwork/deployment/selinux-590f86d35331-verified/`。`deployment-verification.json` 为 passed：切换前后 gate 均为零，运行进程身份、health/ready、专用源导出及 stopped 副本导入通过；另一个独立导入副本显式 Start 后读回原字节并 Stop。三个验收 Work 已删除并精确移除其无引用 fixture 卷，保留 Delete 的留存登记语义；四个服务 active、Enforcing，现有 Work 身份、配置和期望状态不变，对应配套政策及 stopped 发布。
- [x] 4.2 独立安装 `piwork-test-0ea28c0b-78a4-4996-adb5-d343ec28d0f2` 的实际进程回退通过：先让修复配套完成普通启动收尾，再切换旧 Core（`e4910143…`）与旧 helper（`f2ccc8e7…`），保留 stopped Work、两个卷、原包、文件摘要和 14 条导入历史。旧导出 `operation-407009917bea3dc046ee7f5ef50ed5f2` 按预期拒绝标签；恢复修复配套后 `operation-2eb2575d43e7173c4f439a69e5175dc3` 导出成功。`rollback.json` 记录全部结果及精确资源清理，对应既有数据保护与独立恢复。
- [x] 4.3 部署记录已包含实际配套发布身份、Enforcing 结果、备份、独立回退和正式 smoke；验收说明为全部 18 个规格场景逐项列出已执行证据，平台必需用例无跳过。Windows 证书校验的四个外部端点均 HTTP 200，防火墙三端口 runtime/permanent 均开放；16 个专用安装身份的容器／卷／网络无残留。仅含受管源码与本次修改的干净副本通过 native source boundary，`git diff --check` 和 `openspec validate fix-selinux-snapshot-compatibility --strict` 通过。历史失败尝试、Delete 留存和 Docker 标签策略边界均如实记录；主规格后续经标准 verify/sync/archive 流程整理。
