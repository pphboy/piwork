## MODIFIED Requirements

### Requirement: 初始化并核验 Go Core 持久存储

**Identifier:** CST-NATIVE-001

Go Core SHALL 为全新安装建立明确标识为 `piwork-go-core`、schemaVersion=1 的存储，并原子初始化所需业务表、安装身份和约束。该版本标识与 TS Core schema 8/9/10 及独立的 Agent history 版本分离。已支持的 Go 存储 SHALL 保留安装、用户、登录、Work、Operation、网络身份、文件任务及快照/包状态并按现有规则恢复。

不支持的格式、未知版本、损坏 marker 或无法识别的非空目录 SHALL 在执行数据库迁移、创建 Docker 资源和开放业务路由前明确失败，不静默重建、清空、降级或猜测转换。首次初始化中断只允许从可证明属于本次 Go 初始化的未完成记录恢复，不能据此接受任意非空目录。存储锁 SHALL 保证单一 Core 所有者，未持锁进程不得修改存储。

存储身份、版本、完整 schema 和完整性核验 SHALL 使用 SQLite 主库及其有效 WAL 共同构成的一致快照，包含其中已经提交的事务。合法 WAL 尚未完全回填主库 SHALL 不构成不支持格式或数据库损坏；Core MUST 能直接启动，无须用户手工 checkpoint、删除 WAL 或复制重建安装。重启仅恢复已提交状态，未提交事务不得变成业务数据。SHM SHALL 作为可重建的索引状态处理，不作为识别已提交数据的唯一依据；缺少或过期的 SHM 不得阻止合法主库与 WAL 的恢复。

Core SHALL 在取得安装锁并核验路径安全后进行存储预检，通过完整快照核验后才取得原库业务写入能力。拒绝预检 SHALL 保持原目录文件集合及 marker、主库、WAL、SHM 的字节不变；不得为使检查通过而 checkpoint、修复、迁移或丢弃原始数据。必要的临时校验数据 SHALL 私有、仅属于本次检查并在成功、失败或取消后清理，不进入日志、发行包或其他安装。路径、所有权、权限、链接和单实例拒绝约束保持。

首次初始化 SHALL 在确认完整数据库已安全发布后才将 marker 标为 ready。发布依赖 WAL 回填时，回填未完成或结果未知 SHALL 中止本次发布，保留可证明属于该初始化的恢复记录，不把尚未完整发布的数据库当作 ready 存储。

Work 与 service 的稳定网络身份 SHALL 在对应创建/导入事务发布时分配并持久化；Core 完成 recovery 与容器核验之前不得开启网关。业务重启恢复与 `.work` V1 导入仍为必要能力，不因取消历史安装升级而省略。

#### Scenario: 空目录首次启动
- **WHEN** Core 指向新的空数据目录
- **THEN** 初始化合法 Go 存储并启动健康接口，未初始化管理员/runtime 时显示相应状态，不创建默认用户或 Work

#### Scenario: 同格式重新启动
- **WHEN** Go Core 重启并读取支持的完整 Go 存储
- **THEN** 使用原安装身份和网络身份恢复，不重新分配 Work 域名、不清空 Operation 或配额

#### Scenario: 拒绝旧开发目录或未知版本
- **WHEN** 目录含旧 TS 数据、未知 Go schemaVersion 或无合法 marker 的非空库
- **THEN** 启动非零退出并说明应使用独立支持的数据目录，原数据及 Docker 资源不被修改

#### Scenario: 初始化中断或第二个所有者
- **WHEN** 初始化事务中断后重试，或另一进程已持有目录锁
- **THEN** 前者仅恢复可证明属于 Go 的未完成初始化，后者拒绝；两种情况均不产生部分可用的业务库或并行写入者

#### Scenario: 有效 WAL 尚未完全回填主库
- **WHEN** schemaVersion 1 的安装具有有效已提交 WAL，主库单独检查失败而包含 WAL 的完整快照通过核验
- **THEN** Core 直接打开并恢复最新已提交数据，保留安装身份和业务记录，不误报存储格式不支持，也不要求手工修复

#### Scenario: 缺少或过期 SHM
- **WHEN** 合法主库和有效 WAL 保留，但 SHM 缺失或不再反映该 WAL
- **THEN** Core 根据完整快照核验并恢复，允许重建索引状态，不丢弃 WAL 内的已提交事务

#### Scenario: 已提交与未提交事务并存后进程中断
- **WHEN** 独立 Core 进程提交数据后又在后续未提交事务期间被强制终止
- **THEN** 下一进程保留并恢复已提交数据，未提交数据不可见，不重新创建安装或更换 schemaVersion

#### Scenario: WAL 中的身份或 schema 不受支持
- **WHEN** marker 和主库单独看似受支持，但包含 WAL 的完整快照具有身份不匹配、未知版本或不受支持的 schema
- **THEN** Core 在取得原库业务写入能力前拒绝，不开放业务或创建 Docker 资源，原目录和全部数据库伴随文件保持不变

#### Scenario: 完整快照损坏或预检无法完成
- **WHEN** 完整快照未通过完整性检查，或读取、临时校验、取消导致预检无法确认
- **THEN** Core 安全失败并清理本次临时资源，不改写原目录，不退回忽略 WAL 的检查，不把未知结果当作成功

#### Scenario: 首次初始化的 WAL 回填未确认
- **WHEN** 首次初始化在发布数据库前无法确认必要的 WAL 回填完成
- **THEN** 本次启动失败且不发布 ready marker；后续仅按原初始化归属规则重试，不接受任意非空数据目录

### Requirement: Shut down Core without destroying running Works

