# WAL 恢复与关闭结果验收

2026-10-22，本变更在 Linux amd64 / WSL2、Go 1.25.5 下实施并验收。下列结果来自本次执行，使用合成数据库、独立安装和真实 SQLite；原始故障安装未被修复或改写。

## 实现与契约对应

| 范围 | 实现及自动验证 |
| --- | --- |
| 包含已提交 WAL 的预检 | `internal/corestore/wal.go` 在私有副本中核验完整快照；`TestWALFixtureExposesImmutableStartupFailure` 保留旧检查的失败证明，`TestOpenRecoversPartiallyCheckpointedWAL` 验证新路径读回准确提交值及安装身份，覆盖正常、缺少、空和过期 SHM |
| 初始化恢复和发布 | `TestInitializationPublishedDatabaseRecoversWAL`、既有初始化中断测试，以及 `TestInitializationBlockedCheckpointDoesNotPublish` 验证正式库残留 WAL 的恢复和未确认时不发布 ready |
| 拒绝且不改写 | `TestWALPreflightRejectsWithoutChangingOriginalFiles` 比较整个原目录文件集合和哈希，覆盖 WAL 内身份/版本/schema 变化、逻辑损坏、权限与链接；预检创建/复制故障及取消测试验证私有暂存清理，既有未知格式与危险路径测试仍通过 |
| 进程中断与事务边界 | `TestWALCrashRecoversCommittedTransactionsOnly` 用独立 Go Store 进程提交后开启未提交事务并强制终止，验证只恢复提交值，身份及 schemaVersion 1 保持 |
| checkpoint 与关闭资源 | `internal/corestore/checkpoint.go` 读取结果行并约束 busy 等待；`checkpoint_test.go` 覆盖真实外部读锁、剩余预算、SQL/句柄关闭失败、两阶段所有权及重试恢复，错误不带原始 SQLite 细节 |
| 最终日志与锁顺序 | `shutdown_storage_test.go` 覆盖 storage unconfirmed、日志写入/同步失败、正常 succeeded、重复清理及最终日志期间第二进程仍被锁拒绝；既有 shutdown policy/contention、日志边界及共享清理测试通过 |
| 实际程序退出及重开 | `TestCoreProcessCheckpointFailureAndWALReopen` 对测试子进程和本次构建的 ELF 均通过：正常 exit 0、阻塞 checkpoint 非零退出，释放读锁后直接启动，原登录会话、提交值和 marker 保留，全部 listener 释放；程序 PATH 指向无工具的空目录 |
| 真实 Work/Service 生命周期 | 独立 Docker Engine 28.5.2 中运行既有两个 NativeShutdown 集成测试，确认 Agent/Service 停止、重开保留 Work/context 与 enabled/disabled 选择，以及一个 Agent drain 失败不阻止其他 Work 停止 |

## 实际执行

以下命令通过：

```sh
make build-go
CGO_ENABLED=0 go test -mod=readonly -p=1 ./internal/corestore ./internal/coreapp ./internal/app ./internal/corelogs ./internal/safefs
PIWORK_TEST_CORE_BINARY="$PWD/dist/go/piwork-core" CGO_ENABLED=0 \
  go test -mod=readonly ./internal/app -run '^TestCoreProcessCheckpointFailureAndWALReopen$' -count=1 -v
```

五个包的执行耗时分别为 3.010、86.415、8.455、0.096 秒及 safefs 缓存通过。实际 ELF 的独立进程用例为 6.00 秒。构建采用现有受管 `dist/go`；尝试自定义输出目录被构建入口保护规则拒绝后，使用默认入口成功，未修改该保护规则。

集成测试先在宿主 Docker 26.1.5 上失败于 Work 创建之前，安全状态为 `defaultContext=CONTEXT_PREPARATION_FAILED`。独立的有归属标签网络创建探针确认：宿主默认 IPv4 地址池已用尽；没有清理其他安装的网络。现有测试镜像和当前源码新建 Agent acceptance 镜像的尝试均受同一环境条件阻断，因此这些失败不记为停机验收通过。

随后使用现有 `docker:28-dind` 启动独立网络命名空间和 Engine，地址池为 `10.250.0.0/16`，只监听私有 Unix socket，并装入三个明确镜像。编译、执行步骤为：

```sh
CGO_ENABLED=0 go test -mod=readonly -tags=integration -c \
  -o dist/wal-fix-validation/coreapp-integration.test ./internal/coreapp
python3 dist/wal-fix-validation/isolated_integration.py
```

