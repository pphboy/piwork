# Tasks

## 1. 帮助文本

- [x] 1.1 从 `internal/app/run.go` 的 `coreHelp` 删除 "Internal Agent mTLS uses port 7172" 说明句，保持 `--ui-port`/`--core-port`/`--data-dir`、ADMIN 初始化和 `piwork-cli` 说明不变；验证：新增断言确认 `--help` 输出不含 `7172` 与 `mTLS`、仍含三项参数，且 `go test ./internal/app/ -run TestUnifiedHelpVersionAndWrongUserCommandsHaveNoStartupEffects` 通过。
- [x] 1.2 确认删除后仓库内无代码或其他帮助文本继续引用该句，部署材料中的 7172 说明保持；验证：`grep -rn "Internal Agent mTLS" --include='*.go' --include='*.md' .` 只命中本变更产物，代码与部署手册无残留。

## 2. 验证

- [x] 2.1 构建后按真实入口核对输出：`make build`，执行 `./dist/go/piwork-core --help` 确认不含 7172 与 mTLS 说明、退出码为 0、不创建数据目录；把实际输出记录到本变更 `acceptance.md`。
- [x] 2.2 运行受影响包检查：`go test ./internal/app/...` 与 `go vet ./internal/app/...` 通过，无新增 actionable warning。
