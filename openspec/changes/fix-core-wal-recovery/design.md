# Design

## Context

动机见 [proposal.md](proposal.md)，行为契约见 [规格增量](specs/core-service-startup/spec.md)。本变更涉及存储安全、关闭预算和日志顺序，需要明确设计。

当前源码的相关职责如下：

| 模块 | 当前行为及本次职责 |
| --- | --- |
| `internal/corestore/store.go` | 持安装目录锁，初始化/校验 schema 1，管理读写连接；现有 `Open` 和初始化已发布库分支在写连接前使用 immutable 预检，`Close` 及首次发布前使用 Exec 执行 checkpoint |
| `internal/safefs/root_linux.go` | 校验私有 owner、权限、链接和文件类型，通过已固定目录 fd 访问文件；供预检读取来源使用 |
| `internal/coreapp/application.go` | 排空任务、停止 Work、汇总关闭错误；目前在存储关闭前结束日志 |
| `internal/coreapp/logging.go` / `internal/corelogs` | 记录 `app.shutdown`、同步关闭日志；日志写入不依赖业务数据库，能够在数据库句柄关闭后继续工作 |
| `internal/app/run.go` | 统一 45 秒关闭 context，把应用关闭失败转为非零进程退出；继续承担进程级验收入口 |

已核对的事实：原版 0.0.11（源码 commit `a19c6f595fa6b2515d19146f3510dfc9f1ba4b8c`）在合成数据库上遇到外部读事务时，checkpoint 返回 `(1,131,69)`，约 5 秒后 Core 仍 exit 0。主库单独 quick_check 失败，包含 WAL 的快照通过；释放读锁后原版重启仍 exit 1，诊断副本完成 checkpoint 后同一程序能启动。本机探索输出在 `dist/wal-root-cause/reader-03/result.json`，后续验收必须通过可重复的仓库测试重新建立证据，不依赖该临时目录。

原故障现场的锁持有者仍未知。普通停启及 16 并发 HTTP 请求的对照通过；本设计不假定存在内部读事务泄漏。

有效主规格为 [core-service-startup](../../specs/core-service-startup/spec.md)，同时核对已实现但尚未归档的 [simplify-linux-delivery 增量](../simplify-linux-delivery/specs/core-service-startup/spec.md)：本变更继续使用 `piwork-core` 三参数入口，不引回旧 operator 命令。本次只修改主规格中仍有效的存储核验和正常关闭两个 Requirement，不处理另一变更的同步或归档。

## Goals / Non-Goals

**Goals:**

- 在保留严格拒绝规则的条件下，直接恢复依赖已提交 WAL 的现有安装。
- 让 checkpoint 的真实结果参与最终关闭结论，并在既有预算内释放资源。
- 用同一驱动的真实 SQLite 和独立进程锁验证问题，不依靠模拟的 busy 返回值证明核心场景。

**Non-Goals:**

- 不自行实现 WAL 解码/修复算法，不改变 schema、journal_mode、synchronous 或宿主运行依赖。
- 不通过杀外部读进程、删除 WAL、清空存储或放宽 schema/身份检查解决占用。
- 不把故障现场占锁者溯源设为修复前提；不调整其他 Work 生命周期策略或默认关闭时间。

## Decisions

### 1. 在取得原库业务写连接前验证包含 WAL 的快照

保留目录锁、marker 解析及整目录路径/权限核验作为第一道边界。无非空 WAL 时，继续采用不创建伴随文件的只读主库预检；存在非空 WAL 时，使用私有临时副本进行 WAL-aware 校验：

1. 通过 `safefs.Root` 打开并再次核验来源主库和 WAL，以流式复制写入本次创建的私有临时目录；目录 0700、文件 0600。只复制这两类输入，不复制 operator 凭证、日志、Work 内容或 SHM。
2. 使用现有纯 Go SQLite 在副本上以普通只读、query_only 连接读取完整已提交快照，允许 SQLite 在临时目录重建 SHM。沿用安装身份、metadata/user_version、精确 schema 对象和 quick_check 校验，不先要求原主库单独通过 quick_check。
3. 关闭副本连接、清理全部临时文件，确认校验成功后再打开原安装的 WAL 写连接并按现有流程复核，随后建立业务读池。