Core 收到 SIGINT、SIGTERM，或因 Docker Compose stop/down/重建进入正常关闭时 SHALL 关闭 HTTP/runtime mutation 与文件准入、停止接受新任务、撤销 readiness、停止生命周期调度，并在既有有界关闭流程内排空执行、收尾文件/快照/package 任务及停止本安装全部受管 Work 的 Agent、附属 Service 与平台 helper。正常关闭成功前 MUST 确认所有受管 Work 运行容器已经停止；不得要求或承诺这些 Work 在 Core 退出后继续运行。某 Work 的 drain 或停止失败 SHALL 不阻止尝试关闭其他受管 Work。

关闭 SHALL 保留 Work 记录、desiredState、Service 启用意图、配置、历史及匹配数据卷，不把 Core 退出隐式转换为用户的 Work stop/delete。默认 drain 30 秒、终止确认 10 秒和 Core 进程总预算 45 秒保持，Docker Compose 提供 60 秒关闭窗口。未确认关闭或超出预算 SHALL 非零退出并提供安全的未完成诊断及恢复记录，不报告正常关闭成功；关闭 SHALL 释放 listener 和 store 锁。SIGKILL、进程崩溃或断电不执行完整正常关闭流程，不得据此记录所有 Work 已停，重启沿用持久意图和资源归属恢复；本变更不新增进程外监护机制。CLI 退出 SHALL 不停止 Work。

正常关闭成功 SHALL 同时确认存储收尾完成，包含必要的 WAL checkpoint 结果和数据库句柄关闭。checkpoint 返回 busy、回填未完成、执行错误或关闭预算耗尽 SHALL 使本次关闭成为未确认并非零退出，不能仅因 SQL 调用未返回错误而报告成功。存储收尾 SHALL 使用统一关闭流程的剩余预算，不额外重置或延长总预算；失败仍须尝试释放本次句柄及安装锁，保留主库和 WAL 中的已提交状态供下一次启动恢复，不删除 WAL 伪造完成。

最终 `app.shutdown` 事件 SHALL 在存储结果已知后记录，反映当时已经确认的 Work 与存储关闭结果；存储未确认时结果 SHALL 为 unconfirmed，不得预先记录 succeeded。日志记录和同步关闭失败 SHALL 传播到非零退出及安全控制台诊断，不承诺向已经失败的日志设施补写结论。安装所有权 SHALL 保持到存储与日志收尾均已尝试完成，避免旧进程尚在收尾时另一 Core 写入同一安装。

#### Scenario: Stop Core and reopen its store
- **WHEN** 具有运行中 Work 和附属 Service 的 Core 收到 SIGTERM 并正常关闭成功
- **THEN** 全部受管 Agent/Service 运行容器已确认停止，数据及运行意图保留，进程在预算内退出，新 Core 能打开同一 store 并按意图恢复

#### Scenario: Bound a stalled shutdown
- **WHEN** 接受中的请求、任务或受管容器无法在关闭期限内完成或确认停止
- **THEN** Core 仍尝试关闭其他 Work，并以非零退出和安全未完成诊断结束，不无限等待、不谎报所有 Work 已停

#### Scenario: Stop Core through Docker Compose
- **WHEN** 用户执行发行手册的 Core stop/down 或 force-recreate
- **THEN** Core 经正常关闭流程停止全部受管 Work，保留目录和卷；重建启动后仅恢复期望 running 的 Work 及启用的 Service

#### Scenario: Abrupt Core loss is not confirmed shutdown
- **WHEN** Core 被 SIGKILL、崩溃或失去电源
- **THEN** 不宣称已确认关闭全部 Work，后续 Core 核对原资源并恢复持久意图，不重提历史 Run 或操作未知归属资源

#### Scenario: Preserve service selection through shutdown
- **WHEN** 一个 Work 含 enabled 服务和 disabled 服务，Core 优雅退出后再次启动
- **THEN** 只恢复 desired-running Work 中的 enabled 服务，退出过程不改写这些选择或删除数据

#### Scenario: 读事务阻塞关闭 checkpoint
- **WHEN** 独立读事务使 WAL 无法在关闭剩余预算内完成回填，SQL 执行返回结果行而非调用错误
- **THEN** Core 非零退出且最终 app.shutdown 为 unconfirmed，保留有效 WAL 并释放自身安装所有权；读事务释放后，新 Core 无须手工 checkpoint 即可恢复最新已提交状态

#### Scenario: 存储失败发生在 Work 已停止之后
- **WHEN** 所有受管 Work 已确认停止，但存储 checkpoint 或句柄关闭失败
- **THEN** 最终关闭记录和退出状态如实表达存储未确认，不遗留较早的整次关闭 succeeded 结论，不修改 Work 的持久运行意图

#### Scenario: 存储收尾时关闭预算已接近耗尽
- **WHEN** Work 或协调任务已消耗大部分总关闭预算
- **THEN** 存储收尾只使用剩余预算，取消或超时后有界返回未确认并继续资源释放，不追加独立的完整等待窗口

#### Scenario: 内部事务回调阻塞关闭
- **WHEN** 内部读写事务的回调持续阻塞，无法在关闭剩余预算内结束，或并发关闭调用者的 context 到期
- **THEN** 关闭调用有界返回未确认，取消未完成事务且旧回调不得继续执行 SQL 或提交；安装锁保持到实际数据库清理及最终日志收尾均已尝试完成，已提交数据可由下一 Core 恢复，预算内正常结束的事务仍可提交

#### Scenario: 日志收尾期间保持单一所有者
- **WHEN** 原 Core 已结束数据库操作但仍在写入最终事件或关闭日志，另一 Core 尝试打开同一目录
- **THEN** 第二个 Core 仍被目录锁拒绝且不写入原安装；原 Core 收尾结束并释放锁后，新进程才可取得所有权