临时驱动在独立 Engine 容器内以宿主同 UID/GID 执行该测试二进制，设置 `PIWORK_TEST_DOCKER_HOST`、三个 native image 测试变量、独立 TMPDIR，使用以下选择器和 20 分钟上限；没有替换 Core/Agent/Service 或 readiness 检查：

```text
-test.run=^TestNativeShutdown(RestartPreservesEnabledAndDisabledServices|ConfirmsOtherWorksAfterFailedAgentDrain)$
-test.timeout=20m
```

两个测试均 PASS，进程 exit 0，总计 91.554 秒。Engine 和数据卷采用 `piwork.acceptance.fixture=piwork-wal-9d3a438ed8d6` 精确归属检查后删除，独立临时目录已清理；未执行全局 prune。临时驱动、完整输出与清理结果保留在忽略的 `dist/wal-fix-validation/`，仓库回归测试不依赖这些一次性输出。

## 首次实施产物身份（补修前）

| 产物 | 实际身份 |
| --- | --- |
| 首次实施时的 `dist/go/piwork-core` | `0.1.0-dev`，commit `2142491f5103b58731de4872d153bd1b876860de`，modified=true，Go 1.25.5，linux/amd64，CGO_ENABLED=0；静态 ELF |
| Core SHA256 | `ed87c5bae4ab1c5f1c6a1af4fd94bca1eeca10f9e53056622893ebb2ae86b72d` |
| `piwork-agentd:wal-recovery-acceptance` | 本次从当前源码构建的 acceptance target，modified=true；`sha256:1e505999f818bff74b8f06956e9a077cdfd6aeb59ec95dd008100f7fbdf156c7` |
| `piwork-file-helper:go-migration-acceptance` | 复用现有协议兼容镜像；`sha256:3edd359fa9a9b2d3d28858c2d8bd75e4898892907876c6d4317a45d121c6072c` |
| `piwork-snapshot-helper:go-migration-acceptance` | 复用现有协议兼容镜像；`sha256:f6fa572a07aa502ccd711f5aa394ffb2d1bfd40867353c2f9b48d2c3dd39297f` |

这些是本机构建和测试身份，未改写 0.0.11 已发布制品身份。宿主 Node 25.6.0 用于现有构建辅助脚本和静态检查；Agent 镜像的 Node 24 构建按 Dockerfile 执行。本次没有重跑完整前端构建或声明宿主 Node 24 基础流程验收。

## 验收边界

OpenSpec strict、原生源码边界、仓库文档归属、格式及 diff 检查通过。未执行完整 `make test`、发行、镜像推送、真实模型调用、浏览器专项或下游 MicroVM 重新打包；本变更的 scoped Go/SQLite/进程及真实 Work 关闭验收不能代替这些场景。原故障现场的锁持有者仍未知，受控读事务证明的是可复现路径。

## 核验后补修：内部事务与关闭预算

同日独立核验发现，首次实施的短预算用例只覆盖外部 SQLite 读锁：`Read` / `Write` 跨回调持有生命周期读锁，关闭在不响应 context 的写锁上等待。合成回调保持阻塞时，50ms 关闭 context 在 250ms 后仍未返回。新增 `TestShutdownBoundsInternalTransactions` 后，旧实现实际失败于“shutdown ignored context while an internal transaction callback was blocked”，随后按现有预算要求补修。

`transactions.go` 改为跟踪 SQL 连接租约，生命周期互斥只保护准入与状态。关闭停止新事务，用剩余 context 排空；到期取消事务，允许 SQLite 回滚及归还连接，不再要求非 SQL 回调先退出。`shutdown.go` 的唯一清理者负责连接池和根目录；调用者有界返回未确认，实际 SQL 或驱动清理期间仍持锁，且最终释放请求须在日志收尾之后发出。未结束的旧回调不能继续 SQL 或提交，预算内完成的事务仍可提交。

