# Tasks

## 1. WAL-aware 存储预检与恢复

- [x] 1.1 在 `internal/corestore` 建立使用现有 SQLite 驱动和握手子进程的合成 WAL 夹具，稳定产生部分回填状态；验证主库单独 quick_check 失败而完整快照通过，原启动路径拒绝该样本，读锁不会被观察代码意外释放。
- [x] 1.2 实现非空 WAL 的私有副本预检，复用安装身份、版本、精确 schema 和完整性核验，并接入 ready 库及初始化中已发布库的路径；验证 1.1 的样本可直接打开、读回准确已提交值和原安装身份，无/空/过期 SHM 均可恢复，原有干净重开测试通过。
- [x] 1.3 补齐 WAL-only 身份/版本/schema 变化、完整快照损坏、路径/权限/链接拒绝，以及临时副本创建、复制失败和取消的回归；验证拒绝时原目录文件集合和各文件哈希不变、本次临时资源清理，已有 `TestUnsupportedDirectoriesRemainUnchanged`、`TestCorruptOrMismatchedGoDatabaseRejectedWithoutWrites` 与路径拒绝测试继续通过。
- [x] 1.4 增加独立进程在提交后、下一事务未提交时中断的恢复用例，并保留初始化中断测试；验证重开只读到已提交数据、身份/schemaVersion 不变，`TestInitializationInterruptionsRecoverOnlyRegisteredFiles` 和多进程锁测试通过。

## 2. checkpoint 结果与存储关闭生命周期

- [x] 2.1 用结果行查询替换关闭及首次发布前的 checkpoint Exec，统一检查 busy、回填/截断计数与执行错误，接受上层剩余 context；验证真实读锁阻塞返回未确认，正常 TRUNCATE 成功，SQL 失败与短截止时间不被吞掉，首次初始化未确认时不发布 ready marker。
- [x] 2.2 将数据库句柄收尾与根目录锁释放拆为内部两阶段，保留完整、幂等的 `Store.Close` 清理路径并汇总首次错误；验证读写句柄失败后仍尝试资源释放、数据库关闭后第二进程仍被锁拒绝、最终释放后可直接重开有效 WAL，原非应用 Close 调用者不会遗留安装锁。核验补修：内部事务排空及并发关闭等待也须遵守 context，超时取消事务后旧回调不得再写入，实际数据库清理完成前不得释放所有权。

## 3. 应用关闭结果、日志与退出状态

- [x] 3.1 在 `internal/coreapp` 接入两阶段存储关闭，汇总存储结果后记录最终 `app.shutdown`，检查最终事件写入与日志同步关闭错误，再释放安装锁；验证 checkpoint 阻塞/失败时事件为 unconfirmed、正常关闭为 succeeded、日志错误传播到应用错误且输出不含原始 SQLite 内容、路径或凭据。
- [x] 3.2 增加应用级关闭竞争和预算回归，覆盖日志收尾期间第二个 Core、存储收尾前预算接近耗尽、重复清理及已有共享任务失败分支；验证锁与日志未被第二进程改写，短预算用例不会额外等待完整 5 秒，并通过既有 shutdown policy/contention 和 logging boundary 测试。核验补修：内部读写事务回调持续阻塞时，应用仍须有界返回 unconfirmed、完成日志收尾并安全释放存储，重开后不能收到旧事务的迟到写入。
- [x] 3.3 为 `internal/app` / 原生进程入口添加可自动重跑的关闭与重开回归，使用独立目录、端口及受控读锁；验证 SIGTERM 下 checkpoint 未完成对应非零退出，释放读锁后无需手工 checkpoint 即可启动并读回准确数据，正常停启 exit 0，所有本次子进程和 listener 均被回收。

## 4. 集成验证与本变更验收

- [x] 4.1 以 `CGO_ENABLED=0` 构建当前 `piwork-core`，执行 `go test -mod=readonly ./internal/corestore ./internal/coreapp ./internal/app ./internal/corelogs ./internal/safefs`，并用当前构建程序执行 3.3 的进程验收；验证恢复、拒绝、关闭预算和日志用例通过，运行不依赖 Python/sqlite3 CLI 等宿主工具。
- [x] 4.2 使用 Makefile 约定的 native acceptance 镜像与独立测试安装，运行 `go test -mod=readonly -tags=integration -v -timeout=20m ./internal/coreapp -run '^TestNativeShutdown(RestartPreservesEnabledAndDisabledServices|ConfirmsOtherWorksAfterFailedAgentDrain)$'`；验证真实 Agent/Service 已停、重开保留运行意图及 enabled/disabled 选择，只按本次 installation ID/标签清理资源。
- [x] 4.3 执行 `openspec validate fix-core-wal-recovery --strict`、`node scripts/check-native-boundary.mjs`、`node scripts/check-repository-docs.mjs` 与 `git diff --check`，将跨阶段实际命令、平台、结果和未测边界记入本变更必要验收附件；验证规格与实现逐项对应，临时日志/数据库留在测试目录或忽略的 `dist/`，不把本地通过写成发布或下游 MicroVM 已修复。
