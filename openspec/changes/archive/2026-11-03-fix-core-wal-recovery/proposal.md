# Proposal

## Why

Piwork 0.0.11 在 SQLite 主库尚依赖已提交 WAL 时，启动预检使用 `immutable=1` 忽略 WAL，将合法的同格式存储误报为 `CORE_STORAGE_FORMAT_UNSUPPORTED`。隔离复现还确认：关闭时 checkpoint 被读事务阻塞，Core 仍返回退出码 0；需要一并修复恢复路径、关闭结果检查和最终关闭日志，保证保留的数据能直接重开。

## What Changes

- 对支持的 Go 数据目录，以包含已提交 WAL 的 SQLite 一致快照核验安装身份、版本、完整 schema 和完整性；通过后才打开原库的业务写连接，不要求用户手工 checkpoint。
- 保留未知格式、身份不匹配、损坏存储、危险路径和第二个 Core 所有者的拒绝边界；拒绝预检不得改写原始数据库、WAL、marker 或其他安装文件。
- 读取并检查 `wal_checkpoint(TRUNCATE)` 的结果行，将 busy、未完成及执行错误纳入关闭失败；首次初始化发布数据库前复用相同的结果检查。
- 存储收尾使用既有关闭流程的剩余预算；最终 `app.shutdown` 记录包含存储结果，日志收尾完成后释放安装所有权。
- 添加真实 SQLite、多进程读锁、进程中断及应用重启回归，覆盖有效 WAL、拒绝且不改写、不谎报关闭成功和资源释放。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `core-service-startup`：明确 Go 存储核验必须包含有效 WAL，以及 checkpoint 未完成时的有界退出、关闭日志和再次启动行为。

## Impact

- `internal/corestore/store.go` 及所属测试：启动/初始化核验、checkpoint 结果、存储收尾及目录锁生命周期。
- `internal/coreapp/application.go`、`internal/coreapp/logging.go` 及关闭/日志测试：汇总存储结果后记录最终生命周期事件。
- `internal/app/run.go` 及进程级测试：沿用退出码与总关闭预算，验证真实启动、停止和同目录重开。
- 复用 `internal/safefs` 的私有目录和文件校验；仍使用现有纯 Go SQLite，不增加宿主工具或数据库依赖。
- 保持 `piwork-go-core` / schemaVersion 1、HTTP/RPC 契约、启动参数和发布身份。修复范围属于上游 Piwork；发行、镜像推送、MicroVM 重新打包与用户原始故障目录修复不在本变更内。