`Open` 与初始化中已存在正式数据库的分支共用该预检，避免只修复 ready 分支。临时初始化库的发布继续受原初始化归属规则约束。

普通 `mode=ro` 不保证 SHM 不被创建或重写，直接在原目录换掉 immutable 会破坏现有“拒绝且目录字节不变”的测试契约。`readonly_shm=1` 对缺少 SHM 的恢复还有限制，因此不将其作为本次完整方案。只在需要 WAL 的路径复制，可控制正常干净启动的额外 I/O；不引入自定义 VFS 或手写 WAL 回放。

副本的来源仅来自已检查的固定目录 fd；以固定缓冲流式复制并响应取消，不按数据库大小一次性分配内存。受支持的写入者均须持目录锁；不支持绕过该锁直接写 Core 数据库。复制期间发现来源替换或变化时安全失败，不继续取得业务写连接。磁盘不足、临时目录不可用或校验被取消时清理本次资源并报告安全存储错误，不忽略 WAL 降级启动。SQLite 对未提交/无效尾部的处理沿用驱动自身的提交边界，不把任意 WAL 尾部异常都当作已提交数据损坏。

### 2. 读取 checkpoint 结果，关闭与初始化共用判定

用返回结果行的查询读取 `busy`、`logFrames`、`checkpointedFrames`。只有 busy 为 0 且全部回填和截断已确认才算完成；WAL 模式下 TRUNCATE 正常完成结果为 `(0,0,0)`。busy、计数不完整/异常、无结果行和 SQL 错误均不能当作成功。

关闭使用上层传下的剩余 context，等待不得越过它；保留既有最多 5 秒 busy 等待上限，并受更短剩余预算约束，不额外重试重置计时。无论 checkpoint 结果如何，都尝试关闭读写句柄，汇总错误；已有合法 WAL 保持供下次启动恢复。首次初始化在重命名发布主库前使用同一判定，未确认则不发布 ready marker。

仅修启动而保留 Exec 会继续掩盖关闭结果；仅修 checkpoint 则无法打开已保留的合法 WAL，这两条路径必须一起覆盖。这里将未完成 checkpoint 作为 Core 关闭未确认处理，不把 busy 等同于已提交数据丢失。

### 3. 将数据库收尾与安装锁释放分为两阶段

存储提供内部的“关闭数据库并保留安装所有权”阶段，以及最终释放根目录/锁的阶段。现有完整 `Store.Close` 路径仍承担两个阶段，避免初始化失败或非应用调用者遗漏清理；应用关闭使用两阶段能力，沿用生命周期互斥和幂等状态，保留首次数据库收尾结果。

生命周期互斥只保护准入与关闭状态，不跨越用户事务回调或 SQL 调用。关闭先停止新事务准入，用同一个剩余 context 等待已准入事务；预算耗尽时取消这些事务的专用 context，触发 SQLite 回滚，使仍在非 SQL 代码中阻塞的旧回调无法继续执行 SQL 或提交。写事务继续由单连接写池串行化，等待连接的调用同样响应取消。

事务排空以专用 `sql.Conn` 租约归还完成为依据，不以回调退出或单次 `Tx.Rollback` 返回为依据（并发自动回滚期间，后者可先返回 `ErrTxDone`）。唯一清理者等待实际 SQL/回滚结束后关闭连接池；各关闭调用者在自身 context 到期后有界返回并保留首次未确认结果。最终释放阶段发出释放请求，只有数据库清理确实结束且应用已尝试最终日志收尾后才关闭根目录；若驱动清理仍在进行，持锁清理者完成后自动释放，真实进程退出时仍持有的 fd 由内核释放。这样既不因阻塞回调拖住进程退出，也不允许旧 SQL 与下一 Core 并行写入。

```text
drain requests / stop Works / stop workers
  --> close platform file handles
  --> close readers / checkpoint / close writer (keep installation lock)
  --> aggregate workload + storage outcome
  --> emit app.shutdown / sync and close logs
  --> release installation lock
  --> return final error / process exit code
```