| 自动回归 | 核验内容 |
| --- | --- |
| `TestShutdownBoundsInternalTransactions` | 内部读/写、完整/两阶段关闭、超时/显式取消的八种组合；拒绝新事务，保留首次失败，旧回调仍阻塞时能完成 SQL 清理和同目录重开，未提交及迟到写入均不可见 |
| `TestShutdownDrainsTransactionWithinBudget` | 正常排空不提前取消，已提交值在重开后保留 |
| `TestWriterAdmissionHonorsCancellation` | 等待单连接写池时响应取消，不再阻塞于独立写互斥 |
| `TestShutdownRetainsOwnershipUntilDriverCleanupEnds` | 受控阻塞实际驱动 Close，并发调用者仍按自己的截止时间返回，实际清理前不释放锁 |
| `TestShutdownWaitsForActualRollbackBeforeReleasingOwnership` | 受控阻塞真实 `database/sql` 回滚路径，不能因 `Tx` 已被标记 done 就提前归还所有权；回滚结束后自动释放，无须再次 Close |
| `TestShutdownBoundsInternalTransactionCallbacks` | 应用级读/写回调保持阻塞时，50ms 预算能有界返回安全错误，唯一最终事件为 unconfirmed，自动释放后新应用可重开，旧事务不得产生迟到写入 |

两个既有进程内测试（shutdown policy 与失败 Agent drain 集成测试）原先在超时返回瞬间立即重开，复跑实际遇到清理尚未结束的锁竞争。现通过共享只读锁探针等待最多 500ms，验证原清理者**自动**释放，不额外调用旧 Store.Close，也不改变被测关闭调用本身的预算。模拟阻塞回滚和驱动 Close 的负向测试同时证明：真实清理未结束时不能提前放锁。实际 Core 进程退出仍由内核释放其剩余 fd。

补修期间新增的阻塞回滚夹具最初未实现驱动的只读 BeginTx 能力，导致夹具启动失败后等待超时；补齐接口及握手失败诊断后用例通过。该次失败不计为产品回归通过。

补修后实际执行并通过：

```sh
make build-go
CGO_ENABLED=0 go test -mod=readonly -p=1 \
  ./internal/corestore ./internal/coreapp ./internal/app ./internal/corelogs ./internal/safefs
CGO_ENABLED=1 go test -mod=readonly -race ./internal/corestore ./internal/coreapp \
  -run '^(TestShutdown|TestWriterAdmission|TestCheckpoint|TestDatabaseClose|TestWorkLockWaitHonorsCancellation|TestSecondCoreDoesNotModifyLogShards)' \
  -count=1 -timeout=60s
PIWORK_TEST_CORE_BINARY="$PWD/dist/go/piwork-core" CGO_ENABLED=0 \
  go test -mod=readonly ./internal/app -run '^TestCoreProcessCheckpointFailureAndWALReopen$' -count=1 -v
CGO_ENABLED=0 go test -mod=readonly -tags=integration -c \
  -o dist/wal-close-budget-fix/coreapp-integration.test ./internal/coreapp
python3 dist/wal-close-budget-fix/isolated_integration.py
```

最终五包执行中 corestore 为 3.531 秒、coreapp 为 84.277 秒，其余缓存通过；补修后的 app 包此前非缓存执行为 8.292 秒。两包竞态专项分别为 7.468 与 14.375 秒。竞态检测仅为开发验证启用 CGo，生产构建及原生程序验收仍为 CGO_ENABLED=0；实际 ELF 停启回归为 6.42 秒并通过。

Docker 首次补修复跑中，正常关闭/重开测试通过，失败 Agent drain 用例遇到上述进程内清理锁竞争，不能计为整组通过；该次精确归属为 `piwork-wal-23fdd54c53b8`，Engine 与卷均已删除。修正两处进程内等待断言后重新编译当前测试二进制，两个用例均 PASS，分别为 71.82 与 20.06 秒，总计 91.999 秒。该次独立 Engine 28.5.2 的归属为 `piwork-wal-11f8ed04e14f`，Engine、数据卷与私有临时目录均已按精确标签检查后清理；复用上述三个 acceptance 镜像，没有推送或发布。临时驱动、两次结果与清理记录保留在忽略的 `dist/wal-close-budget-fix/`。

补修后当前 `dist/go/piwork-core` SHA256 为 `979d29861412fc86674fedd74542dfa2e2ef73bec8f14ed0ccbfabc7f0b04a72`，仍为 `0.1.0-dev`、commit `2142491f5103b58731de4872d153bd1b876860de`、modified=true、Go 1.25.5、linux/amd64、CGO_ENABLED=0。上文首次实施的 hash 继续作为当时产物事实保留。

OpenSpec strict、源码边界、仓库文档归属、Docker Quick Start 一致性及其 30 项测试、gofmt 与 diff 检查通过。规格新增内部事务阻塞场景，任务 2.2 / 3.2 及相关验证重新执行；本节不扩大前述发行、真实模型、前端和下游 MicroVM 的验收边界。