把日志收尾简单移到当前完整 `Store.Close` 后面会提前释放目录锁，允许下一 Core 在旧日志尚未结束时取得安装，因此采用两阶段。日志最终事件沿用 succeeded/unconfirmed 枚举，不新增公开 HTTP DTO 或原始 SQLite 错误输出。若事件写入或日志同步关闭失败，最终返回错误并保留安全 stderr 诊断；不要求向已经失败的日志设施追加记录。最终锁释放错误同样参与退出状态。

Work 停止与现有失败分支仍保持：某阶段失败不阻止尝试其他必要清理，无法确认仍有共享任务运行的早退路径不得被本次重排误改成可安全释放所有权。

### 4. 用合成数据和独立进程锁固化回归

`internal/corestore` 测试用仓库现有驱动生成合法 schema 1 数据，再产生已提交 WAL 与受读事务限制的部分 checkpoint，证明主库单独失败、完整快照通过，并直接用修复后的 `Open` 读回准确值。增加无/空/过期 SHM、已提交与未提交事务、WAL-only 身份/schema 变化及完整快照损坏的场景；拒绝测试比较整个原目录前后文件集合及哈希。

读锁持有者使用独立测试子进程，并以握手通知事务确实已经开始，避免任意 sleep 判定就绪。采样文件或校验状态的观察进程不得在锁持有进程内打开再关闭同一 SQLite/SHM inode，否则 POSIX 的每进程锁语义可能释放测试锁而造成假通过。子进程使用精确 PID 和本次临时目录清理。

`internal/coreapp` 验证存储失败进入最终日志、日志关闭前锁仍被持有，以及短关闭预算不会额外追加 5 秒。内部读写回调持续阻塞的用例还须验证 context 取消、有界返回、事务回滚、重复/并发关闭以及原目录重开后旧事务无法产生迟到写入；预算内正常完成的事务仍应提交。`internal/app` / 当前构建的原生程序验证非零关闭退出、有效 WAL 重开和正常停启 exit 0；原先的真实 Docker Work/Service 关闭集成测试验证持久运行意图与 enabled/disabled 选择未受影响。测试生成数据放在测试临时目录或忽略的 `dist/`，不提交真实故障库。

## Risks / Trade-offs

- [WAL 预检增加复制 I/O 和临时磁盘需求] -> 只在非空 WAL 路径使用副本，固定内存缓冲并及时清理；空间不足安全失败，不改原目录。
- [未知/损坏输入在普通只读连接下仍可能改变 SHM] -> 所有 WAL-aware 拒绝预检在私有副本上执行，扩展原目录逐字节不变的负向测试。
- [关闭重排提前释放安装锁或遗漏清理] -> 两阶段幂等收尾，锁竞争子进程与存储/日志失败测试覆盖边界。
- [busy 等待使关闭超过原总预算] -> 使用上层剩余 context 与更短 busy 等待；用短预算真实读锁测试验证取消和错误传播。
- [原现场占用来源未确定] -> 本变更修复已证实的恢复和结果判定缺陷，明确复现中的读锁是受控条件，不把它当作现场锁来源证据。
- [进程被强杀可能留下私有临时副本] -> 临时目录不放入业务安装、不对外可读；正常成功/失败/取消按精确归属清理，不承诺强杀时执行清理，不新增全局临时目录扫描。

## Migration Plan

实现阶段不执行数据库迁移，不改 marker、schemaVersion 或已发布制品身份。验收先在合成数据与隔离安装完成；实际部署继续遵守停止 Core 后备份完整数据目录和受管卷的既有流程，不能只备份主库。

修复程序应直接打开保留的支持格式主库与 WAL，用户不必运行恢复脚本。回退到原版 0.0.11 仍可能重现 immutable 检查失败，不能宣称旧版具有新的恢复能力；必要回退使用已停止的一致备份和原程序。公开发布、下游 MicroVM 更新或原始现场操作须另行发起，不在本变更实施时自动执行。
